<?php

namespace App\Services;

use App\Models\CalendarSetting;
use App\Models\FocusBlock;
use App\Models\ReportSetting;
use App\Models\SideTask;
use App\Models\User;
use App\Models\UserDayOff;
use App\Models\WorkSession;
use App\Models\WorkTask;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Builds the complete, display-ready document consumed by both the live
 * preview and the PDF. Everything is scoped to the user and filtered from the
 * normalized report config.
 */
class ReportDataService
{
    private const MAX_SESSION_ROWS = 300;

    private const MAX_EVENT_ROWS = 300;

    private const MAX_TASK_ROWS = 100;

    private const MAX_SIDE_TASK_ROWS = 100;

    private const MAX_FOCUS_ROWS = 100;

    private const MAX_DAILY_ROWS = 370;

    private const MAX_TREND_BUCKETS = 62;

    private const DAILY_GOAL_HOURS = 8;

    public function __construct(private CalendarEventFeed $feed) {}

    /**
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    public function build(User $user, array $config): array
    {
        $timezone = $config['timezone'];
        $from = Carbon::createFromFormat('Y-m-d', $config['from'], $timezone)->startOfDay();
        $to = Carbon::createFromFormat('Y-m-d', $config['to'], $timezone)->startOfDay();
        $setting = ReportSetting::forUser($user);
        $requiredDays = CalendarSetting::forUser($user)->requiredDays();
        $warnings = [];
        $workOnly = $config['template'] === 'work';

        $current = $this->period($user, $config, $from, $to, $requiredDays, true);
        $previous = null;

        if ($config['comparison'] !== 'none') {
            [$previousFrom, $previousTo] = $this->previousBounds($config, $from, $to);
            $previous = $this->period($user, $config, $previousFrom, $previousTo, $requiredDays, false);
        }

        $summary = $this->summary($current, $from, $to, $timezone);
        $comparison = $previous === null
            ? null
            : (function () use ($summary, $previous, $config, $from, $to, $timezone, $workOnly): array {
                [$previousFrom, $previousTo] = $this->previousBounds($config, $from, $to);

                return $this->comparison($summary, $this->summary($previous, $previousFrom, $previousTo, $timezone), $previousFrom, $previousTo, $workOnly);
            })();

        $summary['text'] = $this->narrative($summary, $comparison, $workOnly);
        $summary['highlights'] = $this->highlights($summary, $comparison, $workOnly);

        $sections = $config['sections'];
        $trend = in_array('trend', $sections, true)
            ? $this->trend($current['sessions'], $from, $to, $config['groupBy'], $timezone, $warnings)
            : null;
        $heatmap = in_array('heatmap', $sections, true)
            ? $this->heatmap($current['sessions'], $from, $to, $timezone)
            : null;
        $daily = in_array('daily', $sections, true)
            ? $this->daily($current, $from, $to, $timezone, $warnings)
            : null;
        $monthly = in_array('monthly', $sections, true)
            ? $this->monthly($current['sessions'], $current['dayOffs'], $from, $to, $timezone, $requiredDays)
            : null;
        $sessions = in_array('sessions', $sections, true)
            ? $this->sessionRows($current['sessions'], $config, $timezone, $warnings)
            : null;
        $events = in_array('calendar', $sections, true)
            ? $this->eventRows($current['events'], $timezone, $warnings)
            : null;
        $tasks = in_array('tasks', $sections, true)
            ? $this->taskRows($current['tasks'], $timezone, $warnings)
            : null;
        $study = in_array('study', $sections, true)
            ? $this->studySummary($current['sessions'], $from, $to, $timezone)
            : null;
        $sideTasks = in_array('sideTasks', $sections, true)
            ? $this->sideTaskRows($current['sideTasks'], $timezone)
            : null;
        $focusBlocks = in_array('focusBlocks', $sections, true)
            ? $this->focusBlockRows($current['focusBlocks'], $timezone)
            : null;
        $dayOffs = in_array('dayOffs', $sections, true)
            ? $this->dayOffRows($current['dayOffs'])
            : null;

        if ($config['filters']['calendar']['include'] && $current['events']->isEmpty()) {
            $warnings[] = 'No calendar events matched the selected filters.';
        }

        if ($current['sessions']->isEmpty() && $current['events']->isEmpty()) {
            $warnings[] = 'No tracked sessions or calendar events were found for this period.';
        }

        if (ReportConfig::dayCount($from, $to) > 366) {
            $warnings[] = 'Long reports can take a few seconds to generate.';
        }

        $logoDataUri = $setting->logoDataUri();

        if ($logoDataUri !== null && ! function_exists('imagecreatefrompng') && str_starts_with($logoDataUri, 'data:image/png')) {
            $warnings[] = 'PNG logos cannot be embedded in PDFs on this server. Upload a JPEG logo to include it.';
        }

        return [
            'meta' => [
                'title' => $config['title'],
                'subtitle' => $config['subtitle'],
                'company' => $config['company'],
                'preparedFor' => $config['preparedFor'],
                'preparedBy' => $config['preparedBy'],
                'footerText' => $config['footerText'],
                'accentColor' => $config['accentColor'],
                'periodLabel' => ReportConfig::periodLabel($from, $to),
                'from' => $config['from'],
                'to' => $config['to'],
                'timezone' => $timezone,
                'generatedAt' => now()->setTimezone($timezone)->format('M j, Y · H:i T'),
                'paper' => $config['paper'],
                'orientation' => $config['orientation'],
                'paperLabel' => strtoupper($config['paper']).' · '.Str::ucfirst($config['orientation']),
                'showPageNumbers' => $config['showPageNumbers'],
                'sections' => $sections,
                'template' => $config['template'],
                'groupBy' => $trend['groupBy'] ?? $config['groupBy'],
                'comparison' => $config['comparison'],
                'workOnly' => $workOnly,
                'logoDataUri' => $logoDataUri,
            ],
            'summary' => $summary,
            'trend' => $trend,
            'heatmap' => $heatmap,
            'daily' => $daily,
            'sessions' => $sessions,
            'events' => $events,
            'tasks' => $tasks,
            'study' => $study,
            'monthly' => $monthly,
            'comparison' => $comparison,
            'sideTasks' => $sideTasks,
            'focusBlocks' => $focusBlocks,
            'dayOffs' => $dayOffs,
            'notes' => trim((string) $config['notes']),
            'warnings' => array_values(array_unique($warnings)),
            'counts' => [
                'sessions' => $current['sessions']->count(),
                'sessionsShown' => $sessions === null ? 0 : count($sessions),
                'events' => $current['events']->count(),
                'eventsShown' => $events === null ? 0 : count($events),
                'tasks' => $current['tasks']->count(),
                'tasksShown' => $tasks === null ? 0 : count($tasks),
                'sideTasks' => $current['sideTasks']->count(),
                'focusBlocks' => $current['focusBlocks']->count(),
                'dayOffs' => $current['dayOffs']->count(),
                'days' => ReportConfig::dayCount($from, $to),
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    private function period(User $user, array $config, Carbon $from, Carbon $to, array $requiredDays, bool $withExtras): array
    {
        $timezone = $config['timezone'];
        $fromUtc = $from->copy()->utc();
        $toExclusiveUtc = $to->copy()->addDay()->startOfDay()->utc();
        $dayOffs = $this->dayOffs($user, $from, $to);
        $excludedDates = $dayOffs->where('type', 'excluded')
            ->map(fn (UserDayOff $dayOff) => $dayOff->date->format('Y-m-d'))
            ->flip();
        $sessions = $this->sessions($user, $config, $fromUtc, $toExclusiveUtc, $timezone, $excludedDates);
        $events = $config['filters']['calendar']['include']
            ? $this->events($user, $config, $fromUtc, $toExclusiveUtc, $timezone)
            : collect();
        $tasks = $this->tasks($user, $config, $sessions);

        $sideTasks = $withExtras && $config['filters']['includeSideTasks']
            ? $this->sideTasks($user, $fromUtc, $toExclusiveUtc)
            : collect();
        $focusBlocks = $withExtras && $config['filters']['includeFocusBlocks']
            ? $this->focusBlocks($user, $fromUtc, $toExclusiveUtc)
            : collect();

        return [
            'sessions' => $sessions,
            'events' => $events,
            'tasks' => $tasks,
            'sideTasks' => $sideTasks,
            'focusBlocks' => $focusBlocks,
            'dayOffs' => $dayOffs,
            'requiredDays' => $requiredDays,
        ];
    }

    private function sessions(User $user, array $config, Carbon $fromUtc, Carbon $toExclusiveUtc, string $timezone, Collection $excludedDates): Collection
    {
        $query = $user->workSessions()
            ->where('start', '>=', $fromUtc)
            ->where('start', '<', $toExclusiveUtc)
            ->with('workTask');

        $filters = $config['filters'];

        if ($filters['sessionTypes'] !== []) {
            $query->whereIn('type', $filters['sessionTypes']);
        } else {
            $query->whereRaw('1 = 0');
        }

        if ($filters['sessionSources'] !== []) {
            $query->whereIn('source', $filters['sessionSources']);
        } else {
            $query->whereRaw('1 = 0');
        }

        if ($filters['workTaskIds'] !== []) {
            $query->whereIn('work_task_id', $filters['workTaskIds']);
        }

        if ($filters['search'] !== '') {
            $query->where('note', 'like', '%'.$filters['search'].'%');
        }

        return $query->reorder()->orderBy('start')->get()
            ->filter(function (WorkSession $session) use ($timezone, $excludedDates): bool {
                $key = $session->start->copy()->setTimezone($timezone)->format('Y-m-d');

                return ! $excludedDates->has($key);
            })
            ->values();
    }

    private function events(User $user, array $config, Carbon $fromUtc, Carbon $toExclusiveUtc, string $timezone): Collection
    {
        $calendar = $config['filters']['calendar'];
        $events = $this->feed->eventsFor($user, $fromUtc, $toExclusiveUtc);

        return $events
            ->filter(function (array $event) use ($calendar): bool {
                if ($calendar['accountIds'] !== [] && ! in_array($event['accountId'], $calendar['accountIds'], true)) {
                    return false;
                }

                if ($calendar['calendarIds'] !== [] && ! in_array($event['calendarId'], $calendar['calendarIds'], true)) {
                    return false;
                }

                if ($calendar['eventMode'] === 'selected' && ! in_array($event['id'], $calendar['eventIds'], true)) {
                    return false;
                }

                if ($calendar['workFilter'] === 'work' && ! $event['isWork']) {
                    return false;
                }

                if ($calendar['workFilter'] === 'personal' && $event['isWork']) {
                    return false;
                }

                if (! $calendar['includeAllDay'] && $event['allDay']) {
                    return false;
                }

                if ($calendar['search'] !== '') {
                    $haystack = Str::lower($event['title'].' '.$event['calendarName'].' '.$event['accountEmail']);

                    if (! Str::contains($haystack, Str::lower($calendar['search']))) {
                        return false;
                    }
                }

                return true;
            })
            ->map(function (array $event) use ($timezone): array {
                $event['start'] = $event['start']->copy()->setTimezone($timezone);
                $event['end'] = $event['end']->copy()->setTimezone($timezone);

                return $event;
            })
            ->sortBy(fn (array $event) => $event['start']->getTimestamp())
            ->values();
    }

    private function tasks(User $user, array $config, Collection $sessions): Collection
    {
        $filters = $config['filters'];
        $query = $user->workTasks()->orderBy('position')->orderBy('id');

        if ($filters['workTaskIds'] !== []) {
            $query->whereIn('id', $filters['workTaskIds']);
        }

        if ($filters['taskFilter'] === 'open') {
            $query->whereNull('completed_at');
        } elseif ($filters['taskFilter'] === 'done') {
            $query->whereNotNull('completed_at');
        }

        return $query->get()->map(function (WorkTask $task) use ($sessions): WorkTask {
            $taskSessions = $sessions->where('work_task_id', $task->id);
            $task->setAttribute('report_tracked_ms', (int) $taskSessions->sum(fn (WorkSession $session) => $session->duration_ms));
            $task->setAttribute('report_active', $taskSessions->contains(fn (WorkSession $session) => $session->end === null));

            return $task;
        });
    }

    private function sideTasks(User $user, Carbon $fromUtc, Carbon $toExclusiveUtc): Collection
    {
        return $user->sideTasks()
            ->where(function ($query) use ($fromUtc, $toExclusiveUtc): void {
                $query->where(function ($query) use ($fromUtc, $toExclusiveUtc): void {
                    $query->whereNotNull('start')
                        ->where('start', '<', $toExclusiveUtc)
                        ->where('end', '>', $fromUtc);
                })->orWhereBetween('completed_at', [$fromUtc, $toExclusiveUtc]);
            })
            ->orderBy('start')
            ->orderBy('id')
            ->get();
    }

    private function focusBlocks(User $user, Carbon $fromUtc, Carbon $toExclusiveUtc): Collection
    {
        return $user->focusBlocks()
            ->where('end', '>', $fromUtc)
            ->where('start', '<', $toExclusiveUtc)
            ->orderBy('start')
            ->get();
    }

    private function dayOffs(User $user, Carbon $from, Carbon $to): Collection
    {
        return $user->dayOffs()
            ->whereBetween('date', [$from->format('Y-m-d'), $to->format('Y-m-d')])
            ->orderBy('date')
            ->get();
    }

    private function summary(array $period, Carbon $from, Carbon $to, string $timezone): array
    {
        $sessions = $period['sessions'];
        $events = $period['events'];
        $tasks = $period['tasks'];
        $byDay = [];

        foreach ($sessions as $session) {
            $key = $session->start->copy()->setTimezone($timezone)->format('Y-m-d');
            $byDay[$key] = ($byDay[$key] ?? 0) + $session->duration_ms;
        }

        $workMs = $sessions->where('type', 'work')->sum(fn (WorkSession $session) => $session->duration_ms);
        $studyMs = $sessions->where('type', 'study')->sum(fn (WorkSession $session) => $session->duration_ms);
        $totalMs = $workMs + $studyMs;
        $activeDays = count(array_filter($byDay));
        $bestKey = null;
        $bestMs = 0;

        foreach ($byDay as $key => $ms) {
            if ($ms > $bestMs) {
                $bestMs = $ms;
                $bestKey = $key;
            }
        }

        $timedWorkEvents = $events->filter(fn (array $event) => $event['isWork'] && ! $event['allDay']);
        $workEventMs = $timedWorkEvents->sum(fn (array $event) => max(0, $event['end']->getTimestampMs() - $event['start']->getTimestampMs()));
        $completedTasks = $tasks->filter(function (WorkTask $task) use ($from, $to, $timezone): bool {
            if ($task->completed_at === null) {
                return false;
            }

            $completed = $task->completed_at->copy()->setTimezone($timezone);

            return $completed->greaterThanOrEqualTo($from) && $completed->lessThanOrEqualTo($to->copy()->endOfDay());
        })->count();

        $topTask = $sessions
            ->filter(fn (WorkSession $session) => $session->workTask !== null)
            ->groupBy('work_task_id')
            ->map(fn (Collection $group) => [
                'title' => $group->first()->workTask->title,
                'ms' => (int) $group->sum(fn (WorkSession $session) => $session->duration_ms),
            ])
            ->sortByDesc('ms')
            ->first();

        $topCalendar = $timedWorkEvents
            ->groupBy('calendarName')
            ->map(fn (Collection $group) => [
                'name' => $group->first()['calendarName'] ?: 'Calendar',
                'ms' => (int) $group->sum(fn (array $event) => max(0, $event['end']->getTimestampMs() - $event['start']->getTimestampMs())),
            ])
            ->sortByDesc('ms')
            ->first();

        return [
            'workHours' => $this->hours($workMs),
            'studyHours' => $this->hours($studyMs),
            'totalHours' => $this->hours($totalMs),
            'workLabel' => $this->hoursLabel($this->hours($workMs)),
            'studyLabel' => $this->hoursLabel($this->hours($studyMs)),
            'totalLabel' => $this->hoursLabel($this->hours($totalMs)),
            'activeDays' => $activeDays,
            'avgPerActiveDay' => $activeDays > 0 ? round($this->hours($totalMs) / $activeDays, 1) : 0,
            'avgLabel' => $activeDays > 0 ? $this->hoursLabel(round($this->hours($totalMs) / $activeDays, 1)) : '0.0h',
            'bestDay' => $bestKey === null ? null : [
                'date' => $bestKey,
                'label' => Carbon::parse($bestKey, $timezone)->format('D, M j, Y'),
                'hours' => $this->hours($bestMs),
                'hoursLabel' => $this->hoursLabel($this->hours($bestMs)),
            ],
            'sessionCount' => $sessions->count(),
            'studySessionCount' => $sessions->where('type', 'study')->count(),
            'eventCount' => $events->count(),
            'workEventCount' => $timedWorkEvents->count(),
            'workEventHours' => $this->hours($workEventMs),
            'workEventLabel' => $this->hoursLabel($this->hours($workEventMs)),
            'completedTasks' => $completedTasks,
            'taskCount' => $tasks->count(),
            'topTask' => $topTask === null ? null : [
                'title' => $topTask['title'],
                'hours' => $this->hours($topTask['ms']),
                'label' => $this->hoursLabel($this->hours($topTask['ms'])),
            ],
            'topCalendar' => $topCalendar === null ? null : [
                'name' => $topCalendar['name'],
                'hours' => $this->hours($topCalendar['ms']),
                'label' => $this->hoursLabel($this->hours($topCalendar['ms'])),
            ],
        ];
    }

    private function comparison(array $current, array $previous, Carbon $previousFrom, Carbon $previousTo, bool $workOnly = false): array
    {
        $definitions = [
            ['key' => 'workHours', 'label' => 'Work hours', 'format' => 'hours'],
            ['key' => 'studyHours', 'label' => 'Study hours', 'format' => 'hours'],
            ['key' => 'activeDays', 'label' => 'Active days', 'format' => 'count'],
            ['key' => 'bestDay', 'label' => 'Best day', 'format' => 'bestDay'],
            ['key' => 'sessionCount', 'label' => 'Sessions', 'format' => 'count'],
            ['key' => 'eventCount', 'label' => 'Calendar events', 'format' => 'count'],
            ['key' => 'workEventHours', 'label' => 'Scheduled work', 'format' => 'hours'],
            ['key' => 'completedTasks', 'label' => 'Tasks completed', 'format' => 'count'],
        ];

        if ($workOnly) {
            $definitions = array_values(array_filter(
                $definitions,
                fn (array $definition): bool => $definition['key'] !== 'studyHours',
            ));
        }

        $metrics = [];

        foreach ($definitions as $definition) {
            $key = $definition['key'];
            $currentValue = $key === 'bestDay' ? ($current['bestDay']['hours'] ?? 0) : $current[$key];
            $previousValue = $key === 'bestDay' ? ($previous['bestDay']['hours'] ?? 0) : $previous[$key];
            $delta = $currentValue - $previousValue;
            $percent = $previousValue > 0 ? round(($delta / $previousValue) * 100) : ($currentValue > 0 ? null : 0);
            $format = $definition['format'];
            $metrics[] = [
                'key' => $key,
                'label' => $definition['label'],
                'current' => $currentValue,
                'previous' => $previousValue,
                'currentLabel' => $this->metricLabel($currentValue, $format),
                'previousLabel' => $this->metricLabel($previousValue, $format),
                'delta' => $delta,
                'deltaLabel' => ($delta > 0 ? '+' : '').$this->metricLabel($delta, $format),
                'percent' => $percent,
                'percentLabel' => $percent === null ? 'New' : ($percent > 0 ? '+' : '').$percent.'%',
                'direction' => $delta > 0 ? 'up' : ($delta < 0 ? 'down' : 'flat'),
                'improved' => $delta >= 0,
            ];
        }

        return [
            'label' => 'vs '.ReportConfig::periodLabel($previousFrom, $previousTo),
            'previousFrom' => $previousFrom->format('Y-m-d'),
            'previousTo' => $previousTo->format('Y-m-d'),
            'metrics' => $metrics,
        ];
    }

    /**
     * @param  array<int, WorkSession>  $sessions
     */
    private function trend(Collection $sessions, Carbon $from, Carbon $to, string $groupBy, string $timezone, array &$warnings): array
    {
        $groupBy = in_array($groupBy, ReportConfig::GROUPINGS, true) ? $groupBy : 'day';
        $count = $this->bucketCount($from, $to, $groupBy);

        if ($count > self::MAX_TREND_BUCKETS) {
            $warnings[] = 'The trend was grouped by month to keep the report readable.';
            $groupBy = 'month';
            $count = $this->bucketCount($from, $to, $groupBy);
        }

        $buckets = [];
        $cursor = $groupBy === 'month'
            ? $from->copy()->startOfMonth()
            : ($groupBy === 'week' ? $from->copy()->startOfWeek(Carbon::MONDAY) : $from->copy());

        while ($cursor->lessThanOrEqualTo($to) && count($buckets) < self::MAX_TREND_BUCKETS) {
            $start = $cursor->copy();
            $end = $groupBy === 'month'
                ? $start->copy()->endOfMonth()
                : ($groupBy === 'week' ? $start->copy()->endOfWeek(Carbon::SUNDAY) : $start->copy()->endOfDay());
            $buckets[] = [
                'key' => $groupBy === 'month' ? $start->format('Y-m') : $start->format('Y-m-d'),
                'label' => $groupBy === 'month' ? $start->format('M Y') : $start->format('M j'),
                'start' => $start,
                'end' => $end,
                'workMs' => 0,
                'studyMs' => 0,
            ];
            $cursor = $groupBy === 'month'
                ? $start->copy()->addMonthNoOverflow()
                : ($groupBy === 'week' ? $start->copy()->addWeek() : $start->copy()->addDay());
        }

        $index = [];
        foreach ($buckets as $position => $bucket) {
            $index[$bucket['key']] = $position;
        }

        foreach ($sessions as $session) {
            $local = $session->start->copy()->setTimezone($timezone);
            $key = match ($groupBy) {
                'month' => $local->format('Y-m'),
                'week' => $local->copy()->startOfWeek(Carbon::MONDAY)->format('Y-m-d'),
                default => $local->format('Y-m-d'),
            };

            if (! isset($index[$key])) {
                continue;
            }

            $position = $index[$key];
            if ($session->type === 'study') {
                $buckets[$position]['studyMs'] += $session->duration_ms;
            } else {
                $buckets[$position]['workMs'] += $session->duration_ms;
            }
        }

        $maxHours = 1.0;
        foreach ($buckets as &$bucket) {
            $bucket['workHours'] = $this->hours($bucket['workMs']);
            $bucket['studyHours'] = $this->hours($bucket['studyMs']);
            $bucket['totalHours'] = round($bucket['workHours'] + $bucket['studyHours'], 1);
            $bucket['workPercent'] = 0;
            $bucket['studyPercent'] = 0;
            $maxHours = max($maxHours, $bucket['totalHours']);
            unset($bucket['start'], $bucket['end'], $bucket['workMs'], $bucket['studyMs']);
        }
        unset($bucket);

        foreach ($buckets as &$bucket) {
            $bucket['workPercent'] = min(100, round(($bucket['workHours'] / $maxHours) * 100));
            $bucket['studyPercent'] = min(100, round(($bucket['studyHours'] / $maxHours) * 100));
        }
        unset($bucket);

        return [
            'groupBy' => $groupBy,
            'buckets' => $buckets,
            'maxHours' => round($maxHours, 1),
        ];
    }

