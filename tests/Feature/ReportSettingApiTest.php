<?php

namespace Tests\Feature;

use App\Models\ReportSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReportSettingApiTest extends TestCase
{
    use RefreshDatabase;

    private const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Z6sAAAAASUVORK5CYII=';

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->user = User::factory()->create(['name' => 'Amina']);
        $this->actingAs($this->user);
    }

    public function test_show_creates_default_settings_for_the_user(): void
    {
        $response = $this->getJson('/api/report-settings')->assertOk();

        $response->assertJson([
            'companyName' => null,
            'preparedBy' => 'Amina',
            'footerText' => ReportSetting::DEFAULT_FOOTER,
            'accentColor' => ReportSetting::DEFAULT_ACCENT,
            'logoDataUri' => null,
        ]);

        $this->assertDatabaseHas('report_settings', ['user_id' => $this->user->id]);
    }

    public function test_update_saves_branding_text_and_accent_color(): void
    {
        $response = $this->postJson('/api/report-settings', [
            'companyName' => 'Acme Studio',
            'preparedBy' => 'Amina B.',
            'footerText' => 'Confidential · Acme Studio',
            'accentColor' => '#c2410c',
        ])->assertOk();

        $response->assertJson([
            'companyName' => 'Acme Studio',
            'preparedBy' => 'Amina B.',
            'footerText' => 'Confidential · Acme Studio',
            'accentColor' => '#c2410c',
        ]);
    }

    public function test_update_rejects_an_invalid_accent_color(): void
    {
        $this->postJson('/api/report-settings', ['accentColor' => 'orange'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('accentColor');
    }

    public function test_logo_upload_is_stored_and_exposed_as_a_data_uri_and_can_be_removed(): void
    {
        $logo = UploadedFile::fake()->createWithContent('logo.png', base64_decode(self::TINY_PNG));

        $response = $this->post('/api/report-settings', [
            'companyName' => 'Acme Studio',
            'preparedBy' => 'Amina',
            'footerText' => 'Confidential',
            'accentColor' => '#0f766e',
            'logo' => $logo,
        ], ['Accept' => 'application/json'])->assertOk();

        $setting = ReportSetting::forUser($this->user);
        $this->assertNotNull($setting->logo_path);
        Storage::disk('local')->assertExists($setting->logo_path);
        $this->assertStringStartsWith('data:image/png;base64,', $response->json('logoDataUri'));

        $this->post('/api/report-settings', [
            'companyName' => 'Acme Studio',
            'preparedBy' => 'Amina',
            'footerText' => 'Confidential',
            'accentColor' => '#0f766e',
            'removeLogo' => true,
        ], ['Accept' => 'application/json'])->assertOk();

        $this->assertNull($setting->fresh()->logo_path);
        Storage::disk('local')->assertMissing($setting->logo_path);
    }

    public function test_logo_upload_rejects_non_png_or_jpeg_files(): void
    {
        $logo = UploadedFile::fake()->createWithContent('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

        $this->post('/api/report-settings', [
            'logo' => $logo,
        ], ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('logo');
    }

    public function test_settings_are_per_user(): void
    {
        $this->postJson('/api/report-settings', ['companyName' => 'Mine'])->assertOk();

        $other = User::factory()->create(['name' => 'Other']);
        $this->actingAs($other);

        $response = $this->getJson('/api/report-settings')->assertOk();
        $this->assertNull($response->json('companyName'));
        $this->assertSame('Other', $response->json('preparedBy'));
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->getJson('/api/report-settings')->assertStatus(401);
        $this->postJson('/api/report-settings', ['companyName' => 'x'])->assertStatus(401);
    }
}
