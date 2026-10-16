<?php

namespace App\Http\Controllers;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventDismissal;
use App\Models\CalendarEventTag;
use App\Models\CalendarSetting;
use App\Models\User;
use App\Services\CalendarSyncService;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Throwable;

class CalendarEventController extends Controller
{
    /** How far back and forward a manual sync reaches, in months. */
    private const SYNC_MONTHS_BACK = 3;

    private const SYNC_MONTHS_FORWARD = 3;

    public function __construct(private CalendarSyncService $sync) {}

    /**
     * Serve the locally cached events for a range, resolving each one's work
     * state (a manual tag wins over the keyword rules). No network access.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => 'required|date',
            'to' => 'required|date',
        ]);

        $user = $request->user();
        $from = Carbon::parse($data['from']);
        $to = Carbon::parse($data['to']);
        $keywords = array_map(fn (string $keyword): string => Str::lower($keyword), CalendarSetting::forUser($user)->toApi()['workKeywords']);

        $tags = CalendarEventTag::where('user_id', $user->id)->get()
            ->keyBy(fn (CalendarEventTag $tag) => $tag->calendar_account_id.'|'.$tag->event_id);

        $events = CalendarEvent::with('account')
            ->where('user_id', $user->id)
            ->where('start', '<', $to)
            ->where('end', '>', $from)
            ->orderBy('start')
            ->get()
            ->map(function (CalendarEvent $event) use ($tags, $keywords): array {
                $tag = $tags->get($event->calendar_account_id.'|'.$event->event_id);
                $matchesRule = ! $event->all_day && $this->matchesKeyword($event->title, $keywords);
                // A mailbox flagged as default-work counts every timed event as work.
                $defaultWork = ! $event->all_day && (bool) $event->account?->default_work;

                if ($tag) {
                    $isWork = $tag->is_work;
                    $workSource = 'manual';
                } else {
                    $isWork = $matchesRule || $defaultWork;
                    $workSource = $matchesRule ? 'rule' : ($defaultWork ? 'account' : null);
                }

                return [
                    'id' => $event->calendar_account_id.'|'.$event->event_id,
                    'cacheId' => $event->id,
                    'eventId' => $event->event_id,
                    'recurringEventId' => $event->recurring_event_id,
                    'accountId' => $event->calendar_account_id,
                    'accountEmail' => $event->account?->email ?? $event->account_email,
                    'accountColor' => $event->account?->color ?? $event->color,
                    'calendarId' => $event->calendar_id,
                    'calendarName' => $event->calendar_name,
                    'title' => $event->title,
                    // All-day events keep the date-only shape the calendar UI expects.
                    'start' => $event->all_day ? $event->start->toDateString() : $event->start->toISOString(),
                    'end' => $event->all_day ? $event->end->toDateString() : $event->end->toISOString(),
                    'allDay' => $event->all_day,
                    'color' => $event->event_color,
                    'isWork' => $isWork,
                    'workSource' => $workSource,
                    'syncedAt' => $event->synced_at?->toISOString(),
                ];
            })
            ->values();

        return response()->json(['events' => $events, 'errors' => []]);
    }

    /**
     * Manually refresh every connected account into the cache.
     */
    public function sync(Request $request): JsonResponse
    {
        $user = $request->user();

        $from = $request->filled('from')
            ? Carbon::parse($request->string('from'))
            : now()->subMonths(self::SYNC_MONTHS_BACK)->startOfDay();
        $to = $request->filled('to')
            ? Carbon::parse($request->string('to'))
            : now()->addMonths(self::SYNC_MONTHS_FORWARD)->endOfDay();

        $accounts = [];
        $errors = [];

        foreach ($user->calendarAccounts()->whereNull('disconnected_at')->get() as $account) {
            /** @var CalendarAccount $account */
            try {
                $summary = $this->sync->sync($account, $from, $to);

                $accounts[] = [
                    'accountId' => $account->id,
                    'email' => $account->email,
                    'synced' => $summary['synced'],
                    'removed' => $summary['removed'],
                    'lastSyncedAt' => $account->last_synced_at?->toISOString(),
                    'failed' => false,
                ];
            } catch (Throwable $e) {
                report($e);

                $errors[] = [
                    'accountId' => $account->id,
                    'email' => $account->email,
                    'message' => 'Could not load this account. Try reconnecting it.',
                ];
                $accounts[] = [
                    'accountId' => $account->id,
                    'email' => $account->email,
                    'synced' => 0,
                    'removed' => 0,
                    'lastSyncedAt' => $account->last_synced_at?->toISOString(),
                    'failed' => true,
                ];
            }
        }

        return response()->json([
            'synced' => array_sum(array_column($accounts, 'synced')),
            'accounts' => $accounts,
            'errors' => $errors,
            'syncedAt' => now()->toISOString(),
        ]);
    }

