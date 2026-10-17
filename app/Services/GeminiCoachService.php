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
     * The request body: model, system instruction, user input and sampling
     * controls.
     *
     * @param  array<string, mixed>  $facts
     * @return array<string, mixed>
     */
    private function payload(array $facts): array
    {
        return [
            'model' => (string) config('services.gemini.model', 'gemini-2.5-flash'),
            'system_instruction' => $this->systemPrompt(),
            'input' => $this->userPrompt($facts),
            'generation_config' => $this->generationConfig(),
            'store' => (bool) config('services.gemini.store', false),
        ];
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
}
