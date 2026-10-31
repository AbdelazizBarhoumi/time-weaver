<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\User;
use Illuminate\Encryption\Encrypter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CalendarAccountTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected CalendarAccount $account;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        $this->account = CalendarAccount::factory()->create(['user_id' => $this->user->id]);
        $this->actingAs($this->user);
    }

    /**
     * Store tokens as they would have been before APP_KEY was regenerated:
     * valid ciphertext that the current key cannot decrypt.
     */
    private function storeTokensEncryptedWithAnOldKey(): void
    {
        $oldEncrypter = new Encrypter(str_repeat('f', 32), 'AES-256-CBC');

        DB::table('calendar_accounts')->where('id', $this->account->id)->update([
            'access_token' => $oldEncrypter->encryptString('old-access-token'),
            'refresh_token' => $oldEncrypter->encryptString('old-refresh-token'),
        ]);

        $this->account->refresh();
    }

    public function test_stale_tokens_read_as_null_instead_of_throwing(): void
    {
        $this->storeTokensEncryptedWithAnOldKey();

        $this->assertNull($this->account->access_token);
        $this->assertNull($this->account->refresh_token);
    }

    public function test_an_account_with_stale_tokens_can_be_reconnected(): void
    {
        $this->storeTokensEncryptedWithAnOldKey();

        Http::fake([
            '*oauth2.googleapis.com/token' => Http::response([
                'access_token' => 'fresh-access-token',
                'refresh_token' => 'fresh-refresh-token',
                'expires_in' => 3600,
            ]),
            '*openidconnect.googleapis.com/v1/userinfo' => Http::response([
                'email' => $this->account->email,
            ]),
        ]);

        $this->withSession(['google_oauth_state' => 'state'])
            ->get('/api/calendar/google/callback?state=state&code=code')
            ->assertRedirect('/calendar?connected=1');

        $reconnected = $this->account->fresh();

        $this->assertSame('fresh-access-token', $reconnected->access_token);
        $this->assertSame('fresh-refresh-token', $reconnected->refresh_token);
        $this->assertNull($reconnected->disconnected_at);
    }

    public function test_an_account_with_stale_tokens_can_be_disconnected(): void
    {
        $this->storeTokensEncryptedWithAnOldKey();

        $this->deleteJson("/api/calendar/accounts/{$this->account->id}")
            ->assertNoContent();

        $disconnected = $this->account->fresh();

        $this->assertNotNull($disconnected->disconnected_at);
        $this->assertSame('', $disconnected->access_token);
        $this->assertNull($disconnected->refresh_token);
    }

    public function test_sync_reports_stale_tokens_as_a_reconnect_error(): void
    {
        $this->storeTokensEncryptedWithAnOldKey();

        $this->postJson('/api/calendar/sync')
            ->assertOk()
            ->assertJsonPath('accounts.0.failed', true)
            ->assertJsonPath('errors.0.accountId', $this->account->id);
    }
}
