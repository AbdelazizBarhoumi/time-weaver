<?php

namespace App\Services;

use App\Http\Controllers\WorkSessionController;
use App\Models\CalendarEvent;
use App\Models\CalendarEventOverride;
use App\Models\CalendarSetting;
use App\Models\FocusBlock;
use App\Models\SideTask;
use App\Models\User;
use App\Models\UserDayOff;
use App\Models\WorkSession;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Throwable;

/**
 * Declares and executes coach tools for Gemini's Interactions API.
 *
 * All tools operate strictly on the authenticated user. Timestamps are returned
 * as UTC ISO-8601 strings (Z) for consistency with the existing codebase; the
 * client and Gemini convert to local time as needed.
 */
class CoachToolRegistry
{
    /** Maximum window allowed for a single calendar events lookup (in days). */
    private const MAX_EVENTS_WINDOW_DAYS = 120;

    /** Maximum number of calendar events returned per call. */
    private const MAX_EVENTS_RESULTS = 300;

    /** Default minimum minutes for a free slot. */
    private const DEFAULT_FREE_SLOT_MINUTES = 30;

    /** Maximum number of free slots returned per call. */
    private const MAX_FREE_SLOTS = 20;

    public function declarations(): array
    {
        return [
            [
                'type' => 'function',
                'name' => 'get_current_datetime',
                'description' => 'Get the current date/time in UTC and the user\'s local timezone context. Use this to anchor "now", compute relative ranges (e.g. "after 24 hours", "next week"), and avoid guessing the weekday.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => (object) [],
                    'required' => [],
                ],
            ],
            [
                'type' => 'function',
                'name' => 'get_calendar_events',
                'description' => 'Fetch calendar events, focus blocks, tracked work/study sessions, and day-off markers in the given UTC time range. Also return compact busy blocks. Use when the user asks about a specific window (after 24h, next week, through an exam date, etc.).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'start_datetime' => [
                            'type' => 'string',
                            'description' => 'Start time in UTC, ISO-8601 format (e.g. 2026-10-14T12:00:00Z).',
                        ],
                        'end_datetime' => [
                            'type' => 'string',
                            'description' => 'End time in UTC, ISO-8601 format (e.g. 2026-10-21T00:00:00Z). Must be after start.',
                        ],
                        'keywords' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => 'Optional keywords to filter event titles.',
                        ],
                        'include_details' => [
                            'type' => 'boolean',
                            'description' => 'Include full event/session details (defaults to true).',
                        ],
                    ],
                    'required' => ['start_datetime', 'end_datetime'],
                ],
            ],
            [
                'type' => 'function',
                'name' => 'get_goals_and_tasks',
                'description' => 'Return the user\'s goals, required/work days, daily goal hours, side tasks (unplaced/placed/done with estimates), tracked vs target for week/month, backlog/pace, streak, and study summary. Use when answering "how much do I still need to work", "am I behind", "can I play tomorrow?", etc.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => (object) [],
                    'required' => [],
                ],
            ],
            [
                'type' => 'function',
                'name' => 'get_free_slots',
                'description' => 'Compute free slots in the user\'s work window between busy blocks (events, focus blocks, tracked sessions, blocking side tasks, day-offs) for the given UTC range. Return local-slot suggestions (as UTC ISO-8601).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'from_datetime' => [
                            'type' => 'string',
                            'description' => 'Start time in UTC, ISO-8601 (Z).',
                        ],
                        'to_datetime' => [
                            'type' => 'string',
                            'description' => 'End time in UTC, ISO-8601 (Z).',
                        ],
                        'min_minutes' => [
                            'type' => 'integer',
                            'minimum' => 1,
                            'description' => 'Minimum slot length in minutes (default 30).',
                        ],
                        'max_results' => [
                            'type' => 'integer',
                            'minimum' => 1,
                            'maximum' => self::MAX_FREE_SLOTS,
                            'description' => 'Maximum number of slots to return (default 20, max 20).',
                        ],
                    ],
                    'required' => ['from_datetime', 'to_datetime'],
                ],
            ],
        ];
    }

    /**
     * @throws \InvalidArgumentException if arguments are invalid
     */
    public function execute(User $user, string $name, array $arguments): array
    {
        return match ($name) {
            'get_current_datetime' => $this->getCurrentDateTime($user),
            'get_calendar_events' => $this->getCalendarEvents($user, $arguments),
            'get_goals_and_tasks' => $this->getGoalsAndTasks($user),
            'get_free_slots' => $this->getFreeSlots($user, $arguments),
            default => ['error' => 'Unknown tool: '.$name],
        };
    }

    private function getCurrentDateTime(User $user): array
    {
        $now = now();
        $settings = CalendarSetting::forUser($user);
        $tz = config('app.timezone', 'UTC');

        $localNow = $now->copy()->timezone($tz);
        $offset = $localNow->utcOffset();
        $offsetMinutes = (int) ($offset / 60);

        return [
            'now_utc' => $now->toIso8601ZuluString(),
            'timezone' => $tz,
            'utc_offset_minutes' => $offsetMinutes,
            'weekday' => $localNow->format('l'),
            'local_date' => $localNow->format('Y-m-d'),
            'local_time' => $localNow->format('H:i:s'),
            'settings' => $settings->toApi(),
        ];
    }

    /**
     * Parse a tool-supplied timestamp, or null when it is missing or garbage.
     *
     * Carbon 3 throws InvalidFormatException instead of returning an invalid
     * date, so a hallucinated timestamp must never bubble up as a 500.
     */
    private function parseTimestamp(mixed $value): ?Carbon
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            return Carbon::parse($value);
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * The user's own events overlapping the range, each with the times it
     * actually occupies: a dragged occurrence's override wins over the cached
     * Google times, the same rule the calendar endpoint renders by. Dismissed
     * events are already deleted from the cache at sync time, so there is
     * nothing to filter here.
     *
     * @return Collection<int, array{id: int, accountId: int, title: string, start: Carbon, end: Carbon, allDay: bool}>
     */
    private function eventsInRange(User $user, Carbon $start, Carbon $end): Collection
    {
        $overrides = CalendarEventOverride::where('user_id', $user->id)->get()
            ->keyBy(fn (CalendarEventOverride $override): string => $override->calendar_account_id.'|'.$override->event_id);

        // A moved event can leave the window its cached row still sits in, so
        // also pull in any occurrence whose override lands inside the range.
        $movedKeys = $overrides
            ->filter(fn (CalendarEventOverride $override): bool => $override->start->lt($end) && $override->end->gt($start))
            ->map(fn (CalendarEventOverride $override): array => [$override->calendar_account_id, $override->event_id])
            ->values();

        return CalendarEvent::where('user_id', $user->id)
            ->where(function ($query) use ($start, $end, $movedKeys): void {
                $query->where(function ($query) use ($start, $end): void {
                    $query->where('start', '<', $end)->where('end', '>', $start);
                });

                foreach ($movedKeys as [$accountId, $eventId]) {
                    $query->orWhere(function ($query) use ($accountId, $eventId): void {
                        $query->where('calendar_account_id', $accountId)->where('event_id', $eventId);
                    });
                }
            })
            ->orderBy('start')
            ->limit(self::MAX_EVENTS_RESULTS)
            ->get()
            ->map(function (CalendarEvent $event) use ($overrides): array {
                $override = $overrides->get($event->calendar_account_id.'|'.$event->event_id);

                return [
                    'id' => $event->id,
                    'accountId' => $event->calendar_account_id,
                    'title' => $event->title,
                    'start' => $override?->start ?? $event->start,
                    'end' => $override?->end ?? $event->end,
                    'allDay' => (bool) $event->all_day,
                ];
            });
    }

    private function getCalendarEvents(User $user, array $arguments): array
    {
        $start = $this->parseTimestamp($arguments['start_datetime'] ?? null);
        $end = $this->parseTimestamp($arguments['end_datetime'] ?? null);

        if ($start === null || $end === null || $end->lte($start)) {
            return ['error' => 'Invalid range: end must be after start.'];
        }

        if ($start->diffInDays($end) > self::MAX_EVENTS_WINDOW_DAYS) {
            return ['error' => 'Window too large. Max '.self::MAX_EVENTS_WINDOW_DAYS.' days.'];
        }

        $keywords = is_array($arguments['keywords'] ?? null)
            ? array_values(array_filter(array_map(fn ($kw): string => trim((string) $kw), $arguments['keywords']), fn (string $kw): bool => $kw !== ''))
            : [];
        $includeDetails = (bool) ($arguments['include_details'] ?? true);

        $events = $this->eventsInRange($user, $start, $end)
            ->when($keywords !== [], function (Collection $events) use ($keywords): Collection {
                return $events->filter(function (array $event) use ($keywords): bool {
                    $title = Str::lower($event['title']);

                    foreach ($keywords as $keyword) {
                        if (str_contains($title, Str::lower($keyword))) {
                            return true;
                        }
                    }

                    return false;
                });
            })
            ->map(fn (array $event): array => [
                'type' => 'event',
                'id' => $event['id'],
                'account_id' => $event['accountId'],
                'title' => $event['title'],
                'start' => $event['start']->toIso8601ZuluString(),
                'end' => $event['end']->toIso8601ZuluString(),
                'is_all_day' => $event['allDay'],
            ])
            ->values();

        $focus = FocusBlock::query()
            ->where('user_id', $user->id)
            ->where('start', '<', $end)
            ->where('end', '>', $start)
            ->get()
            ->map(fn ($b) => [
                'type' => 'focus_block',
                'id' => $b->id,
                'title' => $b->title,
                'start' => $b->start->toIso8601ZuluString(),
                'end' => $b->end->toIso8601ZuluString(),
            ]);

        $sessions = WorkSession::query()
            ->where(function ($query) use ($user, $start, $end): void {
                $query->where('user_id', $user->id)
                    ->where('start', '<', $end)
                    ->where('end', '>', $start);
            })
            ->orWhere(function ($query) use ($user, $start, $end): void {
                $query->where('user_id', $user->id)->whereNull('end')->where('start', '>=', $start)->where('start', '<', $end);
            })
            ->get()
            ->map(fn ($s) => [
                'type' => $s->type ?? 'work',
                'id' => $s->id,
                'note' => $s->note,
                'start' => $s->start->toIso8601ZuluString(),
                'end' => $s->end?->toIso8601ZuluString(),
            ]);

        $dayOffs = UserDayOff::query()
            ->where('user_id', $user->id)
            ->where('date', '>=', $start->toDateString())
            ->where('date', '<', $end->toDateString())
            ->get()
            ->map(fn ($d) => [
                'type' => 'day_off',
                'dayOffType' => $d->type,
                'date' => $d->date->toDateString(),
            ]);

        $busy = collect()
            ->merge($events->map(fn ($e) => ['start' => $e['start'], 'end' => $e['end']]))
            ->merge($focus->map(fn ($f) => ['start' => $f['start'], 'end' => $f['end']]))
            ->merge($sessions->filter(fn ($s) => $s['end'] !== null)->map(fn ($s) => ['start' => $s['start'], 'end' => $s['end']]))
            ->sortBy('start')
            ->values();

        $result = [
            'range' => ['start' => $start->toIso8601ZuluString(), 'end' => $end->toIso8601ZuluString()],
            'events' => $events->all(),
            'focus_blocks' => $focus->values()->all(),
            'sessions' => $sessions->values()->all(),
            'day_offs' => $dayOffs->values()->all(),
            'busy_blocks' => $busy->all(),
        ];

        if (! $includeDetails) {
            $result['events'] = array_map(fn ($e) => ['start' => $e['start'], 'end' => $e['end'], 'title' => $e['title']], $result['events']);
            $result['focus_blocks'] = array_map(fn ($f) => ['start' => $f['start'], 'end' => $f['end']], $result['focus_blocks']);
        }

        return $result;
    }

    private function getGoalsAndTasks(User $user): array
    {
        $settings = CalendarSetting::forUser($user);
        $now = now();

        $tasks = SideTask::query()
            ->where('user_id', $user->id)
            ->orderBy('id')
            ->get()
            ->map(fn ($t) => $t->toApi($now));

        // The roll-up lives on the controller and only reads $request->user(),
        // so feed it a synthetic request bound to this user instead of
        // duplicating the backlog/streak/study math here.
        $request = Request::create('/api/calendar/work-sessions/stats');
        $request->setUserResolver(fn (): User => $user);
        $stats = app(WorkSessionController::class)->stats($request);

        return [
            'settings' => $settings->toApi(),
            'tasks' => $tasks->values()->all(),
            'stats' => $stats->toArray($request),
            'now' => $now->toIso8601ZuluString(),
        ];
    }

    private function getFreeSlots(User $user, array $arguments): array
    {
        $from = $this->parseTimestamp($arguments['from_datetime'] ?? null);
        $to = $this->parseTimestamp($arguments['to_datetime'] ?? null);

        if ($from === null || $to === null || $to->lte($from)) {
            return ['error' => 'Invalid range: to must be after from.'];
        }

        $minMinutes = max(1, (int) ($arguments['min_minutes'] ?? self::DEFAULT_FREE_SLOT_MINUTES));
        $maxResults = min(self::MAX_FREE_SLOTS, max(1, (int) ($arguments['max_results'] ?? self::MAX_FREE_SLOTS)));

        $settings = CalendarSetting::forUser($user);
        $excludedDays = UserDayOff::where('user_id', $user->id)->where('type', 'excluded')
            ->pluck('date')->map(fn ($date): string => $date->toDateString())
            ->flip();

        $busy = collect()
            ->merge($this->eventsInRange($user, $from, $to)->map(fn (array $event): array => ['start' => $event['start']->copy(), 'end' => $event['end']->copy()]))
            ->merge(FocusBlock::where('user_id', $user->id)->where('start', '<', $to)->where('end', '>', $from)
                ->get()->map(fn (FocusBlock $block): array => ['start' => $block->start->copy(), 'end' => $block->end->copy()]))
            ->merge(WorkSession::where('user_id', $user->id)->whereNotNull('end')->where('start', '<', $to)->where('end', '>', $from)
                ->get()->map(fn (WorkSession $session): array => ['start' => $session->start->copy(), 'end' => $session->end->copy()]))
            // Only placed blocking tasks hold the time; done ones free it again.
            ->merge(SideTask::where('user_id', $user->id)->where('blocks_work', true)->whereNotNull('start')->whereNotNull('end')
                ->where('start', '<', $to)->where('end', '>', $from)
                ->get()
                ->filter(fn (SideTask $task): bool => ! $task->isDone())
                ->map(fn (SideTask $task): array => ['start' => $task->start->copy(), 'end' => $task->end->copy()]))
            ->sortBy('start')
            ->values();

        $slots = [];
        $day = $from->copy()->startOfDay();

        while ($day->lte($to) && count($slots) < $maxResults) {
            // Free time only exists inside the configured work window on a work
            // day; excluded day-offs are erased entirely.
            if ($settings->isWorkDay($day) && ! $excludedDays->has($day->toDateString())) {
                $windowStart = max($from, $day->copy()->setTimeFromTimeString($settings->work_start));
                $windowEnd = min($to, $day->copy()->setTimeFromTimeString($settings->work_end));

                foreach ($this->gapsBetween($windowStart, $windowEnd, $busy, $minMinutes) as $gap) {
                    $slots[] = [
                        'start' => $gap['start']->toIso8601ZuluString(),
                        'end' => $gap['end']->toIso8601ZuluString(),
                        'minutes' => (int) $gap['start']->diffInMinutes($gap['end']),
                    ];

                    if (count($slots) >= $maxResults) {
                        break;
                    }
                }
            }

            $day = $day->addDay()->startOfDay();
        }

        return [
            'range' => ['start' => $from->toIso8601ZuluString(), 'end' => $to->toIso8601ZuluString()],
            'slots' => $slots,
        ];
    }

    /**
     * The gaps of at least $minMinutes left inside [start, end] once every
     * overlapping busy block is carved out. Carbon 3's diffInMinutes returns a
     * signed float, so the later date must come first for a positive length.
     *
     * @param  Collection<int, array{start: Carbon, end: Carbon}>  $busy  Sorted by start.
     * @return array<int, array{start: Carbon, end: Carbon}>
     */
    private function gapsBetween(Carbon $start, Carbon $end, Collection $busy, int $minMinutes): array
    {
        $gaps = [];
        $cursor = $start->copy();

        foreach ($busy as $block) {
            if ($block['end']->lte($cursor)) {
                continue;
            }

            if ($block['start']->gte($end)) {
                break;
            }

            if ($block['start']->gt($cursor) && $cursor->diffInMinutes($block['start']) >= $minMinutes) {
                $gaps[] = ['start' => $cursor->copy(), 'end' => $block['start']->copy()];
            }

            if ($block['end']->gt($cursor)) {
                $cursor = $block['end']->copy();
            }

            if ($cursor->gte($end)) {
                return $gaps;
            }
        }

        if ($cursor->diffInMinutes($end) >= $minMinutes) {
            $gaps[] = ['start' => $cursor, 'end' => $end->copy()];
        }

        return $gaps;
    }
}