    private function heatmap(Collection $sessions, Carbon $from, Carbon $to, string $timezone): array
    {
        $byDay = [];
        foreach ($sessions as $session) {
            $key = $session->start->copy()->setTimezone($timezone)->format('Y-m-d');
            $byDay[$key] = ($byDay[$key] ?? 0) + $session->duration_ms;
        }

        $months = [];
        $cursor = $from->copy()->startOfMonth();
        $last = $to->copy()->startOfMonth();

        while ($cursor->lessThanOrEqualTo($last)) {
            $days = [];
            $daysInMonth = $cursor->daysInMonth;

            for ($day = 1; $day <= $daysInMonth; $day++) {
                $date = $cursor->copy()->day($day);
                $inRange = $date->greaterThanOrEqualTo($from) && $date->lessThanOrEqualTo($to);
                $ms = $inRange ? ($byDay[$date->format('Y-m-d')] ?? 0) : 0;
                $hours = $this->hours($ms);

                $days[] = [
                    'day' => $day,
                    'date' => $date->format('Y-m-d'),
                    'inRange' => $inRange,
                    'hours' => $hours,
                    'level' => $this->heatLevel($hours),
                    'title' => $date->format('M j').' · '.$this->hoursLabel($hours),
                ];
            }

            $months[] = [
                'key' => $cursor->format('Y-m'),
                'label' => $cursor->format('M Y'),
                'days' => $days,
            ];
            $cursor->addMonthNoOverflow();
        }

        return [
            'months' => $months,
            'legend' => ['0h', '<2h', '<4h', '<6h', '6h+'],
        ];
    }

