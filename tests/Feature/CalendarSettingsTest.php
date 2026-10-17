<?php

namespace Tests\Feature;

use App\Models\CalendarSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CalendarSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    public function test_settings_default_to_weekdays(): void
    {
        $response = $this->getJson('/api/calendar/settings');

        $response->assertStatus(200)
            ->assertJson([
                'workStart' => '06:00',
                'workEnd' => '22:00',
                'workDays' => [1, 2, 3, 4, 5],
                'requiredDays' => [1, 2, 3, 4, 5],
            ]);
    }

    public function test_can_update_working_days(): void
    {
        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
            'work_days' => [0, 1, 2, 3, 4],
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'workStart' => '08:00',
                'workEnd' => '18:00',
                'workDays' => [0, 1, 2, 3, 4],
                // The default required week is clipped to the new working week.
                'requiredDays' => [1, 2, 3, 4],
            ]);

        $this->assertDatabaseHas('calendar_settings', ['user_id' => $this->user->id]);
    }

    public function test_can_make_a_workable_day_optional(): void
    {
        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
            'work_days' => [0, 1, 2, 3, 4, 5, 6],
            'required_days' => [1, 2, 3, 4, 5],
        ]);

        $response->assertStatus(200)->assertJson([
            'workDays' => [0, 1, 2, 3, 4, 5, 6],
            'requiredDays' => [1, 2, 3, 4, 5],
        ]);
    }

    public function test_required_days_are_clipped_to_the_working_week(): void
    {
        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
            'work_days' => [1, 2, 3, 4, 5],
            'required_days' => [0, 1, 6],
        ]);

        // Sunday and Saturday are not workable, so they cannot be required.
        $response->assertStatus(200)->assertJson([
            'workDays' => [1, 2, 3, 4, 5],
            'requiredDays' => [1],
        ]);
    }

    public function test_working_days_are_sorted_and_deduplicated(): void
    {
        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
            'work_days' => [4, 1, 1, 3],
        ]);

        $response->assertStatus(200)->assertJson(['workDays' => [1, 3, 4], 'requiredDays' => [1, 3, 4]]);
    }

    public function test_rejects_out_of_range_working_day(): void
    {
        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
            'work_days' => [9],
        ]);

        $response->assertStatus(422)->assertJsonValidationErrors('work_days.0');
    }

    public function test_rejects_out_of_range_required_day(): void
    {
        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
            'required_days' => [9],
        ]);

        $response->assertStatus(422)->assertJsonValidationErrors('required_days.0');
    }

    public function test_omitting_working_days_keeps_existing(): void
    {
        CalendarSetting::factory()->create([
            'user_id' => $this->user->id,
            'work_days' => [0, 6],
            'required_days' => [0, 6],
        ]);

        $response = $this->putJson('/api/calendar/settings', [
            'work_start' => '08:00',
            'work_end' => '18:00',
        ]);

        $response->assertStatus(200)->assertJson(['workDays' => [0, 6], 'requiredDays' => [0, 6]]);
    }
}
