<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CustomRoutesTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    public function test_today_route_exists(): void
    {
        $response = $this->getJson('/api/sessions/today');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }

    public function test_stats_route_exists(): void
    {
        $response = $this->getJson('/api/sessions/stats');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }

    public function test_monthly_route_exists(): void
    {
        $response = $this->getJson('/api/sessions/monthly');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }

    public function test_clear_all_route_exists(): void
    {
        $response = $this->deleteJson('/api/sessions/clear-all');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }
}
