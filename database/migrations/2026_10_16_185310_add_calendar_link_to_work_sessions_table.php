<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('work_sessions', function (Blueprint $table) {
            $table->string('source')->default('manual')->after('note');
            $table->foreignId('calendar_account_id')->nullable()->after('source')
                ->constrained()->nullOnDelete();
            $table->string('calendar_event_id')->nullable()->after('calendar_account_id');

            // One tracked session per calendar event; both columns are null for manual rows,
            // and unique indexes tolerate repeated nulls on MySQL and SQLite.
            $table->unique(['calendar_account_id', 'calendar_event_id']);
        });
    }

    public function down(): void
    {
        Schema::table('work_sessions', function (Blueprint $table) {
            $table->dropUnique(['calendar_account_id', 'calendar_event_id']);
            $table->dropConstrainedForeignId('calendar_account_id');
            $table->dropColumn(['source', 'calendar_event_id']);
        });
    }
};
