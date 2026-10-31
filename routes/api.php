<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CalendarAccountController;
use App\Http\Controllers\CalendarEventController;
use App\Http\Controllers\CalendarInsightController;
use App\Http\Controllers\CalendarSettingsController;
use App\Http\Controllers\DayOffController;
use App\Http\Controllers\FocusBlockController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\ReportPresetController;
use App\Http\Controllers\ReportSettingController;
use App\Http\Controllers\SideTaskController;
use App\Http\Controllers\WorkSessionController;
use App\Http\Controllers\WorkTaskController;
use App\Models\WorkSession;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login']);
Route::post('/register', [AuthController::class, 'register']);

Route::middleware('auth:web')->group(function () {
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/logout', [AuthController::class, 'logout']);

    // Custom routes BEFORE apiResource
    Route::get('sessions/stats', [WorkSessionController::class, 'stats']);
    Route::get('sessions/monthly', [WorkSessionController::class, 'monthly']);
    Route::get('sessions/today', [WorkSessionController::class, 'today']);
    Route::delete('sessions/clear-all', [WorkSessionController::class, 'clearAll']);

    Route::apiResource('sessions', WorkSessionController::class)
        ->only(['index', 'store', 'show', 'update', 'destroy']);

    Route::get('day-offs', [DayOffController::class, 'index']);
    Route::post('day-offs', [DayOffController::class, 'store']);
    Route::delete('day-offs/{date}', [DayOffController::class, 'destroy']);

    // Calendar: connected Google accounts
    Route::get('calendar/accounts', [CalendarAccountController::class, 'index']);
    Route::post('calendar/accounts/connect', [CalendarAccountController::class, 'redirect']);
    Route::get('calendar/google/callback', [CalendarAccountController::class, 'callback']);
    Route::patch('calendar/accounts/{account}', [CalendarAccountController::class, 'update']);
    Route::delete('calendar/accounts/{account}', [CalendarAccountController::class, 'destroy']);
    Route::delete('calendar/accounts/{account}/events', [CalendarAccountController::class, 'purgeEvents']);
    Route::delete('calendar/accounts/{account}/dismissals', [CalendarAccountController::class, 'restoreEvents']);

    // Calendar: events and manual work tags
    Route::get('calendar/events', [CalendarEventController::class, 'index']);
    Route::post('calendar/sync', [CalendarEventController::class, 'sync']);
    Route::put('calendar/events/{event}', [CalendarEventController::class, 'update']);
    Route::delete('calendar/events/{event}', [CalendarEventController::class, 'destroy']);
    Route::post('calendar/events/{event}/duplicate', [CalendarEventController::class, 'duplicate']);
    Route::post('calendar/events/tag', [CalendarEventController::class, 'tag']);

    // Calendar: work-hours settings
    Route::get('calendar/settings', [CalendarSettingsController::class, 'show']);
    Route::put('calendar/settings', [CalendarSettingsController::class, 'update']);

    // Calendar: focus blocks
    Route::get('calendar/focus-blocks', [FocusBlockController::class, 'index']);
    Route::post('calendar/focus-blocks', [FocusBlockController::class, 'store']);
    Route::put('calendar/focus-blocks/{block}', [FocusBlockController::class, 'update']);
    Route::delete('calendar/focus-blocks/{block}', [FocusBlockController::class, 'destroy']);

    // Calendar: personal side tasks (todo list + optional placement)
    Route::get('side-tasks', [SideTaskController::class, 'index']);
    Route::post('side-tasks', [SideTaskController::class, 'store']);
    Route::post('side-tasks/plan', [SideTaskController::class, 'plan']);
    Route::put('side-tasks/{task}', [SideTaskController::class, 'update']);
    Route::delete('side-tasks/{task}', [SideTaskController::class, 'destroy']);

    // Work tasks: the home-page list, with derived status and tracked time
    Route::get('work-tasks', [WorkTaskController::class, 'index']);
    Route::post('work-tasks', [WorkTaskController::class, 'store']);
    Route::post('work-tasks/{task}/start', [WorkTaskController::class, 'start']);
    Route::put('work-tasks/{task}', [WorkTaskController::class, 'update']);
    Route::delete('work-tasks/{task}', [WorkTaskController::class, 'destroy']);

    // Calendar: day intelligence + optional AI coach
    Route::get('calendar/coach/status', [CalendarInsightController::class, 'status']);
    Route::post('calendar/coach', [CalendarInsightController::class, 'coach']);
    Route::post('calendar/coach/chat', [CalendarInsightController::class, 'chat']);

    // Reports: preview, saved PDFs, presets, and branding
    Route::get('reports/source-data', [ReportController::class, 'sourceData']);
    Route::post('reports/preview', [ReportController::class, 'preview']);
    Route::get('reports', [ReportController::class, 'index'])->name('reports.index');
    Route::post('reports', [ReportController::class, 'store'])->name('reports.store');
    Route::get('reports/{report}/download', [ReportController::class, 'download'])->whereNumber('report')->name('reports.download');
    Route::delete('reports/{report}', [ReportController::class, 'destroy'])->whereNumber('report')->name('reports.destroy');

    Route::get('report-presets', [ReportPresetController::class, 'index'])->name('report-presets.index');
    Route::post('report-presets', [ReportPresetController::class, 'store'])->name('report-presets.store');
    Route::put('report-presets/{preset}', [ReportPresetController::class, 'update'])->whereNumber('preset')->name('report-presets.update');
    Route::delete('report-presets/{preset}', [ReportPresetController::class, 'destroy'])->whereNumber('preset')->name('report-presets.destroy');

    Route::get('report-settings', [ReportSettingController::class, 'show'])->name('report-settings.show');
    Route::put('report-settings', [ReportSettingController::class, 'update'])->name('report-settings.update');
    Route::post('report-settings', [ReportSettingController::class, 'update'])->name('report-settings.store');

    // Debug route
    Route::get('/debug-policy', function () {
        $session = WorkSession::first();
        $user = auth()->user();

        return [
            'user_id' => $user->id,
            'session_id' => $session->id,
            'session_user_id' => $session->user_id,
            'gate_allows' => Gate::allows('view', $session),
            'gate_for_user' => Gate::forUser($user)->allows('view', $session),
        ];
    });
});

// Test route
Route::get('test-route', function () {
    return 'test route works';
});