    private function daily(array $period, Carbon $from, Carbon $to, string $timezone, array &$warnings): array
    {
        $byDay = [];
        foreach ($period['sessions'] as $session) {
            $key = $session->start->copy()->setTimezone($timezone)->format('Y-m-d');
            $byDay[$key]['work'] = ($byDay[$key]['work'] ?? 0) + ($session->type === 'study' ? 0 : $session->duration_ms);
            $byDay[$key]['study'] = ($byDay[$key]['study'] ?? 0) + ($session->type === 'study' ? $session->duration_ms : 0);
            $byDay[$key]['sessions'] = ($byDay[$key]['sessions'] ?? 0) + 1;
        }

        $eventsByDay = [];
        foreach ($period['events'] as $event) {
            $key = $event['start']->copy()->setTimezone($timezone)->format('Y-m-d');
            $eventsByDay[$key] = ($eventsByDay[$key] ?? 0) + 1;
        }

        $dayOffs = $period['dayOffs']->keyBy(fn (UserDayOff $dayOff) => $dayOff->date->format('Y-m-d'));
        $includeQuietDays = ReportConfig::dayCount($from, $to) <= 45;
        $rows = [];
        $cursor = $from->copy();

        while ($cursor->lessThanOrEqualTo($to)) {
            $key = $cursor->format('Y-m-d');
            $workHours = $this->hours($byDay[$key]['work'] ?? 0);
            $studyHours = $this->hours($byDay[$key]['study'] ?? 0);
            $sessionCount = $byDay[$key]['sessions'] ?? 0;
            $eventCount = $eventsByDay[$key] ?? 0;
            $dayOff = $dayOffs->get($key);

            if ($includeQuietDays || $workHours > 0 || $studyHours > 0 || $eventCount > 0 || $dayOff !== null) {
                $rows[] = [
                    'date' => $key,
                    'label' => $cursor->format('D, M j'),
                    'workHours' => $workHours,
                    'studyHours' => $studyHours,
                    'workLabel' => $this->hoursLabel($workHours),
                    'studyLabel' => $this->hoursLabel($studyHours),
                    'sessionCount' => $sessionCount,
                    'eventCount' => $eventCount,
                    'dayOff' => $dayOff?->type,
                    'dayOffLabel' => $dayOff === null ? null : ($dayOff->type === 'included' ? 'Included' : 'Excluded'),
                ];
            }

            $cursor->addDay();
        }

        if (count($rows) > self::MAX_DAILY_ROWS) {
            $rows = array_slice($rows, 0, self::MAX_DAILY_ROWS);
            $warnings[] = 'The daily breakdown shows the first '.self::MAX_DAILY_ROWS.' rows.';
        }

        return $rows;
    }

