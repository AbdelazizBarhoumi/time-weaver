<?php

use App\Http\Controllers\AuthController;
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
