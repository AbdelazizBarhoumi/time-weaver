<?php

namespace App\Models;

use Database\Factories\SideTaskFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A personal "side task" — cleaning the room, a class to attend — with an
 * estimate, optionally placed on the calendar. A placed task auto-completes once
 * its slot has passed, and can also be completed by hand.
 */
#[Fillable(['user_id', 'category_id', 'title', 'estimate_minutes', 'start', 'end', 'completed_at', 'blocks_work'])]
class SideTask extends Model
{
    /** @use HasFactory<SideTaskFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'start' => 'datetime',
            'end' => 'datetime',
            'completed_at' => 'datetime',
            'estimate_minutes' => 'integer',
            'blocks_work' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    /**
     * A task is done when the user finished it by hand, or when its scheduled
     * slot has already passed.
     */
    public function isDone(?Carbon $now = null): bool
    {
        if ($this->completed_at !== null) {
            return true;
        }

        return $this->end !== null && $this->end->lessThanOrEqualTo($now ?? now());
    }

    /**
     * When the task actually ends: the planned end, or the moment it was
     * finished early — clamped into its own slot so the block never runs past
     * the plan or ends before it starts.
     */
    public function effectiveEnd(): ?Carbon
    {
        if ($this->end === null) {
            return null;
        }

        if ($this->completed_at === null || $this->start === null) {
            return $this->end;
        }

        if ($this->completed_at->lessThan($this->start)) {
            return $this->start;
        }

        return $this->completed_at->lessThan($this->end) ? $this->completed_at : $this->end;
    }

    /**
     * @return array{id: int, title: string, estimateMinutes: int, blocksWork: bool, start: string|null, end: string|null, completedAt: string|null, done: bool, category: array<string, mixed>|null}
     */
    public function toApi(?Carbon $now = null): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'estimateMinutes' => $this->estimate_minutes,
            'blocksWork' => (bool) $this->blocks_work,
            'start' => $this->start?->toIso8601String(),
            'end' => $this->effectiveEnd()?->toIso8601String(),
            'completedAt' => $this->completed_at?->toIso8601String(),
            'done' => $this->isDone($now),
            'category' => $this->category?->toApi(),
        ];
    }
}
