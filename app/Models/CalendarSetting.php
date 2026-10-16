<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

#[Fillable(['user_id', 'work_start', 'work_end', 'work_keywords', 'work_days'])]
class CalendarSetting extends Model
{
    use HasFactory;

    /** Sunday = 0 … Saturday = 6 (matches JS `getDay()` and Carbon `dayOfWeek`). */
    public const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

    protected function casts(): array
    {
        return [
            'work_keywords' => 'array',
            'work_days' => 'array',
        ];
    }

    public static function forUser(User $user): self
    {
        return self::firstOrCreate(
            ['user_id' => $user->id],
            [
                'work_start' => '06:00',
                'work_end' => '22:00',
                'work_keywords' => ['standup', 'client', 'sprint', 'review', 'sync'],
                'work_days' => self::DEFAULT_WORK_DAYS,
            ],
        );
    }

    /**
     * The user's working weekdays, falling back to Mon–Fri for legacy rows.
     *
     * @return array<int, int>
     */
    public function workDays(): array
    {
        $days = $this->work_days;

        if (! is_array($days) || $days === []) {
            return self::DEFAULT_WORK_DAYS;
        }

        $days = array_values(array_unique(array_map('intval', $days)));
        sort($days);

        return array_values(array_filter($days, fn (int $day): bool => $day >= 0 && $day <= 6));
    }

    public function isWorkDay(Carbon $date): bool
    {
        return in_array($date->dayOfWeek, $this->workDays(), true);
    }

    /**
     * @return array{workStart: string, workEnd: string, workKeywords: array<int, string>, workDays: array<int, int>}
     */
    public function toApi(): array
    {
        return [
            'workStart' => $this->work_start,
            'workEnd' => $this->work_end,
            'workKeywords' => array_values($this->work_keywords ?? []),
            'workDays' => $this->workDays(),
        ];
    }
}
