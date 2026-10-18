<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\SideTask;
use App\Models\User;
use App\Services\CoachToolRegistry;
use App\Services\GeminiCoachService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The tool-driven coach: Gemini asks for data, the registry fetches it for
 * that user only, and the loop feeds the results back until it can answer.
 */
class CoachToolLoopTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
        config([
            'services.gemini.key' => 'test-key',
            'services.gemini.model' => 'gemini-2.5-flash',
            'services.gemini.base_url' => 'https://generativelanguage.googleapis.com/v1beta',
            'services.gemini.store' => true,
        ]);
    }

    /** A first turn that asks the model to call one tool. */
    private function requiresAction(array $calls): array
    {
        return [
            'id' => 'int_first',
            'object' => 'interaction',
            'status' => 'requires_action',
            'steps' => array_merge(
                [['type' => 'thought', 'signature' => 'sig', 'summary' => [['type' => 'text', 'text' => 'thinking']]]],
                $calls,
            ),
            'usage' => ['total_tokens' => 10],
        ];
    }

    private function functionCall(string $name, array $arguments, string $id = 'call_1'): array
    {
        return ['type' => 'function_call', 'name' => $name, 'arguments' => $arguments, 'id' => $id];
    }

    public function test_the_loop_runs_a_tool_call_and_replies_with_its_result(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->push($this->requiresAction([$this->functionCall('get_current_datetime', [])]))
                ->push([
                    'id' => 'int_second',
                    'object' => 'interaction',
                    'status' => 'completed',
                    'steps' => [['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'Tomorrow is Monday.']]]],
                    'usage' => ['total_tokens' => 20],
                ]),
        ]);

        $reply = app(GeminiCoachService::class)->chatWithTools($this->user, [
            ['role' => 'user', 'content' => 'When must I work tomorrow?'],
        ]);

        $this->assertSame('Tomorrow is Monday.', $reply);

        Http::assertSentCount(2);

        // First turn: tools are declared and the transcript is the only input.
        Http::assertSent(fn ($request) => ($request['input'][0]['text'] ?? null) === 'When must I work tomorrow?'
            && $request['tools'][0]['name'] === 'get_current_datetime'
            && ! isset($request['previous_interaction_id']));

        // Second turn: the transcript is replayed with the tool result appended,
        // under the stored interaction id.
        Http::assertSent(fn ($request) => ($request['previous_interaction_id'] ?? null) === 'int_first'
            && ($request['input'][0]['text'] ?? null) === 'When must I work tomorrow?'
            && ($request['input'][1]['type'] ?? null) === 'function_result'
            && ($request['input'][1]['call_id'] ?? null) === 'call_1'
            && str_contains($request['input'][1]['result'][0]['text'] ?? '', '"weekday"'));
    }

    public function test_chat_uses_stateful_storage(): void
    {
        config(['services.gemini.store' => true]);
        $this->fakeSingleReply('Sure.');

        $this->postJson('/api/calendar/coach/chat', [
            'messages' => [['role' => 'user', 'content' => 'hi']],
        ])->assertStatus(200);

        Http::assertSent(fn ($request) => $request['store'] === true);
    }

    public function test_the_loop_stops_after_the_round_cap(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response(
                $this->requiresAction([$this->functionCall('get_current_datetime', [])]),
            ),
        ]);

        $this->expectExceptionMessage('tool loop exceeded max rounds');

        app(GeminiCoachService::class)->chatWithTools(
            $this->user,
            [['role' => 'user', 'content' => 'hi']],
            2,
        );
    }

    private function fakeSingleReply(string $text): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'id' => 'int_1',
                'object' => 'interaction',
                'status' => 'completed',
                'steps' => [['type' => 'model_output', 'content' => [['type' => 'text', 'text' => $text]]]],
                'usage' => ['total_tokens' => 5],
            ]),
        ]);
    }

    /* ---------------------------------------------------------------- registry */

    public function test_the_registry_only_declares_known_tools(): void
    {
        $names = array_column(app(CoachToolRegistry::class)->declarations(), 'name');

        $this->assertSame([
            'get_current_datetime',
            'get_calendar_events',
            'get_goals_and_tasks',
            'get_free_slots',
        ], $names);
    }

    public function test_an_unknown_tool_returns_an_error_instead_of_throwing(): void
    {
        $result = app(CoachToolRegistry::class)->execute($this->user, 'drop_tables', []);

        $this->assertArrayHasKey('error', $result);
    }

    public function test_calendar_events_rejects_an_inverted_range(): void
    {
        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_calendar_events', [
            'start_datetime' => '2026-10-20T00:00:00Z',
            'end_datetime' => '2026-10-14T00:00:00Z',
        ]);

        $this->assertSame('Invalid range: end must be after start.', $result['error']);
    }

    public function test_calendar_events_rejects_a_window_beyond_the_cap(): void
    {
        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_calendar_events', [
            'start_datetime' => '2026-01-01T00:00:00Z',
            'end_datetime' => '2027-01-01T00:00:00Z',
        ]);

        $this->assertStringContainsString('Window too large', $result['error']);
    }

    public function test_calendar_events_never_leaks_another_users_data(): void
    {
        $mine = CalendarEvent::factory()->create([
            'calendar_account_id' => CalendarAccount::factory()->create(['user_id' => $this->user->id])->id,
            'title' => 'My standup',
            'start' => '2026-10-19 09:00:00',
            'end' => '2026-10-19 09:30:00',
        ]);
        $theirs = CalendarEvent::factory()->create([
            'title' => 'Someone elses secret',
            'start' => '2026-10-19 10:00:00',
            'end' => '2026-10-19 10:30:00',
        ]);

        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_calendar_events', [
            'start_datetime' => '2026-10-19T00:00:00Z',
            'end_datetime' => '2026-10-20T00:00:00Z',
        ]);

        $titles = array_column($result['events'], 'title');
        $this->assertContains('My standup', $titles);
        $this->assertNotContains('Someone elses secret', $titles);
        $this->assertNotContains($theirs->id, array_column($result['events'], 'id'));
        $this->assertContains($mine->id, array_column($result['events'], 'id'));
    }

    public function test_goals_and_tasks_only_returns_that_users_tasks(): void
    {
        SideTask::factory()->create(['user_id' => $this->user->id, 'title' => 'Write report']);
        SideTask::factory()->create(['title' => 'Not my task']);

        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_goals_and_tasks', []);

        $titles = array_column($result['tasks'], 'title');
        $this->assertContains('Write report', $titles);
        $this->assertNotContains('Not my task', $titles);
    }

    public function test_free_slots_rejects_an_inverted_range(): void
    {
        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_free_slots', [
            'from_datetime' => '2026-10-20T00:00:00Z',
            'to_datetime' => '2026-10-14T00:00:00Z',
        ]);

        $this->assertArrayHasKey('error', $result);
    }

    public function test_free_slots_reports_gaps_that_avoid_busy_blocks(): void
    {
        CalendarEvent::factory()->create([
            'calendar_account_id' => CalendarAccount::factory()->create(['user_id' => $this->user->id])->id,
            'title' => 'Busy hour',
            'start' => '2026-10-19 10:00:00',
            'end' => '2026-10-19 11:00:00',
        ]);

        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_free_slots', [
            'from_datetime' => '2026-10-19T09:00:00Z',
            'to_datetime' => '2026-10-19T12:00:00Z',
            'min_minutes' => 30,
        ]);

        $busyStart = Carbon::parse('2026-10-19T10:00:00Z');
        $busyEnd = Carbon::parse('2026-10-19T11:00:00Z');

        $this->assertNotSame([], $result['slots']);
        foreach ($result['slots'] as $slot) {
            $overlapsBusy = Carbon::parse($slot['start'])->lt($busyEnd) && Carbon::parse($slot['end'])->gt($busyStart);
            $this->assertFalse($overlapsBusy, 'A slot overlapped the busy event: '.$slot['start']);
        }
    }

    public function test_execute_rejects_malformed_ranges_without_throwing(): void
    {
        $result = app(CoachToolRegistry::class)->execute($this->user, 'get_calendar_events', [
            'start_datetime' => 'not-a-date',
            'end_datetime' => '2026-10-20T00:00:00Z',
        ]);

        $this->assertArrayHasKey('error', $result);
    }

    public function test_a_tool_error_is_fed_back_to_the_model_as_a_result(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->push($this->requiresAction([$this->functionCall('get_calendar_events', [
                    'start_datetime' => '2026-10-20T00:00:00Z',
                    'end_datetime' => '2026-10-14T00:00:00Z',
                ])]))
                ->push([
                    'id' => 'int_second',
                    'object' => 'interaction',
                    'status' => 'completed',
                    'steps' => [['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'That range is backwards.']]]],
                    'usage' => ['total_tokens' => 5],
                ]),
        ]);

        $reply = app(GeminiCoachService::class)->chatWithTools($this->user, [
            ['role' => 'user', 'content' => 'What about last month?'],
        ]);

        $this->assertSame('That range is backwards.', $reply);

        Http::assertSent(fn ($request) => str_contains(
            $this->toolResultText($request),
            'Invalid range',
        ));
    }

    public function test_a_thrown_argument_error_becomes_an_error_result(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->push($this->requiresAction([$this->functionCall('get_calendar_events', [])]))
                ->push([
                    'id' => 'int_second',
                    'object' => 'interaction',
                    'status' => 'completed',
                    'steps' => [['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'Oops.']]]],
                    'usage' => ['total_tokens' => 5],
                ]),
        ]);

        $reply = app(GeminiCoachService::class)->chatWithTools($this->user, [
            ['role' => 'user', 'content' => 'hi'],
        ]);

        $this->assertSame('Oops.', $reply);
        Http::assertSent(fn ($request) => str_contains($this->toolResultText($request), '"error"'));
    }

    /** The concatenated text of every tool result in a request's replayed input. */
    private function toolResultText(Request $request): string
    {
        $texts = [];

        foreach ($request['input'] ?? [] as $step) {
            if (($step['type'] ?? null) !== 'function_result') {
                continue;
            }

            foreach ($step['result'] ?? [] as $part) {
                $texts[] = $part['text'] ?? '';
            }
        }

        return implode("\n", $texts);
    }
}
