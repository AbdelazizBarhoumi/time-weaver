<?php

namespace App\Policies;

use App\Models\User;
use App\Models\WorkSession;

class WorkSessionPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, WorkSession $workSession): bool
    {
        return $user->id === $workSession->user_id;
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function update(User $user, WorkSession $workSession): bool
    {
        return $user->id === $workSession->user_id;
    }

    public function delete(User $user, WorkSession $workSession): bool
    {
        return $user->id === $workSession->user_id;
    }
}
