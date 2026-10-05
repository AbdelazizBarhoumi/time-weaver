<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'start', 'end', 'note', 'paused_ms', 'paused_at'])]
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
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
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
}
