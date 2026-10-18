<?php

namespace App\Http\Controllers;

use App\Models\SideTask;
use App\Services\GeminiCoachService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Throwable;

class SideTaskController extends Controller
{
    /** Longest a single task may be estimated at, in minutes (24 hours). */
    private const MAX_ESTIMATE_MINUTES = 1440;

    public function __construct(private GeminiCoachService $gemini) {}

    /**
     * Every side task, newest last. The client splits the list itself: the todo
     * card shows the live ones, and the calendar draws the placed ones — finished
     * tasks included, so a slot that has passed stays visible and flagged.
     */
    public function index(Request $request): JsonResponse
    {
        $tasks = $request->user()->sideTasks()
            ->orderBy('id')
            ->get()
            ->map(fn (SideTask $task) => $task->toApi());

        return response()->json($tasks);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'estimate_minutes' => ['required', 'integer', 'min:1', 'max:'.self::MAX_ESTIMATE_MINUTES],
            'start' => ['nullable', 'date'],
            'blocks_work' => ['sometimes', 'boolean'],
        ]);

        $start = isset($data['start']) ? Carbon::parse($data['start']) : null;

        $task = $request->user()->sideTasks()->create([
            'title' => trim($data['title']),
            'estimate_minutes' => $data['estimate_minutes'],
            'start' => $start,
            // The end is always derived, so a placed task can never disagree with its estimate.
            'end' => $start?->copy()->addMinutes($data['estimate_minutes']),
            'blocks_work' => $data['blocks_work'] ?? true,
        ]);

        return response()->json($task->toApi(), 201);
    }

    public function update(Request $request, int $taskId): JsonResponse
    {
        $task = $request->user()->sideTasks()->whereKey($taskId)->firstOrFail();

        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'estimate_minutes' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_ESTIMATE_MINUTES],
            'start' => ['sometimes', 'nullable', 'date'],
            'blocks_work' => ['sometimes', 'boolean'],
            'completed' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('title', $data)) {
            $task->title = trim($data['title']);
        }

        if (array_key_exists('estimate_minutes', $data)) {
            $task->estimate_minutes = $data['estimate_minutes'];
        }

        if (array_key_exists('blocks_work', $data)) {
            $task->blocks_work = $data['blocks_work'];
        }

        if ($request->has('start')) {
            $start = $data['start'] !== null ? Carbon::parse($data['start']) : null;
            $task->start = $start;
            // Re-derive the end so it can never disagree with the estimate.
            $task->end = $start?->copy()->addMinutes($task->estimate_minutes);
            // Moving a task makes it live again; the planned slot is no longer finished.
            $task->completed_at = null;
        } elseif (array_key_exists('estimate_minutes', $data) && $task->start !== null) {
            $task->end = $task->start->copy()->addMinutes($task->estimate_minutes);
        }

        // Completing by hand records *when* it finished; the planned end is left
        // untouched so undo can put the task back on its original slot.
        if (array_key_exists('completed', $data)) {
            $task->completed_at = $data['completed'] ? now() : null;
        }

        $task->save();

        return response()->json($task->toApi());
    }

    public function destroy(Request $request, int $taskId): JsonResponse
    {
        $request->user()->sideTasks()->whereKey($taskId)->firstOrFail()->delete();

        return response()->json(null, 204);
    }

    /**
     * Ask the coach where the unplaced tasks should go.
     *
     * Only the unscheduled ones are candidates; the answer proposes a concrete
     * local day and time for each, deferring to next week when this week's free
     * time will not fit the remaining work. Slots already behind the clock are
     * dropped before the reply leaves the server.
     */
    public function plan(Request $request): JsonResponse
    {
        if (! $this->gemini->isConfigured()) {
            return response()->json([
                'available' => false,
                'message' => 'Add a GEMINI_API_KEY to enable AI coaching.',
            ], 503);
        }

        $validated = $request->validate(['context' => ['required', 'array']]);

        $candidates = $request->user()->sideTasks()
            ->whereNull('completed_at')
            ->whereNull('start')
            ->orderBy('id')
            ->get();

        if ($candidates->isEmpty()) {
            return response()->json([
                'available' => true,
                'reply' => 'Every task is already scheduled or done, so there is nothing to place.',
                'suggestions' => [],
            ]);
        }

        /** @var array<int, array{id: int, title: string, estimateMinutes: int, blocksWork: bool}> $tasks */
        $tasks = $candidates->map(fn (SideTask $task): array => [
            'id' => $task->id,
            'title' => $task->title,
            'estimateMinutes' => $task->estimate_minutes,
            'blocksWork' => (bool) $task->blocks_work,
        ])->all();

        try {
            $text = $this->gemini->planTasks($tasks, $validated['context']);
        } catch (Throwable $e) {
            Log::warning('Gemini task planning failed', ['message' => $e->getMessage()]);

            return response()->json([
                'available' => true,
                'message' => 'The AI coach could not be reached right now.',
            ], 502);
        }

        $parsed = $this->gemini->extractPlans($text, $this->localCutoff($validated['context']));

        return response()->json([
            'available' => true,
            'reply' => $parsed['text'],
            'suggestions' => $parsed['plans'],
            'generatedAt' => now()->toIso8601String(),
        ]);
    }

    /**
     * The user's current local wall clock ("Y-m-d H:i") that a proposed slot
     * must sit after, so a suggestion in the past never reaches the client.
     *
     * The snapshot carries the instant (`now`) plus either an IANA zone or a
     * numeric offset; the zone wins because it survives daylight-saving shifts.
     *
     * @param  array<string, mixed>  $context
     */
    private function localCutoff(array $context): ?string
    {
        $stamp = is_string($context['now'] ?? null) ? strtotime($context['now']) : false;

        if ($stamp === false) {
            return null;
        }

        $now = Carbon::createFromTimestamp($stamp);

        $timeZone = is_string($context['timeZone'] ?? null) ? trim($context['timeZone']) : '';
        if ($timeZone !== '') {
            try {
                return $now->setTimezone($timeZone)->format('Y-m-d H:i');
            } catch (Throwable) {
                // Not a real zone — fall through to the numeric offset.
            }
        }

        if (is_numeric($context['utcOffsetMinutes'] ?? null)) {
            return $now->utcOffset((int) $context['utcOffsetMinutes'])->format('Y-m-d H:i');
        }

        return $now->format('Y-m-d H:i');
    }
}
