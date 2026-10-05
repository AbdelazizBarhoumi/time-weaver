<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_register(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['user' => ['id', 'name', 'email']]);

        $this->assertAuthenticated();
    }

    public function test_can_login(): void
    {
        User::factory()->create([
            'email' => 'test@example.com',
            'password' => bcrypt('password123'),
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'test@example.com',
            'password' => 'password123',
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure(['user' => ['id', 'name', 'email']]);

        $this->assertAuthenticated();
    }

    public function test_login_fails_with_wrong_password(): void
    {
        User::factory()->create([
            'email' => 'test@example.com',
            'password' => bcrypt('password123'),
        ]);

        $response = $this->postJson('/api/login', [
            'email' => 'test@example.com',
            'password' => 'wrongpassword',
        ]);

        $response->assertStatus(422);
        $this->assertGuest();
    }

    public function test_can_logout(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $response = $this->postJson('/api/logout');

        $response->assertStatus(200);
        $this->assertGuest();
    }

    public function test_can_get_user(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $response = $this->getJson('/api/user');

        $response->assertStatus(200)
            ->assertJson(['user' => ['id' => $user->id, 'email' => $user->email]]);
    }

    public function test_unauthenticated_user_cannot_get_user(): void
    {
        $response = $this->getJson('/api/user');
        $response->assertStatus(401);
    }
}
