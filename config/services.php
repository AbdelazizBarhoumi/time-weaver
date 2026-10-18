<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT', env('APP_URL').'/api/calendar/google/callback'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Google Gemini (Interactions API)
    |--------------------------------------------------------------------------
    |
    | Powers the AI coach on the calendar. We speak the Interactions API
    | directly over HTTP, so only the API key is required. The sampling knobs
    | are optional and fall back to the defaults below. Note the Interactions
    | API exposes `top_p` but not `top_k`, and that `thinking_level` must be one
    | of the values the chosen model supports (e.g. `minimal` is rejected by
    | gemini-3.8-flash). Modern thinking models can take a while to answer, so
    | the timeout default is deliberately generous.
    |
    | `max_output_tokens` must leave room for the model's thinking, which is
    | charged against this same budget: too low a ceiling ends the reply
    | mid-sentence and returns `status: incomplete`.
    |
    */

    'gemini' => [
        'key' => env('GEMINI_API_KEY'),
        'model' => env('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
        'base_url' => env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
        'api_revision' => env('GEMINI_API_REVISION', '2026-05-20'),
        'temperature' => env('GEMINI_TEMPERATURE', 0.6),
        'top_p' => env('GEMINI_TOP_P', 0.95),
        'max_output_tokens' => env('GEMINI_MAX_OUTPUT_TOKENS', 4096),
        'thinking_level' => env('GEMINI_THINKING_LEVEL', 'low'),
        'seed' => env('GEMINI_SEED'),
        'store' => env('GEMINI_STORE', true),
        'timeout' => env('GEMINI_TIMEOUT', 60),
        'connect_timeout' => env('GEMINI_CONNECT_TIMEOUT', 10),
        'retries' => env('GEMINI_RETRIES', 2),
    ],

];
