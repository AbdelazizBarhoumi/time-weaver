<?php

namespace Database\Factories;

use App\Models\CalendarSetting;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CalendarSetting>
 */
class CalendarSettingFactory extends Factory
{
    protected $model = CalendarSetting::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'work_start' => '06:00',
            'work_end' => '22:00',
            'work_keywords' => ['standup', 'client', 'sprint', 'review', 'sync'],
            'work_days' => CalendarSetting::DEFAULT_WORK_DAYS,
        ];
    }
}
