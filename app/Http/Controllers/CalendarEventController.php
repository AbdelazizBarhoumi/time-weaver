<?php

namespace App\Http\Controllers;

use App\Models\CalendarAccount;
use App\Models\CalendarEventTag;
use App\Models\CalendarSetting;
use App\Services\GoogleCalendarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
     */
    public function tag(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => 'required|integer',
            'event_id' => 'required|string|max:1024',
            'is_work' => 'present|nullable|boolean',
        ]);

        $user = $request->user();
        $account = $user->calendarAccounts()->whereKey($data['account_id'])->firstOrFail();

        if ($data['is_work'] === null) {
            CalendarEventTag::where('calendar_account_id', $account->id)->where('event_id', $data['event_id'])->delete();
        } else {
            CalendarEventTag::updateOrCreate(
                ['calendar_account_id' => $account->id, 'event_id' => $data['event_id']],
                ['user_id' => $user->id, 'is_work' => $data['is_work']],
            );
        }

        return response()->json(['ok' => true]);
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
