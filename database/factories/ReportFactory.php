<?php

namespace Database\Factories;

use App\Models\Report;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<Report>
 */
class ReportFactory extends Factory
{
    protected $model = Report::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $from = Carbon::now()->startOfMonth();
        $to = Carbon::now()->endOfMonth();

        return [
            'user_id' => User::factory(),
            'report_preset_id' => null,
            'title' => 'Time & Work Report',
            'file_name' => 'time-work-report.pdf',
            'file_path' => 'reports/test/time-work-report.pdf',
            'file_size' => 4096,
            'format' => 'pdf',
            'period_from' => $from->toDateString(),
            'period_to' => $to->toDateString(),
            'config' => [
                'timezone' => 'UTC',
                'from' => $from->toDateString(),
                'to' => $to->toDateString(),
                'sections' => ['summary'],
            ],
            'generated_at' => now(),
        ];
    }
}
