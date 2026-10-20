<?php

namespace App\Models;

use Database\Factories\ReportSettingFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

#[Fillable(['user_id', 'company_name', 'prepared_by', 'footer_text', 'accent_color', 'logo_path'])]
class ReportSetting extends Model
{
    /** @use HasFactory<ReportSettingFactory> */
    use HasFactory;

    public const DEFAULT_ACCENT = '#0f766e';

    public const DEFAULT_FOOTER = 'Generated with ShiftGrid';

    public static function forUser(User $user): self
    {
        return self::firstOrCreate(
            ['user_id' => $user->id],
            [
                'prepared_by' => $user->name,
                'footer_text' => self::DEFAULT_FOOTER,
                'accent_color' => self::DEFAULT_ACCENT,
            ],
        );
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The uploaded logo as a data URI, ready for both the preview and Dompdf.
     */
    public function logoDataUri(): ?string
    {
        if ($this->logo_path === null || ! Storage::disk('local')->exists($this->logo_path)) {
            return null;
        }

        $mime = Storage::disk('local')->mimeType($this->logo_path) ?: 'image/png';

        return 'data:'.$mime.';base64,'.base64_encode(Storage::disk('local')->get($this->logo_path));
    }

    /**
     * @return array{companyName: string|null, preparedBy: string|null, footerText: string|null, accentColor: string, logoDataUri: string|null}
     */
    public function toApi(): array
    {
        return [
            'companyName' => $this->company_name,
            'preparedBy' => $this->prepared_by,
            'footerText' => $this->footer_text,
            'accentColor' => $this->accent_color ?: self::DEFAULT_ACCENT,
            'logoDataUri' => $this->logoDataUri(),
        ];
    }
}
