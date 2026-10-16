<?php

namespace App\Http\Controllers;

use App\Models\CalendarSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
        ]);

        if (strcmp($data['work_end'], $data['work_start']) <= 0) {
            return response()->json(['message' => 'End time must be after start time.'], 422);
        }

        $settings = CalendarSetting::forUser($request->user());
        $settings->update([
            'work_start' => $data['work_start'],
            'work_end' => $data['work_end'],
            'work_keywords' => array_values(array_filter(array_map('trim', $data['work_keywords'] ?? []))),
        ]);

        return response()->json($settings->toApi());
    }
}
