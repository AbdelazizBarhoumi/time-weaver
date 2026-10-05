<?php

namespace App\Providers;

use App\Models\WorkSession;
use App\Policies\WorkSessionPolicy;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Gate::policy(WorkSession::class, WorkSessionPolicy::class);
        JsonResource::withoutWrapping();
    }
}
