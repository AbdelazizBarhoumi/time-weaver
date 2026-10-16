<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('calendar_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider')->default('google');
            $table->string('email');
            $table->string('color', 16)->default('#5b9cff');
            $table->text('access_token');
            $table->text('refresh_token')->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'provider', 'email']);
        });

        Schema::create('calendar_event_tags', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('calendar_account_id')->constrained()->cascadeOnDelete();
            $table->string('event_id');
            $table->boolean('is_work');
            $table->timestamps();

            $table->unique(['calendar_account_id', 'event_id']);
        });

        Schema::create('calendar_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('work_start', 5)->default('06:00');
            $table->string('work_end', 5)->default('22:00');
            $table->json('work_keywords')->nullable();
            $table->timestamps();
        });

        Schema::create('focus_blocks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title')->default('Focus block');
            $table->dateTime('start');
            $table->dateTime('end');
            $table->timestamps();

            $table->index(['user_id', 'start']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('focus_blocks');
        Schema::dropIfExists('calendar_settings');
        Schema::dropIfExists('calendar_event_tags');
        Schema::dropIfExists('calendar_accounts');
    }
};
