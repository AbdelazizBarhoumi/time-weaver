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

    public function test_monthly_target_uses_configured_working_days(): void
    {
        $user = User::factory()->create();
        CalendarSetting::factory()->create([
            'user_id' => $user->id,
            // Saturday only.
            'work_days' => [6],
        ]);

        $this->actingAs($user);

        $response = $this->getJson('/api/sessions/monthly?count=1');

        $response->assertStatus(200);

        $now = Carbon::now();
        $saturdays = 0;
        for ($d = $now->copy()->startOfMonth(); $d->lte($now->copy()->endOfMonth()); $d->addDay()) {
            if ($d->dayOfWeek === 6) {
                $saturdays++;
            }
        }

        $this->assertSame($saturdays * 8, $response->json('0.targetHours'));
    }

    public function test_defaults_to_weekdays_when_no_setting_exists(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $response = $this->getJson('/api/sessions/monthly?count=1')->assertStatus(200);

        $now = Carbon::now();
        $weekdays = 0;
        for ($d = $now->copy()->startOfMonth(); $d->lte($now->copy()->endOfMonth()); $d->addDay()) {
            if ($d->dayOfWeek >= 1 && $d->dayOfWeek <= 5) {
                $weekdays++;
            }
        }

        $this->assertSame($weekdays * 8, $response->json('0.targetHours'));
    }
}
