<?php

namespace App\Services;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventDismissal;
use App\Models\CalendarEventOverride;
use Illuminate\Support\Carbon;

/**
 * Persists live Google Calendar events into the local cache so the calendar
 * keeps working — and keeps its history — even when an account is unreachable.
 *
 * Google sends timed events as RFC 3339 *with an offset* (e.g.
 * `2026-10-16T13:00:00+03:00`). The `start`/`end` columns are timezone-less
 * `datetime`s and Laravel formats a Carbon in the Carbon's own timezone, so
 * storing the parsed value as-is silently drops the offset and shifts every
 * event by that offset. Everything is therefore normalised to UTC before it is
 * written; `config('app.timezone')` is UTC, so it round-trips unchanged.
 */
class CalendarSyncService
{
    public function __construct(private GoogleCalendarService $google) {}

    /**
     * Pull one account's events for a window and mirror them into the cache.
     *
     * Events already cached but missing from Google within the window are
     * removed; events outside the window are left untouched — except that a
     * recurring series which has stopped appearing in the window is checked
     * against Google and dropped when it is gone.
     *
     * Events the user deleted for good are skipped entirely — they are never
     * written back — and any stale cached row for them is dropped.
     *
     * @return array{synced: int, removed: int}
     */
    public function sync(CalendarAccount $account, Carbon $from, Carbon $to): array
    {
        $items = $this->google->events($account, $from, $to);
        $now = now();
        $dismissals = $this->dismissalsFor($account);

        $seen = [];
        $seenSeries = [];
        foreach ($items as $item) {
            if ($this->isDismissed($item, $dismissals)) {
                continue;
            }

            $seen[$item['eventId']] = true;
            if ($item['recurringEventId'] !== null) {
                $seenSeries[$item['recurringEventId']] = true;
            }

            CalendarEvent::updateOrCreate(
                [
                    'calendar_account_id' => $account->id,
                    'event_id' => $item['eventId'],
                ],
                [
                    'user_id' => $account->user_id,
                    'account_email' => $account->email,
                    'color' => $account->color,
                    'recurring_event_id' => $item['recurringEventId'],
                    'calendar_id' => $item['calendarId'],
                    'calendar_name' => $item['calendarName'],
                    'title' => $item['title'],
                    'start' => $this->toUtc($item['start']),
                    'end' => $this->toUtc($item['end']),
                    'all_day' => $item['allDay'],
                    'event_color' => $item['color'],
                    'synced_at' => $now,
                ],
            );
        }

        $removed = 0;
        CalendarEvent::where('calendar_account_id', $account->id)
            // Duplicated events live only here; Google never returns them, so
            // they are never stale.
            ->where('is_local', false)
            ->where('start', '<', $to)
            ->where('end', '>', $from)
            ->get()
            ->each(function (CalendarEvent $event) use ($seen, &$removed): void {
                if (! isset($seen[$event->event_id])) {
                    $event->delete();
                    $removed++;
                }
            });

        $removed += $this->removeStaleSeries($account, $seenSeries, $dismissals);

        $account->update(['last_synced_at' => $now]);

        return ['synced' => count($seen), 'removed' => $removed];
    }

    /**
     * Remove cached occurrences of series that Google no longer has.
     *
     * The window sync above only reconciles events inside the window, so a
     * series deleted in Google would leave older cached occurrences behind
     * forever. Series still recurring in the window are skipped — and so are
     * ones the user dismissed — so this only ever asks Google about series that
     * look genuinely stale.
     *
     * @param  array<string, true>  $seenSeries
     * @param  array{events: array<string, true>, series: array<string, true>}  $dismissals
     */
    private function removeStaleSeries(CalendarAccount $account, array $seenSeries, array $dismissals): int
    {
        $candidates = CalendarEvent::where('calendar_account_id', $account->id)
            ->where('is_local', false)
            ->whereNotNull('recurring_event_id')
            ->pluck('calendar_id', 'recurring_event_id')
            ->reject(fn (string $calendarId, string $seriesId): bool => isset($seenSeries[$seriesId])
                || isset($dismissals['series'][$seriesId]))
            ->all();

        $removed = 0;

        foreach ($this->google->missingSeries($account, $candidates) as $seriesId) {
            $removed += CalendarEvent::where('calendar_account_id', $account->id)
                ->where('recurring_event_id', $seriesId)
                ->delete();
        }

        return $removed;
    }

    /**
     * Drop every cached event, work tag and dismissal for an account, so the
     * mailbox starts over completely.
     */
    public function purge(CalendarAccount $account): int
    {
        $deleted = CalendarEvent::where('calendar_account_id', $account->id)->delete();

        $account->tags()->delete();
        $account->dismissals()->delete();
        CalendarEventOverride::where('calendar_account_id', $account->id)->delete();
        $account->update(['last_synced_at' => null]);

        return $deleted;
    }

    /**
     * Forget the events that were deleted for good, so a later sync can find
     * them again.
     */
    public function restore(CalendarAccount $account): int
    {
        return $account->dismissals()->delete();
    }

    /**
     * The account's dismissed ids, split into single occurrences and series ids.
     *
     * @return array{events: array<string, true>, series: array<string, true>}
     */
    private function dismissalsFor(CalendarAccount $account): array
    {
        $dismissals = CalendarEventDismissal::where('calendar_account_id', $account->id)->get();

        return [
            'events' => $dismissals->pluck('event_id')->flip()->all(),
            'series' => $dismissals->whereNotNull('recurring_event_id')->pluck('recurring_event_id')->flip()->all(),
        ];
    }

    /**
     * @param  array{eventId: string, recurringEventId: ?string, start: string, end: string}  $item
     * @param  array{events: array<string, true>, series: array<string, true>}  $dismissals
     */
    private function isDismissed(array $item, array $dismissals): bool
    {
        if (isset($dismissals['events'][$item['eventId']])) {
            return true;
        }

        return $item['recurringEventId'] !== null && isset($dismissals['series'][$item['recurringEventId']]);
    }

    /**
     * Parse a Google date value into UTC. Timed values carry an offset that must
     * be honoured; all-day values are plain dates and land on UTC midnight.
     */
    private function toUtc(string $value): Carbon
    {
        return Carbon::parse($value, 'UTC')->utc();
    }
}
