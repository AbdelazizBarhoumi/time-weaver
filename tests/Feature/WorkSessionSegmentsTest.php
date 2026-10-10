<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\WorkSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class WorkSessionSegmentsTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
        $this->freezeSecond();
    }

    private function iso(int $ms): string
    {
        return Carbon::createFromTimestampMs($ms)->toISOString();
    }

    private function ms(int $minutes): int
    {
        return $minutes * 60000;
    }

    public function test_pausing_derives_pause_state_from_segments(): void
    {
        $now = now()->getTimestampMs();
        $session = WorkSession::factory()->active()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::createFromTimestampMs($now - $this->ms(60)),
        ]);

        $response = $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(60)), 'end' => $this->iso($now - $this->ms(10))],
                ['type' => 'pause', 'start' => $this->iso($now - $this->ms(10)), 'end' => null],
            ],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('pausedMs', 0)
            ->assertJsonPath('pausedAt', $this->iso($now - $this->ms(10)))
            ->assertJsonPath('durationMs', $this->ms(50))
            ->assertJsonPath('segmentsInferred', false)
            ->assertJsonPath('segments.1.end', null);

        $session->refresh();
        $this->assertSame(0, $session->paused_ms);
        $this->assertSame($now - $this->ms(10), $session->paused_at->getTimestampMs());
        $this->assertSame($this->ms(50), $session->duration_ms);
    }

    public function test_resuming_folds_the_closed_pause_into_paused_ms(): void
    {
        $now = now()->getTimestampMs();
        $session = WorkSession::factory()->active()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::createFromTimestampMs($now - $this->ms(60)),
        ]);

        $response = $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(60)), 'end' => $this->iso($now - $this->ms(10))],
                ['type' => 'pause', 'start' => $this->iso($now - $this->ms(10)), 'end' => $this->iso($now - $this->ms(5))],
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(5)), 'end' => null],
            ],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('pausedMs', $this->ms(5))
            ->assertJsonPath('pausedAt', null)
            ->assertJsonPath('durationMs', $this->ms(55));

        $this->assertSame($this->ms(5), $session->refresh()->paused_ms);
    }

    public function test_stopping_keeps_total_equal_to_work_segments(): void
    {
        $now = now()->getTimestampMs();
        $session = WorkSession::factory()->active()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::createFromTimestampMs($now - $this->ms(90)),
        ]);

        $response = $this->putJson("/api/sessions/{$session->id}", [
            'end' => $this->iso($now - $this->ms(30)),
            'segments' => [
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(90)), 'end' => $this->iso($now - $this->ms(60))],
                ['type' => 'pause', 'start' => $this->iso($now - $this->ms(60)), 'end' => $this->iso($now - $this->ms(45))],
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(45)), 'end' => $this->iso($now - $this->ms(30))],
            ],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('durationMs', $this->ms(45))
            ->assertJsonPath('pausedMs', $this->ms(15))
            ->assertJsonPath('pausedAt', null)
            ->assertJsonPath('segmentsInferred', false);

        $session->refresh();
        $this->assertSame($now - $this->ms(30), $session->end->getTimestampMs());
        $this->assertSame($this->ms(45), $session->duration_ms);
        $this->assertNotNull($session->segments);
    }

    public function test_legacy_session_gets_synthesized_breakdown(): void
    {
        $start = Carbon::parse('2026-10-01 09:00:00');
        $session = WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => $start,
            'end' => $start->copy()->addHours(8),
            'paused_ms' => $this->ms(30),
            'paused_at' => null,
            'segments' => null,
        ]);

        $response = $this->getJson("/api/sessions/{$session->id}");

        $response->assertStatus(200)
            ->assertJsonPath('segmentsInferred', true)
            ->assertJsonPath('segments.0.type', 'work')
            ->assertJsonPath('segments.0.start', $start->toISOString())
            ->assertJsonPath('segments.0.end', $start->copy()->addHours(7)->addMinutes(30)->toISOString())
            ->assertJsonPath('segments.1.type', 'pause')
            ->assertJsonPath('segments.1.start', $start->copy()->addHours(7)->addMinutes(30)->toISOString())
            ->assertJsonPath('segments.1.end', $start->copy()->addHours(8)->toISOString())
            ->assertJsonPath('durationMs', $this->ms(8 * 60 - 30));
    }

    public function test_store_materializes_a_single_work_segment(): void
    {
        $start = Carbon::parse('2026-10-02 09:00:00');
        $end = $start->copy()->addHours(4);

        $response = $this->postJson('/api/sessions', [
            'start' => $start->toISOString(),
            'end' => $end->toISOString(),
            'note' => 'manual entry',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('segmentsInferred', false)
            ->assertJsonPath('segments.0.type', 'work')
            ->assertJsonPath('segments.0.start', $start->toISOString())
            ->assertJsonPath('segments.0.end', $end->toISOString());
    }

    public function test_updating_start_clamps_segments_to_session_bounds(): void
    {
        $start = Carbon::parse('2026-10-01 09:00:00');
        $session = WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => $start,
            'end' => $start->copy()->addHours(8),
            'paused_ms' => 0,
            'segments' => [
                ['type' => 'work', 'start' => $start->toISOString(), 'end' => $start->copy()->addHours(3)->toISOString()],
                ['type' => 'pause', 'start' => $start->copy()->addHours(3)->toISOString(), 'end' => $start->copy()->addHours(3)->addMinutes(30)->toISOString()],
                ['type' => 'work', 'start' => $start->copy()->addHours(3)->addMinutes(30)->toISOString(), 'end' => $start->copy()->addHours(8)->toISOString()],
            ],
        ]);

        $response = $this->putJson("/api/sessions/{$session->id}", [
            'start' => $start->copy()->addHour()->toISOString(),
        ] + ['segments' => $session->segments]);

        $response->assertStatus(200)
            ->assertJsonPath('segments.0.start', $start->copy()->addHour()->toISOString())
            ->assertJsonPath('segments.0.end', $start->copy()->addHours(3)->toISOString())
            ->assertJsonPath('pausedMs', $this->ms(30))
            ->assertJsonPath('durationMs', $this->ms(7 * 60 - 30));
    }

    public function test_rejects_overlapping_segments(): void
    {
        $now = now()->getTimestampMs();
        $session = WorkSession::factory()->active()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::createFromTimestampMs($now - $this->ms(120)),
        ]);

        $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(120)), 'end' => $this->iso($now - $this->ms(30))],
                ['type' => 'pause', 'start' => $this->iso($now - $this->ms(60)), 'end' => null],
            ],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['segments' => 'Segments must not overlap.']);
    }

    public function test_rejects_segment_that_ends_before_it_starts(): void
    {
        $now = now()->getTimestampMs();
        $session = WorkSession::factory()->active()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::createFromTimestampMs($now - $this->ms(120)),
        ]);

        $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(60)), 'end' => $this->iso($now - $this->ms(70))],
            ],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['segments' => 'Segment 1 must end after it starts.']);
    }

    public function test_rejects_open_segment_on_completed_session(): void
    {
        $start = Carbon::parse('2026-10-01 09:00:00');
        $session = WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => $start,
            'end' => $start->copy()->addHours(4),
        ]);

        $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [
                ['type' => 'work', 'start' => $start->toISOString(), 'end' => null],
            ],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['segments' => 'A session with an end time cannot have an open segment.']);
    }

    public function test_rejects_open_segment_that_is_not_last(): void
    {
        $now = now()->getTimestampMs();
        $session = WorkSession::factory()->active()->create([
            'user_id' => $this->user->id,
            'start' => Carbon::createFromTimestampMs($now - $this->ms(120)),
        ]);

        $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [
                ['type' => 'pause', 'start' => $this->iso($now - $this->ms(120)), 'end' => null],
                ['type' => 'work', 'start' => $this->iso($now - $this->ms(60)), 'end' => $this->iso($now - $this->ms(30))],
            ],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['segments' => 'Only the last segment can be left open.']);
    }

    public function test_rejects_empty_segment_list(): void
    {
        $session = WorkSession::factory()->active()->create(['user_id' => $this->user->id]);

        $this->putJson("/api/sessions/{$session->id}", [
            'segments' => [],
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['segments' => 'A session needs at least one segment.']);
    }

    public function test_rejects_end_before_start(): void
    {
        $start = Carbon::parse('2026-10-01 09:00:00');
        $session = WorkSession::factory()->create([
            'user_id' => $this->user->id,
            'start' => $start,
            'end' => $start->copy()->addHours(4),
        ]);

        $this->putJson("/api/sessions/{$session->id}", [
            'end' => $start->copy()->subHour()->toISOString(),
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['end']);
    }
}
