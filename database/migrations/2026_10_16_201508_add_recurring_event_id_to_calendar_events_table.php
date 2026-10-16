<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            // Google's series id shared by every occurrence of a recurring event.
            $table->string('recurring_event_id')->nullable()->after('event_id');

            $table->index(['calendar_account_id', 'recurring_event_id']);
        });
    }

    public function down(): void
    {
        Schema::table('calendar_events', function (Blueprint $table) {
            $table->dropIndex(['calendar_account_id', 'recurring_event_id']);
            $table->dropColumn('recurring_event_id');
        });
    }
};
