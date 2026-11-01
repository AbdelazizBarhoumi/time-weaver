<?php

namespace App\Http\Controllers;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventDismissal;
use App\Models\CalendarEventOverride;
use App\Models\CalendarEventTag;
use App\Models\User;
use App\Services\CalendarEventFeed;
use App\Services\CalendarSyncService;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

class CalendarEventController extends Controller
{
    /** How far back and forward a manual sync reaches, in months. */
    private const SYNC_MONTHS_BACK = 3;

    private const SYNC_MONTHS_FORWARD = 3;

    public function __construct(
        private CalendarSyncService $sync,
        private CalendarEventFeed $feed,
    ) {}

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

        $from = Carbon::parse($data['from']);
        $to = Carbon::parse($data['to']);

        $events = $this->feed->eventsFor($request->user(), $from, $to)
            ->map(function (array $event): array {
                return [
                    'id' => $event['id'],
                    'cacheId' => $event['cacheId'],
                    'eventId' => $event['eventId'],
                    'recurringEventId' => $event['recurringEventId'],
                    'accountId' => $event['accountId'],
                    'accountEmail' => $event['accountEmail'],
                    'accountColor' => $event['accountColor'],
                    'calendarId' => $event['calendarId'],
                    'calendarName' => $event['calendarName'],
                    'title' => $event['title'],
                    // All-day events keep the date-only shape the calendar UI expects.
                    'start' => $event['allDay'] ? $event['start']->toDateString() : $event['start']->toISOString(),
                    'end' => $event['allDay'] ? $event['end']->toDateString() : $event['end']->toISOString(),
                    'allDay' => $event['allDay'],
                    'color' => $event['color'],
                    'hasCustomColor' => $event['hasCustomColor'],
                    'category' => $event['category'],
                    'categorySource' => $event['categorySource'],
                    'isLocal' => $event['isLocal'],
                    'isWork' => $event['isWork'],
                    'workSource' => $event['workSource'],
                    'syncedAt' => $event['syncedAt']?->toISOString(),
                ];
            })
            ->values();

