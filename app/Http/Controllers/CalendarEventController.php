<?php

namespace App\Http\Controllers;

use App\Models\CalendarAccount;
use App\Models\CalendarEventTag;
use App\Models\CalendarSetting;
use App\Models\User;
use App\Services\GoogleCalendarService;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Throwable;

class CalendarEventController extends Controller
{
    public function __construct(private GoogleCalendarService $google) {}

    /**
     * All events of every connected account between `from` and `to`,
     * with the work flag resolved (manual tag first, then keyword rules).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'from' => 'required|date',
            'to' => 'required|date|after:from',
        ]);

        $user = $request->user();
        $from = $request->date('from');
        $to = $request->date('to');
        $keywords = array_map(fn (string $k) => Str::lower($k), CalendarSetting::forUser($user)->work_keywords ?? []);

        $tags = CalendarEventTag::where('user_id', $user->id)->get()
            ->keyBy(fn (CalendarEventTag $tag) => $tag->calendar_account_id.'|'.$tag->event_id);

        $events = [];
        $errors = [];

        foreach ($user->calendarAccounts()->get() as $account) {
            /** @var CalendarAccount $account */
            try {
                $items = $this->google->events($account, $from, $to);
            } catch (Throwable $e) {
                report($e);
                $errors[] = ['accountId' => $account->id, 'email' => $account->email, 'message' => 'Could not load this account. Try reconnecting it.'];

                continue;
            }

            foreach ($items as $item) {
                $tag = $tags->get($account->id.'|'.$item['eventId']);
                $matchesRule = ! $item['allDay'] && $this->matchesKeyword($item['title'], $keywords);

                $events[] = $item + [
                    'id' => $account->id.'|'.$item['eventId'],
                    'accountId' => $account->id,
                    'accountEmail' => $account->email,
                    'accountColor' => $account->color,
                    'isWork' => $tag ? $tag->is_work : $matchesRule,
                    'workSource' => $tag ? 'manual' : ($matchesRule ? 'rule' : null),
                ];
            }
        }

        return response()->json(['events' => $events, 'errors' => $errors]);
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