    private function monthly(Collection $sessions, Collection $dayOffs, Carbon $from, Carbon $to, string $timezone, array $requiredDays): array
    {
        $today = Carbon::now($timezone);
        $rows = [];
        $cursor = $from->copy()->startOfMonth();
        $last = $to->copy()->startOfMonth();

        while ($cursor->lessThanOrEqualTo($last)) {
            $monthStart = $cursor->copy()->startOfDay();
            $monthEnd = $cursor->copy()->endOfMonth();
            $monthKey = $monthStart->format('Y-m');
            $excluded = $dayOffs
                ->where('type', 'excluded')
                ->filter(fn (UserDayOff $dayOff) => $dayOff->date->format('Y-m') === $monthKey)
                ->map(fn (UserDayOff $dayOff) => $dayOff->date->format('Y-m-d'))
                ->flip();

            $requiredInMonth = 0;
            $elapsedRequired = 0;
            $daysLeft = 0;
            $isPast = $monthEnd->lessThan($today->copy()->startOfDay());
            $isCurrent = $monthStart->isSameMonth($today) && $monthStart->isSameYear($today);
            $isFuture = $monthStart->greaterThan($today->copy()->startOfMonth());

            for ($day = 1; $day <= $monthStart->daysInMonth; $day++) {
                $date = $monthStart->copy()->day($day);
                $isRequired = in_array($date->dayOfWeek, $requiredDays, true)
                    && ! $excluded->has($date->format('Y-m-d'));

                if (! $isRequired) {
                    continue;
                }

                $requiredInMonth++;

                if ($isPast || ($isCurrent && $date->lessThanOrEqualTo($today))) {
                    $elapsedRequired++;
                }

                if ($isFuture || ($isCurrent && $date->greaterThan($today))) {
                    $daysLeft++;
                }
            }

            $doneMs = $sessions
                ->filter(function (WorkSession $session) use ($timezone, $monthKey, $excluded): bool {
                    $local = $session->start->copy()->setTimezone($timezone);

                    return $session->type === 'work'
                        && $local->format('Y-m') === $monthKey
                        && ! $excluded->has($local->format('Y-m-d'));
                })
                ->sum(fn (WorkSession $session) => $session->duration_ms);

            $targetHours = $requiredInMonth * self::DAILY_GOAL_HOURS;
            $doneHours = $this->hours($doneMs);
            $remaining = max(0, $targetHours - $doneHours);
            $perDayNeeded = $daysLeft > 0 ? $remaining / $daysLeft : 0;
            $pace = $isPast
                ? $doneHours - $targetHours
                : ($isCurrent ? $doneHours - ($elapsedRequired * self::DAILY_GOAL_HOURS) : 0);

            $rows[] = [
                'key' => $monthKey,
                'label' => $monthStart->format('F Y'),
                'doneHours' => $doneHours,
                'doneLabel' => $this->hoursLabel($doneHours),
                'targetHours' => $targetHours,
                'targetLabel' => $this->hoursLabel($targetHours),
                'remainingHours' => round($remaining, 1),
                'remainingLabel' => $this->hoursLabel(round($remaining, 1)),
                'progress' => $targetHours > 0 ? min(1, round($doneHours / $targetHours, 3)) : 0,
                'pace' => round($pace, 1),
                'paceLabel' => ($pace > 0 ? '+' : '').$this->hoursLabel(round($pace, 1)),
                'daysLeft' => $daysLeft,
                'perDayNeeded' => round($perDayNeeded, 1),
                'perDayLabel' => $this->hoursLabel(round($perDayNeeded, 1)),
            ];

            $cursor->addMonthNoOverflow();
        }

        return $rows;
    }

