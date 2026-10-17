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
        Schema::create('side_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->unsignedSmallInteger('estimate_minutes')->default(30);
            $table->dateTime('start')->nullable();
            $table->dateTime('end')->nullable();
            $table->dateTime('completed_at')->nullable();
            // Whether a placed task counts against the user's work time.
            $table->boolean('blocks_work')->default(true);
            $table->timestamps();

            $table->index(['user_id', 'start']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('side_tasks');
    }
};
