<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['user_id', 'work_start', 'work_end', 'work_keywords'])]
class CalendarSetting extends Model
{
    protected function casts(): array
    {
        return ['work_keywords' => 'array'];
    }

    public static function forUser(User $user): self
    {
        return self::firstOrCreate(
            ['user_id' => $user->id],
            ['work_start' => '06:00', 'work_end' => '22:00', 'work_keywords' => ['standup', 'client', 'sprint', 'review', 'sync']],
        );
    }

    /**
     * @return array{workStart: string, workEnd: string, workKeywords: array<int, string>}
     */
    public function toApi(): array
    {
        return [
            'workStart' => $this->work_start,
            'workEnd' => $this->work_end,
            'workKeywords' => array_values($this->work_keywords ?? []),
        ];
    }
}
