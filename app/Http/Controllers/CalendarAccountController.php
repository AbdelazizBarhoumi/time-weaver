<?php

namespace App\Http\Controllers;

use App\Models\CalendarAccount;
use App\Services\GoogleCalendarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Throwable;

class CalendarAccountController extends Controller
{
    private const COLORS = ['#5b9cff', '#ff9f43', '#c56cf0', '#ff6b81', '#1dd1a1', '#feca57'];

    public function __construct(private GoogleCalendarService $google) {}

    public function index(Request $request): JsonResponse
    {
        $accounts = $request->user()->calendarAccounts()->get()
            ->map(fn (CalendarAccount $account) => [
                'id' => $account->id,
                'provider' => $account->provider,
                'email' => $account->email,
                'color' => $account->color,
            ]);

        return response()->json($accounts);
    }

    public function redirect(Request $request): JsonResponse
    {
        $state = Str::random(40);
        $request->session()->put('google_oauth_state', $state);

        return response()->json(['url' => $this->google->authorizationUrl($state)]);
    }

    public function callback(Request $request): RedirectResponse
    {
        $expectedState = $request->session()->pull('google_oauth_state');

        if (! $expectedState || ! hash_equals($expectedState, (string) $request->query('state'))) {
            return redirect('/calendar?error=state');
        }

        if ($request->filled('error') || ! $request->filled('code')) {
            return redirect('/calendar?error=denied');
        }

        try {
            $tokens = $this->google->exchangeCode((string) $request->query('code'));
        } catch (Throwable $e) {
            report($e);

            return redirect('/calendar?error=exchange');
        }

        $user = $request->user();
        $existing = $user->calendarAccounts()->where('provider', 'google')->where('email', $tokens['email'])->first();

        $attributes = [
            'access_token' => $tokens['access_token'],
            'expires_at' => now()->addSeconds($tokens['expires_in']),
        ];
        if ($tokens['refresh_token']) {
            $attributes['refresh_token'] = $tokens['refresh_token'];
        }

        if ($existing) {
            $existing->update($attributes);
        } else {
            $user->calendarAccounts()->create($attributes + [
                'provider' => 'google',
                'email' => $tokens['email'],
                'color' => self::COLORS[$user->calendarAccounts()->count() % count(self::COLORS)],
            ]);
        }

        return redirect('/calendar?connected=1');
    }

    public function destroy(Request $request, int $accountId): JsonResponse
    {
        $request->user()->calendarAccounts()->whereKey($accountId)->firstOrFail()->delete();

        return response()->json(null, 204);
    }
}
