<?php

namespace App\Http\Controllers;

use App\Services\GeminiCoachService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Throwable;

class CalendarInsightController extends Controller
{
    /** Cap on a single chat turn, keeping the replayed transcript bounded. */
    private const MAX_MESSAGE_CHARS = 4000;

    /** Cap on how many turns are replayed to Gemini. */
    private const MAX_MESSAGES = 24;

    public function __construct(private GeminiCoachService $gemini) {}

    /**
     * Whether the AI coach is available (an API key is configured).
     */
    public function status(): JsonResponse
    {
        return response()->json(['available' => $this->gemini->isConfigured()]);
    }

    /**
     * Ask Gemini for a coaching read-out of the user's day.
     *
     * The structured facts are computed on the client from the same rules the
     * "day intelligence" card renders; we forward them to Gemini and cache the
     * answer for a short window so repeat clicks are free.
     */
    public function coach(Request $request): JsonResponse
    {
        if (! $this->gemini->isConfigured()) {
            return response()->json([
                'available' => false,
                'message' => 'Add a GEMINI_API_KEY to enable AI coaching.',
            ], 503);
        }

        $facts = $request->validate([
            'facts' => ['required', 'array'],
            'facts.dayKey' => ['required', 'string', 'max:10'],
            'facts.isWorkDay' => ['required', 'boolean'],
            'facts.isRequiredDay' => ['required', 'boolean'],
            'facts.now' => ['required', 'string', 'max:40'],
            'facts.windowStart' => ['nullable', 'string', 'max:40'],
            'facts.windowEnd' => ['nullable', 'string', 'max:40'],
            'facts.windowMs' => ['required', 'integer', 'min:0'],
            'facts.busyMs' => ['required', 'integer', 'min:0'],
            'facts.freeMs' => ['required', 'integer', 'min:0'],
            'facts.longestGapMs' => ['required', 'integer', 'min:0'],
            'facts.trackedMs' => ['required', 'integer', 'min:0'],
            'facts.goalMs' => ['required', 'integer', 'min:0'],
            'facts.remainingMs' => ['required', 'integer', 'min:0'],
            'facts.meetings' => ['present', 'array', 'max:50'],
            'facts.meetings.*.title' => ['required', 'string', 'max:200'],
            'facts.meetings.*.start' => ['required', 'string', 'max:40'],
            'facts.meetings.*.end' => ['required', 'string', 'max:40'],
            'facts.studyMs' => ['required', 'integer', 'min:0'],
            'facts.studyTodayMs' => ['required', 'integer', 'min:0'],
            'facts.studySessions' => ['present', 'array', 'max:50'],
            'facts.studySessions.*.title' => ['required', 'string', 'max:200'],
            'facts.studySessions.*.start' => ['required', 'string', 'max:40'],
            'facts.studySessions.*.end' => ['required', 'string', 'max:40'],
            'facts.backlogHours' => ['nullable', 'numeric'],
            'facts.perDayNeededHours' => ['nullable', 'numeric'],
            'facts.eventTitles' => ['present', 'array', 'max:50'],
            'facts.eventTitles.*' => ['string', 'max:200'],
        ])['facts'];

        $cacheKey = sprintf(
            'coach:%d:%s:%s',
            $request->user()->id,
            $facts['dayKey'],
            md5(json_encode($facts) ?: ''),
        );

        try {
            $text = Cache::remember($cacheKey, now()->addMinutes(15), fn () => $this->gemini->coach($facts));
        } catch (Throwable $e) {
            Log::warning('Gemini coach failed', ['message' => $e->getMessage()]);

            return response()->json([
                'available' => true,
                'message' => 'The AI coach could not be reached. Your rule-based insights are still shown.',
            ], 502);
        }

        return response()->json([
            'available' => true,
            'text' => $text,
            'generatedAt' => now()->toIso8601String(),
        ]);
    }

    /**
     * Continue a multi-turn coaching conversation.
     *
     * This is deliberately stateless: the client replays the whole transcript
     * and the current data snapshot on every turn, and we forward both to
     * Gemini with `store: false`. Nothing is persisted, and because each turn
     * is unique there is no caching here (unlike the one-shot read-out).
     */
    public function chat(Request $request): JsonResponse
    {
        if (! $this->gemini->isConfigured()) {
            return response()->json([
                'available' => false,
                'message' => 'Add a GEMINI_API_KEY to enable AI coaching.',
            ], 503);
        }

        $validated = $request->validate([
            'messages' => ['required', 'array', 'min:1', 'max:'.self::MAX_MESSAGES],
            'messages.*.role' => ['required', Rule::in(['user', 'assistant'])],
            'messages.*.content' => ['required', 'string', 'max:'.self::MAX_MESSAGE_CHARS],
            'context' => ['required', 'array'],
        ]);

        /** @var array<int, array{role: string, content: string}> $messages */
        $messages = array_slice(array_values($validated['messages']), -self::MAX_MESSAGES);

        if (($messages[array_key_last($messages)]['role'] ?? null) !== 'user') {
            return response()->json([
                'available' => true,
                'message' => 'The conversation must end with a message from you.',
            ], 422);
        }

        try {
            $reply = $this->gemini->chat($messages, $validated['context']);
        } catch (Throwable $e) {
            Log::warning('Gemini coach chat failed', ['message' => $e->getMessage()]);

            return response()->json([
                'available' => true,
                'message' => 'The AI coach could not be reached right now.',
            ], 502);
        }

        // A recommendation to place a side task hides itself in a [[PLAN:…]] marker.
        // Pull those out so the client can offer a one-click "Place" instead of
        // showing the raw syntax.
        $parsed = $this->gemini->extractPlans($reply);

        return response()->json([
            'available' => true,
            'reply' => $parsed['text'],
            'suggestions' => $parsed['plans'],
            'generatedAt' => now()->toIso8601String(),
        ]);
    }
}
