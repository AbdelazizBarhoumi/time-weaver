<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

#[Fillable(['user_id', 'start', 'end', 'note', 'type', 'source', 'calendar_account_id', 'calendar_event_id', 'paused_ms', 'paused_at', 'segments'])]
#[Hidden(['pivot'])]
class WorkSession extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return [
            'start' => 'datetime',
            'end' => 'datetime',
            'paused_at' => 'datetime',
            'paused_ms' => 'integer',
            'segments' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function calendarAccount(): BelongsTo
    {
        return $this->belongsTo(CalendarAccount::class);
    }

    protected function isFromCalendar(): Attribute
    {
        return Attribute::make(
            get: fn (): bool => $this->source === 'calendar',
        );
    }

    protected function isStudy(): Attribute
    {
        return Attribute::make(
            get: fn (): bool => $this->type === 'study',
        );
    }

    protected function durationMs(): Attribute
    {
        return Attribute::make(
            get: function (): int {
                $start = $this->start->getTimestampMs();
                $end = $this->end?->getTimestampMs() ?? now()->getTimestampMs();
                $paused = $this->paused_ms;
                if ($this->paused_at) {
                    $paused += now()->getTimestampMs() - $this->paused_at->getTimestampMs();
                }

                return max(0, $end - $start - $paused);
            },
        );
    }

    protected function durationHours(): Attribute
    {
        return Attribute::make(
            get: function (): float {
                return round($this->duration_ms / 3600000, 2);
            },
        );
    }

    protected function isActive(): Attribute
    {
        return Attribute::make(
            get: function (): bool {
                return $this->end === null;
            },
        );
    }

    protected function dayKey(): Attribute
    {
        return Attribute::make(
            get: function (): string {
                return $this->start->format('Y-m-d');
            },
        );
    }

    /**
     * The session's work/pause segments, always materialized.
     *
     * Rows recorded before segments existed (`segments` is null) get a
     * synthesized breakdown: the position of legacy pauses is unknown, so a
     * single pause block covering `paused_ms` is placed at the start while
     * the session runs, or at the end once it is completed.
     *
     * @return array<int, array{type: 'work'|'pause', start: string, end: string|null}>
     */
    public function effectiveSegments(): array
    {
        if (is_array($this->segments)) {
            return $this->segments;
        }

        return $this->synthesizeSegments();
    }

    /**
     * @return array<int, array{type: 'work'|'pause', start: string, end: string|null}>
     */
    private function synthesizeSegments(): array
    {
        $iso = static fn (int $ms): string => Carbon::createFromTimestampMs($ms)->toISOString();
        $startMs = $this->start->getTimestampMs();
        $closedPauseMs = max(0, $this->paused_ms);

        if ($this->end !== null) {
            $endMs = $this->end->getTimestampMs();

            if ($closedPauseMs === 0) {
                return [['type' => 'work', 'start' => $iso($startMs), 'end' => $iso($endMs)]];
            }

            $pauseStart = max($startMs, $endMs - $closedPauseMs);

            return [
                ['type' => 'work', 'start' => $iso($startMs), 'end' => $iso($pauseStart)],
                ['type' => 'pause', 'start' => $iso($pauseStart), 'end' => $iso($endMs)],
            ];
        }

        $segments = [];
        $workStart = $startMs;

        if ($closedPauseMs > 0) {
            $closedPauseEnd = min($startMs + $closedPauseMs, $this->paused_at?->getTimestampMs() ?? now()->getTimestampMs());
            $segments[] = ['type' => 'pause', 'start' => $iso($startMs), 'end' => $iso($closedPauseEnd)];
            $workStart = $closedPauseEnd;
        }

        if ($this->paused_at !== null) {
            $openPauseStart = max($workStart, $this->paused_at->getTimestampMs());

            if ($openPauseStart > $workStart) {
                $segments[] = ['type' => 'work', 'start' => $iso($workStart), 'end' => $iso($openPauseStart)];
            }

            $segments[] = ['type' => 'pause', 'start' => $iso($openPauseStart), 'end' => null];

            return $segments;
        }

        $segments[] = ['type' => 'work', 'start' => $iso($workStart), 'end' => null];

        return $segments;
    }
}
