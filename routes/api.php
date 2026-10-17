<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CalendarAccountController;
use App\Http\Controllers\CalendarEventController;
use App\Http\Controllers\CalendarInsightController;
use App\Http\Controllers\CalendarSettingsController;
use App\Http\Controllers\DayOffController;
use App\Http\Controllers\FocusBlockController;
use App\Http\Controllers\SideTaskController;
use App\Http\Controllers\WorkSessionController;
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
    Route::delete('calendar/events/{event}', [CalendarEventController::class, 'destroy']);
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

    // Calendar: day intelligence + optional AI coach
    Route::get('calendar/coach/status', [CalendarInsightController::class, 'status']);
    Route::post('calendar/coach', [CalendarInsightController::class, 'coach']);
    Route::post('calendar/coach/chat', [CalendarInsightController::class, 'chat']);

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
