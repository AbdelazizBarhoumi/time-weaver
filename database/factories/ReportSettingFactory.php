<?php

namespace Database\Factories;

use App\Models\ReportSetting;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ReportSetting>
 */
class ReportSettingFactory extends Factory
{
    protected $model = ReportSetting::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'company_name' => fake()->company(),
            'prepared_by' => fake()->name(),
            'footer_text' => ReportSetting::DEFAULT_FOOTER,
            'accent_color' => ReportSetting::DEFAULT_ACCENT,
            'logo_path' => null,
        ];
    }
}