    private function sessionRows(Collection $sessions, array $config, string $timezone, array &$warnings): array
    {
        $rows = $sessions->take(self::MAX_SESSION_ROWS)->map(function (WorkSession $session) use ($config, $timezone): array {
            $start = $session->start->copy()->setTimezone($timezone);
            $end = $session->end?->copy()->setTimezone($timezone);
            $note = $config['filters']['includeSessionNotes'] ? trim((string) $session->note) : '';

            if (Str::length($note) > 180) {
                $note = Str::limit($note, 180);
            }

            return [
                'id' => $session->id,
                'date' => $start->format('Y-m-d'),
                'dateLabel' => $start->format('D, M j'),
                'timeLabel' => $end === null
                    ? $start->format('H:i').' – running'
                    : $start->format('H:i').' – '.$end->format('H:i'),
                'durationLabel' => $this->durationLabel($session->duration_ms),
                'type' => $session->type,
                'typeLabel' => $session->type === 'study' ? 'Study' : 'Work',
                'sourceLabel' => $session->source === 'calendar' ? 'Calendar' : 'Timer / manual',
                'task' => $session->workTask?->title,
                'note' => $note,
                'active' => $session->end === null,
            ];
        })->values()->all();

        if ($sessions->count() > self::MAX_SESSION_ROWS) {
            $warnings[] = 'The sessions table shows the first '.self::MAX_SESSION_ROWS.' rows.';
        }

        return $rows;
    }

