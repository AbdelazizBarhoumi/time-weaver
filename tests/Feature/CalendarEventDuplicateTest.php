<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventTag;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CalendarEventDuplicateTest extends TestCase
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

    private function event(array $attributes = []): CalendarEvent
    {
        return CalendarEvent::factory()->create($attributes + [
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'account_email' => $this->account->email,
            'event_id' => 'evt-1',
            'title' => 'Sprint review',
            'start' => '2026-10-14 09:00:00',
            'end' => '2026-10-14 10:00:00',
        ]);
    }

    /**
     * @param  array<int, array<string, mixed>>  $events
     */
    private function fakeGoogle(array $events = []): void
    {
        Http::fake([
            '*calendar/v3/users/me/calendarList*' => Http::response([
                'items' => [['id' => 'primary', 'primary' => true, 'summary' => 'Primary', 'backgroundColor' => '#123456']],
            ]),
            '*calendar/v3/calendars/*/events*' => Http::response(['items' => $events]),
        ]);
    }

    public function test_duplicating_an_event_creates_a_local_copy_on_the_next_day(): void
    {
        $event = $this->event();

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")
            ->assertStatus(201)
            ->assertJsonPath('start', '2026-10-15T09:00:00.000000Z');

        $copy = CalendarEvent::where('is_local', true)->sole();
        $this->assertSame('Sprint review', $copy->title);
        $this->assertSame('2026-10-15 09:00:00', $copy->start->toDateTimeString());
        $this->assertSame('2026-10-15 10:00:00', $copy->end->toDateTimeString());
        $this->assertStringStartsWith('local-', $copy->event_id);
        $this->assertSame($this->account->id, $copy->calendar_account_id);

        // The source keeps its own row and time.
        $event->refresh();
        $this->assertFalse($event->is_local);
        $this->assertSame('2026-10-14 09:00:00', $event->start->toDateTimeString());
    }

    public function test_the_copy_is_served_by_the_events_endpoint(): void
    {
        $event = $this->event();
        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $events = $this->getJson('/api/calendar/events?from=2026-10-15T00:00:00Z&to=2026-10-16T00:00:00Z')
            ->assertStatus(200)
            ->json('events');

        $this->assertCount(1, $events);
        $this->assertSame('Sprint review', $events[0]['title']);
        $this->assertTrue($events[0]['isLocal']);
    }

    public function test_a_copy_takes_the_source_effective_times_and_color(): void
    {
        $event = $this->event();

        // Move and recolor the source first: the copy must follow the edits.
        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:30:00+00:00',
            'color' => '#f87171',
        ])->assertStatus(200);

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $copy = CalendarEvent::where('is_local', true)->sole();
        $this->assertSame('2026-10-15 13:00:00', $copy->start->toDateTimeString());
        $this->assertSame('2026-10-15 14:30:00', $copy->end->toDateTimeString());
        $this->assertSame('#f87171', $copy->event_color);
    }

    public function test_duplicating_twice_does_not_stack_the_copies(): void
    {
        $event = $this->event();

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);
        $this->postJson("/api/calendar/events/{$event->id}/duplicate")
            ->assertStatus(201)
            ->assertJsonPath('start', '2026-10-16T09:00:00.000000Z');

        $this->assertSame(2, CalendarEvent::where('is_local', true)->count());
        $this->assertSame(1, CalendarEvent::where('start', '2026-10-15 09:00:00')->count());
    }

    public function test_a_copy_is_standalone_not_part_of_the_source_series(): void
    {
        $event = $this->event(['event_id' => 'series_1', 'recurring_event_id' => 'series']);

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $this->assertNull(CalendarEvent::where('is_local', true)->sole()->recurring_event_id);
    }

    public function test_a_copy_keeps_the_source_work_state_without_tracking_time(): void
    {
        $event = $this->event();

        CalendarEventTag::create([
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'event_id' => $event->event_id,
            'is_work' => true,
        ]);

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $copy = CalendarEvent::where('is_local', true)->sole();

        $this->assertDatabaseHas('calendar_event_tags', [
            'calendar_account_id' => $this->account->id,
            'event_id' => $copy->event_id,
            'is_work' => true,
        ]);
        // The copy is a plan, not tracked time: no session is mirrored.
        $this->assertSame(0, $this->user->workSessions()->count());
    }

    public function test_an_all_day_copy_keeps_the_date_only_shape(): void
    {
        $event = $this->event([
            'all_day' => true,
            'start' => '2026-10-14 00:00:00',
            'end' => '2026-10-15 00:00:00',
        ]);

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")
            ->assertStatus(201)
            ->assertJson(['start' => '2026-10-15', 'end' => '2026-10-16']);
    }

    public function test_a_sync_keeps_local_copies(): void
    {
        $event = $this->event();
        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        // Google returns nothing, so its cached rows are stale — the copy is not,
        // even though it sits inside the synced window.
        $this->fakeGoogle();
        $this->postJson('/api/calendar/sync')->assertStatus(200);

        $this->assertDatabaseMissing('calendar_events', ['event_id' => 'evt-1']);
        $this->assertSame(1, CalendarEvent::where('is_local', true)->count());
    }

    public function test_deleting_a_copy_is_final_and_records_no_dismissal(): void
    {
        $event = $this->event();
        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $copy = CalendarEvent::where('is_local', true)->sole();

        $this->deleteJson("/api/calendar/events/{$copy->id}?permanent=1")
            ->assertOk()
            ->assertJsonPath('removed', 1);

        $this->assertDatabaseMissing('calendar_events', ['id' => $copy->id]);
        $this->assertDatabaseCount('calendar_event_dismissals', 0);
    }

    public function test_cannot_duplicate_another_users_event(): void
    {
        $other = CalendarEvent::factory()->create();

        $this->postJson("/api/calendar/events/{$other->id}/duplicate")->assertStatus(404);

        $this->assertSame(0, CalendarEvent::where('is_local', true)->count());
    }

    public function test_requires_authentication(): void
    {
        $event = $this->event();

        auth()->logout();

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(401);

        $this->assertSame(0, CalendarEvent::where('is_local', true)->count());
    }
}
