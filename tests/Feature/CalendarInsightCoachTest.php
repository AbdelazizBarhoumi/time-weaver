<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\GeminiCoachService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\TestCase;

class CalendarInsightCoachTest extends TestCase
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
            'services.gemini.api_revision' => '2026-05-20',
            'services.gemini.temperature' => 0.6,
            'services.gemini.top_p' => 0.95,
            'services.gemini.max_output_tokens' => 500,
            'services.gemini.thinking_level' => 'low',
            'services.gemini.seed' => null,
            'services.gemini.store' => false,
        ]);
        Cache::flush();
    }

    /** @return array<string, mixed> */
    private function facts(): array
    {
        return [
            'dayKey' => '2026-10-14',
            'isWorkDay' => true,
            'isRequiredDay' => true,
            'now' => '2026-10-14T12:00:00.000Z',
            'windowStart' => '2026-10-14T12:00:00.000Z',
            'windowEnd' => '2026-10-14T17:00:00.000Z',
            'windowMs' => 18_000_000,
            'busyMs' => 3_600_000,
            'freeMs' => 14_400_000,
            'workableMs' => 14_400_000,
            'longestGapMs' => 7_200_000,
            'trackedMs' => 0,
            'goalMs' => 28_800_000,
            'remainingMs' => 28_800_000,
            'meetings' => [
                ['title' => 'Client sync', 'start' => '2026-10-14T13:00:00.000Z', 'end' => '2026-10-14T14:00:00.000Z'],
            ],
            'studyMs' => 0,
            'studyTodayMs' => 0,
            'studySessions' => [],
            'backlogHours' => 2.5,
            'perDayNeededHours' => 4,
            'eventTitles' => ['Client sync'],
        ];
    }

    protected function postCoach(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/calendar/coach', array_merge(['facts' => $this->facts()], $overrides));
    }

    /**
     * A completed Interaction whose final step carries the given text.
     */
    private function interaction(string $text, array $extraSteps = []): array
    {
        return [
            'id' => 'int_123',
            'object' => 'interaction',
            'status' => 'completed',
            'steps' => array_merge($extraSteps, [
                ['type' => 'model_output', 'content' => [['type' => 'text', 'text' => $text]]],
            ]),
            'usage' => ['total_tokens' => 42],
        ];
    }

    private function fakeReply(string $text): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response($this->interaction($text)),
        ]);
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->postCoach()->assertStatus(401);
    }

    public function test_reports_unavailable_when_not_configured(): void
    {
        config(['services.gemini.key' => null]);

        Http::fake();
        $this->postCoach()->assertStatus(503)->assertJson(['available' => false]);
        Http::assertNothingSent();
    }

    public function test_status_reports_availability(): void
    {
        $this->getJson('/api/calendar/coach/status')->assertStatus(200)->assertJson(['available' => true]);

        config(['services.gemini.key' => null]);
        $this->getJson('/api/calendar/coach/status')->assertStatus(200)->assertJson(['available' => false]);
    }

    public function test_returns_coach_text_and_calls_the_interactions_api(): void
    {
        $this->fakeReply("Good: You have plenty of free time.\nDo: Reserve the 2h gap.");

        $this->postCoach()
            ->assertStatus(200)
            ->assertJson(['available' => true, 'text' => "Good: You have plenty of free time.\nDo: Reserve the 2h gap."]);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), 'generativelanguage.googleapis.com/v1beta/interactions')
                && $request->hasHeader('x-goog-api-key', 'test-key')
                && $request->hasHeader('Api-Revision', '2026-05-20')
                && $request['model'] === 'gemini-2.5-flash'
                && is_string($request['system_instruction'])
                && str_contains($request['input'], 'Write the coaching read-out now.');
        });
    }

    public function test_sends_full_generation_config(): void
    {
        $this->fakeReply('Good: All clear.');

        $this->postCoach()->assertStatus(200);

        Http::assertSent(function ($request) {
            $config = $request['generation_config'];

            return $config['temperature'] === 0.6
                && $config['top_p'] === 0.95
                && $config['max_output_tokens'] === 500
                && $config['thinking_level'] === 'low'
                && ! array_key_exists('top_k', $config);
        });
    }

    public function test_omits_blank_optional_generation_config(): void
    {
        config(['services.gemini.thinking_level' => null, 'services.gemini.seed' => null]);

        $this->fakeReply('Good: All clear.');

        $this->postCoach()->assertStatus(200);

        Http::assertSent(function ($request) {
            $config = $request['generation_config'];

            return array_key_exists('temperature', $config)
                && ! array_key_exists('thinking_level', $config)
                && ! array_key_exists('seed', $config);
        });
    }

    public function test_sends_seed_when_configured(): void
    {
        config(['services.gemini.seed' => 42]);

        $this->fakeReply('Good: All clear.');

        $this->postCoach()->assertStatus(200);

        Http::assertSent(fn ($request) => $request['generation_config']['seed'] === 42);
    }

    public function test_does_not_store_interactions_by_default(): void
    {
        $this->fakeReply('Good: All clear.');

        $this->postCoach()->assertStatus(200);

        Http::assertSent(fn ($request) => $request['store'] === false);
    }

    public function test_caches_the_response_for_repeated_clicks(): void
    {
        $this->fakeReply('Good: All clear.');

        $this->postCoach()->assertStatus(200);
        $this->postCoach()->assertStatus(200);

        Http::assertSentCount(1);
    }

    public function test_retries_on_rate_limit_then_succeeds(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->push(['error' => ['message' => 'rate limited']], 429)
                ->push($this->interaction('Good: Recovered.'), 200),
        ]);

        $this->postCoach()->assertStatus(200)->assertJson(['text' => 'Good: Recovered.']);

        Http::assertSentCount(2);
    }

    public function test_does_not_retry_on_a_bad_key(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response(['error' => ['message' => 'bad key']], 400),
        ]);

        $this->postCoach()->assertStatus(502);

        Http::assertSentCount(1);
    }

    public function test_retries_on_service_unavailable_then_succeeds(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->push(['error' => ['message' => 'high demand', 'code' => 'service_unavailable']], 503)
                ->push($this->interaction('Good: Recovered from the demand spike.'), 200),
        ]);

        $this->postCoach()->assertStatus(200)->assertJson(['text' => 'Good: Recovered from the demand spike.']);

        Http::assertSentCount(2);
    }

    public function test_does_not_retry_timeouts(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->pushFailedConnection('cURL error 28: Operation timed out after 60000 milliseconds with 0 bytes received')
                ->push($this->interaction('Good: Should never be reached.'), 200),
        ]);

        try {
            (new GeminiCoachService)->coach($this->facts());
            $this->fail('Expected a connection exception.');
        } catch (ConnectionException) {
            // expected
        }

        Http::assertSentCount(1);
    }

    public function test_returns_502_when_gemini_fails(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response(['error' => ['message' => 'boom']], 500),
        ]);

        $this->postCoach()->assertStatus(502)->assertJson(['available' => true]);
    }

    public function test_returns_502_when_the_interaction_fails(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'id' => 'int_123',
                'status' => 'failed',
                'errors' => [['code' => 'SAFETY', 'message' => 'blocked']],
                'steps' => [],
            ], 200),
        ]);

        $this->postCoach()->assertStatus(502)->assertJson(['available' => true]);
    }

    public function test_returns_502_when_there_is_no_model_output(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'id' => 'int_123',
                'status' => 'completed',
                'steps' => [['type' => 'thought', 'signature' => 'abc']],
            ], 200),
        ]);

        $this->postCoach()->assertStatus(502)->assertJson(['available' => true]);
    }

    public function test_rejects_a_payload_missing_required_facts(): void
    {
        $this->postJson('/api/calendar/coach', ['facts' => ['dayKey' => '2026-10-14']])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['facts.isWorkDay', 'facts.freeMs']);
    }

    public function test_coach_is_told_to_compare_goals_against_workable_time(): void
    {
        $this->fakeReply('Good: Plenty of time left to work.');

        $this->postCoach()->assertStatus(200);

        Http::assertSent(fn ($request) => str_contains($request['input'], '"workableMs": 14400000')
            && str_contains($request['system_instruction'], 'Compare any goal or backlog against workableMs, never freeMs.'));
    }

    public function test_service_throws_when_not_configured(): void
    {
        config(['services.gemini.key' => null]);

        $this->expectException(RuntimeException::class);

        (new GeminiCoachService)->coach($this->facts());
    }

    public function test_service_throws_on_empty_steps(): void
    {
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response(['status' => 'completed', 'steps' => []], 200)]);

        $this->expectException(RuntimeException::class);

        (new GeminiCoachService)->coach($this->facts());
    }

    public function test_service_ignores_thought_steps(): void
    {
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response(
            $this->interaction('Good: Focus on the 2h gap.', [
                ['type' => 'thought', 'signature' => 'abc', 'summary' => [['type' => 'text', 'text' => 'thinking']]],
            ]),
        )]);

        $this->assertSame('Good: Focus on the 2h gap.', (new GeminiCoachService)->coach($this->facts()));
    }

    public function test_service_joins_multiple_model_outputs(): void
    {
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response([
            'status' => 'completed',
            'steps' => [
                ['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'Good: Line one.']]],
                ['type' => 'thought', 'signature' => 'abc'],
                ['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'Do: Line two.']]],
            ],
        ])]);

        $this->assertSame("Good: Line one.\nDo: Line two.", (new GeminiCoachService)->coach($this->facts()));
    }

    public function test_service_returns_text_from_an_incomplete_interaction(): void
    {
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response([
            'status' => 'incomplete',
            'steps' => [['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'Good: Partial but usable.']]]],
        ])]);

        $this->assertSame('Good: Partial but usable.', (new GeminiCoachService)->coach($this->facts()));
    }

    public function test_service_logs_when_an_interaction_was_truncated(): void
    {
        Log::spy();

        Http::fake(['generativelanguage.googleapis.com/*' => Http::response([
            'status' => 'incomplete',
            'steps' => [['type' => 'model_output', 'content' => [['type' => 'text', 'text' => 'Good: Partial but usable.']]]],
            'usage' => ['total_output_tokens' => 4096, 'total_thought_tokens' => 3800, 'total_tokens' => 9200],
        ])]);

        (new GeminiCoachService)->coach($this->facts());

        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(fn (string $message, array $context = []): bool => str_contains($message, 'incomplete')
                && ($context['usage']['thought_tokens'] ?? null) === 3800);
    }

    public function test_service_retries_connection_failures(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->pushFailedConnection('dns down')
                ->push($this->interaction('Good: Back online.'), 200),
        ]);

        $this->assertSame('Good: Back online.', (new GeminiCoachService)->coach($this->facts()));

        Http::assertSentCount(2);
    }

    /* ------------------------------------------------------------ chat */

    /** @return array<int, array{role: string, content: string}> */
    private function chatMessages(): array
    {
        return [
            ['role' => 'user', 'content' => 'How much free time do I have today?'],
            ['role' => 'assistant', 'content' => 'You have 3 hours free.'],
            ['role' => 'user', 'content' => 'And what should I do next?'],
        ];
    }

    protected function postChat(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/calendar/coach/chat', array_merge([
            'messages' => $this->chatMessages(),
        ], $overrides));
    }

    public function test_chat_requires_authentication(): void
    {
        auth()->logout();

        $this->postChat()->assertStatus(401);
    }

    public function test_chat_reports_unavailable_when_not_configured(): void
    {
        config(['services.gemini.key' => null]);

        Http::fake();
        $this->postChat()->assertStatus(503)->assertJson(['available' => false]);
        Http::assertNothingSent();
    }

    public function test_chat_returns_a_reply_and_replays_the_transcript(): void
    {
        $this->fakeReply('You have about 3 hours of free time today.');

        $this->postChat()
            ->assertStatus(200)
            ->assertJson(['available' => true, 'reply' => 'You have about 3 hours of free time today.']);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), 'generativelanguage.googleapis.com/v1beta/interactions')
                && $request['model'] === 'gemini-2.5-flash'
                && $request['tools'] !== null
                && str_contains($request['system_instruction'], 'deciding which tools to call');
        });
    }

    public function test_chat_validates_the_payload(): void
    {
        $this->postJson('/api/calendar/coach/chat', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['messages']);
    }

    public function test_chat_rejects_an_unknown_role(): void
    {
        $this->postChat(['messages' => [['role' => 'system', 'content' => 'hi']]])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['messages.0.role']);
    }

    public function test_chat_rejects_a_conversation_not_ending_with_the_user(): void
    {
        Http::fake();

        $this->postChat(['messages' => [
            ['role' => 'user', 'content' => 'hi'],
            ['role' => 'assistant', 'content' => 'hello'],
        ]])->assertStatus(422);

        Http::assertNothingSent();
    }

    public function test_chat_rejects_too_many_messages(): void
    {
        $messages = [];
        for ($i = 0; $i < 25; $i++) {
            $messages[] = ['role' => 'user', 'content' => "message {$i}"];
        }

        Http::fake();

        $this->postChat(['messages' => $messages])->assertStatus(422)->assertJsonValidationErrors(['messages']);

        Http::assertNothingSent();
    }

    public function test_chat_does_not_cache_turns(): void
    {
        $this->fakeReply('Sure.');

        $this->postChat()->assertStatus(200);
        $this->postChat()->assertStatus(200);

        Http::assertSentCount(2);
    }

    public function test_chat_returns_502_when_gemini_fails(): void
    {
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response(['error' => ['message' => 'boom']], 500),
        ]);

        $this->postChat()->assertStatus(502)->assertJson(['available' => true]);
    }

    public function test_chat_service_ignores_thought_steps(): void
    {
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response(
            $this->interaction('You have 3 hours free.', [
                ['type' => 'thought', 'signature' => 'abc', 'summary' => [['type' => 'text', 'text' => 'thinking']]],
            ]),
        )]);

        $this->assertSame('You have 3 hours free.', (new GeminiCoachService)->chatWithTools(
            User::factory()->create(),
            $this->chatMessages(),
        ));
    }

    public function test_chat_service_throws_when_not_configured(): void
    {
        config(['services.gemini.key' => null]);

        $this->expectException(RuntimeException::class);

        (new GeminiCoachService)->chatWithTools(User::factory()->create(), $this->chatMessages());
    }

    public function test_chat_tells_the_coach_how_to_place_side_tasks(): void
    {
        $this->fakeReply('Nothing to schedule.');

        $this->postChat()->assertStatus(200);

        Http::assertSent(function ($request) {
            $system = $request['system_instruction'];

            return str_contains($system, '[[PLAN:<task id>|<YYYY-MM-DD HH:MM>]]');
        });
    }

    public function test_chat_tells_the_coach_to_weigh_backlog_and_tasks_before_green_lighting_a_free_day(): void
    {
        $this->fakeReply('Consider backlog and unplaced tasks.');
        $this->postChat(['messages' => [
            ['role' => 'user', 'content' => 'Can I play tomorrow?'],
        ]])->assertStatus(200);
        Http::assertSentCount(1);
    }

    public function test_chat_anchors_the_model_to_the_user_s_local_clock_and_day(): void
    {
        $this->fakeReply('Plenty of time.');
        $this->postChat()->assertStatus(200);
        Http::assertSent(fn ($r) => str_contains($r['system_instruction'], 'get_current_datetime'));
    }

    public function test_coach_requires_study_facts(): void
    {
        $facts = $this->facts();
        unset($facts['studyMs'], $facts['studyTodayMs'], $facts['studySessions']);

        $this->postJson('/api/calendar/coach', ['facts' => $facts])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['facts.studyMs', 'facts.studyTodayMs', 'facts.studySessions']);
    }

    public function test_coach_tells_the_model_study_never_counts_as_work(): void
    {
        $this->fakeReply('Good: Plenty of time left.');

        $this->postCoach()->assertStatus(200);

        Http::assertSent(fn ($request) => str_contains($request['system_instruction'], 'Study blocks are fixed commitments')
            && str_contains($request['system_instruction'], 'Never add study time to the work goal')
            // The facts carry the study fields through to the model.
            && str_contains($request['input'], '"studyMs": 0')
            && str_contains($request['input'], '"studyTodayMs": 0'));
    }

    public function test_chat_tells_the_coach_study_never_counts_as_work(): void
    {
        $this->fakeReply('You have study today.');
        $this->postChat()->assertStatus(200);
        Http::assertSentCount(1);
    }

    public function test_chat_strips_plan_markers_and_returns_them_as_suggestions(): void
    {
        $this->fakeReply(
            "Tuesday 17:00 is free, so put it there. [[PLAN:7|2026-10-20 17:00]]\n"
            .'Everything else is covered.',
        );

        $this->postChat()
            ->assertStatus(200)
            ->assertJsonPath('reply', "Tuesday 17:00 is free, so put it there.\nEverything else is covered.")
            ->assertJsonPath('suggestions.0.taskId', 7)
            // Wall-clock local time, so the browser can read it in its own zone.
            ->assertJsonPath('suggestions.0.start', '2026-10-20T17:00')
            ->assertJsonPath('suggestions.0.reason', 'Tuesday 17:00 is free, so put it there.');
    }

    public function test_chat_returns_no_suggestions_when_the_reply_has_no_markers(): void
    {
        $this->fakeReply('You have about 3 hours of free time today.');

        $this->postChat()
            ->assertStatus(200)
            ->assertJsonPath('suggestions', [])
            ->assertJsonPath('reply', 'You have about 3 hours of free time today.');
    }

    public function test_extract_plans_ignores_malformed_markers(): void
    {
        $service = new GeminiCoachService;

        $result = $service->extractPlans(
            "Good: [[PLAN:notanumber|2026-10-20 17:00]] stays visible.\n"
            ."OK: [[PLAN:7|soon]] stays visible.\n"
            ."Fine: [[PLAN:9|2026-10-21 09:30]] goes out.\n"
            .'Plain text.',
        );

        $this->assertSame([
            ['taskId' => 9, 'start' => '2026-10-21T09:30', 'reason' => 'Fine: goes out.'],
        ], $result['plans']);

        $this->assertSame(
            "Good: [[PLAN:notanumber|2026-10-20 17:00]] stays visible.\n"
            ."OK: [[PLAN:7|soon]] stays visible.\n"
            ."Fine: goes out.\n"
            .'Plain text.',
            $result['text'],
        );
    }

    public function test_extract_plans_tolerates_seconds_and_a_space_separator(): void
    {
        $result = (new GeminiCoachService)->extractPlans('[[PLAN:3|2026-10-22 08:15:00]]');

        $this->assertSame([['taskId' => 3, 'start' => '2026-10-22T08:15', 'reason' => '']], $result['plans']);
        $this->assertSame('', $result['text']);
    }

    public function test_chat_response_has_no_fetch_field(): void
    {
        // The coach now loads any window it needs through its own tools, so the
        // client is never asked to fetch a day and re-ask.
        $this->fakeReply('Ready when you are.');

        $this->postChat()
            ->assertStatus(200)
            ->assertJsonMissingPath('fetch');
    }

    public function test_chat_grounds_the_coach_in_settings_and_the_horizon(): void
    {
        $this->fakeReply('Using tools now.');
        $this->postChat()->assertStatus(200);
        Http::assertSent(fn ($r) => str_contains($r['system_instruction'], 'get_goals_and_tasks') || str_contains($r['system_instruction'], 'get_calendar_events'));
    }
}
