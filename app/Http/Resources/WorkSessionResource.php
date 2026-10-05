<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WorkSessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'start' => $this->start?->toISOString(),
            'end' => $this->end?->toISOString(),
            'note' => $this->note,
            'pausedMs' => $this->paused_ms,
            'pausedAt' => $this->paused_at?->toISOString(),
            'durationMs' => $this->duration_ms,
            'durationHours' => $this->duration_hours,
            'isActive' => $this->is_active,
            'dayKey' => $this->day_key,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
