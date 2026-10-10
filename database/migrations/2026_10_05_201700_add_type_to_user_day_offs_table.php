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
        Schema::table('user_day_offs', function (Blueprint $table) {
            $table->enum('type', ['excluded', 'included'])->default('excluded')->after('date');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('user_day_offs', function (Blueprint $table) {
            $table->dropColumn('type');
        });
    }
};
