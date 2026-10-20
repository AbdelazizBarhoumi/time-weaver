<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkTask;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TaskPanelViewTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    public function test_home_page_loads_and_lists_work_tasks(): void
    {
        WorkTask::factory()->for($this->user)->create(['title' => 'Refactor the panel', 'estimate_minutes' => 45]);

        $response = $this->get('/');

        $response->assertOk();
    }
}
