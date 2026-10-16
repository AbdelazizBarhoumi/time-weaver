<?php

namespace Database\Factories;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CalendarEvent>
 */
class CalendarEventFactory extends Factory
{
    protected $model = CalendarEvent::class;

    public function definition(): array
    {
        $start = fake()->dateTimeBetween('-1 week', '+1 week');

        return [
            'calendar_account_id' => CalendarAccount::factory(),
            'user_id' => fn (array $attributes) => CalendarAccount::find($attributes['calendar_account_id'])->user_id,
            'account_email' => fn (array $attributes) => CalendarAccount::find($attributes['calendar_account_id'])->email,
            'color' => '#5b9cff',
            'event_id' => 'evt-'.fake()->unique()->numerify('######'),
            'recurring_event_id' => null,
            'calendar_id' => 'primary',
            'calendar_name' => 'Primary',
            'title' => fake()->sentence(3),
            'start' => $start,
            'end' => (clone $start)->modify('+1 hour'),
            'all_day' => false,
            'event_color' => null,
            'synced_at' => now(),
        ];
    }
}
