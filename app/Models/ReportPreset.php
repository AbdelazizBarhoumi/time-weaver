<?php

namespace App\Models;

use Database\Factories\ReportPresetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'name', 'config', 'is_default'])]
class ReportPreset extends Model
{
    /** @use HasFactory<ReportPresetFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'config' => 'array',
            'is_default' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return array{id: int, name: string, config: array<string, mixed>, isDefault: bool, updatedAt: string|null}
     */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'config' => $this->config ?? [],
            'isDefault' => $this->is_default,
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
