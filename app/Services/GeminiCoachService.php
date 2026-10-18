<?php

namespace App\Services;

use App\Models\User;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

/**
 * Thin wrapper around Google's Gemini "Interactions" REST API.
 *
 * We call the REST endpoint directly through Laravel's HTTP client instead of
 * pulling in an extra SDK, so the only configuration needed is an API key.
 *
 * The Interactions API is Google's current interface for Gemini (GA as of
 * June 2026) and is the one that serves the newer model families such as
 * `gemini-3.8-flash`; the legacy `models/{model}:generateContent` route only
 * covers the older mainline models. See:
 * https://ai.google.dev/gemini-api/docs/interactions-overview
 *
 * The call is hardened: bounded timeouts, a short retry with backoff for
 * transient failures (429 / 5xx / connection drops), and explicit handling of
 * every way the API can hand back "nothing useful" — a failed or cancelled
 * interaction, a missing `model_output` step, or an empty text block.
 */
class GeminiCoachService
{
    /** Fallback tries for transient failures (429 / 5xx / connection drops). */
    private const DEFAULT_RETRIES = 2;

    /** Base backoff between tries, in milliseconds. */
    private const RETRY_SLEEP_MS = 400;

    /**
     * Fallback ceiling for the whole request, in seconds. Thinking models such
     * as gemini-3.8-flash can take a minute under load, so this is deliberately
     * generous and configurable.
     */
    private const DEFAULT_TIMEOUT = 60;

    /** Fallback connect budget, in seconds — fail fast when the network is down. */
    private const DEFAULT_CONNECT_TIMEOUT = 10;

    /** Status codes worth retrying; every other failure is permanent. */
    private const RETRYABLE_STATUS = [429, 500, 502, 503, 504];

    /** Substrings that mark a connection failure as a timeout rather than a drop. */
    private const TIMEOUT_HINTS = ['timed out', 'timeout'];

    /** Interaction statuses that mean the request will never yield text. */
    private const DEAD_STATUSES = ['failed', 'cancelled'];

    /**
     * Status for an interaction that finished but was cut short, almost always
     * because thinking plus the reply exceeded `max_output_tokens`. The text is
     * still usable, so we keep it and log the cause instead of discarding it.
     */
    private const INCOMPLETE_STATUS = 'incomplete';

    /**
     * The line suffix the coach uses to propose a slot for a side task:
     * `[[PLAN:7|2026-10-20 17:00]]`, with the time on the user's local clock.
     * The server strips these out of the visible reply and returns them as
     * structured suggestions, so the client never has to parse prose.
     */
    private const PLAN_MARKER = '/\[\[\s*PLAN\s*:\s*(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?\s*\]\]/i';

    /** Max tool execution rounds in the agent loop. */
    private const MAX_TOOL_ROUNDS = 6;

    /**
     * Whether an API key has been configured for Gemini.
     */
    public function isConfigured(): bool
    {
        return filled(config('services.gemini.key'));
    }

