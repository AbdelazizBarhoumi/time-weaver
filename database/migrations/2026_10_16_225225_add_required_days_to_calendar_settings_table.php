<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_settings', function (Blueprint $table) {
            // Days the user is *obliged* to work, 0 = Sunday … 6 = Saturday. These
            // drive the 8h/day backlog and monthly targets. `work_days` stays as
            // "days I can work", so extra days can be worked without being demanded.
            $table->json('required_days')->nullable()->after('work_days');
        });

        // Existing rows become "weekdays I already treat as working days", falling
        // back to Mon–Fri when the work week contains no weekday at all. This keeps
        // an all-seven-day work week from suddenly demanding a full weekend.
        foreach (DB::table('calendar_settings')->select('id', 'work_days')->get() as $row) {
            $workDays = json_decode($row->work_days ?? 'null', true);
            $workDays = is_array($workDays) ? array_map('intval', $workDays) : [1, 2, 3, 4, 5];
            $required = array_values(array_filter($workDays, fn (int $day): bool => $day >= 1 && $day <= 5));

            DB::table('calendar_settings')->where('id', $row->id)->update([
                'required_days' => json_encode($required === [] ? [1, 2, 3, 4, 5] : $required),
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('calendar_settings', function (Blueprint $table) {
            $table->dropColumn('required_days');
        });
    }
};
