<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Tests\TestCase;

class PolicyTest extends TestCase
{
    use RefreshDatabase;

    public function test_policy_allows_owner_to_view(): void
    {
        $user = User::factory()->create();
        $session = WorkSession::factory()->create(['user_id' => $user->id]);

        $this->assertTrue(Gate::forUser($user)->allows('view', $session));
    }

    public function test_policy_denies_other_user(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $session = WorkSession::factory()->create(['user_id' => $otherUser->id]);

        $this->assertFalse(Gate::forUser($user)->allows('view', $session));
    }

    public function test_policy_allows_owner_to_update(): void
    {
        $user = User::factory()->create();
        $session = WorkSession::factory()->create(['user_id' => $user->id]);

        $this->assertTrue(Gate::forUser($user)->allows('update', $session));
    }

    public function test_policy_allows_owner_to_delete(): void
    {
        $user = User::factory()->create();
        $session = WorkSession::factory()->create(['user_id' => $user->id]);

        $this->assertTrue(Gate::forUser($user)->allows('delete', $session));
    }
}
