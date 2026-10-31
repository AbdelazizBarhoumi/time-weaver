<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventOverride;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CalendarEventColorTest extends TestCase
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

    /**
     * @return array<int, array<string, mixed>>
     */
    private function served(): array
    {
        return $this->getJson('/api/calendar/events?from=2026-10-13T00:00:00Z&to=2026-10-16T00:00:00Z')
            ->assertStatus(200)
            ->json('events');
    }

    public function test_setting_a_color_is_served_back_as_the_custom_color(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => '#34d399'])->assertOk();

        $events = $this->served();
        $this->assertCount(1, $events);
        $this->assertSame('#34d399', $events[0]['color']);
        $this->assertTrue($events[0]['hasCustomColor']);
    }

    public function test_a_color_only_edit_does_not_move_the_event(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => '#f472b6'])->assertOk();

        // The override carries a color but no times, so the cached time wins.
        $override = CalendarEventOverride::sole();
        $this->assertNull($override->start);
        $this->assertNull($override->end);

        $this->assertSame('2026-10-14T09:00:00.000000Z', $this->served()[0]['start']);
    }

    public function test_a_color_survives_a_later_move(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => '#a78bfa'])->assertOk();
        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertOk();

        $served = $this->served()[0];
        $this->assertSame('#a78bfa', $served['color']);
        $this->assertSame('2026-10-14T13:00:00.000000Z', $served['start']);
    }

    public function test_moving_after_recoloring_keeps_the_color(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertOk();
        $this->putJson("/api/calendar/events/{$event->id}", ['color' => '#fcd34d'])->assertOk();

        $served = $this->served()[0];
        $this->assertSame('#fcd34d', $served['color']);
        $this->assertSame('2026-10-14T13:00:00.000000Z', $served['start']);
    }

    public function test_automatic_color_falls_back_and_removes_the_empty_override(): void
    {
        $event = $this->event(['event_color' => '#22d3ee']);

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => '#f87171'])->assertOk();
        $this->assertTrue($this->served()[0]['hasCustomColor']);

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => null])->assertOk();

        // Nothing is left to remember: the row goes away instead of lingering blank.
        $this->assertSame(0, CalendarEventOverride::count());

        $served = $this->served()[0];
        $this->assertSame('#22d3ee', $served['color']);
        $this->assertFalse($served['hasCustomColor']);
    }

    public function test_rejects_a_color_that_is_not_a_hex_value(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => 'red'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('color');

        $this->putJson("/api/calendar/events/{$event->id}", ['color' => '#12345'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('color');

        $this->assertSame(0, CalendarEventOverride::count());
    }

    public function test_rejects_an_update_with_nothing_to_change(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors('event');
    }

    public function test_cannot_recolor_another_users_event(): void
    {
        $other = CalendarEvent::factory()->create();

        $this->putJson("/api/calendar/events/{$other->id}", ['color' => '#34d399'])
            ->assertStatus(404);

        $this->assertSame(0, CalendarEventOverride::count());
    }
}
