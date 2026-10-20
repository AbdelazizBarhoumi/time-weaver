<?php

namespace App\Support;

use Closure;

class EnvironmentFileGuard
{
    /**
     * The environment file reader.
     *
     * @var Closure(string): (string|false)
     */
    protected Closure $reader;

    /**
     * The path to the diagnostic log file.
     */
    protected string $logPath;

    public function __construct(
        protected string $basePath,
        ?Closure $reader = null,
        protected int $attempts = 10,
        protected int $delayMicroseconds = 100_000,
        ?string $logPath = null,
    ) {
        $this->reader = $reader ?? static fn (string $path): string|false => @file_get_contents($path);
        $this->logPath = $logPath ?? $basePath.'/storage/logs/environment-load.log';
    }

    /**
     * Ensure the given environment files can be read before the framework loads them.
     *
     * Laravel silently ignores unreadable environment files, which boots the
     * application with no environment at all: APP_ENV falls back to
     * "production" and APP_KEY becomes empty.
     */
    public function ensureReadable(string ...$files): void
    {
        foreach ($files as $file) {
            if (! is_file($file)) {
                continue;
            }

            if ($this->waitUntilReadable($file)) {
                continue;
            }

            $this->report($file);
        }
    }

    /**
     * Determine if the given file can be read, retrying transient failures.
     */
    protected function waitUntilReadable(string $file): bool
    {
        for ($attempt = 1; $attempt <= $this->attempts; $attempt++) {
            $contents = ($this->reader)($file);

            if (is_string($contents) && trim($contents) !== '') {
                return true;
            }

            if ($attempt < $this->attempts) {
                usleep($this->delayMicroseconds);
            }
        }

        return false;
    }

    /**
     * Write a diagnostic entry explaining why the environment file could not be read.
     */
    protected function report(string $file): void
    {
        $error = error_get_last();

        $entry = [
            'time' => date(DATE_ATOM),
            'pid' => getmypid(),
            'sapi' => PHP_SAPI,
            'script' => $_SERVER['SCRIPT_FILENAME'] ?? null,
            'port' => $_SERVER['SERVER_PORT'] ?? null,
            'file' => $file,
            'readable' => is_readable($file),
            'size' => @filesize($file),
            'attempts' => $this->attempts,
            'config_cached' => is_file($this->basePath.'/bootstrap/cache/config.php'),
            'error' => $error['message'] ?? null,
        ];

        if (! is_dir(dirname($this->logPath))) {
            @mkdir(dirname($this->logPath), 0777, true);
        }

        @file_put_contents(
            $this->logPath,
            json_encode($entry, JSON_UNESCAPED_SLASHES).PHP_EOL,
            FILE_APPEND | LOCK_EX,
        );
    }
}
