<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class DayOffController extends Controller
{
    public function index(Request $request)
    {
        $dayOffs = $request->user()->dayOffs()
            ->orderBy('date')
            ->get()
            ->map(function ($dayOff) {
                return [
                    'date' => $dayOff->date->format('Y-m-d'),
                    'type' => $dayOff->type,
                    'created_at' => $dayOff->created_at?->toISOString(),
                ];
            });

        return response()->json($dayOffs);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'date' => 'required|date',
            'type' => 'sometimes|in:excluded,included',
        ]);

        $date = Carbon::parse($data['date']);
        $dateKey = $date->format('Y-m-d');

        $existing = $request->user()->dayOffs()->where('date', $dateKey)->first();
        if ($existing) {
            // Update type if different
            if ($existing->type !== ($data['type'] ?? 'excluded')) {
                $existing->update(['type' => $data['type'] ?? 'excluded']);
            }

            return response()->json(['message' => 'Day off already exists'], 409);
        }

        $dayOff = $request->user()->dayOffs()->create([
            'date' => $dateKey,
            'type' => $data['type'] ?? 'excluded',
        ]);

        return response()->json([
            'date' => $dayOff->date->format('Y-m-d'),
            'type' => $dayOff->type,
            'created_at' => $dayOff->created_at?->toISOString(),
        ], 201);
    }

    public function destroy(Request $request, string $date)
    {
        $dayOff = $request->user()->dayOffs()->where('date', $date)->first();

        if (! $dayOff) {
            return response()->json(['message' => 'Day off not found'], 404);
        }

        $dayOff->delete();

        return response()->json(['message' => 'Day off removed']);
    }
}
