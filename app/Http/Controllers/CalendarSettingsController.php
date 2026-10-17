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
            'required_days' => 'sometimes|array|max:7',
            'required_days.*' => 'integer|between:0,6',
        ]);

        if ($this->toMinutes($data['work_end']) <= $this->toMinutes($data['work_start'])) {
            throw ValidationException::withMessages([
                'work_end' => 'The work end must be after the work start.',
            ]);
        }

        $settings = CalendarSetting::forUser($request->user());
        $workDays = $this->normalizeDays($data['work_days'] ?? null, $settings->workDays());

        // A day can only be *required* if it is also workable, and dropping a day
        // from the working week must drop it from the required week too.
        $requiredDays = array_values(array_intersect(
            $this->normalizeDays($data['required_days'] ?? null, $settings->requiredDays()),
            $workDays,
        ));

        $settings->update([
            'work_start' => $data['work_start'],
            'work_end' => $data['work_end'],
            'work_keywords' => array_values(array_filter(array_map('trim', $data['work_keywords'] ?? []))),
            'work_days' => $workDays,
            'required_days' => $requiredDays,
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
     * @param  array<int, mixed>|null  $days
     * @param  array<int, int>  $fallback
     * @return array<int, int>
     */
    private function normalizeDays(?array $days, array $fallback): array
    {
        if ($days === null) {
            return $fallback;
        }

        $days = array_values(array_unique(array_map('intval', $days)));
        sort($days);

        return $days;
    }
}
