<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserDayOff extends Model
{
    protected $fillable = ['user_id', 'date', 'type'];

    protected $casts = [
        'date' => 'date',
        'type' => 'string',
    ];
}
