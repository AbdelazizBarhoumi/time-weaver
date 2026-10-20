<?php

namespace App\Models;

use Database\Factories\WorkTaskFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A work task — a to-do item from the work list, with an estimate, an
 * optional deadline, and real tracked time linked through work sessions.
 * The status is derived, never stored: tasks are never auto-deleted, and a
 * finished task stays in the list with its history intact.
 */
#[Fillable(['user_id', 'title', 'estimate_minutes', 'started_at', 'completed_at', 'due_at', 'position', 'notes'])]
class WorkTask extends Model
{
    /** @use HasFactory<WorkTaskFactory> */
    use HasFactory;

    /** Longest a single task may be estimated at, in minutes (24 hours). */
    public const MAX_ESTIMATE_MINUTES = 1440;

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
            'due_at' => 'datetime',
            'estimate_minutes' => 'integer',
            'position' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Every work session logged against this task — the source of its tracked time. */
    public function workSessions(): HasMany
    {
        return $this->hasMany(WorkSession::class);
    }

    /** A session currently running against this task, if any. */
    public function activeSession(): ?WorkSession
    {
        return $this->workSessions->firstWhere('end', null);
    }

    /**
     * Derived status — one of: active (timer running against it), in_progress
     * (it was started, or time was tracked against it at least once), todo, or
     * done.
     */
    public function status(): string
    {
        if ($this->completed_at !== null) {
            return 'done';
        }

        if ($this->activeSession() !== null) {
            return 'active';
        }

        return $this->hasBegun() ? 'in_progress' : 'todo';
    }

    /** Whether any real work has been recorded — a start stamp or tracked time. */
    private function hasBegun(): bool
    {
        return $this->started_at !== null || $this->workSessions->isNotEmpty();
    }

    /** Past its deadline and still not done. */
    public function isOverdue(?Carbon $now = null): bool
    {
        return $this->completed_at === null
            && $this->due_at !== null
            && $this->due_at->lessThan($now ?? now());
    }

    /**
     * Total time tracked against this task, in milliseconds. Open sessions
     * count up to the current moment, so the number is always live.
     */
    public function trackedMs(): int
    {
        return (int) $this->workSessions->sum(fn (WorkSession $session) => $session->duration_ms);
    }

    /**
     * @return array{id: int, title: string, estimateMinutes: int, startedAt: string|null, completedAt: string|null, dueAt: string|null, position: int, notes: string|null, status: string, overdue: bool, done: bool, trackedMs: int, activeSessionId: int|null}
     */
    public function toApi(?Carbon $now = null): array
    {
        $now ??= now();
        $status = $this->status();

        return [
            'id' => $this->id,
            'title' => $this->title,
            'estimateMinutes' => $this->estimate_minutes,
            'startedAt' => $this->started_at?->toIso8601String(),
            'completedAt' => $this->completed_at?->toIso8601String(),
            'dueAt' => $this->due_at?->toIso8601String(),
            'position' => $this->position,
            'notes' => $this->notes,
            'status' => $status,
            'overdue' => $this->isOverdue($now),
            'done' => $status === 'done',
            'trackedMs' => $this->trackedMs(),
            'activeSessionId' => $this->activeSession()?->id,
        ];
    }
}
