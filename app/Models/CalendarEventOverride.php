<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A locally moved Google event. The cache keeps the times Google sent, so a
 * later sync cannot revert the drag; this override wins when the calendar reads
 * the event back.
 */
#[Fillable(['user_id', 'calendar_account_id', 'event_id', 'recurring_event_id', 'start', 'end'])]
class CalendarEventOverride extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return [
            'start' => 'datetime',
            'end' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(CalendarAccount::class, 'calendar_account_id');
    }
}
