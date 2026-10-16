<?php

namespace App\Http\Controllers;

use App\Models\CalendarSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class CalendarSettingsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(CalendarSetting::forUser($request->user())->toApi());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'work_start' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'work_end' => ['required', 'regex:/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/'],
            'work_keywords' => 'array|max:50',
            'work_keywords.*' => 'string|max:60',
            'work_days' => 'sometimes|array|max:7',
            'work_days.*' => 'integer|between:0,6',
        ]);

        if ($this->toMinutes($data['work_end']) <= $this->toMinutes($data['work_start'])) {
            throw ValidationException::withMessages([
                'work_end' => 'The work end must be after the work start.',
            ]);
        }

        $settings = CalendarSetting::forUser($request->user());
        $settings->update([
            'work_start' => $data['work_start'],
            'work_end' => $data['work_end'],
            'work_keywords' => array_values(array_filter(array_map('trim', $data['work_keywords'] ?? []))),
            'work_days' => $this->normalizeWorkDays($data['work_days'] ?? null, $settings),
        ]);

        return response()->json($settings->toApi());
    }

    /**
     * "06:30" → 390, "24:00" → 1440.
     */
    private function toMinutes(string $value): int
    {
        [$hours, $minutes] = array_map('intval', explode(':', $value));

        return $hours * 60 + $minutes;
    }

    /**
     * @param  array<int, mixed>|null  $workDays
     * @return array<int, int>
     */
    private function normalizeWorkDays(?array $workDays, CalendarSetting $settings): array
    {
        if ($workDays === null) {
            return $settings->workDays();
        }

        $days = array_values(array_unique(array_map('intval', $workDays)));
        sort($days);

        return $days;
    }
}
