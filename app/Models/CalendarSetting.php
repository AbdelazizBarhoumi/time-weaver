<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

#[Fillable(['user_id', 'work_start', 'work_end', 'work_keywords', 'work_days', 'required_days'])]
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
            'required_days' => 'array',
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
                'required_days' => self::DEFAULT_WORK_DAYS,
            ],
        );
    }

    /**
     * The weekdays the user *can* work. Drives "is this a day off?" styling; a day
     * here does not oblige any hours.
     *
     * @return array<int, int>
     */
    public function workDays(): array
    {
        return $this->normalizeDays($this->work_days);
    }

    /**
     * The weekdays the user *must* work. Drives the 8h/day backlog and the monthly
     * targets, so extra days the user only sometimes works cost them nothing.
     *
     * @return array<int, int>
     */
    public function requiredDays(): array
    {
        return $this->normalizeDays($this->required_days);
    }

    public function isWorkDay(Carbon $date): bool
    {
        return in_array($date->dayOfWeek, $this->workDays(), true);
    }

    public function isRequiredDay(Carbon $date): bool
    {
        return in_array($date->dayOfWeek, $this->requiredDays(), true);
    }

    /**
     * Normalize a stored weekday list, falling back to Mon–Fri for null/empty rows.
     *
     * @param  array<int, mixed>|null  $days
     * @return array<int, int>
     */
    private function normalizeDays(?array $days): array
    {
        if (! is_array($days) || $days === []) {
            return self::DEFAULT_WORK_DAYS;
        }

        $days = array_values(array_unique(array_map('intval', $days)));
        sort($days);

        return array_values(array_filter($days, fn (int $day): bool => $day >= 0 && $day <= 6));
    }

    /**
     * @return array{workStart: string, workEnd: string, workKeywords: array<int, string>, workDays: array<int, int>, requiredDays: array<int, int>}
     */
    public function toApi(): array
    {
        return [
            'workStart' => $this->work_start,
            'workEnd' => $this->work_end,
            'workKeywords' => array_values($this->work_keywords ?? []),
            'workDays' => $this->workDays(),
            'requiredDays' => $this->requiredDays(),
        ];
    }
}
