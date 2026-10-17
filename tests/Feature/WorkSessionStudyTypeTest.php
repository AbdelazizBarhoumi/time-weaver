<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class WorkSessionStudyTypeTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    public function test_sessions_default_to_the_work_type(): void
    {
        $response = $this->postJson('/api/sessions', [
            'start' => now()->toISOString(),
            'note' => 'Plain work session',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('type', 'work');

        $this->assertDatabaseHas('work_sessions', [
            'user_id' => $this->user->id,
            'note' => 'Plain work session',
            'type' => 'work',
        ]);
    }

    public function test_can_create_a_study_session(): void
    {
        $response = $this->postJson('/api/sessions', [
            'start' => now()->subHour()->toISOString(),
            'end' => now()->toISOString(),
            'note' => 'Studying Laravel',
            'type' => 'study',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('type', 'study')
            ->assertJsonPath('note', 'Studying Laravel');

        $this->assertDatabaseHas('work_sessions', [
            'user_id' => $this->user->id,
            'note' => 'Studying Laravel',
            'type' => 'study',
        ]);
    }

    public function test_invalid_session_type_is_rejected(): void
    {
        $this->postJson('/api/sessions', [
            'start' => now()->toISOString(),
            'type' => 'bogus',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['type']);
    }

    public function test_updating_a_session_without_a_type_preserves_it(): void
    {
        $session = WorkSession::factory()->study()->create(['user_id' => $this->user->id]);

        $this->putJson("/api/sessions/{$session->id}", [
            'note' => 'Renamed study block',
        ])->assertStatus(200)
            ->assertJsonPath('type', 'study');

        $this->assertDatabaseHas('work_sessions', [
            'id' => $session->id,
            'note' => 'Renamed study block',
            'type' => 'study',
        ]);
    }

    public function test_session_type_can_be_changed(): void
    {
        $session = WorkSession::factory()->create(['user_id' => $this->user->id]);

        $this->putJson("/api/sessions/{$session->id}", [
            'type' => 'study',
        ])->assertStatus(200)
            ->assertJsonPath('type', 'study');
    }

    public function test_study_sessions_are_listed_and_tagged(): void
    {
        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => now()->setTime(9, 0),
            'end' => now()->setTime(11, 0),
        ]);

        $this->getJson('/api/sessions/today')
            ->assertStatus(200)
            ->assertJsonPath('0.type', 'study');

        $this->getJson('/api/sessions')
            ->assertStatus(200)
            ->assertJsonPath('data.0.type', 'study');
    }

    public function test_stats_ignore_study_sessions(): void
    {
        $this->travelTo(Carbon::parse('2026-10-07 17:00:00')); // Wednesday

        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-05 09:00:00'),
            'end' => Carbon::parse('2026-10-05 17:00:00'), // 8h of study on Monday
        ]);
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-06 09:00:00'),
            'end' => Carbon::parse('2026-10-06 17:00:00'), // 8h of work on Tuesday
        ]);

        $response = $this->getJson('/api/sessions/stats');

        // Only the work session counts: Tue 8h, streak 1, and the Monday study
        // day never joins the backlog window (first *work* session is Tuesday).
        $response->assertStatus(200)
            ->assertJsonPath('weekHours', 8)
            ->assertJsonPath('bestDayHours', 8)
            ->assertJsonPath('totalHours', 8)
            ->assertJsonPath('streak', 1)
            ->assertJsonPath('backlogHours', 8);
    }

    public function test_stats_report_study_hours_separately(): void
    {
        $this->travelTo(Carbon::parse('2026-10-07 17:00:00')); // Wednesday

        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-05 09:00:00'),
            'end' => Carbon::parse('2026-10-05 17:00:00'), // 8h study Monday
        ]);
        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-06 09:00:00'),
            'end' => Carbon::parse('2026-10-06 11:00:00'), // 2h study Tuesday
        ]);
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-06 12:00:00'),
            'end' => Carbon::parse('2026-10-06 16:00:00'), // 4h work Tuesday
        ]);

        $this->getJson('/api/sessions/stats')
            ->assertStatus(200)
            ->assertJsonPath('studyWeekHours', 10)
            ->assertJsonPath('studyTotalHours', 10)
            ->assertJsonPath('studyBestDayHours', 8)
            // The work stats stay untouched by study.
            ->assertJsonPath('weekHours', 4)
            ->assertJsonPath('totalHours', 4)
            ->assertJsonPath('bestDayHours', 4);
    }

    public function test_study_hours_skip_excluded_day_offs(): void
    {
        $this->travelTo(Carbon::parse('2026-10-07 17:00:00')); // Wednesday

        $this->postJson('/api/day-offs', ['date' => '2026-10-05', 'type' => 'excluded'])->assertStatus(201);

        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-05 09:00:00'),
            'end' => Carbon::parse('2026-10-05 17:00:00'), // 8h study on an excluded day
        ]);
        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-06 09:00:00'),
            'end' => Carbon::parse('2026-10-06 11:00:00'), // 2h study Tuesday
        ]);

        $this->getJson('/api/sessions/stats')
            ->assertStatus(200)
            ->assertJsonPath('studyWeekHours', 2)
            ->assertJsonPath('studyTotalHours', 2)
            ->assertJsonPath('studyBestDayHours', 2);
    }

    public function test_monthly_breakdown_ignores_study_sessions(): void
    {
        $this->travelTo(Carbon::parse('2026-10-07 17:00:00')); // Wednesday

        WorkSession::factory()->study()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-06 09:00:00'),
            'end' => Carbon::parse('2026-10-06 17:00:00'), // 8h of study
        ]);
        WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::parse('2026-10-05 09:00:00'),
            'end' => Carbon::parse('2026-10-05 13:00:00'), // 4h of work
        ]);

        $response = $this->getJson('/api/sessions/monthly');

        $response->assertStatus(200);

        $current = collect($response->json())->firstWhere('isCurrent', true);
        $this->assertNotNull($current);
        $this->assertSame(4, $current['doneHours']);
    }
}
