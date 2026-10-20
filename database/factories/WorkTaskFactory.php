<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\WorkTask;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<WorkTask>
 */
class WorkTaskFactory extends Factory
{
    protected $model = WorkTask::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => ucfirst(fake()->words(3, true)),
            'estimate_minutes' => fake()->randomElement([15, 30, 45, 60, 90]),
            'started_at' => null,
            'completed_at' => null,
            'due_at' => null,
            'position' => 0,
            'notes' => null,
        ];
    }

    /** A task the user has already started tracking time against. */
    public function started(?Carbon $startedAt = null): static
    {
        return $this->state(fn () => [
            'started_at' => $startedAt ?? now()->subHour(),
        ]);
    }

    /** A task finished by hand at `$completedAt` — it stays in the list forever. */
    public function done(?Carbon $completedAt = null): static
    {
        return $this->state(fn () => [
            'completed_at' => $completedAt ?? now()->subHour(),
        ]);
    }

    /** A task with a deadline in the past — derived status stays whatever it was, but overdue flags. */
    public function overdue(?Carbon $dueAt = null): static
    {
        return $this->state(fn () => [
            'due_at' => $dueAt ?? now()->subDay(),
        ]);
    }
}
