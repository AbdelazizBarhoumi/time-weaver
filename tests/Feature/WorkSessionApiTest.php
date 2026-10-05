<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WorkSessionApiTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    public function test_can_list_sessions(): void
    {
        WorkSession::factory()->count(3)->create(['user_id' => $this->user->id]);

        $response = $this->getJson('/api/sessions');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'start', 'end', 'note', 'durationMs', 'durationHours', 'isActive', 'dayKey'],
                ],
                'links',
                'meta',
            ]);
    }

    public function test_can_create_session(): void
    {
        $response = $this->postJson('/api/sessions', [
            'start' => now()->toISOString(),
            'note' => 'Test session',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['id', 'start', 'end', 'note', 'durationMs', 'durationHours', 'isActive', 'dayKey']);

        $this->assertDatabaseHas('work_sessions', [
            'user_id' => $this->user->id,
            'note' => 'Test session',
        ]);
    }

    public function test_can_create_active_session(): void
    {
        $response = $this->postJson('/api/sessions', [
            'start' => now()->toISOString(),
        ]);

        $response->assertStatus(201);
        $data = $response->json();
        $this->assertTrue($data['isActive']);
        $this->assertNull($data['end']);
    }

    public function test_can_show_session(): void
    {
        $session = WorkSession::factory()->create(['user_id' => $this->user->id]);

        // Debug: check session exists and has correct user_id
        $this->assertDatabaseHas('work_sessions', ['id' => $session->id, 'user_id' => $this->user->id]);

        $response = $this->getJson("/api/sessions/{$session->id}");

        $response->assertStatus(200)
            ->assertJson(['id' => $session->id]);
    }

    public function test_can_update_session(): void
    {
        $session = WorkSession::factory()->create(['user_id' => $this->user->id]);

        $response = $this->putJson("/api/sessions/{$session->id}", [
            'note' => 'Updated note',
            'end' => now()->addHour()->toISOString(),
        ]);

        $response->assertStatus(200)
            ->assertJson(['note' => 'Updated note']);
    }

    public function test_can_delete_session(): void
    {
        $session = WorkSession::factory()->create(['user_id' => $this->user->id]);

        $response = $this->deleteJson("/api/sessions/{$session->id}");

        $response->assertStatus(200);
        $this->assertDatabaseMissing('work_sessions', ['id' => $session->id]);
    }

    public function test_cannot_access_other_users_session(): void
    {
        $otherUser = User::factory()->create();
        $session = WorkSession::factory()->create(['user_id' => $otherUser->id]);

        $response = $this->getJson("/api/sessions/{$session->id}");
        $response->assertStatus(404);

        $response = $this->putJson("/api/sessions/{$session->id}", ['note' => 'hack']);
        $response->assertStatus(404);

        $response = $this->deleteJson("/api/sessions/{$session->id}");
        $response->assertStatus(404);
    }

    public function test_can_get_today_sessions(): void
    {
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => now()->setTime(9, 0),
        ]);
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => now()->subDay()->setTime(9, 0),
        ]);

        $response = $this->getJson('/api/sessions/today');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertCount(1, $data);
        $this->assertStringContainsString(now()->format('Y-m-d'), $data[0]['dayKey']);
    }

    public function test_can_get_stats(): void
    {
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => now()->subDays(2)->setTime(9, 0),
            'end' => now()->subDays(2)->setTime(17, 0),
        ]);
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => now()->subDay()->setTime(9, 0),
            'end' => now()->subDay()->setTime(17, 0),
        ]);

        $response = $this->getJson('/api/sessions/stats');

        $response->assertStatus(200)
            ->assertJsonStructure(['streak', 'weekHours', 'bestDayHours', 'avgPerActiveDay', 'totalHours']);
    }

    public function test_can_get_monthly_breakdown(): void
    {
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => now()->subDays(10)->setTime(9, 0),
            'end' => now()->subDays(10)->setTime(17, 0),
        ]);

        $response = $this->getJson('/api/sessions/monthly');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertIsArray($data);
        $this->assertGreaterThan(0, count($data));
    }

    public function test_can_clear_all_sessions(): void
    {
        WorkSession::factory()->count(5)->create(['user_id' => $this->user->id]);

        $response = $this->deleteJson('/api/sessions/clear-all');

        $response->assertStatus(200);
        $this->assertEquals(0, $this->user->workSessions()->count());
    }
}
