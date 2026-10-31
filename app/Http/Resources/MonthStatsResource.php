<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MonthStatsResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'key' => $this['key'],
            'label' => $this['label'],
            'doneHours' => $this['doneHours'],
            'targetHours' => $this['targetHours'],
            'remainingHours' => $this['remainingHours'],
            'daysLeft' => $this['daysLeft'],
            'perDayNeeded' => $this['perDayNeeded'],
            'paceDeltaHours' => $this['paceDeltaHours'],
            'progress' => $this['progress'],
            'isCurrent' => $this['isCurrent'],
            'customDaysOff' => $this['customDaysOff'],
        ];
    }
}
