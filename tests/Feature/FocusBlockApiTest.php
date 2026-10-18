<?php

namespace Tests\Feature;

use App\Models\FocusBlock;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FocusBlockApiTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    private function block(array $attributes = []): FocusBlock
    {
        return $this->user->focusBlocks()->create($attributes + [
            'title' => 'Deep work',
            'start' => '2026-10-14 09:00:00',
            'end' => '2026-10-14 10:00:00',
        ]);
    }

    public function test_updating_a_block_moves_and_stretches_it(): void
    {
        $block = $this->block();

        $this->putJson("/api/calendar/focus-blocks/{$block->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T15:00:00+00:00',
        ])->assertStatus(200);

        $block->refresh();
        $this->assertSame('13:00', $block->start->format('H:i'));
        $this->assertSame('15:00', $block->end->format('H:i'));
    }

    public function test_rejects_a_lone_start_that_would_invert_the_block(): void
    {
        $block = $this->block();

        $this->putJson("/api/calendar/focus-blocks/{$block->id}", [
            'start' => '2026-10-14T11:00:00+00:00',
        ])->assertStatus(422)->assertJsonValidationErrors('end');
    }

    public function test_rejects_a_lone_end_that_would_invert_the_block(): void
    {
        $block = $this->block();

        $this->putJson("/api/calendar/focus-blocks/{$block->id}", [
            'end' => '2026-10-14T08:00:00+00:00',
        ])->assertStatus(422)->assertJsonValidationErrors('end');
    }

    public function test_cannot_update_another_users_block(): void
    {
        $other = FocusBlock::create([
            'user_id' => User::factory()->create()->id,
            'title' => 'Theirs',
            'start' => '2026-10-14 09:00:00',
            'end' => '2026-10-14 10:00:00',
        ]);

        $this->putJson("/api/calendar/focus-blocks/{$other->id}", [
            'start' => '2026-10-14T13:00:00+00:00',
            'end' => '2026-10-14T14:00:00+00:00',
        ])->assertStatus(404);
    }
}
