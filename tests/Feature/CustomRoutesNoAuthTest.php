<?php

namespace Tests\Feature;

use Tests\TestCase;

class CustomRoutesNoAuthTest extends TestCase
{
    public function test_today_route_no_auth(): void
    {
        $response = $this->getJson('/api/sessions/today');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }

    public function test_stats_route_no_auth(): void
    {
        $response = $this->getJson('/api/sessions/stats');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }

    public function test_monthly_route_no_auth(): void
    {
        $response = $this->getJson('/api/sessions/monthly');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }

    public function test_clear_all_route_no_auth(): void
    {
        $response = $this->deleteJson('/api/sessions/clear-all');
        $this->assertNotEquals(404, $response->status(), 'Route should not be 404');
    }
}
