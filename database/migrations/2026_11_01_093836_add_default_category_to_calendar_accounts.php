<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('calendar_accounts', function (Blueprint $table) {
            // Every event synced from this mailbox inherits this category unless
            // the event itself has been given one.
            $table->foreignId('default_category_id')->nullable()->after('default_work')
                ->constrained('categories')->nullOnDelete();
        });

        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            // Distinguishes "this event has no category" from "this event has no
            // category of its own, so use the mailbox's". Without it, clearing a
            // category would silently fall back to the mailbox default.
            $table->boolean('category_override')->default(false)->after('category_id');
        });

        // Any category already set on an occurrence was an explicit choice.
        DB::table('calendar_event_overrides')
            ->whereNotNull('category_id')
            ->update(['category_override' => true]);
    }

    public function down(): void
    {
        Schema::table('calendar_event_overrides', function (Blueprint $table) {
            $table->dropColumn('category_override');
        });

        Schema::table('calendar_accounts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('default_category_id');
        });
    }
};
