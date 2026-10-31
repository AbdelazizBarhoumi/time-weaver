<?php

namespace Tests\Feature;

use App\Models\CalendarSetting;
use App\Models\User;
use App\Models\UserDayOff;
use App\Models\WorkSession;
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

    public function test_monthly_breakdown_drops_excluded_days_and_reports_them(): void
    {
        $this->travelTo(Carbon::parse('2026-10-07 17:00:00')); // Wednesday

        $user = User::factory()->create();
        $this->actingAs($user);

        UserDayOff::create([
            'user_id' => $user->id,
            'date' => '2026-10-06', // Tuesday off
            'type' => 'excluded',
        ]);

        WorkSession::factory()->create([
            'user_id' => $user->id,
            'start' => Carbon::parse('2026-10-06 09:00:00'),
            'end' => Carbon::parse('2026-10-06 17:00:00'),
            'type' => 'work',
            'paused_ms' => 0,
        ]);

        $response = $this->getJson('/api/sessions/monthly?count=1')->assertStatus(200);

        // 22 October weekdays minus the excluded Tuesday → 21 × 8h target.
        $this->assertSame(21 * 8, $response->json('0.targetHours'));
        // Hours logged on an excluded day never count toward the month.
        $this->assertEquals(0, $response->json('0.doneHours'));
        $this->assertSame(1, $response->json('0.customDaysOff'));
    }

    public function test_monthly_breakdown_covers_the_current_month_and_the_eleven_before_it(): void
    {
        $this->travelTo(Carbon::parse('2026-10-07 17:00:00')); // Wednesday

        $user = User::factory()->create();
        $this->actingAs($user);

        $rows = $this->getJson('/api/sessions/monthly?count=12')->assertStatus(200)->json();

        $this->assertCount(12, $rows);
        $this->assertSame('2025-11', $rows[0]['key']);
        $this->assertSame('2026-10', $rows[11]['key']);
        $this->assertTrue($rows[11]['isCurrent']);
        $this->assertSame(1, collect($rows)->where('isCurrent', true)->count());
    }
}
