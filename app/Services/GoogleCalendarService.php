<?php

namespace App\Services;

use App\Models\CalendarAccount;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

/**
 * Read-only Google Calendar access for every connected account of a user.
 */
class GoogleCalendarService
{
    private const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const API_URL = 'https://www.googleapis.com/calendar/v3';

    private const SCOPES = [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.readonly',
    ];

    public function authorizationUrl(string $state): string
    {
        return self::AUTH_URL.'?'.http_build_query([
            'client_id' => config('services.google.client_id'),
            'redirect_uri' => config('services.google.redirect'),
            'response_type' => 'code',
            'scope' => implode(' ', self::SCOPES),
            'access_type' => 'offline',
            'prompt' => 'consent select_account',
            'include_granted_scopes' => 'true',
            'state' => $state,
        ]);
    }

    /**
     * @return array{access_token: string, refresh_token: ?string, expires_in: int, email: string}
     */
    public function exchangeCode(string $code): array
    {
        $response = Http::asForm()->post(self::TOKEN_URL, [
            'code' => $code,
            'client_id' => config('services.google.client_id'),
            'client_secret' => config('services.google.client_secret'),
            'redirect_uri' => config('services.google.redirect'),
            'grant_type' => 'authorization_code',
        ])->throw()->json();

        $email = Http::withToken($response['access_token'])
            ->get('https://openidconnect.googleapis.com/v1/userinfo')
            ->throw()
            ->json('email');

        return [
            'access_token' => $response['access_token'],
            'refresh_token' => $response['refresh_token'] ?? null,
            'expires_in' => (int) ($response['expires_in'] ?? 3600),
            'email' => (string) $email,
        ];
    }

    public function accessToken(CalendarAccount $account): string
    {
        if ($account->expires_at && $account->expires_at->isAfter(now()->addMinute())) {
            return $account->access_token;
        }

        if (! $account->refresh_token) {
            throw new RuntimeException("Account {$account->email} needs to be reconnected.");
        }

        $response = Http::asForm()->post(self::TOKEN_URL, [
            'client_id' => config('services.google.client_id'),
            'client_secret' => config('services.google.client_secret'),
            'refresh_token' => $account->refresh_token,
            'grant_type' => 'refresh_token',
        ]);

        if ($response->failed()) {
            throw new RuntimeException("Account {$account->email} needs to be reconnected.");
        }

        $account->update([
            'access_token' => $response->json('access_token'),
            'expires_at' => now()->addSeconds((int) $response->json('expires_in', 3600)),
        ]);

        return $account->access_token;
    }

    /**
     * Events from all visible calendars of one account, already normalized.
     *
     * @return array<int, array{eventId: string, recurringEventId: ?string, calendarId: string, calendarName: string, title: string, start: string, end: string, allDay: bool, color: ?string}>
     */
    public function events(CalendarAccount $account, Carbon $from, Carbon $to): array
    {
        $token = $this->accessToken($account);

        $calendars = Http::withToken($token)
            ->get(self::API_URL.'/users/me/calendarList', ['minAccessRole' => 'reader'])
            ->throw()
            ->json('items', []);

        $events = [];

        foreach ($calendars as $calendar) {
            $isVisible = ($calendar['primary'] ?? false) || ($calendar['selected'] ?? false);
            if (! $isVisible) {
                continue;
            }

            $items = $this->eventsForCalendar($token, $calendar['id'], $from, $to);

            foreach ($items as $item) {
                if (($item['status'] ?? '') === 'cancelled' || $this->isDeclined($item)) {
                    continue;
                }

                $allDay = isset($item['start']['date']);

                $events[] = [
                    'eventId' => $item['id'],
                    // Present on every occurrence of a recurring series.
                    'recurringEventId' => $item['recurringEventId'] ?? null,
                    'calendarId' => $calendar['id'],
                    'calendarName' => $calendar['summaryOverride'] ?? $calendar['summary'] ?? '',
                    'title' => $item['summary'] ?? '(no title)',
                    // All-day: Google end.date is exclusive; we keep it as-is.
                    'start' => $allDay ? $item['start']['date'] : $item['start']['dateTime'],
                    'end' => $allDay ? $item['end']['date'] : $item['end']['dateTime'],
                    'allDay' => $allDay,
                    'color' => $calendar['backgroundColor'] ?? null,
                ];
            }
        }

        return $events;
    }

    /**
     * Which of the given recurring series Google no longer has.
     *
     * A series deleted in Google simply stops appearing in the synced window, so
     * its older cached occurrences would otherwise linger forever. Asking for
     * the series itself tells "deleted" apart from "just not recurring in this
     * window". Anything that is not a clear 404/410/cancelled is treated as
     * still present, so a transient failure never wipes cached history.
     *
     * @param  array<string, string>  $series  series id => calendar id
     * @return array<int, string>
     */
    public function missingSeries(CalendarAccount $account, array $series): array
    {
        if ($series === []) {
            return [];
        }

        $token = $this->accessToken($account);
        $missing = [];

        foreach ($series as $seriesId => $calendarId) {
            try {
                $response = Http::withToken($token)->get(
                    self::API_URL.'/calendars/'.rawurlencode($calendarId).'/events/'.rawurlencode($seriesId),
                );
            } catch (Throwable) {
                continue;
            }

            if (in_array($response->status(), [404, 410], true) || $response->json('status') === 'cancelled') {
                $missing[] = $seriesId;
            }
        }

        return $missing;
    }

    /**
     * Every event of one calendar in the window, following Google's pagination
     * so a busy calendar is not silently truncated at the first page.
     *
     * @return array<int, array<string, mixed>>
     */
    private function eventsForCalendar(string $token, string $calendarId, Carbon $from, Carbon $to): array
    {
        $items = [];
        $pageToken = null;

        do {
            $response = Http::withToken($token)
                ->get(self::API_URL.'/calendars/'.rawurlencode($calendarId).'/events', array_filter([
                    'timeMin' => $from->toRfc3339String(),
                    'timeMax' => $to->toRfc3339String(),
                    'singleEvents' => 'true',
                    'orderBy' => 'startTime',
                    'maxResults' => 250,
                    'pageToken' => $pageToken,
                ]))
                ->throw();

            $items = array_merge($items, $response->json('items', []));
            $pageToken = $response->json('nextPageToken');
        } while ($pageToken);

        return $items;
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function isDeclined(array $item): bool
    {
        foreach ($item['attendees'] ?? [] as $attendee) {
            if (($attendee['self'] ?? false) && ($attendee['responseStatus'] ?? '') === 'declined') {
                return true;
            }
        }

        return false;
    }
}
