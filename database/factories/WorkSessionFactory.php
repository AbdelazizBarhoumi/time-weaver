<?php

namespace Database\Factories;

use App\Models\WorkSession;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<WorkSession>
 */
class WorkSessionFactory extends Factory
{
    protected $model = WorkSession::class;

    public function definition(): array
    {
        $daysAgo = $this->faker->numberBetween(1, 70);
        $date = Carbon::now()->subDays($daysAgo);

        // Skip Sundays and some Saturdays
        if ($date->isSunday()) {
            return $this->definition();
        }
        if ($date->isSaturday() && $this->faker->boolean(70)) {
            return $this->definition();
        }
        if ($this->faker->boolean(12)) {
            return $this->definition();
        }

        $startHour = 8 + $this->faker->numberBetween(0, 2);
        $startMinute = $this->faker->numberBetween(0, 59);
        $start = $date->copy()->setTime($startHour, $startMinute);

        $remainingHours = 5.5 + $this->faker->randomFloat(1, 0, 4);
        $sessions = [];

        while ($remainingHours > 0.4) {
            $chunk = min($remainingHours, 1 + $this->faker->randomFloat(1, 0, 2.5));
            $end = $start->copy()->addMinutes($chunk * 60);

            $sessions[] = [
                'start' => $start,
                'end' => $end,
                'note' => '',
                'paused_ms' => 0,
                'paused_at' => null,
            ];

            $remainingHours -= $chunk;
            $start = $end->copy()->addMinutes((0.5 + $this->faker->randomFloat(1, 0, 2.5)) * 60);

            if ($start->day !== $date->day) {
                break;
            }
        }

        // Return first session, others will be created separately
        $session = $sessions[0] ?? [
            'start' => $start,
            'end' => $start->copy()->addHours(8),
            'note' => '',
            'paused_ms' => 0,
            'paused_at' => null,
        ];

        return [
            'start' => $session['start'],
            'end' => $session['end'],
            'note' => $session['note'],
            'paused_ms' => $session['paused_ms'],
            'paused_at' => $session['paused_at'],
        ];
    }

    public function active(): static
    {
        return $this->state(fn (array $attributes) => [
            'end' => null,
            'paused_at' => null,
            'paused_ms' => 0,
        ]);
    }

    public function study(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'study',
        ]);
    }

    public function paused(): static
    {
        return $this->state(fn (array $attributes) => [
            'end' => null,
            'paused_at' => now(),
            'paused_ms' => $this->faker->numberBetween(0, 3600000),
        ]);
    }
}
