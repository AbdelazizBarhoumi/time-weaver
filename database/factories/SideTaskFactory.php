<?php

namespace Database\Factories;

use App\Models\SideTask;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<SideTask>
 */
class SideTaskFactory extends Factory
{
    protected $model = SideTask::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => ucfirst(fake()->words(3, true)),
            'estimate_minutes' => fake()->randomElement([15, 30, 45, 60, 90]),
            'start' => null,
            'end' => null,
            'completed_at' => null,
            'blocks_work' => true,
        ];
    }

    /** A task placed on the calendar, running from `$start` for its estimate. */
    public function scheduled(?Carbon $start = null, ?int $minutes = null): static
    {
        return $this->state(function (array $attributes) use ($start, $minutes) {
            $minutes ??= (int) ($attributes['estimate_minutes'] ?? 30);
            $start ??= now()->addDay()->setTime(17, 0);

            return [
                'estimate_minutes' => $minutes,
                'start' => $start,
                'end' => $start->copy()->addMinutes($minutes),
            ];
        });
    }

    /** A task already finished at `$completedAt`. */
    public function done(?Carbon $completedAt = null): static
    {
        return $this->state(fn () => [
            'completed_at' => $completedAt ?? now()->subHour(),
        ]);
    }
}
