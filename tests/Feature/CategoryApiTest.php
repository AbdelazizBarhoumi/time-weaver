<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\SideTask;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CategoryApiTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    private function payload(array $attributes = []): array
    {
        return $attributes + [
            'name' => 'Deep work',
            'color' => '#5b9cff',
            'icon' => 'Briefcase',
            'style' => 'solid',
        ];
    }

    public function test_creating_a_category_returns_its_theme(): void
    {
        $this->postJson('/api/categories', $this->payload())
            ->assertStatus(201)
            ->assertJson([
                'name' => 'Deep work',
                'color' => '#5b9cff',
                'icon' => 'Briefcase',
                'style' => 'solid',
            ]);

        $this->assertDatabaseHas('categories', [
            'user_id' => $this->user->id,
            'name' => 'Deep work',
        ]);
    }

    public function test_the_list_only_contains_the_users_categories_with_usage_counts(): void
    {
        $mine = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Errands']);
        Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Study']);
        Category::factory()->create(['name' => 'Someone else']);

        SideTask::factory()->create(['user_id' => $this->user->id, 'category_id' => $mine->id]);

        $response = $this->getJson('/api/categories')->assertOk()->json();

        $this->assertCount(2, $response);
        $this->assertSame('Errands', $response[0]['name']);
        $this->assertSame(1, $response[0]['usageCount']);
    }

    public function test_a_name_must_be_unique_per_user_only(): void
    {
        Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Errands']);
        Category::factory()->create(['user_id' => User::factory()->create()->id, 'name' => 'Errands']);

        $this->postJson('/api/categories', $this->payload(['name' => 'Errands']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('name');

        // Same name for another user is allowed.
        $other = User::factory()->create();
        $this->actingAs($other)
            ->postJson('/api/categories', $this->payload(['name' => 'Errands']))
            ->assertStatus(201);
    }

    public function test_the_theme_is_validated(): void
    {
        $this->postJson('/api/categories', $this->payload(['color' => 'red']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('color');

        $this->postJson('/api/categories', $this->payload(['icon' => 'Skull']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('icon');

        $this->postJson('/api/categories', $this->payload(['style' => 'glow']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('style');
    }

    public function test_a_category_can_be_updated(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Old']);

        $this->putJson("/api/categories/{$category->id}", [
            'name' => 'New name',
            'color' => '#f87171',
            'icon' => 'Heart',
            'style' => 'outline',
        ])->assertOk()->assertJson([
            'name' => 'New name',
            'color' => '#f87171',
            'icon' => 'Heart',
            'style' => 'outline',
        ]);
    }

    public function test_an_update_can_keep_its_own_name(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id, 'name' => 'Errands']);

        $this->putJson("/api/categories/{$category->id}", ['name' => 'Errands'])
            ->assertOk();
    }

    public function test_cannot_touch_another_users_category(): void
    {
        $other = Category::factory()->create();

        $this->putJson("/api/categories/{$other->id}", ['name' => 'Mine now'])->assertStatus(404);
        $this->deleteJson("/api/categories/{$other->id}")->assertStatus(404);

        $this->assertDatabaseHas('categories', ['id' => $other->id, 'name' => $other->name]);
    }

    public function test_deleting_a_category_removes_it(): void
    {
        $category = Category::factory()->create(['user_id' => $this->user->id]);

        $this->deleteJson("/api/categories/{$category->id}")->assertStatus(204);

        $this->assertDatabaseMissing('categories', ['id' => $category->id]);
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->getJson('/api/categories')->assertStatus(401);
        $this->postJson('/api/categories', $this->payload())->assertStatus(401);
    }
}
