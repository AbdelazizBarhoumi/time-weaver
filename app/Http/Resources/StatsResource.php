<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StatsResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'streak' => $this['streak'],
            'weekHours' => $this['weekHours'],
            'bestDayHours' => $this['bestDayHours'],
            'avgPerActiveDay' => $this['avgPerActiveDay'],
            'totalHours' => $this['totalHours'],
            'backlogHours' => $this['backlogHours'],
        ];
    }
}
