<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\CalendarEventOverride;
use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A mailbox can carry a default category so every event synced from it arrives
 * already labelled. An event keeps the right to choose its own category — or to
 * have none — and only "use the mailbox default" hands it back.
 */
class AccountDefaultCategoryTest extends TestCase
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

    private function category(string $name = 'Work'): Category
    {
        return Category::factory()->create(['user_id' => $this->user->id, 'name' => $name]);
    }

    private function event(array $attributes = []): CalendarEvent
    {
        return CalendarEvent::factory()->create($attributes + [
            'user_id' => $this->user->id,
            'calendar_account_id' => $this->account->id,
            'account_email' => $this->account->email,
            'event_id' => 'evt-'.fake()->unique()->numerify('####'),
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

    public function test_events_synced_from_a_mailbox_inherit_its_default_category(): void
    {
        $category = $this->category();
        $this->account->update(['default_category_id' => $category->id]);
        $this->event();

        $served = $this->served()[0];

        $this->assertSame($category->id, $served['category']['id']);
        $this->assertSame($category->name, $served['category']['name']);
        $this->assertSame('account', $served['categorySource']);
        // Nothing was written for the event itself; it simply follows the mailbox.
        $this->assertSame(0, CalendarEventOverride::count());
    }

    public function test_an_events_own_category_wins_over_the_mailbox_default(): void
    {
        $mailboxDefault = $this->category('Mailbox');
        $own = $this->category('Own');
        $this->account->update(['default_category_id' => $mailboxDefault->id]);
        $event = $this->event();

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $own->id])->assertOk();

        $served = $this->served()[0];
        $this->assertSame($own->id, $served['category']['id']);
        $this->assertSame('event', $served['categorySource']);
    }

    public function test_an_event_can_explicitly_have_no_category_even_with_a_mailbox_default(): void
    {
        $mailboxDefault = $this->category('Mailbox');
        $this->account->update(['default_category_id' => $mailboxDefault->id]);
        $event = $this->event();
        $own = $this->category('Own');

        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $own->id])->assertOk();
        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => null])->assertOk();

        $served = $this->served()[0];
        $this->assertNull($served['category']);
        $this->assertSame('event', $served['categorySource']);

        $override = CalendarEventOverride::sole();
        $this->assertNull($override->category_id);
        $this->assertTrue($override->category_override);
    }

    public function test_an_event_can_be_handed_back_to_its_mailbox_default(): void
    {
        $mailboxDefault = $this->category('Mailbox');
        $own = $this->category('Own');
        $this->account->update(['default_category_id' => $mailboxDefault->id]);
        $event = $this->event();
        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $own->id])->assertOk();

        $this->putJson("/api/calendar/events/{$event->id}", ['use_default_category' => true])->assertOk();

        $served = $this->served()[0];
        $this->assertSame($mailboxDefault->id, $served['category']['id']);
        $this->assertSame('account', $served['categorySource']);
        // With nothing else stored, the choice leaves no override behind.
        $this->assertSame(0, CalendarEventOverride::count());
    }

    public function test_handing_an_event_back_keeps_its_manual_color(): void
    {
        $mailboxDefault = $this->category('Mailbox');
        $own = $this->category('Own');
        $this->account->update(['default_category_id' => $mailboxDefault->id]);
        $event = $this->event();
        $this->putJson("/api/calendar/events/{$event->id}", [
            'category_id' => $own->id,
            'color' => '#f87171',
        ])->assertOk();

        $this->putJson("/api/calendar/events/{$event->id}", ['use_default_category' => true])->assertOk();

        $override = CalendarEventOverride::sole();
        $this->assertSame('#f87171', $override->color);
        $this->assertNull($override->category_id);
        $this->assertFalse($override->category_override);
    }

    public function test_a_local_event_never_inherits_the_mailbox_default(): void
    {
        $mailboxDefault = $this->category('Mailbox');
        $this->account->update(['default_category_id' => $mailboxDefault->id]);

        $this->postJson('/api/calendar/events', [
            'title' => 'Dentist',
            'start' => '2026-10-14T13:00:00Z',
            'end' => '2026-10-14T14:00:00Z',
        ])->assertStatus(201);

        $served = $this->served()[0];
        $this->assertTrue($served['isLocal']);
        $this->assertNull($served['category']);
        $this->assertNull($served['categorySource']);
    }

    public function test_duplicating_an_explicitly_uncategorized_event_keeps_it_uncategorized(): void
    {
        $mailboxDefault = $this->category('Mailbox');
        $this->account->update(['default_category_id' => $mailboxDefault->id]);
        $event = $this->event();
        $own = $this->category('Own');
        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => $own->id])->assertOk();
        $this->putJson("/api/calendar/events/{$event->id}", ['category_id' => null])->assertOk();

        $this->postJson("/api/calendar/events/{$event->id}/duplicate")->assertStatus(201);

        $copy = CalendarEvent::where('is_local', true)->sole();
        $override = CalendarEventOverride::where('event_id', $copy->event_id)->sole();
        $this->assertNull($override->category_id);
        $this->assertTrue($override->category_override);
    }

    public function test_a_mailbox_default_is_returned_by_the_accounts_api(): void
    {
        $category = $this->category();
        $this->account->update(['default_category_id' => $category->id]);

        $this->getJson('/api/calendar/accounts')
            ->assertOk()
            ->assertJsonPath('0.defaultCategory.id', $category->id)
            ->assertJsonPath('0.defaultCategory.name', $category->name)
            ->assertJsonPath('0.defaultCategory.color', $category->color);

        $this->patchJson("/api/calendar/accounts/{$this->account->id}", [
            'default_category_id' => $category->id,
        ])->assertOk()
            ->assertJsonPath('defaultCategory.id', $category->id);
    }

    public function test_a_mailbox_default_can_be_cleared(): void
    {
        $category = $this->category();
        $this->account->update(['default_category_id' => $category->id]);

        $this->patchJson("/api/calendar/accounts/{$this->account->id}", [
            'default_category_id' => null,
        ])->assertOk()
            ->assertJsonPath('defaultCategory', null);

        $this->assertNull($this->account->fresh()->default_category_id);
    }

    public function test_a_mailbox_default_must_be_one_of_the_users_categories(): void
    {
        $foreign = Category::factory()->create();

        $this->patchJson("/api/calendar/accounts/{$this->account->id}", [
            'default_category_id' => $foreign->id,
        ])->assertStatus(422)->assertJsonValidationErrors('default_category_id');

        $this->assertNull($this->account->fresh()->default_category_id);
    }

    public function test_a_mailbox_belonging_to_another_user_cannot_be_changed(): void
    {
        $stranger = User::factory()->create();
        $foreignAccount = CalendarAccount::factory()->create(['user_id' => $stranger->id]);
        $category = $this->category();

        $this->patchJson("/api/calendar/accounts/{$foreignAccount->id}", [
            'default_category_id' => $category->id,
        ])->assertNotFound();

        $this->assertNull($foreignAccount->fresh()->default_category_id);
    }

    public function test_deleting_a_category_clears_it_from_mailboxes(): void
    {
        $category = $this->category();
        $this->account->update(['default_category_id' => $category->id]);

        $this->deleteJson("/api/categories/{$category->id}")->assertStatus(204);

        $this->assertNull($this->account->fresh()->default_category_id);
    }

    public function test_the_category_usage_count_includes_mailbox_defaults(): void
    {
        $category = $this->category();
        $this->account->update(['default_category_id' => $category->id]);

        $this->getJson('/api/categories')
            ->assertOk()
            ->assertJsonPath('0.usageCount', 1);
    }
}