    /**
     * Ask Gemini for a short coaching read-out of the user's day.
     *
     * @param  array<string, mixed>  $facts  Structured facts about the day (see DayIntelligence on the client).
     *
     * @throws RuntimeException when the service is not configured, the request fails, or the reply is unusable.
     */
    public function coach(array $facts): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Gemini is not configured.');
        }

        $response = $this->send($this->payload($facts));

        return $this->extractText($response);
    }

    /**
     * Tool-driven chat loop using Gemini Interactions API.
     *
     * @param  array<int, array{role: string, content: string}>  $messages
     */
    public function chatWithTools(User $user, array $messages, int $maxRounds = self::MAX_TOOL_ROUNDS): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Gemini is not configured.');
        }

        $registry = app(CoachToolRegistry::class);
        $tools = $registry->declarations();

        $history = $this->normalizeMessages($messages);
        $previousId = null;
        $round = 0;

        while ($round < $maxRounds) {
            $payload = [
                'model' => $this->model(),
                'system_instruction' => $this->toolsSystemPrompt(),
                'tools' => $tools,
                'generation_config' => $this->generationConfig(),
                'store' => (bool) config('services.gemini.store', true),
            ];
            if ($previousId) {
                $payload['previous_interaction_id'] = $previousId;
            }
            // The full transcript goes out every round: the API wants each
            // function_result right behind the call turn it answers, so the
            // replayed history keeps the pairing intact under chaining.
            $payload['input'] = $this->renderHistory($history);

            $response = $this->send($payload);
            $body = $response->json();
            if (! is_array($body)) {
                throw new RuntimeException('Gemini returned an unreadable response.');
            }

            $status = data_get($body, 'status');
            if (is_string($status) && in_array($status, self::DEAD_STATUSES, true)) {
                throw new RuntimeException('Gemini '.$status.' the interaction: '.$this->errorMessage($body));
            }

            $steps = is_array(data_get($body, 'steps')) ? data_get($body, 'steps') : [];

            if ($status === 'requires_action') {
                $toolCalls = array_values(array_filter($steps, fn ($s) => is_array($s) && ($s['type'] ?? null) === 'function_call'));
                if ($toolCalls === []) {
                    throw new RuntimeException('Gemini asked for a tool call but none were found.');
                }

                $toolResults = [];
                foreach ($toolCalls as $call) {
                    $name = $call['name'] ?? null;
                    $args = is_array($call['arguments'] ?? null) ? $call['arguments'] : [];
                    $callId = $call['id'] ?? null;
                    try {
                        $result = $registry->execute($user, (string) $name, $args);
                    } catch (InvalidArgumentException $e) {
                        $result = ['error' => $e->getMessage()];
                    }
                    $toolResults[] = [
                        'type' => 'function_result',
                        'name' => $name,
                        'call_id' => $callId,
                        'result' => [['type' => 'text', 'text' => json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]],
                    ];
                }

                $previousId = $body['id'] ?? null;
                $round++;
                $history = array_merge($history, $toolResults);

                continue;
            }

            if ($status === self::INCOMPLETE_STATUS) {
                Log::warning('Gemini interaction was incomplete (reply truncated)', [
                    'reason' => $this->errorMessage($body),
                    'usage' => $this->usageSummary($body),
                ]);
            }

            $text = $this->collectModelOutput($body);
            if ($text === null || trim($text) === '') {
                throw new RuntimeException('Gemini returned an empty response');
            }

            return trim($text);
        }

        throw new RuntimeException('Gemini tool loop exceeded max rounds.');
    }

    /**
     * @param  array<int, array{role: string, content: string}>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function normalizeMessages(array $messages): array
    {
        $normalized = [];
        foreach ($messages as $m) {
            $role = $m['role'] ?? 'user';
            $content = trim((string) ($m['content'] ?? ''));
            if ($content === '') {
                continue;
            }
            $normalized[] = ['role' => $role, 'content' => $content];
        }

        return $normalized;
    }

    /**
     * Render the in-flight transcript as the `input` steps of an interaction.
     *
     * The Interactions API rejects `model_output` steps inside a submitted
     * `input` with a 400 ("Request contains an invalid argument"), so every
     * turn — including the coach's own earlier replies — goes out as a plain
     * `text` step, with a role prefix so the model can still tell the turns
     * apart. Only `text` and `function_result` steps may appear here.
     *
     * @param  array<int, array<string, mixed>>  $history
     */
    private function renderHistory(array $history): array
    {
        $input = [];
        foreach ($history as $item) {
            if (isset($item['type']) && $item['type'] === 'function_result') {
                $input[] = $item;

                continue;
            }

            $prefix = ($item['role'] ?? 'user') === 'assistant' ? 'Coach: ' : 'User: ';
            $input[] = [
                'type' => 'text',
                'text' => $prefix.$item['content'],
            ];
        }

        return $input;
    }

    /**
     * Ask Gemini where a batch of unscheduled side tasks should go.
     *
     * The same stateless call as the chat: the caller sends a fresh snapshot and
     * the candidate tasks, and the reply carries one `[[PLAN:…]]` marker per
     * task (see {@see extractPlans()}).
     *
     * @param  array<int, array{id: int, title: string, estimateMinutes: int, blocksWork: bool}>  $tasks
     * @param  array<string, mixed>  $context  A fresh snapshot of the user's day/week/month data.
     *
     * @throws RuntimeException when the service is not configured, the request fails, or the reply is unusable.
     */
    public function planTasks(array $tasks, array $context): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Gemini is not configured.');
        }

        $response = $this->send($this->planPayload($tasks, $context));

        return $this->extractText($response);
    }

    /**
     * Split a coach reply into the text the user should see and the placement
     * proposals hidden in it.
     *
     * Every line carrying a `[[PLAN:id|YYYY-MM-DD HH:MM]]` marker becomes a
     * suggestion, and that marker is removed from the line so the user never
     * sees the raw syntax. The reason is whatever text shared the line.
     *
     * A slot the model placed in the past is dropped whole — line included — so
     * the reply never advertises a time that is already behind the clock. The
     * model is told not to do it, but a free morning in the snapshot still
     * tempts it, so the cutoff is enforced here as well.
     *
     * @param  string|null  $notBefore  Local wall clock ("Y-m-d H:i") before which a slot is rejected.
     * @return array{text: string, plans: array<int, array{taskId: int, start: string, reason: string}>}
     */
    public function extractPlans(string $text, ?string $notBefore = null): array
    {
        $plans = [];
        $kept = [];

        foreach (preg_split('/\R/', $text) ?: [] as $line) {
            if (preg_match(self::PLAN_MARKER, $line, $matches) !== 1) {
                $kept[] = $line;

                continue;
            }

            // Both sides are zero-padded "Y-m-d H:i", so the ordering is lexicographic.
            $slot = "{$matches[2]} {$matches[3]}";
            if ($notBefore !== null && $slot < $notBefore) {
                continue;
            }

            $reason = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace(self::PLAN_MARKER, '', $line)));

            $plans[] = [
                'taskId' => (int) $matches[1],
                // A wall-clock time without an offset: the client reads it as local.
                'start' => "{$matches[2]}T{$matches[3]}",
                'reason' => $reason,
            ];

            if ($reason !== '') {
                $kept[] = $reason;
            }
        }

        return [
            'text' => trim(implode("\n", $kept)),
            'plans' => $plans,
        ];
    }

    /**
     * The request body: model, system instruction, user input and sampling
     * controls.
     *
     * @param  array<string, mixed>  $facts
     * @return array<string, mixed>
     */
    private function payload(array $facts): array
    {
        return [
            'model' => $this->model(),
            'system_instruction' => $this->systemPrompt(),
            'input' => $this->userPrompt($facts),
            'generation_config' => $this->generationConfig(),
            'store' => (bool) config('services.gemini.store', false),
        ];
    }

    /**
     * The request body for a task-placement turn: the same model and sampling
     * controls, a system instruction carrying the snapshot, and the candidate
     * tasks in the user input.
     *
     * @param  array<int, array{id: int, title: string, estimateMinutes: int, blocksWork: bool}>  $tasks
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private function planPayload(array $tasks, array $context): array
    {
        return [
            'model' => $this->model(),
            'system_instruction' => $this->planSystemPrompt($context),
            'input' => $this->planUserPrompt($tasks),
            'generation_config' => $this->generationConfig(),
            'store' => (bool) config('services.gemini.store', false),
        ];
    }

    /**
     * The configured model, with a sane fallback for an unset value.
     */
    private function model(): string
    {
        $model = config('services.gemini.model');

        return is_string($model) && trim($model) !== '' ? trim($model) : 'gemini-3.5-flash-lite';
    }

    /**
     * Sampling and output controls. Every value is configurable via env so the
     * behaviour can be tuned without a deploy; empty values are omitted so the
     * API defaults apply.
     *
     * Note the Interactions API does not expose `top_k` — only `top_p`.
     *
     * @return array<string, mixed>
     */
    private function generationConfig(): array
    {
        return array_filter([
            'temperature' => (float) config('services.gemini.temperature', 0.6),
            'top_p' => (float) config('services.gemini.top_p', 0.95),
            'max_output_tokens' => (int) config('services.gemini.max_output_tokens', 500),
            'thinking_level' => $this->optionalString(config('services.gemini.thinking_level')),
            'seed' => $this->optionalInt(config('services.gemini.seed')),
        ], fn (mixed $value): bool => $value !== null && $value !== '');
    }

    /**
     * Persona, grounding rules and tool guidance for the tool-driven chat.
     *
     * The domain rules mirror the snapshot prompt: arithmetic over tool data,
     * workable time vs free time, study never counting as work, the backlog /
     * pace checks before green-lighting a free day, and the [[PLAN]] marker.
     */
    private function toolsSystemPrompt(): string
    {
        return implode("\n", [
            'You are the AI coach inside a work-hours tracker called ShiftGrid.',
            'The user asks about their own schedule, workload and pace, and you guide them.',
            'You answer by deciding which tools to call: fetch only what the question needs, never guess.',
            'Use get_current_datetime first to anchor "now" (timezone, weekday, local date/time).',
            'Use get_calendar_events for a specific window (after 24h, next week, through an exam date).',
            'Use get_goals_and_tasks for workload, pace, backlog, settings and side tasks.',
            'Use get_free_slots when you need concrete gaps to place a task.',
            'Never invent events, meetings, hours or numbers; only use data returned by tools.',
            'Never answer "I cannot tell" when the tool data supports a subtraction or division.',
            'Do the arithmetic yourself: free = window minus busy, still owed today = remaining goal,',
            'week left = target minus done, per day = remaining divided by days left.',
            'freeMs is only unbooked gaps; workableMs is the time left to work, because focus blocks and work',
            'events are work and do not reduce it. Compare goals and backlogs against workable, never free.',
            'The working window and required weekdays are settings (workStart, workEnd, workDays, requiredDays),',
            'returned by get_goals_and_tasks and get_current_datetime. Never ask the user to tell you their',
            'working window or working days — call a tool and read them.',
            'Treat requiredDays as the days the user must work; any other weekday is optional, not owed.',
            'Before confirming a day is free, or that resting or playing is fine, check the whole picture:',
            'the remaining week and month targets, the month pace so far, the cumulative backlog, and the side',
            'tasks (unplaced ones and any already placed on that day).',
            'A weekday that is not required is not owed, but it is not automatically free either: if the backlog',
            'is above zero, tasks are still unplaced, or the month pace is behind, do not answer with a bare yes —',
            'answer the question first, then name the backlog hours, the unplaced task hours and the time still',
            'needed per day.',
            'A non-required day that already has blocking tasks placed on it is not free time; say so.',
            'Study sessions are fixed commitments: study time blocks the day like a meeting but is never work.',
            'Never count study toward work hours or goal progress, and never add study and busy hours together.',
            'Every timestamp returned by tools is UTC (it ends with Z). Convert each time into the user\'s local',
            'clock and never quote a raw ISO timestamp back to the user.',
            'Never propose a day earlier than today, and never propose a time that has already passed.',
            'A slot later on today is still today: say "later today", never name a future weekday for it.',
            'Side tasks are the user\'s personal to-dos, listed by get_goals_and_tasks with an estimate in minutes.',
            'A task is unplaced when its start is null and it is not done — only those can be given a slot.',
            'Tasks marked blocksWork occupy the user\'s time; the others are flexible.',
            'When the user asks where or when to do a task, recommend one concrete local day and time, only',
            'where the gap is at least the task estimate and does not overlap a meeting or another task,',
            'and end that recommendation with [[PLAN:<task id>|<YYYY-MM-DD HH:MM>]] using the user\'s local clock.',
            'Never add a marker when the user did not ask where to put a task, and only use real task ids.',
            'Answer the user\'s actual question first, then add at most one short, concrete suggestion.',
            'Be concise: 1 to 4 short sentences, or a few short lines.',
            'Plain text only — no markdown, no headings, no bullet characters, no asterisks.',
            'Keep the thread coherent: you can refer back to earlier turns in the conversation.',
        ]);
    }

    /**
     * POST to the interactions endpoint, retrying only on transient failures.
     *
     * @param  array<string, mixed>  $payload
     *
     * @throws ConnectionException when the connection keeps failing.
     */
    private function send(array $payload): Response
    {
        $base = rtrim((string) config('services.gemini.base_url', 'https://generativelanguage.googleapis.com/v1beta'), '/');

        $headers = ['x-goog-api-key' => (string) config('services.gemini.key')];

        $revision = $this->optionalString(config('services.gemini.api_revision'));
        if ($revision !== null) {
            $headers['Api-Revision'] = $revision;
        }

        return Http::withHeaders($headers)
            ->asJson()
            ->connectTimeout((int) config('services.gemini.connect_timeout', self::DEFAULT_CONNECT_TIMEOUT))
            ->timeout((int) config('services.gemini.timeout', self::DEFAULT_TIMEOUT))
            ->retry(
                (int) config('services.gemini.retries', self::DEFAULT_RETRIES),
                self::RETRY_SLEEP_MS,
                fn (Throwable $exception): bool => $this->shouldRetry($exception),
            )
            ->post("{$base}/interactions", $payload);
    }

    /**
     * Retry connection drops and rate limits / server errors. A 4xx like a bad
     * key or a malformed body will fail identically every time, so don't burn
     * tries on it.
     *
     * Timeouts are also left alone: they already consumed the whole timeout
     * budget, so retrying only makes the caller wait twice as long.
     *
     * The retry `$when` callback receives the thrown exception, which for a
     * failed HTTP status carries the response.
     */
    private function shouldRetry(Throwable $exception): bool
    {
        if ($exception instanceof RequestException && $exception->response !== null) {
            return in_array($exception->response->status(), self::RETRYABLE_STATUS, true);
        }

        if ($exception instanceof ConnectionException) {
            return ! $this->isTimeout($exception);
        }

        return false;
    }

    /**
     * Whether a connection failure reads as a timeout rather than an immediate
     * transport error (DNS failure, TLS error, connection refused).
     */
    private function isTimeout(Throwable $exception): bool
    {
        $message = strtolower($exception->getMessage());

        foreach (self::TIMEOUT_HINTS as $hint) {
            if (str_contains($message, $hint)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Pull the coach text out of an Interaction, rejecting every unusable shape.
     *
     * @throws RuntimeException when the interaction failed, or has no usable text.
     */
    private function extractText(Response $response): string
    {
        $response->throw();

        $body = $response->json();

        if (! is_array($body)) {
            throw new RuntimeException('Gemini returned an unreadable response.');
        }

        $status = data_get($body, 'status');

        if (is_string($status) && in_array($status, self::DEAD_STATUSES, true)) {
            throw new RuntimeException("Gemini {$status} the interaction: {$this->errorMessage($body)}");
        }

        if ($status === 'requires_action') {
            throw new RuntimeException('Gemini asked for a tool call but none are declared.');
        }

        if ($status === self::INCOMPLETE_STATUS) {
            // The reply is usable but was cut short, so record why rather than
            // silently presenting a half sentence as a finished answer.
            Log::warning('Gemini interaction was incomplete (reply truncated)', [
                'reason' => $this->errorMessage($body),
                'usage' => $this->usageSummary($body),
            ]);
        }

        $text = $this->collectModelOutput($body);

        if ($text === null || trim($text) === '') {
            $reason = $this->errorMessage($body);

            throw new RuntimeException('Gemini returned an empty response'.($reason !== '' ? ": {$reason}" : '.'));
        }

        return trim($text);
    }

    /**
     * Join the text blocks of every `model_output` step, ignoring `thought`
     * steps and any other non-text content.
     *
     * @param  array<string, mixed>  $body
     */
    private function collectModelOutput(array $body): ?string
    {
        $steps = data_get($body, 'steps');

        if (! is_array($steps)) {
            return null;
        }

        $chunks = [];

        foreach ($steps as $step) {
            if (! is_array($step) || ($step['type'] ?? null) !== 'model_output') {
                continue;
            }

            $content = $step['content'] ?? null;

            if (! is_array($content)) {
                continue;
            }

            foreach ($content as $block) {
                $text = is_array($block) ? ($block['text'] ?? null) : null;

                if (($block['type'] ?? null) === 'text' && is_string($text) && $text !== '') {
                    $chunks[] = $text;
                }
            }
        }

        return $chunks === [] ? null : implode("\n", $chunks);
    }

    /**
     * A compact usage read-out for a truncated interaction, so the log shows how
     * much of the reply budget went to thinking versus the visible text.
     *
     * @param  array<string, mixed>  $body
     * @return array<string, int>
     */
    private function usageSummary(array $body): array
    {
        return [
            'output_tokens' => (int) data_get($body, 'usage.total_output_tokens', 0),
            'thought_tokens' => (int) data_get($body, 'usage.total_thought_tokens', 0),
            'total_tokens' => (int) data_get($body, 'usage.total_tokens', 0),
        ];
    }

    /**
     * Best-effort human message from the interaction's `errors` (or a plain
     * API error body) for the exception and the log line.
     *
     * @param  array<string, mixed>  $body
     */
    private function errorMessage(array $body): string
    {
        $errors = data_get($body, 'errors');

        if (is_array($errors) && $errors !== []) {
            $messages = [];

            foreach ($errors as $error) {
                if (is_array($error)) {
                    $messages[] = trim(($error['code'] ?? '').' '.($error['message'] ?? ''));
                } elseif (is_string($error)) {
                    $messages[] = $error;
                }
            }

            $messages = array_filter($messages);

            if ($messages !== []) {
                return implode('; ', $messages);
            }
        }

        $message = data_get($body, 'error.message');

        return is_string($message) ? $message : 'no detail provided';
    }

    /**
     * Normalise an optional string config value, treating blank as "unset".
     */
    private function optionalString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }

    /**
     * Normalise an optional integer config value, treating blank as "unset".
     */
    private function optionalInt(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function systemPrompt(): string
    {
        return implode(' ', [
            'You are a concise productivity coach inside a calendar app called ShiftGrid.',
            'Given structured facts about the user\'s day, give practical, upbeat feedback.',
            'Reply with 2 to 4 short lines. Each line starts with one of: "Good:", "Watch:", "Do:".',
            'Use plain text only. No markdown, no headings, no bullet characters, no asterisks.',
            'Reference concrete times and durations from the facts. Never invent events.',
            'freeMs is only the unbooked gaps; workableMs is the time left to work today.',
            'Focus blocks and work events are work, so they never reduce workableMs.',
            'Compare any goal or backlog against workableMs, never freeMs.',
            'Study blocks are fixed commitments that consume the day but never count as work hours.',
            'Never add study time to the work goal; only mention study when it changes the read-out.',
            'If the day is already handled, say so plainly instead of inventing work.',
        ]);
    }

    /**
     * @param  array<string, mixed>  $facts
     */
    private function userPrompt(array $facts): string
    {
        $json = json_encode($facts, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return implode("\n", [
            'Here are the facts for the user\'s day (times are in the user\'s local timezone):',
            $json === false ? '{"error":"facts could not be encoded"}' : $json,
            '',
            'Write the coaching read-out now.',
        ]);
    }

    /**
     * Persona + grounding rules + the data snapshot for a batch placement turn.
     *
     * @param  array<string, mixed>  $context
     */
    private function planSystemPrompt(array $context): string
    {
        $json = json_encode($context, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $timeZone = is_string($context['timeZone'] ?? null) && $context['timeZone'] !== ''
            ? $context['timeZone']
            : 'unknown';
        $offsetMinutes = $context['utcOffsetMinutes'] ?? null;

        return implode("\n", [
            'You are the scheduling assistant inside a work-hours tracker called ShiftGrid.',
            'You get a snapshot of the user\'s calendar, work hours and workload, plus a list of unscheduled personal tasks.',
            'The snapshot is the single source of truth: never invent events, hours, days or numbers.',
            'Propose the best day and time for every task in the list, using only the free time the snapshot supports.',
            'A gap only works if it is at least as long as the task\'s estimate in minutes.',
            'Never overlap a meeting or tracked session, and keep the tasks from overlapping each other.',
            'Treat study blocks and tracked sessions as busy time too: never place a task over them.',
            'Study time never reduces the work the user still owes for the week.',
            sprintf(
                'Every timestamp is ISO-8601 in UTC (it ends with Z). The user is in %s (%s), so convert',
                $timeZone,
                $this->formatUtcOffset($offsetMinutes),
            ),
            'each time into that local clock and never quote a raw ISO timestamp back to the user.',
            $this->localNowLine($context),
            'Never propose a day earlier than today, and never propose a time that has already passed.',
            'Slots before the current local time are invalid even when the snapshot shows free time there: earlier today is gone.',
            'week.days and horizon rows for days before today are history — ignore their window and hours entirely.',
            'A slot later on today is still today: say "later today", never name a future weekday for it.',
            'Pick slots from the horizon and week.days lists below: each gives a day with its window, busy hours and free hours.',
            'Only use a day whose dataCovered is true, so you never place a task into a day whose calendar was not loaded.',
            'Only propose a day whose freeHours is at least the task\'s estimate in minutes divided by 60.',
            'Prefer the current week or the one right after: use free gaps on days the user can work, and keep the remaining work for the week in mind.',
            'If the remaining work for this week will not fit in the free time left, say so and place those tasks next week instead.',
            'Write exactly one short line per task: the reason first, then the marker.',
            'The marker is [[PLAN:<task id>|<YYYY-MM-DD HH:MM>]] with the user\'s LOCAL clock time, never UTC.',
            'Only use ids from the task list below, and never add a marker for a task you did not place.',
            'Plain text only — no markdown, no headings, no bullet characters, no asterisks.',
            '',
            'Current snapshot:',
            $json === false ? '{"error":"context could not be encoded"}' : $json,
        ]);
    }

    /**
     * The candidate tasks to place, appended after the snapshot in the prompt.
     *
     * @param  array<int, array{id: int, title: string, estimateMinutes: int, blocksWork: bool}>  $tasks
     */
    private function planUserPrompt(array $tasks): string
    {
        $json = json_encode($tasks, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return implode("\n", [
            'Unscheduled tasks to place (id, title, estimate in minutes, whether they block work time):',
            $json === false ? '[]' : $json,
            '',
            'Propose a slot for each task now.',
        ]);
    }

    /**
     * A plain-language anchor for "right now" in the user's own zone.
     *
     * The snapshot only carries ISO-8601 UTC, so the model has to do the
     * timezone and weekday arithmetic itself — and it routinely gets the weekday
     * wrong, which is how a task on a Saturday ends up "placed on Saturday".
     * Spelling the local date and clock out removes that whole class of mistake.
     *
     * @param  array<string, mixed>  $context
     */
    private function localNowLine(array $context): string
    {
        $now = is_string($context['now'] ?? null) ? $context['now'] : '';
        $timeZone = is_string($context['timeZone'] ?? null) && $context['timeZone'] !== '' ? $context['timeZone'] : 'UTC';

        $stamp = strtotime($now);
        if ($stamp === false) {
            return 'The current local date and time are unknown, so never name a weekday for "today".';
        }

        try {
            $zone = new DateTimeZone($timeZone);
        } catch (Throwable) {
            $zone = new DateTimeZone('UTC');
        }

        // "@" timestamps are always UTC, so this is a safe base to convert from.
        $local = (new DateTimeImmutable('@'.$stamp))->setTimezone($zone);

        return sprintf(
            'Today is %s in the user\'s zone, and the local time now is %s.',
            $local->format('l, j F Y'),
            $local->format('H:i'),
        );
    }

    /**
     * Render a UTC offset as "+02:00", "−05:30" or "UTC" when unavailable.
     */
    private function formatUtcOffset(mixed $minutes): string
    {
        if (! is_numeric($minutes)) {
            return 'an unknown offset';
        }

        $minutes = (int) $minutes;
        $sign = $minutes < 0 ? '-' : '+';
        $absolute = abs($minutes);

        return sprintf('%s%02d:%02d', $sign, intdiv($absolute, 60), $absolute % 60);
    }
}
