<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calendar_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Kept when an account is disconnected; null only if the account row is removed.
            $table->foreignId('calendar_account_id')->nullable()->constrained()->nullOnDelete();
            // Snapshots so cached events survive a disconnect and still render with their identity.
            $table->string('account_email');
            $table->string('color', 16)->default('#5b9cff');
            $table->string('event_id');
            $table->string('calendar_id')->nullable();
            $table->string('calendar_name')->nullable();
            $table->string('title');
            $table->dateTime('start');
            $table->dateTime('end');
            $table->boolean('all_day')->default(false);
            $table->string('event_color', 32)->nullable();
            $table->dateTime('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['calendar_account_id', 'event_id']);
            $table->index(['user_id', 'start']);
            $table->index(['user_id', 'end']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_events');
    }
};
