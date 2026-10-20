<?php

namespace Tests\Feature;

use App\Support\EnvironmentFileGuard;
use Closure;
use Tests\TestCase;

class EnvironmentFileGuardTest extends TestCase
{
    protected string $logPath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->logPath = storage_path('framework/testing/environment-load-'.getmypid().'.log');

        @unlink($this->logPath);
    }

    protected function tearDown(): void
    {
        @unlink($this->logPath);

        parent::tearDown();
    }

    public function test_readable_environment_file_does_not_write_a_diagnostic(): void
    {
        $file = $this->temporaryEnvironmentFile();

        $this->guard()->ensureReadable($file);

        $this->assertFileDoesNotExist($this->logPath);
    }

    public function test_missing_environment_file_is_ignored(): void
    {
        $this->guard()->ensureReadable(base_path('.env.missing'));

        $this->assertFileDoesNotExist($this->logPath);
    }

    public function test_transient_read_failures_are_retried(): void
    {
        $file = $this->temporaryEnvironmentFile();

        $reads = 0;

        $this->guard(reader: function (string $path) use (&$reads): string|false {
            $reads++;

            return $reads === 1 ? false : file_get_contents($path);
        })->ensureReadable($file);

        $this->assertSame(2, $reads);
        $this->assertFileDoesNotExist($this->logPath);
    }

    public function test_diagnostic_is_written_when_the_file_stays_unreadable(): void
    {
        $file = $this->temporaryEnvironmentFile();

        $this->guard(reader: fn (string $path): string|false => false)->ensureReadable($file);

        $this->assertFileExists($this->logPath);

        $entry = json_decode(trim(file_get_contents($this->logPath)), true);

        $this->assertSame($file, $entry['file']);
        $this->assertSame(5, $entry['attempts']);
        $this->assertArrayHasKey('pid', $entry);
        $this->assertArrayHasKey('sapi', $entry);
        $this->assertArrayHasKey('config_cached', $entry);
    }

    protected function guard(?Closure $reader = null): EnvironmentFileGuard
    {
        return new EnvironmentFileGuard(
            base_path(),
            reader: $reader,
            attempts: 5,
            delayMicroseconds: 0,
            logPath: $this->logPath,
        );
    }

    protected function temporaryEnvironmentFile(): string
    {
        $file = tempnam(sys_get_temp_dir(), 'environment-file-');

        file_put_contents($file, "APP_KEY=base64:secret\n");

        $this->beforeApplicationDestroyed(fn () => @unlink($file));

        return $file;
    }
}
