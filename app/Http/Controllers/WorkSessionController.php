<?php

namespace App\Http\Controllers;

use App\Http\Resources\MonthStatsResource;
use App\Http\Resources\StatsResource;
use App\Http\Resources\WorkSessionResource;
use App\Models\CalendarSetting;
use App\Models\WorkSession;
use App\Models\WorkTask;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

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
            'type' => 'sometimes|in:work,study',
            'paused_ms' => 'nullable|integer|min:0',
            'paused_at' => 'nullable|date',
            'work_task_id' => $this->workTaskRules($request),
            ...$this->segmentRules(),
        ]);

        $start = Carbon::parse($data['start']);
        $end = isset($data['end']) ? Carbon::parse($data['end']) : null;

        if (array_key_exists('segments', $data)) {
            $data = array_merge($data, $this->resolveSegmentState($data['segments'], $start, $end));
        } elseif (($data['paused_ms'] ?? 0) === 0 && ($data['paused_at'] ?? null) === null) {
            $data['segments'] = [[
                'type' => 'work',
                'start' => $start->toISOString(),
                'end' => $end?->toISOString(),
            ]];
        }

        $session = $request->user()->workSessions()->create([
            'start' => $data['start'],
            'end' => $data['end'] ?? null,
            'note' => $data['note'] ?? '',
            'type' => $data['type'] ?? 'work',
            'paused_ms' => $data['paused_ms'] ?? 0,
            'paused_at' => $data['paused_at'] ?? null,
            'segments' => $data['segments'] ?? null,
            'work_task_id' => $data['work_task_id'] ?? null,
        ]);

        if ($session->work_task_id !== null) {
            $this->markTaskStarted($session->work_task_id);
        }

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
            'type' => 'sometimes|in:work,study',
            'paused_ms' => 'sometimes|integer|min:0',
            'paused_at' => 'nullable|date',
            'work_task_id' => $this->workTaskRules($request),
            ...$this->segmentRules(),
        ]);

        $start = array_key_exists('start', $data) ? Carbon::parse($data['start']) : $session->start;
        $end = array_key_exists('end', $data)
            ? ($data['end'] === null ? null : Carbon::parse($data['end']))
            : $session->end;

        if ($end !== null && $end->lt($start)) {
            throw ValidationException::withMessages(['end' => 'The end must be at or after the start.']);
        }

        if (array_key_exists('segments', $data)) {
            $data = array_merge($data, $this->resolveSegmentState($data['segments'], $start, $end));
        }

        $session->update($data);

        if ($session->work_task_id !== null) {
            $this->markTaskStarted($session->work_task_id);
        }

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
        // Study sessions never feed the work stats — only tracked work counts.
        $sessions = $request->user()->workSessions()->where('type', 'work')->get();
        $dayOffs = $request->user()->dayOffs()->get();
        $requiredDays = CalendarSetting::forUser($request->user())->requiredDays();
        $excludedDayOffs = $dayOffs->where('type', 'excluded')->pluck('date')->map(fn ($d) => $d->format('Y-m-d'))->toArray();
        $includedDayOffs = $dayOffs->where('type', 'included')->pluck('date')->map(fn ($d) => $d->format('Y-m-d'))->toArray();
        $excludedSet = array_flip($excludedDayOffs);
        $includedSet = array_flip($includedDayOffs);
        $allDayOffsSet = array_merge($excludedSet, $includedSet);
        $now = now();

        $byDay = [];
        foreach ($sessions as $session) {
            $key = $session->start->format('Y-m-d');
            // Skip sessions on EXCLUDED day-offs entirely
            if (isset($excludedSet[$key])) {
                continue;
            }
            // Include sessions on INCLUDED day-offs in totals
            $byDay[$key] = ($byDay[$key] ?? 0) + $this->sessionDurationMs($session, $now);
        }

        // Study hours are reported separately and never counted as work. They
        // follow the same day-off rules: EXCLUDED days are skipped, INCLUDED days
        // still count.
        $studyByDay = [];
        foreach ($request->user()->workSessions()->where('type', 'study')->get() as $session) {
            $key = $session->start->format('Y-m-d');
            if (isset($excludedSet[$key])) {
                continue;
            }
            $studyByDay[$key] = ($studyByDay[$key] ?? 0) + $this->sessionDurationMs($session, $now);
        }

        $streak = 0;
        $cursor = Carbon::today();
        // Skip ALL day-offs when checking streak (neither break nor count)
        while (true) {
            $cursorKey = $cursor->format('Y-m-d');
            $hours = $byDay[$cursorKey] ?? 0;
            if ($hours <= 0) {
                // If it's any day-off, skip it but don't break streak
                if (isset($allDayOffsSet[$cursorKey])) {
                    $cursor->subDay();

                    continue;
                }
                $cursor->subDay();
                if (($byDay[$cursor->format('Y-m-d')] ?? 0) <= 0) {
                    break;
                }
            } else {
                break;
            }
        }
        while (($byDay[$cursor->format('Y-m-d')] ?? 0) > 0) {
            $streak++;
            $cursor->subDay();
            // Skip all day-offs in streak calculation
            while (isset($allDayOffsSet[$cursor->format('Y-m-d')])) {
                $cursor->subDay();
            }
        }

        $weekStart = Carbon::today()->startOfWeek(Carbon::MONDAY);
        $weekMs = 0;
        for ($i = 0; $i < 7; $i++) {
            $d = $weekStart->copy()->addDays($i);
            if ($d->gt($now)) {
                break;
            }
            $dKey = $d->format('Y-m-d');
            // Skip EXCLUDED day-offs in week calculation; INCLUDED day-offs count hours
            if (isset($excludedSet[$dKey])) {
                continue;
            }
            $weekMs += $byDay[$dKey] ?? 0;
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

        // Study roll-up: this week, all time, and the best single day.
        $studyWeekMs = 0;
        for ($i = 0; $i < 7; $i++) {
            $d = $weekStart->copy()->addDays($i);
            if ($d->gt($now)) {
                break;
            }
            $dKey = $d->format('Y-m-d');
            if (isset($excludedSet[$dKey])) {
                continue;
            }
            $studyWeekMs += $studyByDay[$dKey] ?? 0;
        }
        $studyTotal = array_sum($studyByDay);
        $studyBest = $studyByDay === [] ? 0 : max($studyByDay);

        // Cumulative shortfall against the 8-hour daily goal across every elapsed
        // *required* working day (the user's compulsory weekdays, excluding EXCLUDED
        // day-offs) from the first session through today. Days the user merely *can*
        // work never create a shortfall; hours worked on any day — including overtime
        // and weekend/optional work — reduce the backlog, which never goes below zero.
        $backlogMs = 0;
        if ($sessions->isNotEmpty()) {
            $workedMs = 0;
            $firstDay = null;
            foreach ($sessions as $session) {
                $workedMs += $this->sessionDurationMs($session, $now);
                $day = $session->start->copy()->startOfDay();
                if ($firstDay === null || $day->lt($firstDay)) {
                    $firstDay = $day;
                }
            }

            $workingDays = 0;
            $cursor = $firstDay;
            $todayKey = $now->format('Y-m-d');
            while ($cursor->format('Y-m-d') <= $todayKey) {
                $cursorKey = $cursor->format('Y-m-d');
                if (in_array($cursor->dayOfWeek, $requiredDays, true) && ! isset($excludedSet[$cursorKey])) {
                    $workingDays++;
                }
                $cursor->addDay();
            }

            $backlogMs = max(0, $workingDays * 8 * 3600000 - $workedMs);
        }

        return new StatsResource([
            'streak' => $streak,
            'weekHours' => round($weekMs / 3600000, 1),
            'bestDayHours' => round($best / 3600000, 1),
            'avgPerActiveDay' => $activeDays ? round($total / 3600000 / $activeDays, 1) : 0,
            'totalHours' => round($total / 3600000, 1),
            'backlogHours' => round($backlogMs / 3600000, 1),
            'studyWeekHours' => round($studyWeekMs / 3600000, 1),
            'studyTotalHours' => round($studyTotal / 3600000, 1),
            'studyBestDayHours' => round($studyBest / 3600000, 1),
        ]);
    }

    public function monthly(Request $request)
    {
        $count = $request->integer('count', 4);
        $sessions = $request->user()->workSessions()->where('type', 'work')->get();
        $dayOffs = $request->user()->dayOffs()->get();
        $requiredDays = CalendarSetting::forUser($request->user())->requiredDays();
        $now = now();
        $results = [];

        for ($i = $count - 1; $i >= 0; $i--) {
            $d = Carbon::createFromDate($now->year, $now->month - $i, 1);
            $results[] = $this->buildMonthStats($sessions, $dayOffs, $d->year, $d->month, $now, $requiredDays);
        }

        return MonthStatsResource::collection($results);
    }

    public function clearAll(Request $request)
    {
        $request->user()->workSessions()->delete();

        return response()->json(['message' => 'All sessions cleared']);
    }

    /**
     * @return array<string, string>
     */
    private function segmentRules(): array
    {
        return [
            'segments' => 'sometimes|array',
            'segments.*.type' => 'required|in:work,pause',
            'segments.*.start' => 'required|date',
            'segments.*.end' => 'nullable|date',
        ];
    }

    /**
     * Only a task the user owns may be linked to their session.
     *
     * @return array<int, mixed>
     */
    private function workTaskRules(Request $request): array
    {
        return [
            'sometimes',
            'nullable',
            'integer',
            Rule::exists('work_tasks', 'id')->where('user_id', $request->user()->id),
        ];
    }

    /** Beginning (or editing) a session against a task marks that task started. */
    private function markTaskStarted(int $taskId): void
    {
        $task = WorkTask::find($taskId);

        if ($task !== null && $task->started_at === null) {
            $task->started_at = now();
            $task->save();
        }
    }

    /**
     * Validate the structure of a submitted segment list, normalize it into the
     * session bounds and derive the legacy pause counters from it, so that
     * `end - start - paused` always equals the summed work segments.
     *
     * @param  array<int, array{type: string, start: string, end?: string|null}>  $segments
     * @return array{segments: array<int, array{type: string, start: string, end: string|null}>, paused_ms: int, paused_at: Carbon|null}
     *
     * @throws ValidationException
     */
    private function resolveSegmentState(array $segments, Carbon $start, ?Carbon $end): array
    {
        $nowMs = now()->getTimestampMs();
        $startMs = $start->getTimestampMs();
        $endMs = $end?->getTimestampMs() ?? $nowMs;
        $errors = [];
        $parsed = [];

        if ($segments === []) {
            $errors[] = 'A session needs at least one segment.';
        }

        foreach (array_values($segments) as $index => $segment) {
            $segmentStartMs = Carbon::parse($segment['start'])->getTimestampMs();
            $segmentEndMs = isset($segment['end']) ? Carbon::parse($segment['end'])->getTimestampMs() : null;

            if ($segmentEndMs !== null && $segmentEndMs <= $segmentStartMs) {
                $errors[] = sprintf('Segment %d must end after it starts.', $index + 1);

                continue;
            }

            $parsed[] = [$segmentStartMs, $segmentEndMs, $segment['type']];
        }

        usort($parsed, fn (array $a, array $b): int => [$a[0], $a[1] ?? PHP_INT_MAX] <=> [$b[0], $b[1] ?? PHP_INT_MAX]);

        foreach ($parsed as $index => [$segmentStartMs, $segmentEndMs]) {
            if ($segmentEndMs === null && ($end !== null || $index !== array_key_last($parsed))) {
                $errors[] = $end !== null
                    ? 'A session with an end time cannot have an open segment.'
                    : 'Only the last segment can be left open.';
            }

            if ($index === 0) {
                continue;
            }

            $previousEndMs = $parsed[$index - 1][1];
            if ($previousEndMs !== null && $segmentStartMs < $previousEndMs) {
                $errors[] = 'Segments must not overlap.';
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages(['segments' => array_values(array_unique($errors))]);
        }

        $normalized = [];

        foreach ($parsed as [$segmentStartMs, $segmentEndMs, $type]) {
            if ($segmentEndMs === null) {
                $normalized[] = [
                    'type' => $type,
                    'start' => Carbon::createFromTimestampMs(min(max($segmentStartMs, $startMs), $endMs))->toISOString(),
                    'end' => null,
                ];

                continue;
            }

            $normalizedStartMs = max($segmentStartMs, $startMs);
            $normalizedEndMs = min($segmentEndMs, $endMs);

            if ($normalizedEndMs <= $normalizedStartMs) {
                continue;
            }

            $normalized[] = [
                'type' => $type,
                'start' => Carbon::createFromTimestampMs($normalizedStartMs)->toISOString(),
                'end' => Carbon::createFromTimestampMs($normalizedEndMs)->toISOString(),
            ];
        }

        if ($normalized === []) {
            throw ValidationException::withMessages(['segments' => 'Segments must fall within the session bounds.']);
        }

        $workMs = 0;
        $openPauseStartMs = null;

        foreach ($normalized as $segment) {
            $segmentStartMs = Carbon::parse($segment['start'])->getTimestampMs();
            $segmentEndMs = $segment['end'] === null ? null : Carbon::parse($segment['end'])->getTimestampMs();

            if ($segment['type'] === 'work') {
                $workMs += max(0, ($segmentEndMs ?? $nowMs) - $segmentStartMs);
            } elseif ($segmentEndMs === null) {
                $openPauseStartMs = $segmentStartMs;
            }
        }

        $livePauseMs = $openPauseStartMs === null ? 0 : max(0, $nowMs - $openPauseStartMs);

        return [
            'segments' => $normalized,
            'paused_ms' => max(0, ($endMs - $startMs) - $workMs - $livePauseMs),
            'paused_at' => $openPauseStartMs === null ? null : Carbon::createFromTimestampMs($openPauseStartMs),
        ];
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

    private function buildMonthStats($sessions, $dayOffs, int $year, int $month, Carbon $now, array $requiredDays): array
    {
        // Separate excluded and included day-offs
        $excludedDayOffs = [];
        $includedDayOffs = [];
        foreach ($dayOffs as $dayOff) {
            $dateKey = $dayOff->date->format('Y-m-d');
            if ($dayOff->type === 'included') {
                $includedDayOffs[$dateKey] = true;
            } else {
                $excludedDayOffs[$dateKey] = true;
            }
        }
        $allDayOffs = array_merge($excludedDayOffs, $includedDayOffs);

        $workingDaysInMonth = $this->getRequiredDaysInMonth($year, $month, $excludedDayOffs, $requiredDays);
        $doneHours = 0;

        foreach ($sessions as $session) {
            $d = $session->start;
            $dateKey = $d->format('Y-m-d');

            // Skip sessions on EXCLUDED day-offs entirely
            if (isset($excludedDayOffs[$dateKey])) {
                continue;
            }
            // Include sessions on INCLUDED day-offs in doneHours
            // But INCLUDED day-offs don't reduce working days

            if ($d->year === $year && $d->month === $month) {
                $doneHours += $this->sessionDurationMs($session, $now) / 3600000;
            }
        }

        $targetHours = $workingDaysInMonth * 8;
        $today = $now;
        $isCurrent = $today->year === $year && $today->month === $month;
        $workingDaysElapsed = $isCurrent ? $this->getRequiredDaysElapsed($year, $month, $today, $excludedDayOffs, $requiredDays) : $workingDaysInMonth;
        $workingDaysLeft = $isCurrent ? $this->getRequiredDaysLeft($year, $month, $today, $excludedDayOffs, $requiredDays) : 0;

        $remainingHours = max(0, $targetHours - $doneHours);
        $perDayNeeded = $workingDaysLeft > 0 ? $remainingHours / $workingDaysLeft : 0;
        $paceDeltaHours = $doneHours - $workingDaysElapsed * 8;

        // Count total custom days off (both types)
        $customDaysOffCount = 0;
        foreach ($allDayOffs as $dateKey => $_) {
            $d = Carbon::parse($dateKey);
            if ($d->year === $year && $d->month === $month) {
                $customDaysOffCount++;
            }
        }

        return [
            'key' => sprintf('%04d-%02d', $year, $month),
            'label' => Carbon::createFromDate($year, $month, 1)->format('F Y'),
            'doneHours' => round($doneHours, 1),
            'targetHours' => $targetHours,
            'remainingHours' => round($remainingHours, 1),
            'daysLeft' => $workingDaysLeft,
            'perDayNeeded' => round($perDayNeeded, 1),
            'paceDeltaHours' => round($paceDeltaHours, 1),
            'progress' => min(1, $targetHours > 0 ? $doneHours / $targetHours : 0),
            'isCurrent' => $isCurrent,
            'customDaysOff' => $customDaysOffCount,
        ];
    }

    private function getRequiredDaysInMonth(int $year, int $month, array $excludedDayOffs = [], array $requiredDays = CalendarSetting::DEFAULT_WORK_DAYS): int
    {
        $start = Carbon::create($year, $month, 1);
        $end = $start->copy()->endOfMonth();
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            if ($this->isRequiredDay($d, $requiredDays) && ! isset($excludedDayOffs[$d->format('Y-m-d')])) {
                $days++;
            }
        }

        return $days;
    }

    private function getRequiredDaysElapsed(int $year, int $month, Carbon $today, array $excludedDayOffs = [], array $requiredDays = CalendarSetting::DEFAULT_WORK_DAYS): int
    {
        $start = Carbon::create($year, $month, 1);
        $end = $today->copy()->min($start->copy()->endOfMonth());
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            if ($this->isRequiredDay($d, $requiredDays) && ! isset($excludedDayOffs[$d->format('Y-m-d')])) {
                $days++;
            }
        }

        return $days;
    }

    private function getRequiredDaysLeft(int $year, int $month, Carbon $today, array $excludedDayOffs = [], array $requiredDays = CalendarSetting::DEFAULT_WORK_DAYS): int
    {
        $start = $today->copy()->max(Carbon::create($year, $month, 1))->addDay();
        $end = Carbon::create($year, $month, 1)->endOfMonth();
        if ($start->gt($end)) {
            return 0;
        }
        $days = 0;
        for ($d = $start->copy(); $d->lte($end); $d->addDay()) {
            if ($this->isRequiredDay($d, $requiredDays) && ! isset($excludedDayOffs[$d->format('Y-m-d')])) {
                $days++;
            }
        }

        return $days;
    }

    /**
     * @param  array<int, int>  $requiredDays
     */
    private function isRequiredDay(Carbon $date, array $requiredDays): bool
    {
        return in_array($date->dayOfWeek, $requiredDays, true);
    }
}
