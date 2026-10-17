<?php

namespace Tests\Feature;

use App\Models\SideTask;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SideTaskApiTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
        config([
            'services.gemini.key' => 'test-key',
            'services.gemini.model' => 'gemini-2.5-flash',
            'services.gemini.base_url' => 'https://generativelanguage.googleapis.com/v1beta',
            'services.gemini.api_revision' => '2026-05-20',
            'services.gemini.temperature' => 0.6,
            'services.gemini.top_p' => 0.95,
            'services.gemini.max_output_tokens' => 500,
            'services.gemini.thinking_level' => 'low',
            'services.gemini.seed' => null,
            'services.gemini.store' => false,
        ]);
    }

    /** Carbon's ISO-8601 rendering of an instant, as the API returns it. */
    private function iso(string $moment): string
    {
        return Carbon::parse($moment)->toIso8601String();
    }

    /** A completed Interaction whose final step carries the given text. */
    private function interaction(string $text): array
    {
        return [
            'id' => 'int_123',
            'object' => 'interaction',
            'status' => 'completed',
            'steps' => [
                ['type' => 'model_output', 'content' => [['type' => 'text', 'text' => $text]]],
            ],
        ];
    }

    private function fakeReply(string $text): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response($this->interaction($text)),
        ]);
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->getJson('/api/side-tasks')->assertStatus(401);
        $this->postJson('/api/side-tasks', ['title' => 'x', 'estimate_minutes' => 30])->assertStatus(401);
        $this->postJson('/api/side-tasks/plan', ['context' => []])->assertStatus(401);
        $this->putJson('/api/side-tasks/1', ['title' => 'x'])->assertStatus(401);
        $this->deleteJson('/api/side-tasks/1')->assertStatus(401);
    }

    public function test_index_returns_only_the_users_own_tasks(): void
    {
        SideTask::factory()->for($this->user)->create(['title' => 'Clean the room']);
        SideTask::factory()->create(['title' => 'Someone else task']);

        $this->getJson('/api/side-tasks')
            ->assertStatus(200)
            ->assertJsonCount(1)
            ->assertJsonPath('0.title', 'Clean the room')
            ->assertJsonMissing(['title' => 'Someone else task']);
    }

    public function test_store_creates_an_unplaced_task_and_defaults_to_blocking(): void
    {
        $this->postJson('/api/side-tasks', [
            'title' => 'Clean the room',
            'estimate_minutes' => 45,
        ])
            ->assertStatus(201)
            ->assertJsonPath('title', 'Clean the room')
            ->assertJsonPath('estimateMinutes', 45)
            ->assertJsonPath('blocksWork', true)
            ->assertJsonPath('start', null)
            ->assertJsonPath('end', null)
            ->assertJsonPath('completedAt', null)
            ->assertJsonPath('done', false);

        $this->assertDatabaseHas('side_tasks', [
            'user_id' => $this->user->id,
            'title' => 'Clean the room',
            'estimate_minutes' => 45,
            'blocks_work' => true,
            'start' => null,
        ]);
    }

    public function test_store_places_the_task_and_derives_its_end_from_the_estimate(): void
    {
        $this->postJson('/api/side-tasks', [
            'title' => 'Attend class',
            'estimate_minutes' => 90,
            'start' => '2026-10-20T17:00:00.000000Z',
            'blocks_work' => false,
        ])
            ->assertStatus(201)
            ->assertJsonPath('blocksWork', false)
            ->assertJsonPath('start', $this->iso('2026-10-20T17:00:00Z'))
            ->assertJsonPath('end', $this->iso('2026-10-20T18:30:00Z'));
    }

    public function test_store_ignores_a_client_supplied_end(): void
    {
        $this->postJson('/api/side-tasks', [
            'title' => 'Attend class',
            'estimate_minutes' => 60,
            'start' => '2026-10-20T17:00:00.000000Z',
            // A client trying to disagree with the estimate.
            'end' => '2026-10-20T23:30:00.000000Z',
        ])
            ->assertStatus(201)
            ->assertJsonPath('end', $this->iso('2026-10-20T18:00:00Z'));
    }

    public function test_store_validates_its_input(): void
    {
        $this->postJson('/api/side-tasks', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['title', 'estimate_minutes']);

        $this->postJson('/api/side-tasks', ['title' => 'x', 'estimate_minutes' => 0])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['estimate_minutes']);

        $this->postJson('/api/side-tasks', ['title' => 'x', 'estimate_minutes' => 2000])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['estimate_minutes']);
    }

    public function test_update_moves_a_task_and_keeps_the_end_in_sync(): void
    {
        $task = SideTask::factory()->for($this->user)
            ->scheduled(Carbon::parse('2026-10-20T09:00:00Z'), 30)
            ->create();

        $this->putJson("/api/side-tasks/{$task->id}", [
            'start' => '2026-10-21T14:00:00.000000Z',
        ])
            ->assertStatus(200)
            ->assertJsonPath('start', $this->iso('2026-10-21T14:00:00Z'))
            ->assertJsonPath('end', $this->iso('2026-10-21T14:30:00Z'));
    }

    public function test_update_reschedules_a_task_back_into_the_todo_list(): void
    {
        $task = SideTask::factory()->for($this->user)->scheduled()->create();

        $this->putJson("/api/side-tasks/{$task->id}", ['start' => null])
            ->assertStatus(200)
            ->assertJsonPath('start', null)
            ->assertJsonPath('end', null);
    }

    public function test_update_changing_the_estimate_shifts_a_placed_tasks_end(): void
    {
        $task = SideTask::factory()->for($this->user)
            ->scheduled(Carbon::parse('2026-10-20T09:00:00Z'), 30)
            ->create();

        $this->putJson("/api/side-tasks/{$task->id}", ['estimate_minutes' => 90])
            ->assertStatus(200)
            ->assertJsonPath('estimateMinutes', 90)
            ->assertJsonPath('end', $this->iso('2026-10-20T10:30:00Z'));
    }

    public function test_manual_completion_records_now_and_shortens_the_slot(): void
    {
        Carbon::setTestNow('2026-10-20T09:20:00Z');

        $task = SideTask::factory()->for($this->user)
            ->scheduled(Carbon::parse('2026-10-20T09:00:00Z'), 60)
            ->create();

        $this->putJson("/api/side-tasks/{$task->id}", ['completed' => true])
            ->assertStatus(200)
            ->assertJsonPath('completedAt', $this->iso('2026-10-20T09:20:00Z'))
            // The block shrinks to the moment it actually finished…
            ->assertJsonPath('end', $this->iso('2026-10-20T09:20:00Z'))
            ->assertJsonPath('done', true);

        // …while the planned slot itself is kept, so undo can restore it exactly.
        $this->assertDatabaseHas('side_tasks', [
            'id' => $task->id,
            'start' => '2026-10-20 09:00:00',
            'end' => '2026-10-20 10:00:00',
        ]);
    }

    public function test_manual_completion_can_be_undone(): void
    {
        Carbon::setTestNow('2026-10-20T09:20:00Z');

        $task = SideTask::factory()->for($this->user)
            ->scheduled(Carbon::parse('2026-10-20T09:00:00Z'), 60)
            ->create();

        $this->putJson("/api/side-tasks/{$task->id}", ['completed' => true])->assertStatus(200);

        $this->putJson("/api/side-tasks/{$task->id}", ['completed' => false])
            ->assertStatus(200)
            ->assertJsonPath('completedAt', null)
            ->assertJsonPath('end', $this->iso('2026-10-20T10:00:00Z'))
            ->assertJsonPath('done', false);
    }

    public function test_completing_an_unplaced_task_does_not_place_it(): void
    {
        $task = SideTask::factory()->for($this->user)->create();

        $this->putJson("/api/side-tasks/{$task->id}", ['completed' => true])
            ->assertStatus(200)
            ->assertJsonPath('start', null)
            ->assertJsonPath('end', null)
            ->assertJsonPath('done', true);
    }

    public function test_moving_a_completed_task_makes_it_live_again(): void
    {
        $task = SideTask::factory()->for($this->user)->scheduled()->done()->create();

        $this->putJson("/api/side-tasks/{$task->id}", ['start' => '2026-10-25T09:00:00.000000Z'])
            ->assertStatus(200)
            ->assertJsonPath('completedAt', null)
            ->assertJsonPath('done', false);
    }

    public function test_blocks_work_can_be_toggled(): void
    {
        $task = SideTask::factory()->for($this->user)->create(['blocks_work' => true]);

        $this->putJson("/api/side-tasks/{$task->id}", ['blocks_work' => false])
            ->assertStatus(200)
            ->assertJsonPath('blocksWork', false);
    }

    public function test_a_task_whose_slot_has_passed_is_done(): void
    {
        Carbon::setTestNow('2026-10-20T11:00:00Z');

        SideTask::factory()->for($this->user)
            ->scheduled(Carbon::parse('2026-10-20T09:00:00Z'), 60)
            ->create();

        $this->getJson('/api/side-tasks')
            ->assertStatus(200)
            ->assertJsonPath('0.done', true)
            ->assertJsonPath('0.completedAt', null);
    }

    public function test_update_and_destroy_reject_another_users_task(): void
    {
        $foreign = SideTask::factory()->create();

        $this->putJson("/api/side-tasks/{$foreign->id}", ['title' => 'hijack'])->assertStatus(404);
        $this->deleteJson("/api/side-tasks/{$foreign->id}")->assertStatus(404);

        $this->assertDatabaseHas('side_tasks', ['id' => $foreign->id, 'title' => $foreign->title]);
    }

    public function test_destroy_removes_the_task(): void
    {
        $task = SideTask::factory()->for($this->user)->create();

        $this->deleteJson("/api/side-tasks/{$task->id}")->assertStatus(204);

        $this->assertDatabaseMissing('side_tasks', ['id' => $task->id]);
    }

    public function test_plan_reports_unavailable_when_not_configured(): void
    {
        config(['services.gemini.key' => null]);

        Http::fake();

        $this->postJson('/api/side-tasks/plan', ['context' => []])
            ->assertStatus(503)
            ->assertJson(['available' => false]);

        Http::assertNothingSent();
    }

    public function test_plan_short_circuits_when_nothing_needs_placing(): void
    {
        SideTask::factory()->for($this->user)->scheduled()->create();
        SideTask::factory()->for($this->user)->done()->create();

        Http::fake();

        $this->postJson('/api/side-tasks/plan', ['context' => ['now' => '2026-10-14T12:00:00.000Z']])
            ->assertStatus(200)
            ->assertJsonPath('available', true)
            ->assertJsonPath('suggestions', []);

        Http::assertNothingSent();
    }

    public function test_plan_asks_gemini_about_the_unplaced_tasks_and_returns_suggestions(): void
    {
        $todo = SideTask::factory()->for($this->user)->create([
            'title' => 'Clean the room',
            'estimate_minutes' => 45,
            'blocks_work' => false,
        ]);
        // Neither of these is a placement candidate.
        SideTask::factory()->for($this->user)->scheduled()->create(['title' => 'Already placed']);
        SideTask::factory()->for($this->user)->done()->create(['title' => 'Already done']);

        $this->fakeReply(
            'Tuesday evening is still free. [[PLAN:'.$todo->id.'|2026-10-20 17:00]]'.PHP_EOL
            .'Wednesday morning works too.',
        );

        $this->postJson('/api/side-tasks/plan', [
            'context' => ['now' => '2026-10-14T12:00:00.000Z', 'timeZone' => 'Europe/Berlin'],
        ])
            ->assertStatus(200)
            ->assertJsonPath('available', true)
            ->assertJsonPath('suggestions.0.taskId', $todo->id)
            ->assertJsonPath('suggestions.0.start', '2026-10-20T17:00')
            ->assertJsonPath('suggestions.0.reason', 'Tuesday evening is still free.')
            // The marker never reaches the user's eyes.
            ->assertJsonPath('reply', "Tuesday evening is still free.\nWednesday morning works too.");

        Http::assertSent(function ($request) use ($todo) {
            return str_contains($request->url(), 'interactions')
                && str_contains($request['system_instruction'], 'Current snapshot:')
                && str_contains($request['system_instruction'], 'Europe/Berlin')
                && str_contains($request['input'], 'Unscheduled tasks to place')
                && str_contains($request['input'], '"title": "Clean the room"')
                && str_contains($request['input'], '"estimateMinutes": 45')
                && str_contains($request['input'], '"id": '.$todo->id)
                // Only the unplaced task is a candidate.
                && ! str_contains($request['input'], 'Already placed')
                && ! str_contains($request['input'], 'Already done');
        });
    }

    public function test_plan_returns_502_when_gemini_fails(): void
    {
        SideTask::factory()->for($this->user)->create();

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response(['error' => ['message' => 'boom']], 500),
        ]);

        $this->postJson('/api/side-tasks/plan', ['context' => ['now' => '2026-10-14T12:00:00.000Z']])
            ->assertStatus(502)
            ->assertJson(['available' => true]);
    }

    public function test_plan_validates_its_payload(): void
    {
        Http::fake();

        $this->postJson('/api/side-tasks/plan', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['context']);

        Http::assertNothingSent();
    }
}
