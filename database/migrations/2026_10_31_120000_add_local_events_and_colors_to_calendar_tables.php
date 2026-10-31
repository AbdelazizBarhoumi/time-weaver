<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            // Rows that exist only here (a duplicated event); Google never sent them,
            // so a sync must not treat them as stale and delete them.
            $table->boolean('is_local')->default(false)->after('event_color');

            $table->index(['calendar_account_id', 'is_local']);
        });

        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            // A color-only override has no times, so the moved times become optional.
            $table->dateTime('start')->nullable()->change();
            $table->dateTime('end')->nullable()->change();
            // The user's own color for this occurrence, picked in the calendar menu.
            $table->string('color', 7)->nullable()->after('end');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            // Drop the color-only rows first: they cannot satisfy NOT NULL times.
            $table->dropColumn('color');
        });

        DB::table('calendar_event_overrides')->whereNull('start')->orWhereNull('end')->delete();

        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            $table->dateTime('start')->nullable(false)->change();
            $table->dateTime('end')->nullable(false)->change();
        });

        Schema::table('calendar_events', function (Blueprint $table) {
            $table->dropIndex(['calendar_account_id', 'is_local']);
            $table->dropColumn('is_local');
        });
    }
};
