<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventOverride;
use App\Models\Category;
use App\Models\FocusBlock;
use App\Models\SideTask;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CategoryAssignmentTest extends TestCase
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

    public function test_a_side_task_can_be_created_and_updated_with_a_category(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Errands']);
        $other = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Study']);

        $taskId = $this->postJson('/api/side-tasks', [
            'title' => 'Buy milk',
            'estimate_minutes' => 30,
            'category_id' => $category->id,
        ])->assertStatus(201)
            ->assertJsonPath('category.name', 'Errands')
            ->json('id');

        $this->putJson("/api/side-tasks/{$taskId}", ['category_id' => $other->id])
            ->assertOk()
            ->assertJsonPath('category.name', 'Study');

        $this->putJson("/api/side-tasks/{$taskId}", ['category_id' => null])
            ->assertOk()
            ->assertJsonPath('category', null);
    }

    public function test_a_side_task_cannot_use_another_users_category(): void
    {
        $foreign = Category::factory()->create();

        $this->postJson('/api/side-tasks', [
            'title' => 'Buy milk',
            'estimate_minutes' => 30,
            'category_id' => $foreign->id,
        ])->assertStatus(422)->assertJsonValidationErrors('category_id');
    }

    public function test_a_focus_block_can_be_created_and_updated_with_a_category(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Deep work']);

        $blockId = $this->postJson('/api/calendar/focus-blocks', [
            'title' => 'Write',
            'start' => '2026-10-14T09:00:00Z',
            'end' => '2026-10-14T11:00:00Z',
            'category_id' => $category->id,
        ])->assertStatus(201)
            ->assertJsonPath('category.color', $category->color)
            ->json('id');

        $this->getJson('/api/calendar/focus-blocks?from=2026-10-14T00:00:00Z&to=2026-10-15T00:00:00Z')
            ->assertOk()
            ->assertJsonPath('0.category.name', 'Deep work');

        $this->putJson("/api/calendar/focus-blocks/{$blockId}", ['category_id' => null])
            ->assertOk()
            ->assertJsonPath('category', null);
    }

    public function test_an_event_category_is_stored_on_the_override_and_served_back(): void
    {
        $event = $this->event();
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Meetings']);

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $category->id])->assertOk();

        $override = CalendarEventOverride::sole();
        $this->assertNull($override->start);
        $this->assertNull($override->end);
        $this->assertNull($override->color);

        $served = $this->served()[0];
        $this->assertSame('Meetings', $served['category']['name']);
        $this->assertSame($category->color, $served['category']['color']);
        $this->assertSame('2026-10-14T09:00:00.000000Z', $served['start']);
    }

    public function test_a_manual_color_wins_over_the_category_color(): void
    {
        $event = $this->event();
        $category = Category::factory()->create([
            'user_id' => $this->user->id,
            'color' => '#34d399',
        ]);

        $this->putJson("/api/calendar/events/{$event->id}", [
            'category_id' => $category->id,
            'color' => '#f87171',
        ])->assertOk();

        $served = $this->served()[0];
        $this->assertSame('#f87171', $served['color']);
        $this->assertTrue($served['hasCustomColor']);
        $this->assertSame('#34d399', $served['category']['color']);
    }

    public function test_clearing_the_category_keeps_an_explicit_no_category_override(): void
    {
        $event = $this->event();
        $category = Category::factory()->create(['user_id' => $this->user->id]);

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $category->id])->assertOk();
        $this->assertSame(1, CalendarEventOverride::count());

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => null])->assertOk();

        // "No category" is a real choice, not an empty override: it has to keep
        // the event from falling back to its mailbox's default.
        $override = CalendarEventOverride::sole();
        $this->assertNull($override->category_id);
        $this->assertTrue($override->category_override);

        $served = $this->served()[0];
        $this->assertNull($served['category']);
        $this->assertSame('event', $served['categorySource']);
    }

    public function test_cannot_assign_another_users_category_to_an_event(): void
    {
        $event = $this->event();
        $foreign = Category::factory()->create();

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $foreign->id])
            ->assertStatus(422)
            ->assertJsonValidationErrors('category_id');

        $this->assertSame(0, CalendarEventOverride::count());
    }

    public function test_creating_a_local_event_saves_it_with_a_category(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Personal']);

        $this->postJson('/api/calendar/events', [
            'title' => 'Dentist',
            'start' => '2026-10-14T13:00:00Z',
            'end' => '2026-10-14T14:00:00Z',
            'category_id' => $category->id,
        ])->assertStatus(201)
            ->assertJsonPath('start', '2026-10-14T13:00:00.000000Z');

        $event = CalendarEvent::where('is_local', true)->sole();
        $this->assertSame('Dentist', $event->title);
        $this->assertSame($this->account->id, $event->calendar_account_id);
        $this->assertStringStartsWith('local-', $event->event_id);

        $served = $this->served()[0];
        $this->assertTrue($served['isLocal']);
        $this->assertSame('Dentist', $served['title']);
        $this->assertSame('Personal', $served['category']['name']);
    }

    public function test_a_local_all_day_event_keeps_the_date_only_shape(): void
    {
        $this->postJson('/api/calendar/events', [
            'title' => 'Conference',
            'start' => '2026-10-14',
            'end' => '2026-10-15',
            'all_day' => true,
        ])->assertStatus(201)
            ->assertJson(['start' => '2026-10-14', 'end' => '2026-10-15']);

        $this->assertTrue(CalendarEvent::where('is_local', true)->sole()->all_day);
    }

    public function test_creating_a_local_event_without_a_connected_account_is_blocked(): void
    {
        $this->account->delete();

        $this->postJson('/api/calendar/events', [
            'title' => 'Dentist',
            'start' => '2026-10-14T13:00:00Z',
            'end' => '2026-10-14T14:00:00Z',
        ])->assertStatus(422)->assertJsonValidationErrors('event');

        $this->assertSame(0, CalendarEvent::count());
    }

    public function test_a_local_event_can_be_edited_in_place(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Personal']);

        $this->postJson('/api/calendar/events', [
            'title' => 'Dentist',
            'start' => '2026-10-14T13:00:00Z',
            'end' => '2026-10-14T14:00:00Z',
        ])->assertStatus(201);

        $event = CalendarEvent::where('is_local', true)->sole();

        $this->putJson("/api/calendar/events/{$event->id}", [
            'title' => 'Dentist (moved)',
            'start' => '2026-10-14T15:00:00Z',
            'end' => '2026-10-14T16:30:00Z',
            'category_id' => $category->id,
        ])->assertOk();

        $event->refresh();
        $this->assertSame('Dentist (moved)', $event->title);
        $this->assertSame('2026-10-14 15:00:00', $event->start->toDateTimeString());
        $this->assertSame('2026-10-14 16:30:00', $event->end->toDateTimeString());

        $served = $this->served()[0];
        $this->assertSame('Dentist (moved)', $served['title']);
        $this->assertSame('2026-10-14T15:00:00.000000Z', $served['start']);
        $this->assertSame('Personal', $served['category']['name']);
    }

    public function test_google_events_cannot_be_renamed(): void
    {
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", ['title' => 'Renamed'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('event');

        $this->assertSame('Sprint review', $event->fresh()->title);
    }

    public function test_duplicating_an_event_copies_its_category(): void
    {
        $event = $this->event();
        $category = Category::factory()->create(['user_id' => $this->user->id]);

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $category->id])->assertOk();
        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $copy = CalendarEvent::where('is_local', true)->sole();
        $this->assertSame(
            $category->id,
            CalendarEventOverride::where('event_id', $copy->event_id)->sole()->category_id,
        );
    }

    public function test_deleting_a_category_clears_it_from_everything(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id]);
        $task = SideTask::factory()->create(['user_id' => $this->user->id, 'category_id' => $category->id]);
        $block = FocusBlock::create([
            'user_id' => $this->user->id,
            'category_id' => $category->id,
            'title' => 'Write',
            'start' => '2026-10-14 09:00:00',
            'end' => '2026-10-14 10:00:00',
        ]);
        $event = $this->event();
        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $category->id])->assertOk();

        $this->deleteJson("/api/categories/{$category->id}")->assertStatus(204);

        $this->assertNull($task->fresh()->category_id);
        $this->assertNull($block->fresh()->category_id);
        $this->assertNull(CalendarEventOverride::sole()->category_id);
    }
}
