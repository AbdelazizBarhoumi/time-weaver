<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_accounts', function (Blueprint $table) {
            // Treat every timed event from this mailbox as work unless tagged otherwise.
            $table->boolean('default_work')->default(false)->after('color');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_accounts', function (Blueprint $table) {
            $table->dropColumn('default_work');
        });
    }
};
