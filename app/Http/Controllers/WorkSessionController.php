<?php

namespace App\Http\Controllers;

use App\Http\Resources\MonthStatsResource;
use App\Http\Resources\StatsResource;
use App\Http\Resources\WorkSessionResource;
use App\Models\WorkSession;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;

class WorkSessionController extends Controller
{
    public function index(Request $request)
    {
        $query = $request->user()->workSessions();

        if ($request->has('from')) {
            $query->where('start', '>=', $request->date('from'));
        }

        if ($request->has('to')) {
            $query->where('start', '<=', $request->date('to')->endOfDay());
        }

        if ($request->has('month')) {
            $month = Carbon::parse($request->string('month'));
            $query->whereYear('start', $month->year)
                ->whereMonth('start', $month->month);
        }

        $sessions = $query->paginate($request->integer('per_page', 50));

        return WorkSessionResource::collection($sessions);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'start' => 'required|date',
            'end' => 'nullable|date|after_or_equal:start',
            'note' => 'nullable|string',
            'paused_ms' => 'nullable|integer|min:0',
            'paused_at' => 'nullable|date',
        ]);

        $session = $request->user()->workSessions()->create([
            'start' => $data['start'],
            'end' => $data['end'] ?? null,
            'note' => $data['note'] ?? '',
            'paused_ms' => $data['paused_ms'] ?? 0,
            'paused_at' => $data['paused_at'] ?? null,
        ]);

        return new WorkSessionResource($session);
    }

    public function show(Request $request, $sessionId)
    {
        $session = $request->user()->workSessions()->findOrFail($sessionId);
        Gate::authorize('view', $session);

        return new WorkSessionResource($session);
    }

    public function update(Request $request, $sessionId)
    {
        $session = $request->user()->workSessions()->findOrFail($sessionId);
        Gate::authorize('update', $session);

        $data = $request->validate([
            'start' => 'sometimes|date',
            'end' => 'nullable|date|after_or_equal:start',
            'note' => 'nullable|string',
            'paused_ms' => 'sometimes|integer|min:0',
            'paused_at' => 'nullable|date',
        ]);

        $session->update($data);

        return new WorkSessionResource($session->refresh());
    }

    public function destroy(Request $request, $sessionId)
    {
        $session = $request->user()->workSessions()->findOrFail($sessionId);
        Gate::authorize('delete', $session);
        $session->delete();

        return response()->json(['message' => 'Session deleted']);
    }

    public function today(Request $request)
    {
        $today = now()->format('Y-m-d');
        $sessions = $request->user()->workSessions()
            ->whereDate('start', $today)
            ->orderBy('start')
            ->get();

        return WorkSessionResource::collection($sessions);
    }

    public function stats(Request $request)
    {
        $sessions = $request->user()->workSessions()->get();
        $now = now();

        $byDay = [];
        foreach ($sessions as $session) {
            $key = $session->start->format('Y-m-d');
            $byDay[$key] = ($byDay[$key] ?? 0) + $this->sessionDurationMs($session, $now);
        }

        $streak = 0;
        $cursor = Carbon::today();
        if (($byDay[$cursor->format('Y-m-d')] ?? 0) <= 0) {
            $cursor->subDay();
        }
        while (($byDay[$cursor->format('Y-m-d')] ?? 0) > 0) {
            $streak++;
            $cursor->subDay();
        }

        $weekStart = Carbon::today()->startOfWeek(Carbon::MONDAY);
        $weekMs = 0;
        for ($i = 0; $i < 7; $i++) {
            $d = $weekStart->copy()->addDays($i);
            if ($d->gt($now)) {
                break;
            }
            $weekMs += $byDay[$d->format('Y-m-d')] ?? 0;
        }

        $best = 0;
        $total = 0;
        $activeDays = 0;
        foreach ($byDay as $ms) {
            $total += $ms;
            if ($ms > 0) {
                $activeDays++;
            }
            if ($ms > $best) {
                $best = $ms;
            }
        }

        return new StatsResource([
            'streak' => $streak,
            'weekHours' => round($weekMs / 3600000, 1),
            'bestDayHours' => round($best / 3600000, 1),
            'avgPerActiveDay' => $activeDays ? round($total / 3600000 / $activeDays, 1) : 0,
            'totalHours' => round($total / 3600000, 1),
        ]);
    }

    public function monthly(Request $request)
    {
        $count = $request->integer('count', 4);
        $sessions = $request->user()->workSessions()->get();
        $now = now();
        $results = [];

        for ($i = $count - 1; $i >= 0; $i--) {
            $d = Carbon::createFromDate($now->year, $now->month - $i, 1);
            $results[] = $this->buildMonthStats($sessions, $d->year, $d->month, $now);
        }

        return MonthStatsResource::collection($results);
    }

    public function clearAll(Request $request)
    {
        $request->user()->workSessions()->delete();

        return response()->json(['message' => 'All sessions cleared']);
    }

    private function sessionDurationMs(WorkSession $session, Carbon $now): int
    {
        $start = $session->start->getTimestampMs();
        $end = $session->end?->getTimestampMs() ?? $now->getTimestampMs();
        $paused = $session->paused_ms;
        if ($session->paused_at) {
            $paused += $now->getTimestampMs() - $session->paused_at->getTimestampMs();
        }

        return max(0, $end - $start - $paused);
    }

    private function buildMonthStats($sessions, int $year, int $month, Carbon $now): array
    {
        $daysInMonth = Carbon::createFromDate($year, $month, 1)->daysInMonth;
        $doneHours = 0;

        foreach ($sessions as $session) {
            $d = $session->start;
            if ($d->year === $year && $d->month === $month) {
                $doneHours += $this->sessionDurationMs($session, $now) / 3600000;
            }
        }

        $targetHours = $daysInMonth * 8;
        $today = $now;
        $isCurrent = $today->year === $year && $today->month === $month;
        $dayOfMonth = $isCurrent ? $today->day : $daysInMonth;
        $daysLeft = $isCurrent ? $daysInMonth - $today->day + 1 : 0;

        $remainingHours = max(0, $targetHours - $doneHours);
        $perDayNeeded = $daysLeft > 0 ? $remainingHours / $daysLeft : 0;
        $paceDeltaHours = $doneHours - $dayOfMonth * 8;

        return [
            'key' => sprintf('%04d-%02d', $year, $month),
            'label' => Carbon::createFromDate($year, $month, 1)->format('F Y'),
            'doneHours' => round($doneHours, 1),
            'targetHours' => $targetHours,
            'remainingHours' => round($remainingHours, 1),
            'daysLeft' => $daysLeft,
            'perDayNeeded' => round($perDayNeeded, 1),
            'paceDeltaHours' => round($paceDeltaHours, 1),
            'progress' => min(1, $targetHours > 0 ? $doneHours / $targetHours : 0),
            'isCurrent' => $isCurrent,
        ];
    }
}
