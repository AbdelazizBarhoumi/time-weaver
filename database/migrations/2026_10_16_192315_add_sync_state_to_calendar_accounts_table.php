<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_accounts', function (Blueprint $table) {
            $table->dateTime('last_synced_at')->nullable()->after('expires_at');
            // Soft disconnect: the row (and its cached events/tags) survives.
            $table->dateTime('disconnected_at')->nullable()->after('last_synced_at');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_accounts', function (Blueprint $table) {
            $table->dropColumn(['last_synced_at', 'disconnected_at']);
        });
    }
};
