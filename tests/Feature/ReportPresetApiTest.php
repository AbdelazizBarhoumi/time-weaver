<?php

namespace Tests\Feature;

use App\Models\ReportPreset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReportPresetApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->actingAs($this->user);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function presetConfig(array $overrides = []): array
    {
        return array_replace([
            'template' => 'time',
            'title' => 'Monthly focus',
            'sections' => ['cover', 'summary', 'sessions'],
            'from' => '2026-10-01',
            'to' => '2026-10-31',
            'timezone' => 'UTC',
            'filters' => [
                'sessionTypes' => ['work'],
                'taskFilter' => 'open',
            ],
        ], $overrides);
    }

    public function test_store_creates_a_preset_without_pinning_dates(): void
    {
        $response = $this->postJson('/api/report-presets', [
            'name' => 'Focus review',
            'config' => $this->presetConfig(),
        ])->assertCreated();

        $this->assertSame('Focus review', $response->json('name'));
        $this->assertTrue($response->json('isDefault'), 'The first preset becomes the default.');
        $this->assertSame(['cover', 'summary', 'sessions'], $response->json('config.sections'));
        $this->assertArrayNotHasKey('from', $response->json('config'));
        $this->assertArrayNotHasKey('to', $response->json('config'));
        $this->assertArrayNotHasKey('timezone', $response->json('config'));
        $this->assertDatabaseHas('report_presets', [
            'user_id' => $this->user->id,
            'name' => 'Focus review',
            'is_default' => true,
        ]);
    }

    public function test_a_new_default_moves_the_flag_from_the_previous_preset(): void
    {
        $first = ReportPreset::factory()->for($this->user)->create([
            'name' => 'First',
            'is_default' => true,
        ]);

        $response = $this->postJson('/api/report-presets', [
            'name' => 'Second',
            'config' => $this->presetConfig(),
            'isDefault' => true,
        ])->assertCreated();

        $this->assertFalse($first->fresh()->is_default);
        $this->assertTrue(ReportPreset::findOrFail($response->json('id'))->is_default);
    }

    public function test_update_changes_the_name_default_and_config(): void
    {
        $preset = ReportPreset::factory()->for($this->user)->create(['name' => 'Old name']);

        $response = $this->putJson('/api/report-presets/'.$preset->id, [
            'name' => 'New name',
            'isDefault' => true,
            'config' => $this->presetConfig(['title' => 'Updated title']),
        ])->assertOk();

        $this->assertSame('New name', $response->json('name'));
        $this->assertTrue($response->json('isDefault'));
        $this->assertSame('Updated title', $response->json('config.title'));
    }

    public function test_presets_are_scoped_to_the_authenticated_user(): void
    {
        $mine = ReportPreset::factory()->for($this->user)->create(['name' => 'Mine']);
        $theirs = ReportPreset::factory()->create(['name' => 'Theirs']);

        $response = $this->getJson('/api/report-presets')->assertOk();
        $this->assertCount(1, $response->json());
        $this->assertSame($mine->id, $response->json('0.id'));

        $this->putJson('/api/report-presets/'.$theirs->id, ['name' => 'Hijacked'])->assertNotFound();
        $this->deleteJson('/api/report-presets/'.$theirs->id)->assertNotFound();
        $this->assertDatabaseHas('report_presets', ['id' => $theirs->id, 'name' => 'Theirs']);
    }

    public function test_names_are_unique_per_user_but_can_repeat_across_users(): void
    {
        ReportPreset::factory()->for($this->user)->create(['name' => 'Monthly']);

        $this->postJson('/api/report-presets', [
            'name' => 'Monthly',
            'config' => $this->presetConfig(),
        ])->assertStatus(422)->assertJsonValidationErrors('name');

        $other = User::factory()->create();
        $this->actingAs($other);
        $this->postJson('/api/report-presets', [
            'name' => 'Monthly',
            'config' => $this->presetConfig(),
        ])->assertCreated();
    }

    public function test_config_validation_rejects_unknown_sections(): void
    {
        $this->postJson('/api/report-presets', [
            'name' => 'Broken',
            'config' => $this->presetConfig(['sections' => ['summary', 'not-a-section']]),
        ])->assertStatus(422)->assertJsonValidationErrors('sections.1');
    }

    public function test_destroy_deletes_only_the_users_preset(): void
    {
        $preset = ReportPreset::factory()->for($this->user)->create();

        $this->deleteJson('/api/report-presets/'.$preset->id)->assertOk();
        $this->assertDatabaseMissing('report_presets', ['id' => $preset->id]);
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->getJson('/api/report-presets')->assertStatus(401);
        $this->postJson('/api/report-presets', ['name' => 'x', 'config' => []])->assertStatus(401);
    }
}