    private function eventRows(Collection $events, string $timezone, array &$warnings): array
    {
        $rows = $events->take(self::MAX_EVENT_ROWS)->map(function (array $event) use ($timezone): array {
            $start = $event['start']->copy()->setTimezone($timezone);
            $end = $event['end']->copy()->setTimezone($timezone);
            $durationMs = max(0, $end->getTimestampMs() - $start->getTimestampMs());

            return [
                'id' => $event['id'],
                'dateLabel' => $start->format('D, M j'),
                'timeLabel' => $event['allDay'] ? 'All day' : $start->format('H:i').' – '.$end->format('H:i'),
                'durationLabel' => $event['allDay'] ? 'All day' : $this->durationLabel($durationMs),
                'title' => $event['title'],
                'calendar' => $event['calendarName'] ?: 'Calendar',
                'account' => $event['accountEmail'],
                'isWork' => $event['isWork'],
                'workLabel' => $event['isWork'] ? 'Work' : 'Personal',
                'workSource' => $event['workSource'],
                'color' => $event['accountColor'],
                'allDay' => $event['allDay'],
            ];
        })->values()->all();

        if ($events->count() > self::MAX_EVENT_ROWS) {
            $warnings[] = 'The calendar agenda shows the first '.self::MAX_EVENT_ROWS.' rows.';
        }

        return $rows;
    }

