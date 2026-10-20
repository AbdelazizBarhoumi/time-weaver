<?php

namespace Database\Factories;

use App\Models\ReportPreset;
use App\Models\User;
use App\Services\ReportConfig;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ReportPreset>
 */
class ReportPresetFactory extends Factory
{
    protected $model = ReportPreset::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => fake()->unique()->words(3, true),
            'config' => [
                'template' => 'full',
                'sections' => ReportConfig::templateSections('full'),
                'filters' => [
                    'sessionTypes' => ['work', 'study'],
                ],
            ],
            'is_default' => false,
        ];
    }
}
