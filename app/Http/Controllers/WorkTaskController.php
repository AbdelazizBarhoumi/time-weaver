<?php

namespace App\Http\Controllers;

use App\Models\WorkTask;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class WorkTaskController extends Controller{
    /**
     * Every work task, oldest position first. Finished tasks are returned too —
     * nothing is ever deleted for being done, so the panel can keep showing
     * them (the client groups them under "completed").
     */
    public function index(Request $request): JsonResponse
    {
        $tasks = $request->user()->workTasks()
            // Only the columns the duration maths needs, so a long history
            // does not drag whole session payloads into memory.
            ->with(['workSessions' => fn ($query) => $query->select([
                'id', 'work_task_id', 'start', 'end', 'paused_ms', 'paused_at',
            ])])
            ->orderBy('position')
            ->orderBy('id')
            ->get()
            ->map(fn (WorkTask $task) => $task->toApi());

        return response()->json($tasks);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'estimate_minutes' => ['required', 'integer', 'min:1', 'max:'.WorkTask::MAX_ESTIMATE_MINUTES],
            'due_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string'],
        ]);

        $task = $request->user()->workTasks()->create([
            'title' => trim($data['title']),
            'estimate_minutes' => $data['estimate_minutes'],
            'due_at' => isset($data['due_at']) ? Carbon::parse($data['due_at']) : null,
            'notes' => $data['notes'] ?? null,
            'position' => ($request->user()->workTasks()->max('position') ?? -1) + 1,
        ]);

        return response()->json($task->toApi(), 201);
    }

    public function update(Request $request, int $taskId): JsonResponse
    {
        $task = $request->user()->workTasks()->whereKey($taskId)->firstOrFail();

        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'estimate_minutes' => ['sometimes', 'integer', 'min:1', 'max:'.WorkTask::MAX_ESTIMATE_MINUTES],
            'due_at' => ['sometimes', 'nullable', 'date'],
            'notes' => ['sometimes', 'nullable', 'string'],
            'position' => ['sometimes', 'integer', 'min:0'],
            'completed' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('title', $data)) {
            $task->title = trim($data['title']);
        }

        if (array_key_exists('estimate_minutes', $data)) {
            $task->estimate_minutes = $data['estimate_minutes'];
        }

        if (array_key_exists('due_at', $data)) {
            $task->due_at = $data['due_at'] !== null ? Carbon::parse($data['due_at']) : null;
        }

        if (array_key_exists('notes', $data)) {
            $task->notes = $data['notes'];
        }

        if (array_key_exists('position', $data)) {
            $task->position = $data['position'];
        }

        // Completing records *when* it finished; undo simply clears the stamp.
        // The tracked sessions stay linked either way, so the history survives.
        if (array_key_exists('completed', $data)) {
            $task->completed_at = $data['completed'] ? now() : null;
        }

        $task->save();

        return response()->json($task->fresh()->toApi());
    }

    /**
     * Mark the task as started (idempotent). Called when the user begins the
     * timer on a task, so "in progress" reflects that work has really begun.
     */
    public function start(Request $request, int $taskId): JsonResponse
    {
        $task = $request->user()->workTasks()->whereKey($taskId)->firstOrFail();

        if ($task->started_at === null) {
            $task->started_at = now();
            $task->save();
        }

        return response()->json($task->fresh()->toApi());
    }

    /**
     * Manual removal only — completing a task never deletes it. Any tracked
     * sessions survive, unlinked, because the foreign key is null-on-delete.
     */
    public function destroy(Request $request, int $taskId): JsonResponse
    {
        $request->user()->workTasks()->whereKey($taskId)->firstOrFail()->delete();

        return response()->json(null, 204);
    }
}
