<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventDismissal;
use App\Models\CalendarEventTag;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CalendarSyncTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected CalendarAccount $account;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->account = CalendarAccount::factory()->create(['user_id' => $this->user->id]);
        $this->actingAs($this->user);

        Http::preventStrayRequests();
    }

    /**
     * Fake the exactly two endpoints the sync walks: the calendar list, then
     * each visible calendar's events.
     *
     * @param  array<int, array<string, mixed>>  $events
     */
    private function fakeGoogle(array $events): void
    {
        Http::fake([
            '*calendar/v3/users/me/calendarList*' => Http::response([
                'items' => [
                    ['id' => 'primary', 'primary' => true, 'summary' => 'Primary', 'backgroundColor' => '#123456'],
                ],
            ]),
            '*calendar/v3/calendars/*/events*' => Http::response(['items' => $events]),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function timedEvent(string $id, Carbon $start, ?string $title = null): array
    {
        return [
            'id' => $id,
            'summary' => $title ?? 'Event '.$id,
            'start' => ['dateTime' => $start->toIso8601String()],
            'end' => ['dateTime' => $start->copy()->addHour()->toIso8601String()],
        ];
    }

    /**
     * One expanded occurrence of a recurring series, as Google returns it with
     * singleEvents=true.
     *
     * @return array<string, mixed>
     */
    private function recurringEvent(string $id, string $seriesId, Carbon $start): array
    {
        return [
            'id' => $id,
            'summary' => 'Weekly sync',
            'recurringEventId' => $seriesId,
            'start' => ['dateTime' => $start->toIso8601String()],
            'end' => ['dateTime' => $start->copy()->addHour()->toIso8601String()],
        ];
    }

    public function test_sync_stores_events_in_the_cache_and_stamps_last_synced(): void
    {
        $this->fakeGoogle([$this->timedEvent('evt-1', now()->addDay()->setTime(9, 0), 'Standup')]);

        $response = $this->postJson('/api/calendar/sync');

        $response->assertOk()->assertJsonPath('synced', 1);

        $this->assertDatabaseHas('calendar_events', [
            'calendar_account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'title' => 'Standup',
            'all_day' => false,
        ]);
        $this->assertNotNull($this->account->fresh()->last_synced_at);
    }

    public function test_refresh_removes_events_google_no_longer_returns(): void
    {
        $round = 0;
        Http::fake(function ($request) use (&$round) {
            if (str_contains($request->url(), 'calendarList')) {
                return Http::response(['items' => [
                    ['id' => 'primary', 'primary' => true, 'summary' => 'Primary', 'backgroundColor' => '#123456'],
                ]]);
            }

            $round++;

            return Http::response(['items' => $round === 1
                ? [
                    $this->timedEvent('evt-1', now()->addDay()->setTime(9, 0)),
                    $this->timedEvent('evt-2', now()->addDay()->setTime(11, 0)),
                ]
                // Google no longer returns evt-2: the refresh should mirror that.
                : [$this->timedEvent('evt-1', now()->addDay()->setTime(9, 0))]]);
        });

        $this->postJson('/api/calendar/sync')->assertStatus(200);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'evt-1']);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'evt-2']);

        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $this->assertDatabaseHas('calendar_events', ['event_id' => 'evt-1']);
        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'evt-2']);
    }

    public function test_sync_leaves_events_outside_the_window_untouched(): void
    {
        $old = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => 'old-event',
            'start' => now()->subYear(),
            'end' => now()->subYear()->addHour(),
        ]);

        $this->fakeGoogle([$this->timedEvent('evt-1', now()->addDay()->setTime(9, 0))]);
        $this->postJson('/api/calendar/sync')->assertStatus(200);

        // Outside the synced window, history is preserved.
        $this->assertDatabaseHas('calendar_events', ['id' => $old->id]);
    }

    public function test_disconnected_accounts_are_skipped_but_keep_their_events(): void
    {
        $this->account->update([
            'disconnected_at' => now(),
            'access_token' => '',
            'refresh_token' => null,
            'expires_at' => null,
        ]);

        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
        ]);

        // Http::preventStrayRequests() is active: touching Google would fail.
        $this->postJson('/api/calendar/sync')
            ->assertStatus(200)
            ->assertJsonPath('synced', 0)
            ->assertJsonCount(0, 'accounts');

        $this->assertDatabaseHas('calendar_events', ['id' => $event->id]);
    }

    public function test_sync_can_target_a_single_account(): void
    {
        $other = CalendarAccount::factory()->create(['user_id' => $this->user->id]);

        $this->fakeGoogle([$this->timedEvent('evt-1', now()->addDay()->setTime(9, 0))]);

        $this->postJson('/api/calendar/sync', ['account_id' => $other->id])
            ->assertOk()
            ->assertJsonPath('synced', 1)
            ->assertJsonCount(1, 'accounts')
            ->assertJsonPath('accounts.0.accountId', $other->id);

        $this->assertDatabaseHas('calendar_events', [
            'calendar_account_id' => $other->id,
            'event_id' => 'evt-1',
        ]);
        // The user's other mailbox was left alone.
        $this->assertNull($this->account->fresh()->last_synced_at);
    }

    public function test_sync_cannot_target_another_users_account(): void
    {
        $intruder = User::factory()->create();

        $this->actingAs($intruder)
            ->postJson('/api/calendar/sync', ['account_id' => $this->account->id])
            ->assertStatus(404);

        $this->assertNull($this->account->fresh()->last_synced_at);
    }

    public function test_sync_skips_a_disconnected_target_account(): void
    {
        $this->account->update([
            'disconnected_at' => now(),
            'access_token' => '',
            'refresh_token' => null,
            'expires_at' => null,
        ]);

        // Http::preventStrayRequests() is active: touching Google would fail.
        $this->postJson('/api/calendar/sync', ['account_id' => $this->account->id])
            ->assertStatus(200)
            ->assertJsonPath('synced', 0)
            ->assertJsonCount(0, 'accounts');
    }

    public function test_index_reads_from_the_cache_without_network(): void
    {
        CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'title' => 'Sprint review',
            'all_day' => false,
            'start' => now()->addDay()->setTime(9, 0),
            'end' => now()->addDay()->setTime(10, 0),
        ]);

        // Http::preventStrayRequests() is active, so any network call would fail.
        $response = $this->getJson('/api/calendar/events?'.http_build_query([
            'from' => now()->toIso8601String(),
            'to' => now()->addDays(2)->toIso8601String(),
        ]));

        $response->assertStatus(200)->assertJsonCount(1, 'events');
        $this->assertTrue($response->json('events.0.isWork'));
        $this->assertSame('rule', $response->json('events.0.workSource'));
        $this->assertIsInt($response->json('events.0.cacheId'));
        $this->assertNull($response->json('events.0.recurringEventId'));
    }

    public function test_index_serializes_all_day_events_as_date_only_strings(): void
    {
        $day = now()->addDays(3)->startOfDay();

        CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'title' => 'Holiday',
            'all_day' => true,
            'start' => $day,
            'end' => $day->copy()->addDay(),
        ]);

        $response = $this->getJson('/api/calendar/events?'.http_build_query([
            'from' => now()->toIso8601String(),
            'to' => now()->addDays(5)->toIso8601String(),
        ]));

        $response->assertStatus(200);
        $start = $response->json('events.0.start');
        $end = $response->json('events.0.end');

        $this->assertSame($day->toDateString(), $start);
        $this->assertSame($day->copy()->addDay()->toDateString(), $end);
        $this->assertStringNotContainsString('T', $start);
    }

    public function test_manual_work_tags_survive_on_cached_events(): void
    {
        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'title' => 'Untitled',
            'all_day' => false,
            'start' => now()->addDay()->setTime(9, 0),
            'end' => now()->addDay()->setTime(10, 0),
        ]);

        CalendarEventTag::create([
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'event_id' => $event->event_id,
            'is_work' => true,
        ]);

        $response = $this->getJson('/api/calendar/events?'.http_build_query([
            'from' => now()->toIso8601String(),
            'to' => now()->addDays(2)->toIso8601String(),
        ]));

        $response->assertStatus(200);
        $this->assertTrue($response->json('events.0.isWork'));
        $this->assertSame('manual', $response->json('events.0.workSource'));
    }

    public function test_purge_removes_cached_events_and_their_tags(): void
    {
        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
        ]);
        CalendarEventTag::create([
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'event_id' => $event->event_id,
            'is_work' => true,
        ]);

        $this->deleteJson("/api/calendar/accounts/{$this->account->id}/events")
            ->assertStatus(200)
            ->assertJsonPath('removed', 1);

        $this->assertDatabaseMissing('calendar_events', ['id' => $event->id]);
        $this->assertDatabaseMissing('calendar_event_tags', [
            'calendar_account_id' => $this->account->id,
            'event_id' => $event->event_id,
        ]);
    }

    public function test_disconnect_keeps_the_account_and_its_cached_events(): void
    {
        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
        ]);

        $this->deleteJson("/api/calendar/accounts/{$this->account->id}")
            ->assertStatus(204);

        $this->assertNotNull($this->account->fresh()->disconnected_at);
        $this->assertDatabaseHas('calendar_events', ['id' => $event->id]);

        $accounts = $this->getJson('/api/calendar/accounts')->assertStatus(200);
        $this->assertTrue($accounts->json('0.disconnected'));
    }

    public function test_deleting_a_single_cached_event_removes_only_that_row(): void
    {
        $keep = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => 'keep-me',
        ]);
        $remove = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => 'delete-me',
        ]);

        $this->deleteJson("/api/calendar/events/{$remove->id}")
            ->assertOk()
            ->assertJsonPath('removed', 1);

        $this->assertDatabaseMissing('calendar_events', ['id' => $remove->id]);
        $this->assertDatabaseHas('calendar_events', ['id' => $keep->id]);
    }

    public function test_cannot_delete_another_users_cached_event(): void
    {
        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
        ]);

        $intruder = User::factory()->create();

        $this->actingAs($intruder)
            ->deleteJson("/api/calendar/events/{$event->id}")
            ->assertStatus(404);

        $this->assertDatabaseHas('calendar_events', ['id' => $event->id]);
    }

    public function test_a_later_sync_restores_a_deleted_event(): void
    {
        $this->fakeGoogle([$this->timedEvent('evt-1', now()->addDay()->setTime(9, 0))]);
        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $event = CalendarEvent::where('event_id', 'evt-1')->firstOrFail();
        $this->deleteJson("/api/calendar/events/{$event->id}")->assertOk();
        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'evt-1']);

        // Delete is local only: Google still has the event, so a sync brings it back.
        $this->postJson('/api/calendar/sync')->assertStatus(200);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'evt-1']);
    }

    public function test_account_default_counts_timed_events_as_work(): void
    {
        $this->account->update(['default_work' => true]);

        CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'title' => 'Something unrelated',
            'all_day' => false,
            'start' => now()->addDay()->setTime(9, 0),
            'end' => now()->addDay()->setTime(10, 0),
        ]);

        $response = $this->getJson('/api/calendar/events?'.http_build_query([
            'from' => now()->toIso8601String(),
            'to' => now()->addDays(2)->toIso8601String(),
        ]));

        $response->assertStatus(200)->assertJsonCount(1, 'events');
        $this->assertTrue($response->json('events.0.isWork'));
        $this->assertSame('account', $response->json('events.0.workSource'));
    }

    public function test_manual_tag_overrides_the_account_default(): void
    {
        $this->account->update(['default_work' => true]);

        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'title' => 'Lunch',
            'all_day' => false,
            'start' => now()->addDay()->setTime(12, 0),
            'end' => now()->addDay()->setTime(13, 0),
        ]);

        CalendarEventTag::create([
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'event_id' => $event->event_id,
            'is_work' => false,
        ]);

        $response = $this->getJson('/api/calendar/events?'.http_build_query([
            'from' => now()->toIso8601String(),
            'to' => now()->addDays(2)->toIso8601String(),
        ]));

        $response->assertStatus(200);
        $this->assertFalse($response->json('events.0.isWork'));
        $this->assertSame('manual', $response->json('events.0.workSource'));
    }

    public function test_all_day_events_ignore_the_account_default(): void
    {
        $this->account->update(['default_work' => true]);
        $day = now()->addDays(3)->startOfDay();

        CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'title' => 'Holiday',
            'all_day' => true,
            'start' => $day,
            'end' => $day->copy()->addDay(),
        ]);

        $response = $this->getJson('/api/calendar/events?'.http_build_query([
            'from' => now()->toIso8601String(),
            'to' => now()->addDays(5)->toIso8601String(),
        ]));

        $response->assertStatus(200);
        $this->assertFalse($response->json('events.0.isWork'));
        $this->assertNull($response->json('events.0.workSource'));
    }

    public function test_account_default_can_be_toggled_and_is_exposed(): void
    {
        $this->patchJson("/api/calendar/accounts/{$this->account->id}", ['default_work' => true])
            ->assertOk()
            ->assertJsonPath('defaultWork', true);

        $this->assertTrue($this->account->fresh()->default_work);

        $accounts = $this->getJson('/api/calendar/accounts')->assertStatus(200);
        $this->assertTrue($accounts->json('0.defaultWork'));
    }

    public function test_cannot_toggle_another_users_account_default(): void
    {
        $intruder = User::factory()->create();

        $this->actingAs($intruder)
            ->patchJson("/api/calendar/accounts/{$this->account->id}", ['default_work' => true])
            ->assertStatus(404);

        $this->assertFalse($this->account->fresh()->default_work);
    }

    public function test_sync_normalises_event_times_to_utc(): void
    {
        // 13:00 in a UTC+03:00 calendar is 10:00 UTC.
        $this->fakeGoogle([[
            'id' => 'evt-tz',
            'summary' => 'Offset event',
            'start' => ['dateTime' => '2026-10-16T13:00:00+03:00'],
            'end' => ['dateTime' => '2026-10-16T14:30:00+03:00'],
        ]]);

        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $event = CalendarEvent::where('event_id', 'evt-tz')->firstOrFail();

        // The offset must survive: the cached instants are three hours earlier in UTC.
        $this->assertSame('2026-10-16 10:00:00', $event->start->utc()->toDateTimeString());
        $this->assertSame('2026-10-16 11:30:00', $event->end->utc()->toDateTimeString());
    }

    public function test_sync_keeps_all_day_dates_on_their_own_day(): void
    {
        $this->fakeGoogle([[
            'id' => 'evt-allday',
            'summary' => 'Holiday',
            'start' => ['date' => '2026-11-02'],
            'end' => ['date' => '2026-11-03'],
        ]]);

        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $event = CalendarEvent::where('event_id', 'evt-allday')->firstOrFail();

        $this->assertTrue($event->all_day);
        $this->assertSame('2026-11-02', $event->start->toDateString());
        $this->assertSame('2026-11-03', $event->end->toDateString());
    }

    public function test_sync_stores_the_recurring_series_id(): void
    {
        $this->fakeGoogle([[
            'id' => 'series-base_20261001T090000Z',
            'summary' => 'Weekly sync',
            'recurringEventId' => 'series-base',
            'start' => ['dateTime' => now()->addDay()->setTime(9, 0)->toIso8601String()],
            'end' => ['dateTime' => now()->addDay()->setTime(10, 0)->toIso8601String()],
        ]]);

        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $this->assertDatabaseHas('calendar_events', [
            'event_id' => 'series-base_20261001T090000Z',
            'recurring_event_id' => 'series-base',
        ]);
    }

    public function test_deleting_a_series_removes_all_cached_occurrences(): void
    {
        $occurrences = collect([1, 2, 3])->map(fn (int $n) => CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => "series-base_2026100{$n}T090000Z",
            'recurring_event_id' => 'series-base',
        ]));

        $standalone = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => 'standalone',
            'recurring_event_id' => null,
        ]);

        $this->deleteJson("/api/calendar/events/{$occurrences->first()->id}?scope=series")
            ->assertOk()
            ->assertJsonPath('removed', 3);

        foreach ($occurrences as $occurrence) {
            $this->assertDatabaseMissing('calendar_events', ['id' => $occurrence->id]);
        }

        $this->assertDatabaseHas('calendar_events', ['id' => $standalone->id]);
    }

    public function test_series_scope_on_a_non_recurring_event_only_removes_that_row(): void
    {
        $event = CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => 'one-off',
            'recurring_event_id' => null,
        ]);

        $this->deleteJson("/api/calendar/events/{$event->id}?scope=series")
            ->assertOk()
            ->assertJsonPath('removed', 1);

        $this->assertDatabaseMissing('calendar_events', ['id' => $event->id]);
    }

    public function test_permanently_deleting_one_occurrence_keeps_it_hidden_after_a_resync(): void
    {
        $this->fakeGoogle([
            $this->recurringEvent('series-base_1', 'series-base', now()->addDay()->setTime(9, 0)),
            $this->recurringEvent('series-base_2', 'series-base', now()->addDays(7)->setTime(9, 0)),
        ]);

        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $occurrence = CalendarEvent::where('event_id', 'series-base_1')->firstOrFail();
        $this->deleteJson("/api/calendar/events/{$occurrence->id}", ['permanent' => true])
            ->assertOk()
            ->assertJsonPath('removed', 1);

        $this->assertDatabaseHas('calendar_event_dismissals', [
            'calendar_account_id' => $this->account->id,
            'event_id' => 'series-base_1',
            'recurring_event_id' => null,
        ]);

        // Google still returns both occurrences; only the dismissed one is skipped.
        $this->postJson('/api/calendar/sync')->assertStatus(200)->assertJsonPath('synced', 1);

        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'series-base_1']);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'series-base_2']);
    }

    public function test_permanently_deleting_a_series_keeps_every_occurrence_hidden(): void
    {
        $this->fakeGoogle([
            $this->recurringEvent('series-base_1', 'series-base', now()->addDay()->setTime(9, 0)),
            $this->recurringEvent('series-base_2', 'series-base', now()->addDays(7)->setTime(9, 0)),
            $this->timedEvent('lone', now()->addDay()->setTime(14, 0)),
        ]);

        $this->postJson('/api/calendar/sync')->assertStatus(200)->assertJsonPath('synced', 3);

        $occurrence = CalendarEvent::where('event_id', 'series-base_1')->firstOrFail();
        $this->deleteJson("/api/calendar/events/{$occurrence->id}", ['scope' => 'series', 'permanent' => true])
            ->assertOk()
            ->assertJsonPath('removed', 2);

        $this->assertDatabaseHas('calendar_event_dismissals', [
            'calendar_account_id' => $this->account->id,
            'event_id' => 'series-base',
            'recurring_event_id' => 'series-base',
        ]);

        // The whole series stays gone, but the unrelated event still syncs.
        $this->postJson('/api/calendar/sync')->assertStatus(200)->assertJsonPath('synced', 1);

        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'series-base_1']);
        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'series-base_2']);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'lone']);
    }

    public function test_restoring_hidden_events_lets_a_sync_find_them_again(): void
    {
        $this->fakeGoogle([$this->timedEvent('evt-1', now()->addDay()->setTime(9, 0))]);
        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $event = CalendarEvent::where('event_id', 'evt-1')->firstOrFail();
        $this->deleteJson("/api/calendar/events/{$event->id}", ['permanent' => true])->assertOk();

        $this->postJson('/api/calendar/sync')->assertStatus(200)->assertJsonPath('synced', 0);
        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'evt-1']);

        $this->getJson('/api/calendar/accounts')->assertStatus(200)->assertJsonPath('0.hiddenCount', 1);

        $this->deleteJson("/api/calendar/accounts/{$this->account->id}/dismissals")
            ->assertOk()
            ->assertJsonPath('restored', 1);

        $this->assertDatabaseCount('calendar_event_dismissals', 0);

        $this->postJson('/api/calendar/sync')->assertStatus(200);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'evt-1']);
    }

    public function test_cannot_restore_another_users_hidden_events(): void
    {
        CalendarEventDismissal::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => 'hidden-1',
        ]);

        $intruder = User::factory()->create();

        $this->actingAs($intruder)
            ->deleteJson("/api/calendar/accounts/{$this->account->id}/dismissals")
            ->assertStatus(404);

        $this->assertDatabaseCount('calendar_event_dismissals', 1);
    }

    public function test_purging_an_account_forgets_its_hidden_events_too(): void
    {
        CalendarEventDismissal::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
        ]);

        $this->deleteJson("/api/calendar/accounts/{$this->account->id}/events")->assertOk();

        $this->assertDatabaseCount('calendar_event_dismissals', 0);
    }

    public function test_a_series_deleted_in_google_is_removed_even_outside_the_window(): void
    {
        // Both rows are months old, so the window sync alone would never look at them.
        $stale = $this->createCachedOccurrence('series-gone_1', 'series-gone', now()->subMonths(5));
        $alive = $this->createCachedOccurrence('series-alive_1', 'series-alive', now()->subMonths(5));

        Http::fake([
            // The series is gone; the other one still exists.
            '*calendar/v3/calendars/*/events/series-gone' => Http::response(['error' => ['code' => 404]], 404),
            '*calendar/v3/users/me/calendarList*' => Http::response([
                'items' => [['id' => 'primary', 'primary' => true, 'summary' => 'Primary']],
            ]),
            '*calendar/v3/calendars/*/events*' => Http::response(['items' => [
                $this->timedEvent('lone', now()->addDay()->setTime(9, 0)),
            ]]),
        ]);

        $this->postJson('/api/calendar/sync')
            ->assertStatus(200)
            ->assertJsonPath('accounts.0.removed', 1)
            ->assertJsonPath('synced', 1);

        $this->assertDatabaseMissing('calendar_events', ['id' => $stale->id]);
        $this->assertDatabaseHas('calendar_events', ['id' => $alive->id]);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'lone']);
    }

    public function test_a_stale_series_that_google_still_has_is_kept(): void
    {
        $kept = $this->createCachedOccurrence('series-past_1', 'series-past', now()->subMonths(5));

        Http::fake([
            // Google is unsure (a 500), so cached history must survive.
            '*calendar/v3/calendars/*/events/series-past' => Http::response(['error' => ['code' => 500]], 500),
            '*calendar/v3/users/me/calendarList*' => Http::response([
                'items' => [['id' => 'primary', 'primary' => true, 'summary' => 'Primary']],
            ]),
            '*calendar/v3/calendars/*/events*' => Http::response(['items' => []]),
        ]);

        $this->postJson('/api/calendar/sync')->assertStatus(200)->assertJsonPath('accounts.0.removed', 0);

        $this->assertDatabaseHas('calendar_events', ['id' => $kept->id]);
    }

    public function test_sync_follows_google_pagination(): void
    {
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'calendarList')) {
                return Http::response([
                    'items' => [['id' => 'primary', 'primary' => true, 'summary' => 'Primary']],
                ]);
            }

            if ($request->data()['pageToken'] ?? null) {
                return Http::response(['items' => [$this->timedEvent('page-2', now()->addDays(2)->setTime(9, 0))]]);
            }

            return Http::response([
                'items' => [$this->timedEvent('page-1', now()->addDay()->setTime(9, 0))],
                'nextPageToken' => 'page-two',
            ]);
        });

        $this->postJson('/api/calendar/sync')->assertStatus(200)->assertJsonPath('synced', 2);

        $this->assertDatabaseHas('calendar_events', ['event_id' => 'page-1']);
        $this->assertDatabaseHas('calendar_events', ['event_id' => 'page-2']);
    }

    /**
     * A cached occurrence of a recurring series, dated however the test needs.
     */
    private function createCachedOccurrence(string $eventId, string $seriesId, Carbon $start): CalendarEvent
    {
        return CalendarEvent::factory()->create([
            'calendar_account_id' => $this->account->id,
            'user_id' => $this->user->id,
            'event_id' => $eventId,
            'recurring_event_id' => $seriesId,
            'start' => $start,
            'end' => $start->copy()->addHour(),
            'all_day' => false,
        ]);
    }
}
