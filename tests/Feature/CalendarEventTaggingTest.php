<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEventTag;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CalendarEventTaggingTest extends TestCase
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

    public function test_marking_a_timed_event_as_work_creates_a_tracked_session(): void
    {
        $start = now()->setTime(9, 0);
        $end = now()->setTime(10, 30);

        $response = $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'title' => 'Sprint review',
            'start' => $start->toISOString(),
            'end' => $end->toISOString(),
            'all_day' => false,
        ]);

        $response->assertStatus(200)->assertJson(['ok' => true]);

        $this->assertDatabaseHas('work_sessions', [
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'calendar_event_id' => 'evt-1',
            'source' => 'calendar',
            'note' => 'Sprint review',
        ]);

        $this->assertDatabaseHas('calendar_event_tags', [
            'calendar_account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
        ]);
        $this->assertSame(1, $this->user->workSessions()->count());
    }

    public function test_marking_the_same_event_twice_does_not_duplicate_the_session(): void
    {
        $payload = [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'title' => 'Standup',
            'start' => now()->setTime(9, 0)->toISOString(),
            'end' => now()->setTime(9, 15)->toISOString(),
            'all_day' => false,
        ];

        $this->postJson('/api/calendar/events/tag', $payload)->assertStatus(200);
        $this->postJson('/api/calendar/events/tag', $payload)->assertStatus(200);

        $this->assertSame(1, $this->user->workSessions()->count());
    }

    public function test_marking_work_updates_the_session_when_the_event_moves(): void
    {
        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'title' => 'Client call',
            'start' => now()->setTime(9, 0)->toISOString(),
            'end' => now()->setTime(10, 0)->toISOString(),
            'all_day' => false,
        ])->assertStatus(200);

        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'title' => 'Client call',
            'start' => now()->setTime(11, 0)->toISOString(),
            'end' => now()->setTime(12, 0)->toISOString(),
            'all_day' => false,
        ])->assertStatus(200);

        $session = $this->user->workSessions()->sole();
        $this->assertSame('11:00', $session->start->format('H:i'));
        $this->assertSame('12:00', $session->end->format('H:i'));
    }

    public function test_all_day_work_events_do_not_create_a_session(): void
    {
        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-allday',
            'is_work' => true,
            'title' => 'Conference',
            'all_day' => true,
        ])->assertStatus(200);

        $this->assertSame(0, $this->user->workSessions()->count());
        $this->assertDatabaseHas('calendar_event_tags', [
            'event_id' => 'evt-allday',
            'is_work' => true,
        ]);
    }

    public function test_marking_an_event_as_not_work_removes_the_session_but_keeps_the_tag(): void
    {
        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'start' => now()->setTime(9, 0)->toISOString(),
            'end' => now()->setTime(10, 0)->toISOString(),
        ])->assertStatus(200);

        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => false,
        ])->assertStatus(200);

        $this->assertSame(0, $this->user->workSessions()->count());
        $this->assertDatabaseHas('calendar_event_tags', [
            'event_id' => 'evt-1',
            'is_work' => false,
        ]);
    }

    public function test_resetting_to_automatic_removes_both_tag_and_session(): void
    {
        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'start' => now()->setTime(9, 0)->toISOString(),
            'end' => now()->setTime(10, 0)->toISOString(),
        ])->assertStatus(200);

        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => null,
        ])->assertStatus(200);

        $this->assertSame(0, $this->user->workSessions()->count());
        $this->assertSame(0, CalendarEventTag::count());
    }

    public function test_cannot_tag_another_users_account(): void
    {
        $other = CalendarAccount::factory()->create();

        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $other->id,
            'event_id' => 'evt-1',
            'is_work' => true,
            'start' => now()->setTime(9, 0)->toISOString(),
            'end' => now()->setTime(10, 0)->toISOString(),
        ])->assertStatus(404);
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->postJson('/api/calendar/events/tag', [
            'account_id' => $this->account->id,
            'event_id' => 'evt-1',
            'is_work' => true,
        ])->assertStatus(401);
    }
}
