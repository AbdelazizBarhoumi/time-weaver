<?php

namespace Database\Factories;

use App\Models\CalendarAccount;
use App\Models\CalendarEventOverride;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<CalendarEventOverride>
 */
class CalendarEventOverrideFactory extends Factory
{
    protected $model = CalendarEventOverride::class;

    public function definition(): array
    {
        $start = Carbon::parse('2026-10-17 09:00:00', 'UTC');

        return [
            'calendar_account_id' => CalendarAccount::factory(),
            'user_id' => fn (array $attributes) => CalendarAccount::find($attributes['calendar_account_id'])->user_id,
            'event_id' => 'evt-'.fake()->unique()->numerify('######'),
            'recurring_event_id' => null,
            'start' => $start,
            'end' => $start->copy()->addHour(),
        ];
    }
}
