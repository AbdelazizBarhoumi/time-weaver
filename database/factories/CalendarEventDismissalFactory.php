<?php

namespace Database\Factories;

use App\Models\CalendarAccount;
use App\Models\CalendarEventDismissal;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CalendarEventDismissal>
 */
class CalendarEventDismissalFactory extends Factory
{
    protected $model = CalendarEventDismissal::class;

    public function definition(): array
    {
        return [
            'calendar_account_id' => CalendarAccount::factory(),
            'user_id' => fn (array $attributes) => CalendarAccount::find($attributes['calendar_account_id'])->user_id,
            'event_id' => 'evt-'.fake()->unique()->numerify('######'),
            'recurring_event_id' => null,
        ];
    }
}
