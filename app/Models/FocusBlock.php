<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'category_id', 'title', 'start', 'end'])]
class FocusBlock extends Model
{
    protected function casts(): array
    {
        return ['start' => 'datetime', 'end' => 'datetime'];
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
     * @return array{id: int, title: string, start: string, end: string, category: array<string, mixed>|null}
     */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'start' => $this->start->toIso8601String(),
            'end' => $this->end->toIso8601String(),
            'category' => $this->category?->toApi(),
        ];
    }
}
