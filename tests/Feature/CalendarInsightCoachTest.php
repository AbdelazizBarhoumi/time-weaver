<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\GeminiCoachService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
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
            'longestGapMs' => 7_200_000,
            'trackedMs' => 0,
            'goalMs' => 28_800_000,
            'remainingMs' => 28_800_000,
            'meetings' => [
                ['title' => 'Client sync', 'start' => '2026-10-14T13:00:00.000Z', 'end' => '2026-10-14T14:00:00.000Z'],
            ],
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

    /** @return array<string, mixed> */
    private function chatContext(): array
    {
        return [
            'now' => '2026-10-14T12:00:00.000Z',
            'timeZone' => 'Europe/Berlin',
            'utcOffsetMinutes' => 120,
            'dailyGoalHours' => 8,
            'today' => $this->facts(),
            'week' => [
                'startDayKey' => '2026-10-12',
                'requiredDays' => [1, 2, 3, 4, 5],
                'targetHours' => 40,
                'doneHours' => 16,
                'remainingHours' => 24,
            ],
            'month' => [
                'label' => 'October 2026',
                'doneHours' => 60,
                'targetHours' => 176,
                'remainingHours' => 116,
                'daysLeft' => 12,
                'perDayNeeded' => 9.7,
                'paceDeltaHours' => -4,
            ],
            'backlogHours' => 2.5,
            'streak' => 4,
            'tasks' => [
                [
                    'id' => 7,
                    'title' => 'Clean the room',
                    'estimateMinutes' => 45,
                    'blocksWork' => false,
                    'start' => null,
                    'end' => null,
                    'done' => false,
                ],
                [
                    'id' => 8,
                    'title' => 'Dentist appointment',
                    'estimateMinutes' => 60,
                    'blocksWork' => true,
                    'start' => '2026-10-14T15:00:00.000Z',
                    'end' => '2026-10-14T16:00:00.000Z',
                    'done' => false,
                ],
            ],
            'tasksSummary' => [
                'total' => 2,
                'unplaced' => 1,
                'scheduled' => 1,
                'done' => 0,
                'unplacedEstimateHours' => 0.8,
                'blockingHoursToday' => 1,
            ],
        ];
    }

    protected function postChat(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/calendar/coach/chat', array_merge([
            'messages' => $this->chatMessages(),
            'context' => $this->chatContext(),
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
                && $request['store'] === false
                && str_contains($request['system_instruction'], 'Current snapshot:')
                && str_contains($request['system_instruction'], '"perDayNeeded": 9.7')
                && str_contains($request['system_instruction'], 'Europe/Berlin')
                && str_contains($request['system_instruction'], '+02:00')
                && str_contains($request['input'], 'User: How much free time do I have today?')
                && str_contains($request['input'], 'Coach: You have 3 hours free.')
                && str_contains($request['input'], 'User: And what should I do next?')
                && str_contains($request['input'], 'Reply to the last User message now, as the Coach.');
        });
    }

    public function test_chat_validates_the_payload(): void
    {
        $this->postJson('/api/calendar/coach/chat', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['messages', 'context']);
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

        $this->assertSame('You have 3 hours free.', (new GeminiCoachService)->chat(
            $this->chatMessages(),
            $this->chatContext(),
        ));
    }

    public function test_chat_service_throws_when_not_configured(): void
    {
        config(['services.gemini.key' => null]);

        $this->expectException(RuntimeException::class);

        (new GeminiCoachService)->chat($this->chatMessages(), $this->chatContext());
    }

    public function test_chat_tells_the_coach_how_to_place_side_tasks(): void
    {
        $this->fakeReply('Nothing to schedule.');

        $this->postChat()->assertStatus(200);

        Http::assertSent(function ($request) {
            $system = $request['system_instruction'];

            return str_contains($system, 'Side tasks are the user\'s personal to-dos')
                && str_contains($system, 'A task is unplaced when its start is null')
                && str_contains($system, '[[PLAN:<task id>|<YYYY-MM-DD HH:MM>]]')
                // The snapshot carries the real tasks, titles and all.
                && str_contains($system, '"title": "Clean the room"')
                && str_contains($system, '"estimateMinutes": 45')
                && str_contains($system, '"blocksWork": false')
                // The roll-up the coach reasons over.
                && str_contains($system, '"unplacedEstimateHours": 0.8')
                && str_contains($system, '"blockingHoursToday": 1');
        });
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
}