    private function taskRows(Collection $tasks, string $timezone, array &$warnings): array
    {
        $rows = $tasks->take(self::MAX_TASK_ROWS)->map(function (WorkTask $task) use ($timezone): array {
            $trackedMs = (int) ($task->getAttribute('report_tracked_ms') ?? 0);
            $done = $task->completed_at !== null;
            $active = (bool) $task->getAttribute('report_active');
            $status = match (true) {
                $done => 'done',
                $active => 'active',
                $trackedMs > 0 || $task->started_at !== null => 'in_progress',
                default => 'todo',
            };

            return [
                'id' => $task->id,
                'title' => $task->title,
                'status' => $status,
                'statusLabel' => ucfirst(str_replace('_', ' ', $status)),
                'trackedLabel' => $this->durationLabel($trackedMs),
                'estimateLabel' => $this->durationLabel($task->estimate_minutes * 60 * 1000),
                'dueLabel' => $task->due_at?->copy()->setTimezone($timezone)->format('M j, Y'),
                'completedLabel' => $task->completed_at?->copy()->setTimezone($timezone)->format('M j, Y'),
                'overdue' => $task->isOverdue(),
                'done' => $done,
            ];
        })->values()->all();

        if ($tasks->count() > self::MAX_TASK_ROWS) {
            $warnings[] = 'The tasks table shows the first '.self::MAX_TASK_ROWS.' rows.';
        }

        return $rows;
    }

    private function studySummary(Collection $sessions, Carbon $from, Carbon $to, string $timezone): array
    {
        $study = $sessions->where('type', 'study');
        $byDay = [];

        foreach ($study as $session) {
            $key = $session->start->copy()->setTimezone($timezone)->format('Y-m-d');
            $byDay[$key] = ($byDay[$key] ?? 0) + $session->duration_ms;
        }

        $bestKey = null;
        $bestMs = 0;
        foreach ($byDay as $key => $ms) {
            if ($ms > $bestMs) {
                $bestMs = $ms;
                $bestKey = $key;
            }
        }

        $totalMs = $study->sum(fn (WorkSession $session) => $session->duration_ms);
        $workMs = $sessions->where('type', 'work')->sum(fn (WorkSession $session) => $session->duration_ms);
        $allTrackedMs = $totalMs + $workMs;
        $weeks = max(1, (int) ceil(ReportConfig::dayCount($from, $to) / 7));

        return [
            'totalHours' => $this->hours($totalMs),
            'totalLabel' => $this->hoursLabel($this->hours($totalMs)),
            'weeklyAverage' => round($this->hours($totalMs) / $weeks, 1),
            'weeklyAverageLabel' => $this->hoursLabel(round($this->hours($totalMs) / $weeks, 1)),
            'bestDay' => $bestKey === null ? null : [
                'label' => Carbon::parse($bestKey, $timezone)->format('D, M j, Y'),
                'hoursLabel' => $this->hoursLabel($this->hours($bestMs)),
            ],
            'sessionCount' => $study->count(),
            'activeDays' => count($byDay),
            'sharePercent' => $allTrackedMs > 0 ? round(($totalMs / $allTrackedMs) * 100) : 0,
        ];
    }

    private function sideTaskRows(Collection $tasks, string $timezone): array
    {
        return $tasks->take(self::MAX_SIDE_TASK_ROWS)->map(function (SideTask $task) use ($timezone): array {
            $start = $task->start?->copy()->setTimezone($timezone);
            $end = $task->effectiveEnd()?->copy()->setTimezone($timezone);

            return [
                'id' => $task->id,
                'title' => $task->title,
                'slotLabel' => $start === null
                    ? 'Unscheduled'
                    : $start->format('M j, H:i').($end === null ? '' : ' – '.$end->format('H:i')),
                'estimateLabel' => $this->durationLabel($task->estimate_minutes * 60 * 1000),
                'statusLabel' => $task->isDone() ? 'Done' : ($start === null ? 'Todo' : 'Scheduled'),
                'blocksWork' => (bool) $task->blocks_work,
            ];
        })->values()->all();
    }

    private function focusBlockRows(Collection $blocks, string $timezone): array
    {
        return $blocks->take(self::MAX_FOCUS_ROWS)->map(function (FocusBlock $block) use ($timezone): array {
            $start = $block->start->copy()->setTimezone($timezone);
            $end = $block->end->copy()->setTimezone($timezone);

            return [
                'id' => $block->id,
                'title' => $block->title,
                'timeLabel' => $start->format('D, M j · H:i').' – '.$end->format('H:i'),
                'durationLabel' => $this->durationLabel(max(0, $end->getTimestampMs() - $start->getTimestampMs())),
            ];
        })->values()->all();
    }

    private function dayOffRows(Collection $dayOffs): array
    {
        return $dayOffs->map(fn (UserDayOff $dayOff) => [
            'date' => $dayOff->date->format('Y-m-d'),
            'dateLabel' => $dayOff->date->format('D, M j, Y'),
            'type' => $dayOff->type,
            'typeLabel' => $dayOff->type === 'included' ? 'Worked day off' : 'Day off',
        ])->values()->all();
    }

