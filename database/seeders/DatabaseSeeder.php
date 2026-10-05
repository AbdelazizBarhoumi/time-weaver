<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\WorkSession;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $user = User::factory()->create([
            'name' => 'Demo User',
            'email' => 'demo@example.com',
            'password' => bcrypt('password'),
        ]);

        $this->seedWorkSessions($user);
    }

    private function seedWorkSessions(User $user): void
    {
        $now = Carbon::now();
        $sessions = [];

        for ($daysAgo = 70; $daysAgo >= 1; $daysAgo--) {
            $date = $now->copy()->subDays($daysAgo);
            $dow = $date->dayOfWeek;

            if ($dow === Carbon::SUNDAY) {
                continue;
            }
            if ($dow === Carbon::SATURDAY && rand(0, 100) < 70) {
                continue;
            }
            if (rand(0, 100) < 12) {
                continue;
            }

            $remainingHours = 5.5 + rand(0, 40) / 10;
            $startHour = 8 + rand(0, 2);
            $startMinute = rand(0, 59);
            $cursor = $date->copy()->setTime($startHour, $startMinute, 0);

            while ($remainingHours > 0.4) {
                $chunk = min($remainingHours, 1 + rand(0, 25) / 10);
                $start = $cursor->copy();
                $end = $start->copy()->addMinutes($chunk * 60);

                $sessions[] = [
                    'user_id' => $user->id,
                    'start' => $start,
                    'end' => $end,
                    'note' => '',
                    'paused_ms' => 0,
                    'paused_at' => null,
                    'created_at' => $start,
                    'updated_at' => $start,
                ];

                $remainingHours -= $chunk;
                $cursor = $end->copy()->addMinutes((0.5 + rand(0, 25) / 10) * 60);

                if ($cursor->day !== $date->day) {
                    break;
                }
            }
        }

        if (! empty($sessions)) {
            WorkSession::insert($sessions);
        }
    }
}
