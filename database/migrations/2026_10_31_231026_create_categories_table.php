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
        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 60);
            // A visual theme: a hex accent, one icon from the allowlist, one of
            // three accent styles (solid, outline, stripe). Never color alone.
            $table->string('color', 7);
            $table->string('icon', 32)->default('Star');
            $table->string('style', 16)->default('solid');
            $table->timestamps();

            $table->unique(['user_id', 'name']);
        });

        Schema::table('side_tasks', function (Blueprint $table) {
            $table->foreignId('category_id')->nullable()->after('user_id')->constrained()->nullOnDelete();
        });

        Schema::table('focus_blocks', function (Blueprint $table) {
            $table->foreignId('category_id')->nullable()->after('user_id')->constrained()->nullOnDelete();
        });

        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            // Categories live on the override, like colors, so the cached event
            // row stays a pure mirror of Google.
            $table->foreignId('category_id')->nullable()->after('end')->constrained()->nullOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            $table->dropConstrainedForeignId('category_id');
        });

        Schema::table('focus_blocks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('category_id');
        });

        Schema::table('side_tasks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('category_id');
        });

        Schema::dropIfExists('categories');
    }
};
