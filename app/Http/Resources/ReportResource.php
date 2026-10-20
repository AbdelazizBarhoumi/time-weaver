<?php

namespace App\Http\Resources;

use App\Services\ReportConfig;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReportResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        // Periods are calendar dates, so the label must never shift by timezone.
        $from = $this->period_from->copy();
        $to = $this->period_to->copy();

        return [
            'id' => $this->id,
            'title' => $this->title,
            'fileName' => $this->file_name,
            'fileSize' => $this->file_size,
            'format' => $this->format,
            'periodFrom' => $this->period_from->format('Y-m-d'),
            'periodTo' => $this->period_to->format('Y-m-d'),
            'periodLabel' => ReportConfig::periodLabel($from, $to),
            'generatedAt' => $this->generated_at?->toISOString(),
            'presetId' => $this->report_preset_id,
            'downloadUrl' => route('reports.download', ['report' => $this->id]),
        ];
    }
}
