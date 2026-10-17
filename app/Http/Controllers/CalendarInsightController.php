<?php

namespace App\Http\Controllers;

use App\Services\GeminiCoachService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class CalendarInsightController extends Controller
{
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
}
