<?php

namespace App\Models;

use App\Support\EncryptedString;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'provider', 'email', 'color', 'default_work', 'access_token', 'refresh_token', 'expires_at', 'last_synced_at', 'disconnected_at'])]
#[Hidden(['access_token', 'refresh_token'])]
class CalendarAccount extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return [
            'access_token' => EncryptedString::class,
            'refresh_token' => EncryptedString::class,
            'default_work' => 'boolean',
            'expires_at' => 'datetime',
            'last_synced_at' => 'datetime',
            'disconnected_at' => 'datetime',
        ];
    }

    public function isConnected(): bool
    {
        return $this->disconnected_at === null;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function tags(): HasMany
    {
        return $this->hasMany(CalendarEventTag::class);
    }

    /**
     * Events the user deleted for good, which a sync must never re-create.
     */
    public function dismissals(): HasMany
    {
        return $this->hasMany(CalendarEventDismissal::class);
    }
}
