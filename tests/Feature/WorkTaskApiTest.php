<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkSession;
use App\Models\WorkTask;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class WorkTaskApiTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    /** A finished session logged against a task, lasting `$minutes`. */
    private function trackedSession(WorkTask $task, int $minutes, string $startedAt = '-2 hours'): WorkSession
    {
        $start = Carbon::parse($startedAt);

        return WorkSession::factory()->create([
            'user_id' => $task->user_id,
            'work_task_id' => $task->id,
            'start' => $start,
            'end' => $start->copy()->addMinutes($minutes),
        ]);
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->getJson('/api/work-tasks')->assertStatus(401);
        $this->postJson('/api/work-tasks', ['title' => 'x', 'estimate_minutes' => 30])->assertStatus(401);
        $this->postJson('/api/work-tasks/1/start')->assertStatus(401);
        $this->putJson('/api/work-tasks/1', ['title' => 'x'])->assertStatus(401);
        $this->deleteJson('/api/work-tasks/1')->assertStatus(401);
    }

    public function test_index_returns_only_the_users_tasks(): void
    {
        $mine = WorkTask::factory()->for($this->user)->create(['title' => 'Mine']);
        WorkTask::factory()->create(['title' => 'Theirs']);

        $response = $this->getJson('/api/work-tasks')->assertOk();

        $this->assertCount(1, $response->json());
        $this->assertSame($mine->id, $response->json('0.id'));
        $this->assertSame('Mine', $response->json('0.title'));
    }

    public function test_index_keeps_finished_tasks_with_their_status(): void
    {
        WorkTask::factory()->for($this->user)->create(['title' => 'Open']);
        WorkTask::factory()->for($this->user)->done()->create(['title' => 'Finished']);

        $tasks = collect($this->getJson('/api/work-tasks')->assertOk()->json());

        $this->assertCount(2, $tasks, 'A completed task must never disappear from the list.');
        $this->assertSame('done', $tasks->firstWhere('title', 'Finished')['status']);
        $this->assertTrue($tasks->firstWhere('title', 'Finished')['done']);
        $this->assertNotNull($tasks->firstWhere('title', 'Finished')['completedAt']);
        $this->assertSame('todo', $tasks->firstWhere('title', 'Open')['status']);
    }

    public function test_store_creates_a_todo_task_with_defaults(): void
    {
        $response = $this->postJson('/api/work-tasks', [
            'title' => '  Write the report  ',
            'estimate_minutes' => 45,
        ])->assertStatus(201);

        $response->assertJson([
            'title' => 'Write the report',
            'estimateMinutes' => 45,
            'status' => 'todo',
            'done' => false,
            'overdue' => false,
            'trackedMs' => 0,
            'activeSessionId' => null,
        ]);

        $this->assertNull($response->json('startedAt'));
        $this->assertNull($response->json('completedAt'));
        $this->assertDatabaseHas('work_tasks', [
            'user_id' => $this->user->id,
            'title' => 'Write the report',
            'estimate_minutes' => 45,
        ]);
    }

    public function test_store_accepts_a_deadline_and_notes(): void
    {
        $due = now()->addDays(3)->startOfHour();

        $this->postJson('/api/work-tasks', [
            'title' => 'Ship it',
            'estimate_minutes' => 60,
            'due_at' => $due->toIso8601String(),
            'notes' => 'Coordinate with the team.',
        ])
            ->assertStatus(201)
            ->assertJson([
                'dueAt' => $due->toIso8601String(),
                'notes' => 'Coordinate with the team.',
            ]);
    }

    public function test_store_validates_the_payload(): void
    {
        $this->postJson('/api/work-tasks', [])->assertStatus(422)->assertJsonValidationErrors(['title', 'estimate_minutes']);
        $this->postJson('/api/work-tasks', ['title' => 'x', 'estimate_minutes' => 0])->assertStatus(422)->assertJsonValidationErrors('estimate_minutes');
        $this->postJson('/api/work-tasks', ['title' => 'x', 'estimate_minutes' => 2000])->assertStatus(422)->assertJsonValidationErrors('estimate_minutes');
    }

    public function test_new_tasks_are_appended_to_the_end_of_the_list(): void
    {
        $first = $this->postJson('/api/work-tasks', ['title' => 'First', 'estimate_minutes' => 30])->json();
        $second = $this->postJson('/api/work-tasks', ['title' => 'Second', 'estimate_minutes' => 30])->json();

        $this->assertGreaterThan($first['position'], $second['position']);
    }

    public function test_update_changes_title_estimate_deadline_and_position(): void
    {
        $task = WorkTask::factory()->for($this->user)->create(['title' => 'Old', 'estimate_minutes' => 30]);
        $due = now()->addDay()->startOfHour();

        $this->putJson("/api/work-tasks/{$task->id}", [
            'title' => 'New',
            'estimate_minutes' => 90,
            'due_at' => $due->toIso8601String(),
            'notes' => null,
            'position' => 7,
        ])
            ->assertOk()
            ->assertJson([
                'title' => 'New',
                'estimateMinutes' => 90,
                'dueAt' => $due->toIso8601String(),
                'notes' => null,
                'position' => 7,
            ]);
    }

    public function test_completing_a_task_records_the_time_and_keeps_the_row(): void
    {
        $task = WorkTask::factory()->for($this->user)->started()->create();

        $this->putJson("/api/work-tasks/{$task->id}", ['completed' => true])
            ->assertOk()
            ->assertJson(['status' => 'done', 'done' => true]);

        $this->assertDatabaseHas('work_tasks', ['id' => $task->id]);
        $this->assertNotNull($task->fresh()->completed_at);

        // Undo puts it back exactly where it was — it is never deleted.
        $this->putJson("/api/work-tasks/{$task->id}", ['completed' => false])
            ->assertOk()
            ->assertJson(['status' => 'in_progress', 'done' => false]);

        $this->assertNull($task->fresh()->completed_at);
        $this->assertDatabaseCount('work_tasks', 1);
    }

    public function test_start_marks_the_task_in_progress_and_is_idempotent(): void
    {
        $task = WorkTask::factory()->for($this->user)->create();

        $this->postJson("/api/work-tasks/{$task->id}/start")
            ->assertOk()
            ->assertJson(['status' => 'in_progress']);

        $startedAt = $task->fresh()->started_at;
        $this->assertNotNull($startedAt);

        // Starting again must not move the original start time.
        $this->postJson("/api/work-tasks/{$task->id}/start")->assertOk();
        $this->assertTrue($startedAt->equalTo($task->fresh()->started_at));
    }

    public function test_deadline_in_the_past_flags_the_task_overdue(): void
    {
        $task = WorkTask::factory()->for($this->user)->overdue()->create();
        $done = WorkTask::factory()->for($this->user)->overdue()->done()->create();

        $tasks = collect($this->getJson('/api/work-tasks')->json());

        $this->assertTrue($tasks->firstWhere('id', $task->id)['overdue']);
        $this->assertFalse($tasks->firstWhere('id', $done->id)['overdue'], 'A finished task is never overdue.');
    }

    public function test_tracked_time_sums_every_linked_session(): void
    {
        $task = WorkTask::factory()->for($this->user)->create();
        $this->trackedSession($task, 25);
        $this->trackedSession($task, 35, '-1 hour');

        $payload = collect($this->getJson('/api/work-tasks')->json())->firstWhere('id', $task->id);

        $this->assertSame(60 * 60_000, $payload['trackedMs']);
        $this->assertSame('in_progress', $payload['status']);
    }

    public function test_an_open_session_makes_the_task_active(): void
    {
        $task = WorkTask::factory()->for($this->user)->create();
        $open = WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'work_task_id' => $task->id,
            'start' => now()->subMinutes(10),
            'end' => null,
        ]);

        $payload = collect($this->getJson('/api/work-tasks')->json())->firstWhere('id', $task->id);

        $this->assertSame('active', $payload['status']);
        $this->assertSame($open->id, $payload['activeSessionId']);
        $this->assertGreaterThan(0, $payload['trackedMs']);
    }

    public function test_logging_a_session_against_a_task_marks_it_started(): void
    {
        $task = WorkTask::factory()->for($this->user)->create();

        $this->postJson('/api/sessions', [
            'start' => now()->subMinutes(5)->toIso8601String(),
            'work_task_id' => $task->id,
        ])
            ->assertStatus(201)
            ->assertJson(['workTaskId' => $task->id]);

        $this->assertNotNull($task->fresh()->started_at);
    }

    public function test_a_session_cannot_link_another_users_task(): void
    {
        $foreign = WorkTask::factory()->create();

        $this->postJson('/api/sessions', [
            'start' => now()->toIso8601String(),
            'work_task_id' => $foreign->id,
        ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('work_task_id');
    }

    public function test_sessions_can_be_unlinked_from_a_task(): void
    {
        $task = WorkTask::factory()->for($this->user)->create();
        $session = $this->trackedSession($task, 30);

        $this->putJson("/api/sessions/{$session->id}", ['work_task_id' => null])
            ->assertOk()
            ->assertJson(['workTaskId' => null]);

        $this->assertNull($session->fresh()->work_task_id);
    }

    public function test_other_users_tasks_are_not_found(): void
    {
        $foreign = WorkTask::factory()->create();

        $this->putJson("/api/work-tasks/{$foreign->id}", ['title' => 'hijack'])->assertStatus(404);
        $this->postJson("/api/work-tasks/{$foreign->id}/start")->assertStatus(404);
        $this->deleteJson("/api/work-tasks/{$foreign->id}")->assertStatus(404);
    }

    public function test_destroy_removes_the_task_but_keeps_its_tracked_time(): void
    {
        $task = WorkTask::factory()->for($this->user)->create();
        $session = $this->trackedSession($task, 30);

        $this->deleteJson("/api/work-tasks/{$task->id}")->assertStatus(204);

        $this->assertDatabaseMissing('work_tasks', ['id' => $task->id]);
        $this->assertDatabaseHas('work_sessions', ['id' => $session->id]);
        $this->assertNull($session->fresh()->work_task_id);
    }
}
