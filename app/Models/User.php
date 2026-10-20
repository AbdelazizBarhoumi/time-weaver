<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function workSessions(): HasMany
    {
        return $this->hasMany(WorkSession::class)->orderBy('start', 'desc');
    }

    public function dayOffs(): HasMany
    {
        return $this->hasMany(UserDayOff::class);
    }

    public function calendarAccounts(): HasMany
    {
        return $this->hasMany(CalendarAccount::class);
    }

    public function focusBlocks(): HasMany
    {
        return $this->hasMany(FocusBlock::class);
    }

    public function sideTasks(): HasMany
    {
        return $this->hasMany(SideTask::class);
    }

    public function workTasks(): HasMany
    {
        return $this->hasMany(WorkTask::class);
    }

    public function reportSetting(): HasOne
    {
        return $this->hasOne(ReportSetting::class);
    }

    public function reportPresets(): HasMany
    {
        return $this->hasMany(ReportPreset::class);
    }

    public function reports(): HasMany
    {
        return $this->hasMany(Report::class)->orderByDesc('generated_at');
    }
}
