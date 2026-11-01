<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A local edit to a cached Google event: the times it was dragged to and/or the
 * color the user picked. The cache keeps what Google sent, so a later sync
 * cannot revert the change; this override wins when the calendar reads it back.
 */
#[Fillable(['user_id', 'calendar_account_id', 'event_id', 'recurring_event_id', 'start', 'end', 'color', 'category_id', 'category_override'])]
class CalendarEventOverride extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return [
            'start' => 'datetime',
            'end' => 'datetime',
            'category_override' => 'boolean',
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

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }
}
