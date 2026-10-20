<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('work_sessions', function (Blueprint $table) {
            // Links a tracked session to the task it was logged against.
            // Null on delete so removing a task never destroys tracked time.
            $table->foreignId('work_task_id')
                ->nullable()
                ->after('calendar_event_id')
                ->constrained('work_tasks')
                ->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('work_sessions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('work_task_id');
        });
    }
};
