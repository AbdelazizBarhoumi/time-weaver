<?php

namespace Tests\Feature;

use App\Models\CalendarSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class WorkDaysStatsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @param  array<int, int>  $days
     */
    private function countWeekdaysInCurrentMonth(array $days): int
    {
        $now = Carbon::now();
        $count = 0;

        for ($d = $now->copy()->startOfMonth(); $d->lte($now->copy()->endOfMonth()); $d->addDay()) {
            if (in_array($d->dayOfWeek, $days, true)) {
                $count++;
            }
        }

        return $count;
    }

    public function test_monthly_target_uses_required_days(): void
    {
        $user = User::factory()->create();
        CalendarSetting::factory()->create([
            'user_id' => $user->id,
            // Workable every day, but only Saturday is required.
            'work_days' => [0, 1, 2, 3, 4, 5, 6],
            'required_days' => [6],
        ]);

        $this->actingAs($user);

        $response = $this->getJson('/api/sessions/monthly?count=1')->assertStatus(200);

        $this->assertSame($this->countWeekdaysInCurrentMonth([6]) * 8, $response->json('0.targetHours'));
    }

    public function test_monthly_target_ignores_workable_but_not_required_days(): void
    {
        $user = User::factory()->create();
        CalendarSetting::factory()->create([
            'user_id' => $user->id,
            // Weekends can be worked, but they are not required.
            'work_days' => [0, 1, 2, 3, 4, 5, 6],
            'required_days' => [1, 2, 3, 4, 5],
        ]);

        $this->actingAs($user);

        $response = $this->getJson('/api/sessions/monthly?count=1')->assertStatus(200);

        $this->assertSame(
            $this->countWeekdaysInCurrentMonth([1, 2, 3, 4, 5]) * 8,
            $response->json('0.targetHours'),
        );
    }

    public function test_defaults_to_weekdays_when_no_setting_exists(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $response = $this->getJson('/api/sessions/monthly?count=1')->assertStatus(200);

        $this->assertSame($this->countWeekdaysInCurrentMonth([1, 2, 3, 4, 5]) * 8, $response->json('0.targetHours'));
    }
}
