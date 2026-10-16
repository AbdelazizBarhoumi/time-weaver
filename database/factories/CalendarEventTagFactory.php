<?php

namespace Database\Factories;

use App\Models\CalendarAccount;
use App\Models\CalendarEventTag;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CalendarEventTag>
 */
class CalendarEventTagFactory extends Factory
{
    protected $model = CalendarEventTag::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'calendar_account_id' => CalendarAccount::factory(),
            'event_id' => 'event-'.fake()->unique()->numerify('####'),
            'is_work' => true,
        ];
    }
}
