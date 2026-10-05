<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->dateTime('start');
            $table->dateTime('end')->nullable();
            $table->text('note')->nullable();
            $table->unsignedBigInteger('paused_ms')->default(0);
            $table->dateTime('paused_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'start']);
            $table->index('start');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('work_sessions');
    }
};
