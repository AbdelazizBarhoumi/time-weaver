<?php

namespace Database\Factories;

use App\Models\CalendarAccount;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CalendarAccount>
 */
class CalendarAccountFactory extends Factory
{
    protected $model = CalendarAccount::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'provider' => 'google',
            'email' => fake()->unique()->safeEmail(),
            'color' => '#5b9cff',
            'access_token' => 'fake-access-token',
            'refresh_token' => 'fake-refresh-token',
            'expires_at' => now()->addHour(),
        ];
    }
}
