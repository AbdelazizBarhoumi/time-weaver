<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calendar_event_overrides', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('calendar_account_id')->constrained()->cascadeOnDelete();
            // The single occurrence that was dragged; the cached row keeps its
            // Google times, so a later sync cannot undo the move.
            $table->string('event_id');
            // The Google series the occurrence belongs to, when it recurs.
            $table->string('recurring_event_id')->nullable();
            // The times the user moved it to. All-day events land on UTC midnight.
            $table->dateTime('start');
            $table->dateTime('end');
            $table->timestamps();

            // One override per occurrence per account; re-dragging refreshes it.
            // Names are explicit because the auto-generated ones exceed MySQL's 64-char limit.
            $table->unique(['calendar_account_id', 'event_id'], 'ceo_account_event_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_event_overrides');
    }
};
