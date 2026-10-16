<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_settings', function (Blueprint $table) {
            // Working days of the week, 0 = Sunday … 6 = Saturday. Null defaults to Mon–Fri.
            $table->json('work_days')->nullable()->after('work_keywords');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_settings', function (Blueprint $table) {
            $table->dropColumn('work_days');
        });
    }
};