    private function narrative(array $summary, ?array $comparison, bool $workOnly = false): string
    {
        if ($summary['sessionCount'] === 0 && $summary['eventCount'] === 0) {
            return 'No activity was recorded for this period.';
        }

        $parts = $workOnly && $summary['sessionCount'] === 0
            ? ['No work sessions were tracked for this period.']
            : [
                $workOnly
                    ? sprintf(
                        'You tracked %s of work across %d active %s, averaging %s per active day.',
                        $summary['workLabel'],
                        $summary['activeDays'],
                        $summary['activeDays'] === 1 ? 'day' : 'days',
                        $summary['avgLabel'],
                    )
                    : sprintf(
                        'You tracked %s of work and %s of study across %d active %s, averaging %s per active day.',
                        $summary['workLabel'],
                        $summary['studyLabel'],
                        $summary['activeDays'],
                        $summary['activeDays'] === 1 ? 'day' : 'days',
                        $summary['avgLabel'],
                    ),
            ];

        if ($summary['bestDay'] !== null) {
            $parts[] = sprintf('Your busiest day was %s with %s.', $summary['bestDay']['label'], $summary['bestDay']['hoursLabel']);
        }

        if ($summary['topTask'] !== null) {
            $parts[] = sprintf('Most tracked time went to "%s" (%s).', $summary['topTask']['title'], $summary['topTask']['label']);
        }

        if ($summary['eventCount'] > 0) {
            $parts[] = $workOnly
                ? sprintf(
                    'The work calendar added %d %s (%s scheduled).',
                    $summary['eventCount'],
                    $summary['eventCount'] === 1 ? 'event' : 'events',
                    $summary['workEventLabel'],
                )
                : sprintf(
                    'The calendar added %d %s, including %d marked as work (%s scheduled).',
                    $summary['eventCount'],
                    $summary['eventCount'] === 1 ? 'event' : 'events',
                    $summary['workEventCount'],
                    $summary['workEventLabel'],
                );
        }

        if ($comparison !== null) {
            $work = collect($comparison['metrics'])->firstWhere('key', 'workHours');

            if ($work !== null) {
                $direction = match ($work['direction']) {
                    'up' => 'up',
                    'down' => 'down',
                    default => 'unchanged',
                };
                $parts[] = $work['percent'] === null
                    ? sprintf('Work time is %s compared with the previous period.', $direction)
                    : sprintf('Work time is %s %s compared with the previous period.', $direction, $work['percentLabel']);
            }
        }

        return implode(' ', $parts);
    }

    /**
     * @return array<int, string>
     */
    private function highlights(array $summary, ?array $comparison, bool $workOnly = false): array
    {
        $highlights = [];

        if ($summary['bestDay'] !== null) {
            $highlights[] = 'Busiest day: '.$summary['bestDay']['label'].' · '.$summary['bestDay']['hoursLabel'];
        }

        if ($summary['topTask'] !== null) {
            $highlights[] = 'Top task: '.$summary['topTask']['title'].' · '.$summary['topTask']['label'];
        }

        if ($summary['eventCount'] > 0) {
            $highlights[] = $workOnly
                ? 'Work calendar: '.$summary['eventCount'].' '.($summary['eventCount'] === 1 ? 'event' : 'events').' · '.$summary['workEventLabel'].' scheduled'
                : 'Calendar: '.$summary['eventCount'].' events · '.$summary['workEventCount'].' work · '.$summary['workEventLabel'].' scheduled';
        }

        if (! $workOnly && $summary['studySessionCount'] > 0) {
            $highlights[] = 'Study: '.$summary['studyLabel'].' across '.$summary['studySessionCount'].' sessions';
        }

        if ($summary['completedTasks'] > 0) {
            $highlights[] = 'Tasks completed: '.$summary['completedTasks'];
        }

        if ($comparison !== null) {
            $work = collect($comparison['metrics'])->firstWhere('key', 'workHours');

            if ($work !== null && $work['direction'] !== 'flat') {
                $highlights[] = 'Work trend: '.$work['percentLabel'].' '.($work['direction'] === 'up' ? '↑' : '↓').' '.$comparison['label'];
            }
        }

        return $highlights;
    }

    /**
     * @return array{0: Carbon, 1: Carbon}
     */
    private function previousBounds(array $config, Carbon $from, Carbon $to): array
    {
        if ($config['comparison'] === 'previous_year') {
            return [$from->copy()->subYearNoOverflow(), $to->copy()->subYearNoOverflow()];
        }

        $days = ReportConfig::dayCount($from, $to);
        $previousTo = $from->copy()->subDay();
        $previousFrom = $previousTo->copy()->subDays($days - 1);

        return [$previousFrom, $previousTo];
    }

    private function bucketCount(Carbon $from, Carbon $to, string $groupBy): int
    {
        return match ($groupBy) {
            'month' => (int) $from->copy()->startOfMonth()->diffInMonths($to->copy()->startOfMonth()) + 1,
            'week' => (int) $from->copy()->startOfWeek(Carbon::MONDAY)->diffInWeeks($to->copy()->startOfWeek(Carbon::MONDAY)) + 1,
            default => ReportConfig::dayCount($from, $to),
        };
    }

    private function metricLabel(float|int $value, string $format): string
    {
        return match ($format) {
            'hours' => $this->hoursLabel((float) $value),
            'bestDay' => $this->hoursLabel((float) $value),
            default => (string) (int) $value,
        };
    }

    private function heatLevel(float $hours): int
    {
        return match (true) {
            $hours <= 0 => 0,
            $hours < 2 => 1,
            $hours < 4 => 2,
            $hours < 6 => 3,
            default => 4,
        };
    }

    private function hours(int $ms): float
    {
        return round($ms / 3_600_000, 1);
    }

    private function hoursLabel(float $hours): string
    {
        return number_format($hours, 1).'h';
    }

    private function durationLabel(int $ms): string
    {
        $minutes = (int) round($ms / 60_000);
        $hours = intdiv($minutes, 60);
        $remaining = $minutes % 60;

        if ($hours === 0) {
            return $remaining.'m';
        }

        return $remaining === 0 ? $hours.'h' : $hours.'h '.$remaining.'m';
    }
}
