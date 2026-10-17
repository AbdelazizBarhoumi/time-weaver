<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
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
     * Continue (or start) a multi-turn coaching conversation.
     *
     * The API is used statelessly: `store` is false and the whole transcript is
     * replayed on every turn. Rather than echoing the model's opaque steps back
     * (which would drag provider-specific signatures through the client), the
     * transcript is rendered as plain text, which keeps each turn independent.
     *
     * @param  array<int, array{role: string, content: string}>  $messages  Oldest first; ends with the new user turn.
     * @param  array<string, mixed>  $context  A fresh snapshot of the user's day/week/month data.
     *
     * @throws RuntimeException when the service is not configured, the request fails, or the reply is unusable.
     */
    public function chat(array $messages, array $context): string
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('Gemini is not configured.');
        }

        $response = $this->send($this->chatPayload($messages, $context));

        return $this->extractText($response);
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
     * The request body for a chat turn: the same model and sampling controls,
     * but the system instruction carries a data snapshot and the input is the
     * replayed transcript.
     *
     * @param  array<int, array{role: string, content: string}>  $messages
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private function chatPayload(array $messages, array $context): array
    {
        return [
            'model' => $this->model(),
            'system_instruction' => $this->chatSystemPrompt($context),
            'input' => $this->chatUserPrompt($messages),
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
     * Persona + grounding rules + the data snapshot the chat can answer from.
     *
     * @param  array<string, mixed>  $context
     */
    private function chatSystemPrompt(array $context): string
    {
        $json = json_encode($context, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $timeZone = is_string($context['timeZone'] ?? null) && $context['timeZone'] !== ''
            ? $context['timeZone']
            : 'unknown';
        $offsetMinutes = $context['utcOffsetMinutes'] ?? null;

        return implode("\n", [
            'You are the AI coach inside a work-hours tracker called ShiftGrid.',
            'The user asks you questions about their own schedule, workload and pace, and you guide them.',
            'The snapshot below is the single source of truth. Use only the data in it.',
            'Never invent events, meetings, hours or numbers, and never contradict the snapshot.',
            'Do the arithmetic yourself wherever the snapshot supports it: free = window minus busy,',
            'still owed today = remaining goal, week left = target minus done, per day = remaining divided by days left.',
            'Never answer "I cannot tell" when a subtraction or division over the snapshot answers the question.',
            'Treat the requiredDays list as the days the user must work; any other weekday is optional, not owed.',
            'If the snapshot genuinely lacks something, say so plainly and ask for what you need.',
            'Answer the user\'s actual question first, then add at most one short, concrete suggestion.',
            'Be concise: 1 to 4 short sentences, or a few short lines.',
            'Plain text only — no markdown, no headings, no bullet characters, no asterisks.',
            'Quote concrete times and durations from the snapshot when they help.',
            'Keep the thread coherent: you can refer back to earlier turns in the conversation.',
            sprintf(
                'Every timestamp is ISO-8601 in UTC (it ends with Z). The user is in %s (%s), so convert',
                $timeZone,
                $this->formatUtcOffset($offsetMinutes),
            ),
            'each time into that local clock and never quote a raw ISO timestamp back to the user.',
            '',
            'Current snapshot:',
            $json === false ? '{"error":"context could not be encoded"}' : $json,
        ]);
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

    /**
     * Render the replayed transcript as plain text, ending with the turn to answer.
     *
     * @param  array<int, array{role: string, content: string}>  $messages
     */
    private function chatUserPrompt(array $messages): string
    {
        $lines = ['Conversation so far (oldest first):'];

        foreach ($messages as $message) {
            $content = trim((string) ($message['content'] ?? ''));

            if ($content === '') {
                continue;
            }

            $role = ($message['role'] ?? '') === 'assistant' ? 'Coach' : 'User';
            $lines[] = "{$role}: {$content}";
        }

        $lines[] = '';
        $lines[] = 'Reply to the last User message now, as the Coach.';

        return implode("\n", $lines);
    }
}
