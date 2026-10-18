<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventOverride;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CalendarEventMoveTest extends TestCase
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

    public function test_moving_an_event_stores_a_local_override_and_serves_the_new_time(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(200)->assertJson(['ok' => true]);

        $this->assertDatabaseHas('calendar_event_overrides', [
            'calendar_account_id' => $this->account->id,
            'event_id' => 'evt-1',
        ]);

        $events = $this->getJson('/api/calendar/events?from=2026-10-14T00:00:00Z&to=2026-10-15T00:00:00Z')
            ->assertStatus(200)
            ->json('events');

        $this->assertCount(1, $events);
        $this->assertSame('2026-10-14T13:00:00.000000Z', $events[0]['start']);
        $this->assertSame('2026-10-14T14:00:00.000000Z', $events[0]['end']);
    }

    public function test_moving_an_event_leaves_the_cached_google_times_untouched(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(200);

        // The cache stays a mirror of Google; only the override moves.
        $event->refresh();
        $this->assertSame('09:00', $event->start->format('H:i'));
        $this->assertSame('10:00', $event->end->format('H:i'));
    }

    public function test_a_moved_event_is_served_even_when_its_cached_row_left_the_window(): void
    {
        $event = $this->event([
            'start' => '2026-10-01 09:00:00',
            'end' => '2026-10-01 10:00:00',
        ]);

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-20T13:00:00+00:00',
            'end' => '2026-10-20T14:00:00+00:00',
        ])->assertStatus(200);

        $events = $this->getJson('/api/calendar/events?from=2026-10-19T00:00:00Z&to=2026-10-21T00:00:00Z')
            ->assertStatus(200)
            ->json('events');

        $this->assertCount(1, $events);
        $this->assertSame('2026-10-20T13:00:00.000000Z', $events[0]['start']);
    }

    public function test_moving_a_work_event_shifts_its_tracked_session(): void
    {
        $event = $this->event();

        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'title' => 'Sprint review',
            'start' => '2026-10-14T09:00:00+00:00',
            'end' => '2026-10-14T10:00:00+00:00',
        ])->assertStatus(200);

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T15:00:00+00:00',
            'end' => '2026-10-14T16:00:00+00:00',
        ])->assertStatus(200);

        $session = $this->user->workSessions()->sole();
        $this->assertSame('15:00', $session->start->format('H:i'));
        $this->assertSame('16:00', $session->end->format('H:i'));
    }

    public function test_moving_an_all_day_event_keeps_the_date_only_shape(): void
    {
        $event = $this->event([
            'event_id' => 'evt-allday',
            'all_day' => true,
            'start' => '2026-10-14 00:00:00',
            'end' => '2026-10-15 00:00:00',
        ]);

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-17',
            'end' => '2026-10-18',
        ])->assertStatus(200);

        $events = $this->getJson('/api/calendar/events?from=2026-10-13T00:00:00Z&to=2026-10-20T00:00:00Z')
            ->assertStatus(200)
            ->json('events');

        $this->assertSame('2026-10-17', $events[0]['start']);
        $this->assertSame('2026-10-18', $events[0]['end']);
        $this->assertTrue($events[0]['allDay']);
    }

    public function test_rejects_an_end_before_the_start(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T15:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(422)->assertJsonValidationErrors('end');
    }

    public function test_cannot_move_another_users_event(): void
    {
        $other = CalendarEvent::factory()->create();

        $this->putJson("/api/calendar/events/{$other->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(404);
    }

    public function test_deleting_an_event_removes_its_override(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(200);

        $this->deleteJson("/api/calendar/events/{$event->id}")->assertStatus(200);

        $this->assertSame(0, CalendarEventOverride::count());
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(401);
    }
}