        return response()->json(['events' => $events, 'errors' => []]);
    }

    /**
     * Create an event that lives only in Time Weaver. Google access is
     * read-only, so the event is attached to the user's first connected mailbox
     * and every later sync leaves the `local-` row alone.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'filled', 'string', 'max:512'],
            'start' => ['required', 'date'],
            'end' => ['required', 'date', 'after:start'],
            'all_day' => ['sometimes', 'boolean'],
            'category_id' => ['nullable', 'integer', Rule::exists('categories', 'id')->where('user_id', $request->user()->id)],
            'color' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]);

        $user = $request->user();
        $account = $user->calendarAccounts()
            ->whereNull('disconnected_at')
            ->orderBy('id')
            ->first();

        if ($account === null) {
            throw ValidationException::withMessages([
                'event' => 'Connect a Google account before creating an event.',
            ]);
        }

        $allDay = (bool) ($data['all_day'] ?? false);
        $start = Carbon::parse($data['start'], 'UTC')->utc();
        $end = Carbon::parse($data['end'], 'UTC')->utc();

        if ($end->lessThanOrEqualTo($start)) {
            throw ValidationException::withMessages(['end' => 'The end must be after the start.']);
        }

        $event = CalendarEvent::create([
            'user_id' => $user->id,
            'calendar_account_id' => $account->id,
            'account_email' => $account->email,
            'color' => $account->color,
            'event_id' => 'local-'.Str::uuid(),
            'recurring_event_id' => null,
            'calendar_id' => 'primary',
            'calendar_name' => 'Time Weaver',
            'title' => trim($data['title']),
            'start' => $start,
            'end' => $end,
            'all_day' => $allDay,
            'event_color' => $data['color'] ?? null,
            'is_local' => true,
            'synced_at' => null,
        ]);

        if (($data['category_id'] ?? null) !== null) {
            CalendarEventOverride::create([
                'user_id' => $user->id,
                'calendar_account_id' => $account->id,
                'event_id' => $event->event_id,
                'recurring_event_id' => null,
                'category_id' => $data['category_id'],
                'category_override' => true,
            ]);
        }

        return response()->json([
            'cacheId' => $event->id,
            'eventId' => $event->event_id,
            // All-day events keep the date-only shape the calendar UI expects.
            'start' => $allDay ? $start->toDateString() : $start->toISOString(),
            'end' => $allDay ? $end->toDateString() : $end->toISOString(),
        ], 201);
    }

    /**
     * Pull Google's events into the cache — for every connected mailbox, or a
     * single one when an account id is passed.
     */
    public function sync(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => ['sometimes', 'integer'],
        ]);

        $user = $request->user();

        $from = $request->filled('from')
            ? Carbon::parse($request->string('from'))
            : now()->subMonths(self::SYNC_MONTHS_BACK)->startOfDay();
        $to = $request->filled('to')
            ? Carbon::parse($request->string('to'))
            : now()->addMonths(self::SYNC_MONTHS_FORWARD)->endOfDay();

        $targets = $user->calendarAccounts()->whereNull('disconnected_at');

        if (array_key_exists('account_id', $data)) {
            // Another user's mailbox is a 404, like every other per-account route.
            $user->calendarAccounts()->whereKey($data['account_id'])->firstOrFail();
            $targets->whereKey($data['account_id']);
        }

        $accounts = [];
        $errors = [];

        foreach ($targets->get() as $account) {
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

        $linkedSession = $this->linkedSession($user, $account, $data['event_id']);

        if ($data['is_work'] === true) {
            CalendarEventTag::updateOrCreate(
                ['calendar_account_id' => $account->id, 'event_id' => $data['event_id']],
                ['user_id' => $user->id, 'is_work' => true],
            );

            $this->recordCalendarSession(
                $user,
                $account,
                $data['event_id'],
                (bool) ($data['all_day'] ?? false),
                $data['title'] ?? null,
                isset($data['start']) ? Carbon::parse($data['start']) : null,
                isset($data['end']) ? Carbon::parse($data['end']) : null,
            );
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
     * Edit a cached event without touching Google: move it, recolor it, or put
     * it in a category. Google's cache row stays authoritative, so these edits
     * are stored as a local override which `index` applies when it serves the
     * event. A local event (created here or a duplicate) is its own source, so
     * its times and title are changed on the row itself. A work tag's tracked
     * session is shifted with a move so calendar work keeps its real times.
     */
    public function update(Request $request, int $eventId): JsonResponse
    {
        $data = $request->validate([
            'start' => ['nullable', 'date', 'required_with:end'],
            'end' => ['nullable', 'date', 'required_with:start'],
            'color' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'category_id' => ['sometimes', 'nullable', 'integer', Rule::exists('categories', 'id')->where('user_id', $request->user()->id)],
            'use_default_category' => ['sometimes', 'boolean'],
            'title' => ['sometimes', 'filled', 'string', 'max:512'],
            'all_day' => ['sometimes', 'boolean'],
        ]);

        $moving = isset($data['start'], $data['end']);
        $recoloring = array_key_exists('color', $data);
        $recategorizing = array_key_exists('category_id', $data);
        $resettingCategory = (bool) ($data['use_default_category'] ?? false);
        $renaming = array_key_exists('title', $data);
        $retyping = array_key_exists('all_day', $data);

        if (! $moving && ! $recoloring && ! $recategorizing && ! $resettingCategory && ! $renaming && ! $retyping) {
            throw ValidationException::withMessages(['event' => 'Send new times, a color, or a category.']);
        }

        $user = $request->user();
        $event = CalendarEvent::where('user_id', $user->id)->whereKey($eventId)->firstOrFail();
        $account = $event->account;

        if ($account === null) {
            throw ValidationException::withMessages([
                'event' => 'This event belongs to an account that is no longer connected.',
            ]);
        }

        if (($renaming || $retyping) && ! $event->is_local) {
            throw ValidationException::withMessages([
                'event' => 'Only events saved in Time Weaver can be renamed or switched to all-day.',
            ]);
        }

        if ($renaming) {
            $event->title = trim($data['title']);
        }

        if ($retyping) {
            $event->all_day = $data['all_day'];
        }

        $needsOverride = $recoloring || $recategorizing || $resettingCategory || ($moving && ! $event->is_local);
        $override = null;

        if ($needsOverride) {
            $override = CalendarEventOverride::firstOrNew([
                'calendar_account_id' => $account->id,
                'event_id' => $event->event_id,
            ]);

            $override->fill([
                'user_id' => $user->id,
                'recurring_event_id' => $event->recurring_event_id,
            ]);

            if ($recoloring) {
                $override->color = $data['color'];
            }

            if ($recategorizing) {
                $override->category_id = $data['category_id'];
                $override->category_override = true;
            }

            // "Use the mailbox default" hands the event back to its account.
            if ($resettingCategory) {
                $override->category_id = null;
                $override->category_override = false;
            }
        }

        if ($moving) {
            $start = Carbon::parse($data['start'], 'UTC')->utc();
            $end = Carbon::parse($data['end'], 'UTC')->utc();

            if ($end->lessThanOrEqualTo($start)) {
                throw ValidationException::withMessages(['end' => 'The end must be after the start.']);
            }

            if ($event->is_local) {
                $event->start = $start;
                $event->end = $end;
            } else {
                $override->start = $start;
                $override->end = $end;
            }
        }

        if ($event->isDirty()) {
            $event->save();
        }

        if ($override === null) {
            return response()->json(['ok' => true]);
        }

        // "Automatic" on an untouched event leaves nothing to remember, and an
        // empty override would only slow the feed down. An explicit "no category"
        // (category_override) is a real choice and must survive.
        if ($override->start === null && $override->color === null && $override->category_id === null && ! $override->category_override) {
            if ($override->exists) {
                $override->delete();
            }

            return response()->json(['ok' => true]);
        }

        $override->save();

        // Only manually tagged work has a mirrored session; keep it in step.
        $tagged = CalendarEventTag::where('calendar_account_id', $account->id)
            ->where('event_id', $event->event_id)
            ->where('is_work', true)
            ->exists();

        $sessionStart = $event->is_local ? $event->start : $override->start;
        $sessionEnd = $event->is_local ? $event->end : $override->end;

        if ($moving && $tagged && $sessionEnd !== null && $sessionStart !== null) {
            $this->recordCalendarSession($user, $account, $event->event_id, (bool) $event->all_day, $event->title, $sessionStart, $sessionEnd);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Copy a cached event to the next free day at the same clock time.
     *
     * Google access is read-only, so the copy exists only here: it is a local
     * row wearing a `local-` event id, which the feed serves like any other
     * event and a sync never deletes. The copy is standalone — it keeps the
     * source's manual work state but no recurring series, so editing or deleting
     * it can never touch the original.
     */
    public function duplicate(Request $request, int $eventId): JsonResponse
    {
        $user = $request->user();
        $event = CalendarEvent::where('user_id', $user->id)->whereKey($eventId)->firstOrFail();
        $account = $event->account;

        if ($account === null) {
            throw ValidationException::withMessages([
                'event' => 'This event belongs to an account that is no longer connected.',
            ]);
        }

        $override = CalendarEventOverride::where('calendar_account_id', $account->id)
            ->where('event_id', $event->event_id)
            ->first();

        // Copy where the event actually sits, not where Google last saw it.
        $start = ($override?->start ?? $event->start)->copy()->addDay();
        $end = ($override?->end ?? $event->end)->copy()->addDay();

        // Copying twice must not stack two invisible events on the same slot, so
        // walk forward until the day is free.
        for ($attempt = 0; $attempt < 30 && $this->copySlotTaken($user, $account, $event->title, $start); $attempt++) {
            $start->addDay();
            $end->addDay();
        }

        $copy = CalendarEvent::create([
            'user_id' => $user->id,
            'calendar_account_id' => $account->id,
            'account_email' => $account->email,
            'color' => $account->color,
            'event_id' => 'local-'.Str::uuid(),
            'recurring_event_id' => null,
            'calendar_id' => $event->calendar_id,
            'calendar_name' => $event->calendar_name,
            'title' => $event->title,
            'start' => $start,
            'end' => $end,
            'all_day' => $event->all_day,
            'event_color' => $override?->color ?? $event->event_color,
            'is_local' => true,
            'synced_at' => null,
        ]);

        $this->copyWorkTag($user, $account, $event, $copy);

        // A category choice and a manual color live on the override, so the copy
        // needs its own row to keep the same look. An explicit "no category" must
        // be copied too, or the copy would inherit the mailbox default.
        if ($override !== null && ($override->color !== null || $override->category_override)) {
            CalendarEventOverride::create([
                'user_id' => $user->id,
                'calendar_account_id' => $account->id,
                'event_id' => $copy->event_id,
                'recurring_event_id' => null,
                'color' => $override->color,
                'category_id' => $override->category_id,
                'category_override' => $override->category_override,
            ]);
        }

        return response()->json([
            'cacheId' => $copy->id,
            'eventId' => $copy->event_id,
            // All-day copies keep the date-only shape the calendar UI expects.
            'start' => $event->all_day ? $start->toDateString() : $start->toISOString(),
            'end' => $event->all_day ? $end->toDateString() : $end->toISOString(),
        ], 201);
    }

    /**
     * Whether another copy of the same event already starts at this slot.
     */
    private function copySlotTaken(User $user, CalendarAccount $account, string $title, Carbon $start): bool
    {
        return CalendarEvent::where('user_id', $user->id)
            ->where('calendar_account_id', $account->id)
            ->where('is_local', true)
            ->where('title', $title)
            ->where('start', $start)
            ->exists();
    }

    /**
     * Give a copy the source's manual work state so it renders the same way.
     *
     * No tracked session is mirrored: the copy is a plan, not tracked time, and
     * a session would double-count the same hours.
     */
    private function copyWorkTag(User $user, CalendarAccount $account, CalendarEvent $source, CalendarEvent $copy): void
    {
        $tag = CalendarEventTag::where('calendar_account_id', $account->id)
            ->where('event_id', $source->event_id)
            ->first();

        if ($tag === null) {
            return;
        }

        CalendarEventTag::create([
            'user_id' => $user->id,
            'calendar_account_id' => $account->id,
            'event_id' => $copy->event_id,
            'is_work' => $tag->is_work,
        ]);
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

        // A local row (a duplicate) has no Google counterpart: deleting it is
        // final, so there is no dismissal to record and no series to consider.
        if ($event->is_local) {
            CalendarEventOverride::where('calendar_account_id', $event->calendar_account_id)
                ->where('event_id', $event->event_id)
                ->delete();

            $event->delete();

            return response()->json(['removed' => 1]);
        }

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

            CalendarEventOverride::where('calendar_account_id', $event->calendar_account_id)
                ->where(function ($query) use ($seriesId): void {
                    $query->where('recurring_event_id', $seriesId)
                        ->orWhere('event_id', $seriesId);
                })
                ->delete();

            return response()->json(['removed' => $removed]);
        }

        CalendarEventOverride::where('calendar_account_id', $event->calendar_account_id)
            ->where('event_id', $event->event_id)
            ->delete();

        $event->delete();

        return response()->json(['removed' => 1]);
    }

    /**
     * The tracked session mirroring a manually tagged work event, if any.
     */
    private function linkedSession(User $user, CalendarAccount $account, string $eventId): HasMany
    {
        return $user->workSessions()
            ->where('source', 'calendar')
            ->where('calendar_account_id', $account->id)
            ->where('calendar_event_id', $eventId);
    }

    /**
     * Create or refresh the tracked session mirroring a work event.
     *
     * All-day events have no clock time, so they only get the tag.
     */
    private function recordCalendarSession(
        User $user,
        CalendarAccount $account,
        string $eventId,
        bool $allDay,
        ?string $title,
        ?Carbon $start,
        ?Carbon $end,
    ): void {
        if ($allDay || $start === null || $end === null || $end->lessThanOrEqualTo($start)) {
            return;
        }

        $attributes = [
            'start' => $start,
            'end' => $end,
            'note' => $title ?? 'Calendar event',
            'source' => 'calendar',
            'paused_ms' => 0,
            'paused_at' => null,
            'segments' => [[
                'type' => 'work',
                'start' => $start->toISOString(),
                'end' => $end->toISOString(),
            ]],
        ];

        $session = $this->linkedSession($user, $account, $eventId)->first();

        if ($session) {
            $session->update($attributes);
        } else {
            $user->workSessions()->create($attributes + [
                'calendar_account_id' => $account->id,
                'calendar_event_id' => $eventId,
            ]);
        }
    }
}
