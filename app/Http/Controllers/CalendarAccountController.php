<?php

namespace App\Http\Controllers;

use App\Models\CalendarAccount;
use App\Services\CalendarSyncService;
use App\Services\GoogleCalendarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

class CalendarAccountController extends Controller
{
    private const COLORS = ['#5b9cff', '#ff9f43', '#c56cf0', '#ff6b81', '#1dd1a1', '#feca57'];

    public function __construct(
        private GoogleCalendarService $google,
        private CalendarSyncService $sync,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $accounts = $request->user()->calendarAccounts()->with('defaultCategory')->withCount('dismissals')->get()
            ->map(fn (CalendarAccount $account) => [
                'id' => $account->id,
                'provider' => $account->provider,
                'email' => $account->email,
                'color' => $account->color,
                'defaultWork' => $account->default_work,
                // Every event from this mailbox inherits this category.
                'defaultCategory' => $account->defaultCategory?->toApi(),
                'lastSyncedAt' => $account->last_synced_at?->toISOString(),
                'disconnected' => $account->disconnected_at !== null,
                // Events deleted for good, which a sync will not bring back.
                'hiddenCount' => $account->dismissals_count,
            ]);

        return response()->json($accounts);
    }

    /**
     * Change what a mailbox means by default: whether every timed event counts
     * as work, and which category its events inherit.
     */
    public function update(Request $request, int $accountId): JsonResponse
    {
        $data = $request->validate([
            'default_work' => ['sometimes', 'boolean'],
            'default_category_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('categories', 'id')->where('user_id', $request->user()->id),
            ],
        ]);

        if ($data === []) {
            throw ValidationException::withMessages([
                'account' => 'Send a default work flag or a default category.',
            ]);
        }

        $account = $request->user()->calendarAccounts()->whereKey($accountId)->firstOrFail();

        if (array_key_exists('default_work', $data)) {
            $account->default_work = $data['default_work'];
        }

        if (array_key_exists('default_category_id', $data)) {
            $account->default_category_id = $data['default_category_id'];
        }

        $account->save();
        $account->load('defaultCategory');

        return response()->json([
            'id' => $account->id,
            'defaultWork' => $account->default_work,
            'defaultCategory' => $account->defaultCategory?->toApi(),
        ]);
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
            // Reconnecting the same mailbox revives a previously disconnected account.
            'disconnected_at' => null,
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

    /**
     * Soft-disconnect an account: stop syncing it but keep its cached events
     * and work tags so past days stay meaningful.
     */
    public function destroy(Request $request, int $accountId): JsonResponse
    {
        $account = $request->user()->calendarAccounts()->whereKey($accountId)->firstOrFail();

        $account->update([
            'disconnected_at' => now(),
            'access_token' => '',
            'refresh_token' => null,
            'expires_at' => null,
        ]);

        return response()->json(null, 204);
    }

    /**
     * Permanently remove a disconnected account's cached events and work tags.
     */
    public function purgeEvents(Request $request, int $accountId): JsonResponse
    {
        $account = $request->user()->calendarAccounts()->whereKey($accountId)->firstOrFail();

        return response()->json(['removed' => $this->sync->purge($account)]);
    }

    /**
     * Forget the events deleted for good on this account, so the next sync can
     * find them again.
     */
    public function restoreEvents(Request $request, int $accountId): JsonResponse
    {
        $account = $request->user()->calendarAccounts()->whereKey($accountId)->firstOrFail();

        return response()->json(['restored' => $this->sync->restore($account)]);
    }
}
