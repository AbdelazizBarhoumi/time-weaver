<?php

namespace App\Services;

use App\Models\CalendarEvent;
use App\Models\CalendarEventOverride;
use App\Models\CalendarEventTag;
use App\Models\CalendarSetting;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Resolves cached calendar events for a range, applying moved-event overrides
 * and the user's manual work tags / keyword rules. Shared by the calendar API
 * and the report builder so both always agree on what counts as work.
 */
class CalendarEventFeed
{
    /**
     * @return Collection<int, array<string, mixed>>
     */
    public function eventsFor(User $user, Carbon $from, Carbon $to): Collection
    {
        $keywords = array_map(
            fn (string $keyword): string => Str::lower($keyword),
            CalendarSetting::forUser($user)->toApi()['workKeywords'],
        );

        $tags = CalendarEventTag::where('user_id', $user->id)->get()
            ->keyBy(fn (CalendarEventTag $tag) => $tag->calendar_account_id.'|'.$tag->event_id);

        // Events the user dragged keep their Google times in the cache, so the
        // override supplies the times we actually render.
        $overrides = CalendarEventOverride::where('user_id', $user->id)->get()
            ->keyBy(fn (CalendarEventOverride $override) => $override->calendar_account_id.'|'.$override->event_id);

        // A moved event can leave the window its cached row still sits in, so
        // also pull in any occurrence whose override lands inside the range.
        $movedKeys = $overrides
            ->filter(fn (CalendarEventOverride $override): bool => $override->start < $to && $override->end > $from)
            ->map(fn (CalendarEventOverride $override): array => [$override->calendar_account_id, $override->event_id])
            ->values();

        return CalendarEvent::with('account')
            ->where('user_id', $user->id)
            ->where(function ($query) use ($from, $to, $movedKeys): void {
                $query->where(function ($query) use ($from, $to): void {
                    $query->where('start', '<', $to)->where('end', '>', $from);
                });

                foreach ($movedKeys as [$accountId, $eventId]) {
                    $query->orWhere(function ($query) use ($accountId, $eventId): void {
                        $query->where('calendar_account_id', $accountId)->where('event_id', $eventId);
                    });
                }
            })
            ->orderBy('start')
            ->get()
            ->map(function (CalendarEvent $event) use ($tags, $overrides, $keywords): array {
                $key = $event->calendar_account_id.'|'.$event->event_id;
                $tag = $tags->get($key);
                $override = $overrides->get($key);
                ['isWork' => $isWork, 'source' => $workSource] = $this->workState($event, $tag, $keywords);

                return [
                    'id' => $key,
                    'cacheId' => $event->id,
                    'eventId' => $event->event_id,
                    'recurringEventId' => $event->recurring_event_id,
                    'accountId' => $event->calendar_account_id,
                    'accountEmail' => $event->account?->email ?? $event->account_email,
                    'accountColor' => $event->account?->color ?? $event->color,
                    'calendarId' => $event->calendar_id,
                    'calendarName' => $event->calendar_name,
                    'title' => $event->title,
                    'start' => $override?->start ?? $event->start,
                    'end' => $override?->end ?? $event->end,
                    'allDay' => $event->all_day,
                    'color' => $event->event_color,
                    'isWork' => $isWork,
                    'workSource' => $workSource,
                    'syncedAt' => $event->synced_at,
                ];
            });
    }

    /**
     * Resolve whether an event counts as work and where that came from: a manual
     * tag wins over the keyword rules, which win over a default-work mailbox.
     *
     * @param  array<int, string>  $keywords
     * @return array{isWork: bool, source: ?string}
     */
    private function workState(CalendarEvent $event, ?CalendarEventTag $tag, array $keywords): array
    {
        $matchesRule = ! $event->all_day && $this->matchesKeyword($event->title, $keywords);
        // A mailbox flagged as default-work counts every timed event as work.
        $defaultWork = ! $event->all_day && (bool) $event->account?->default_work;

        if ($tag) {
            return ['isWork' => (bool) $tag->is_work, 'source' => 'manual'];
        }

        return [
            'isWork' => $matchesRule || $defaultWork,
            'source' => $matchesRule ? 'rule' : ($defaultWork ? 'account' : null),
        ];
    }

    /**
     * @param  array<int, string>  $keywords
     */
    private function matchesKeyword(string $title, array $keywords): bool
    {
        $lower = Str::lower($title);

        foreach ($keywords as $keyword) {
            if ($keyword !== '' && Str::contains($lower, $keyword)) {
                return true;
            }
        }

        return false;
    }
}