    /**
     * Mark an event as work / not work, or clear the override (is_work = null).
     *
     * Marking a timed event as work also records a tracked session for its time,
     * so calendar work shows up in the streak/backlog/monthly stats. Clearing the
     * tag removes that session again.
     */
    public function tag(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => 'required|integer',
            'event_id' => 'required|string|max:1024',
            'is_work' => 'present|nullable|boolean',
            'title' => 'nullable|string|max:512',
            'start' => 'nullable|date',
            'end' => 'nullable|date',
            'all_day' => 'nullable|boolean',
        ]);

        $user = $request->user();
        $account = $user->calendarAccounts()->whereKey($data['account_id'])->firstOrFail();

        $linkedSession = $user->workSessions()
            ->where('source', 'calendar')
            ->where('calendar_account_id', $account->id)
            ->where('calendar_event_id', $data['event_id']);

        if ($data['is_work'] === true) {
            CalendarEventTag::updateOrCreate(
                ['calendar_account_id' => $account->id, 'event_id' => $data['event_id']],
                ['user_id' => $user->id, 'is_work' => true],
            );

            $this->recordCalendarSession($user, $account, $data, $linkedSession);
        } elseif ($data['is_work'] === false) {
            $linkedSession->delete();
            CalendarEventTag::updateOrCreate(
                ['calendar_account_id' => $account->id, 'event_id' => $data['event_id']],
                ['user_id' => $user->id, 'is_work' => false],
            );
        } else {
            $linkedSession->delete();
            CalendarEventTag::where('calendar_account_id', $account->id)
                ->where('event_id', $data['event_id'])
                ->delete();
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Delete cached rows for a single occurrence, or — with `scope=series` — every
     * cached occurrence of the same recurring event.
     *
     * By default this is a local removal only: a later sync re-creates the events
     * if Google still returns them. Passing `permanent` records a dismissal
     * instead, so every future sync skips them and they stay gone. Any work tags
     * or tracked sessions are left untouched either way.
     */
    public function destroy(Request $request, int $eventId): JsonResponse
    {
        $data = $request->validate([
            'scope' => 'nullable|in:this,series',
            'permanent' => 'nullable|boolean',
        ]);

        $event = CalendarEvent::where('user_id', $request->user()->id)
            ->whereKey($eventId)
            ->firstOrFail();

        $seriesId = $event->recurring_event_id;
        $wholeSeries = ($data['scope'] ?? 'this') === 'series' && $seriesId !== null;

        if ($data['permanent'] ?? false) {
            CalendarEventDismissal::updateOrCreate(
                [
                    'calendar_account_id' => $event->calendar_account_id,
                    // A series dismissal is keyed by the series id so every
                    // occurrence (and the series itself) is skipped on sync.
                    'event_id' => $wholeSeries ? $seriesId : $event->event_id,
                ],
                [
                    'user_id' => $event->user_id,
                    'recurring_event_id' => $wholeSeries ? $seriesId : null,
                ],
            );
        }

        if ($wholeSeries) {
            $removed = CalendarEvent::where('user_id', $request->user()->id)
                ->where('calendar_account_id', $event->calendar_account_id)
                ->where(function ($query) use ($seriesId): void {
                    $query->where('recurring_event_id', $seriesId)
                        ->orWhere('event_id', $seriesId);
                })
                ->delete();

            return response()->json(['removed' => $removed]);
        }

        $event->delete();

        return response()->json(['removed' => 1]);
    }

    /**
     * Create or refresh the tracked session mirroring a work event.
     *
     * All-day events have no clock time, so they only get the tag.
     *
     * @param  array<string, mixed>  $data
     */
    private function recordCalendarSession(
        User $user,
        CalendarAccount $account,
        array $data,
        HasMany $linkedSession,
    ): void {
        if (($data['all_day'] ?? false) || empty($data['start']) || empty($data['end'])) {
            return;
        }

        $start = Carbon::parse($data['start']);
        $end = Carbon::parse($data['end']);

        if ($end->lessThanOrEqualTo($start)) {
            return;
        }

        $attributes = [
            'start' => $start,
            'end' => $end,
            'note' => $data['title'] ?? 'Calendar event',
            'source' => 'calendar',
            'paused_ms' => 0,
            'paused_at' => null,
            'segments' => [[
                'type' => 'work',
                'start' => $start->toISOString(),
                'end' => $end->toISOString(),
            ]],
        ];

        $session = $linkedSession->first();

        if ($session) {
            $session->update($attributes);
        } else {
            $user->workSessions()->create($attributes + [
                'calendar_account_id' => $account->id,
                'calendar_event_id' => $data['event_id'],
            ]);
        }
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
