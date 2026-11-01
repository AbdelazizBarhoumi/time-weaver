<?php

namespace App\Models;

use Database\Factories\CategoryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A user's own label for a kind of work — "Deep work", "Errands" — carrying a
 * visual theme (color, icon and accent style) that tasks, focus blocks and
 * calendar events all render with.
 */
#[Fillable(['user_id', 'name', 'color', 'icon', 'style'])]
class Category extends Model
{
    /** @use HasFactory<CategoryFactory> */
    use HasFactory;

    /** Icons the client knows how to draw; the API refuses anything else. */
    public const ICONS = [
        'Briefcase',
        'BookOpen',
        'Home',
        'Cart',
        'Dumbbell',
        'Heart',
        'Music',
        'Plane',
        'Code',
        'Phone',
        'Coffee',
        'Users',
        'Wallet',
        'Wrench',
        'Palette',
        'Star',
    ];

    /** How the accent is painted: filled, outlined, or striped. */
    public const STYLES = ['solid', 'outline', 'stripe'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function sideTasks(): HasMany
    {
        return $this->hasMany(SideTask::class);
    }

    public function focusBlocks(): HasMany
    {
        return $this->hasMany(FocusBlock::class);
    }

    public function eventOverrides(): HasMany
    {
        return $this->hasMany(CalendarEventOverride::class);
    }

    /** Mailboxes that use this category for every synced event by default. */
    public function defaultAccounts(): HasMany
    {
        return $this->hasMany(CalendarAccount::class, 'default_category_id');
    }

    /**
     * @return array{id: int, name: string, color: string, icon: string, style: string, usageCount?: int}
     */
    public function toApi(?int $usageCount = null): array
    {
        $payload = [
            'id' => $this->id,
            'name' => $this->name,
            'color' => $this->color,
            'icon' => $this->icon,
            'style' => $this->style,
        ];

        if ($usageCount !== null) {
            $payload['usageCount'] = $usageCount;
        }

        return $payload;
    }
}
