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
        Schema::create('work_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->unsignedSmallInteger('estimate_minutes')->default(30);
            // First time the user tracked time against this task (drives "in progress").
            $table->dateTime('started_at')->nullable();
            // Ticked off by hand; nothing ever deletes a finished task.
            $table->dateTime('completed_at')->nullable();
            // Optional deadline; only used to flag the task as overdue.
            $table->dateTime('due_at')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'position']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('work_tasks');
    }
};
