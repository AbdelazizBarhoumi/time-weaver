<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calendar_event_dismissals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('calendar_account_id')->constrained()->cascadeOnDelete();
            // A single dismissed occurrence, or the series id when the whole series was dismissed.
            $table->string('event_id');
            // Set only when a whole recurring series was dismissed.
            $table->string('recurring_event_id')->nullable();
            $table->timestamps();

            // One row per dismissed id per account; re-dismissing just refreshes it.
            // Names are explicit because the auto-generated ones exceed MySQL's 64-char limit.
            $table->unique(['calendar_account_id', 'event_id'], 'ced_account_event_unique');
            $table->index(['calendar_account_id', 'recurring_event_id'], 'ced_account_series_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_event_dismissals');
    }
};
