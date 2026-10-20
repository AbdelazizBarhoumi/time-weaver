<?php

namespace Tests\Feature;

use App\Models\CalendarAccount;
use App\Models\CalendarEvent;
use App\Models\Report;
use App\Models\ReportSetting;
use App\Models\User;
use App\Models\WorkSession;
use App\Models\WorkTask;
use App\Services\ReportConfig;
use App\Services\ReportDataService;
use Dompdf\Dompdf;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReportApiTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private CalendarAccount $workAccount;

    private CalendarAccount $personalAccount;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2026-10-20 12:00:00');
        $this->user = User::factory()->create(['name' => 'Amina']);
        $this->actingAs($this->user);
    }

    private function seedReportData(): WorkTask
    {
        $task = WorkTask::factory()->for($this->user)->create([
            'title' => 'Write the quarterly report',
            'estimate_minutes' => 240,
        ]);

        WorkSession::factory()->for($this->user)->create([
            'work_task_id' => $task->id,
            'start' => Carbon::parse('2026-10-02 09:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-02 11:00:00', 'UTC'),
            'type' => 'work',
            'source' => 'manual',
            'note' => 'Deep work on the report',
        ]);

        WorkSession::factory()->for($this->user)->study()->create([
            'start' => Carbon::parse('2026-10-03 14:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-03 15:00:00', 'UTC'),
            'source' => 'calendar',
            'note' => 'Study session',
        ]);

        WorkSession::factory()->for($this->user)->create([
            'start' => Carbon::parse('2026-10-04 09:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-04 12:00:00', 'UTC'),
            'type' => 'work',
            'source' => 'manual',
            'note' => 'Should be skipped because the day is excluded',
        ]);

        WorkSession::factory()->for($this->user)->create([
            'start' => Carbon::parse('2026-10-08 10:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-08 11:00:00', 'UTC'),
            'type' => 'work',
            'source' => 'manual',
            'note' => 'Second week',
        ]);

        $this->user->dayOffs()->create([
            'date' => '2026-10-04',
            'type' => 'excluded',
        ]);

        $this->workAccount = CalendarAccount::factory()->for($this->user)->create([
            'email' => 'work@example.com',
            'color' => '#0f766e',
            'default_work' => true,
        ]);

        $this->personalAccount = CalendarAccount::factory()->for($this->user)->create([
            'email' => 'personal@example.com',
            'color' => '#f59e0b',
            'default_work' => false,
        ]);

        CalendarEvent::factory()->create([
            'calendar_account_id' => $this->workAccount->id,
            'user_id' => $this->user->id,
            'account_email' => $this->workAccount->email,
            'event_id' => 'evt-work',
            'calendar_id' => 'team',
            'calendar_name' => 'Team calendar',
            'title' => 'Team standup',
            'start' => Carbon::parse('2026-10-05 09:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-05 10:00:00', 'UTC'),
            'all_day' => false,
        ]);

        CalendarEvent::factory()->create([
            'calendar_account_id' => $this->personalAccount->id,
            'user_id' => $this->user->id,
            'account_email' => $this->personalAccount->email,
            'event_id' => 'evt-personal',
            'calendar_id' => 'personal',
            'calendar_name' => 'Personal calendar',
            'title' => 'Dentist appointment',
            'start' => Carbon::parse('2026-10-06 11:00:00', 'UTC'),
            'end' => Carbon::parse('2026-10-06 12:00:00', 'UTC'),
            'all_day' => false,
        ]);

        return $task;
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function config(array $overrides = []): array
    {
        return array_replace([
            'template' => 'full',
            'title' => 'October review',
            'subtitle' => '',
            'company' => 'Acme Studio',
            'preparedFor' => 'The client',
            'preparedBy' => 'Amina',
            'accentColor' => '#0f766e',
            'footerText' => 'Confidential',
            'showPageNumbers' => true,
            'notes' => 'A month with a strong start.',
            'from' => '2026-10-01',
            'to' => '2026-10-10',
            'timezone' => 'UTC',
            'comparison' => 'none',
            'groupBy' => 'day',
            'paper' => 'a4',
            'orientation' => 'portrait',
            'sections' => ReportConfig::SECTIONS,
            'filters' => [
                'sessionTypes' => ['work', 'study'],
                'sessionSources' => ['manual', 'calendar'],
                'workTaskIds' => [],
                'taskFilter' => 'all',
                'search' => '',
                'includeSessionNotes' => true,
                'calendar' => [
                    'include' => true,
                    'accountIds' => [],
                    'calendarIds' => [],
                    'eventIds' => [],
                    'eventMode' => 'all',
                    'workFilter' => 'all',
                    'search' => '',
                    'includeAllDay' => true,
                ],
                'includeSideTasks' => true,
                'includeFocusBlocks' => true,
                'includeDayOffs' => true,
            ],
        ], $overrides);
    }

    public function test_preview_renders_the_shared_document_and_respects_excluded_days(): void
    {
        $this->seedReportData();

        $response = $this->postJson('/api/reports/preview', $this->config())->assertOk();

        $html = $response->json('html');
        $this->assertIsString($html);
        $this->assertStringContainsString('October review', $html);
        $this->assertStringContainsString('Acme Studio', $html);
        $this->assertStringContainsString('Write the quarterly report', $html);
        $this->assertStringContainsString('Team standup', $html);
        $this->assertStringContainsString('Deep work on the report', $html);
        $this->assertStringNotContainsString('Should be skipped because the day is excluded', $html);

        $this->assertSame(3, $response->json('counts.sessions'));
        $this->assertSame(2, $response->json('counts.events'));
        $this->assertSame(10, $response->json('counts.days'));
    }

    public function test_data_service_aggregates_work_study_calendar_and_weekly_trends(): void
    {
        $this->seedReportData();
        $config = ReportConfig::normalize($this->config(['groupBy' => 'week']), $this->user);

        $document = app(ReportDataService::class)->build($this->user, $config);

        $this->assertSame(3.0, $document['summary']['workHours']);
        $this->assertSame(1.0, $document['summary']['studyHours']);
        $this->assertSame(4.0, $document['summary']['totalHours']);
        $this->assertSame(3, $document['summary']['activeDays']);
        $this->assertSame(1.0, $document['summary']['workEventHours']);
        $this->assertSame(2, $document['summary']['eventCount']);
        $this->assertSame(3, $document['counts']['sessions']);

        $weeklyTotal = collect($document['trend']['buckets'])->sum('totalHours');
        $this->assertSame(4.0, round($weeklyTotal, 1), 'Weekly buckets must keep sessions from every week.');
        $this->assertSame('week', $document['trend']['groupBy']);

        $this->assertSame(1, collect($document['dayOffs'])->where('type', 'excluded')->count());
        $this->assertSame(3, collect($document['daily'])->where('sessionCount', '>', 0)->count());
    }

    public function test_employer_template_forces_work_only_content(): void
    {
        Storage::fake('local');
        $this->seedReportData();

        $config = $this->config([
            'template' => 'work',
            'comparison' => 'previous_period',
            'sections' => ReportConfig::SECTIONS,
        ]);

        $normalized = ReportConfig::normalize($config, $this->user);

        $this->assertSame('work', $normalized['template']);
        $this->assertSame(ReportConfig::WORK_ONLY_SECTIONS, $normalized['sections']);
        $this->assertSame(['work'], $normalized['filters']['sessionTypes']);
        $this->assertSame('work', $normalized['filters']['calendar']['workFilter']);
        $this->assertFalse($normalized['filters']['calendar']['includeAllDay']);
        $this->assertFalse($normalized['filters']['includeSideTasks']);
        $this->assertFalse($normalized['filters']['includeFocusBlocks']);
        $this->assertFalse($normalized['filters']['includeDayOffs']);

        $document = app(ReportDataService::class)->build($this->user, $normalized);

        $this->assertTrue($document['meta']['workOnly']);
        $this->assertSame(3.0, $document['summary']['workHours']);
        $this->assertSame(0.0, $document['summary']['studyHours']);
        $this->assertSame(3.0, $document['summary']['totalHours']);
        $this->assertSame(2, $document['counts']['sessions']);
        $this->assertSame(1, $document['summary']['eventCount']);
        $this->assertNull($document['study']);
        $this->assertNull($document['sideTasks']);
        $this->assertNull($document['focusBlocks']);
        $this->assertNull($document['dayOffs']);
        $this->assertSame(['Team standup'], array_column($document['events'], 'title'));
        $this->assertNotContains('studyHours', array_column($document['comparison']['metrics'], 'key'));
        $this->assertStringNotContainsString('study', strtolower($document['summary']['text']));

        $response = $this->postJson('/api/reports/preview', $config)->assertOk();
        $html = $response->json('html');

        $this->assertStringContainsString('Team standup', $html);
        $this->assertStringNotContainsString('Dentist appointment', $html);
        $this->assertStringNotContainsString('Study session', $html);
        $this->assertStringNotContainsString('Study hours', $html);
        $this->assertStringNotContainsString('Work / study split', $html);
        $this->assertStringNotContainsString('Day off', $html);

        $this->postJson('/api/reports', $config)->assertCreated();
        $report = Report::firstOrFail();

        $this->assertStringStartsWith('%PDF', Storage::disk('local')->get($report->file_path));
    }

    public function test_report_styles_preserve_dompdf_page_margins(): void
    {
        $styles = view('reports.partials.styles')->render();

        $dompdf = new Dompdf(['defaultFont' => 'DejaVu Sans']);
        $dompdf->loadHtml('<!DOCTYPE html><html><head>'.$styles.'</head><body><div class="report">Report</div></body></html>');
        $dompdf->setPaper('a4', 'portrait');
        $dompdf->render();

        $rootStyle = $dompdf->getTree()->get_root()->get_style();

        $this->assertSame(36.0, round($rootStyle->margin_top, 1));
        $this->assertSame(36.0, round($rootStyle->margin_right, 1));
        $this->assertSame(36.0, round($rootStyle->margin_bottom, 1));
        $this->assertSame(36.0, round($rootStyle->margin_left, 1));
    }

    public function test_event_selection_and_work_filter_narrow_the_calendar_results(): void
    {
        $this->seedReportData();
        $selected = $this->config([
            'sections' => ['summary', 'calendar'],
            'filters' => array_replace($this->config()['filters'], [
                'calendar' => [
                    'include' => true,
                    'accountIds' => [],
                    'calendarIds' => [],
                    'eventIds' => [$this->workAccount->id.'|evt-work'],
                    'eventMode' => 'selected',
                    'workFilter' => 'all',
                    'search' => '',
                    'includeAllDay' => true,
                ],
            ]),
        ]);

        $document = app(ReportDataService::class)->build($this->user, ReportConfig::normalize($selected, $this->user));

        $this->assertSame(1, $document['summary']['eventCount']);
        $this->assertSame('Team standup', $document['events'][0]['title']);

        $personal = $this->config([
            'sections' => ['summary', 'calendar'],
            'filters' => array_replace($this->config()['filters'], [
                'calendar' => [
                    'include' => true,
                    'accountIds' => [],
                    'calendarIds' => [],
                    'eventIds' => [],
                    'eventMode' => 'all',
                    'workFilter' => 'personal',
                    'search' => '',
                    'includeAllDay' => true,
                ],
            ]),
        ]);

        $document = app(ReportDataService::class)->build($this->user, ReportConfig::normalize($personal, $this->user));

        $this->assertSame(1, $document['summary']['eventCount']);
        $this->assertSame('Dentist appointment', $document['events'][0]['title']);
    }

    public function test_comparison_metrics_use_the_previous_period(): void
    {
        $this->seedReportData();
        WorkSession::factory()->for($this->user)->create([
            'start' => Carbon::parse('2026-09-25 09:00:00', 'UTC'),
            'end' => Carbon::parse('2026-09-25 10:00:00', 'UTC'),
            'type' => 'work',
            'source' => 'manual',
        ]);

        $config = ReportConfig::normalize($this->config([
            'comparison' => 'previous_period',
            'sections' => ['summary', 'comparison'],
        ]), $this->user);

        $document = app(ReportDataService::class)->build($this->user, $config);

        $this->assertNotNull($document['comparison']);
        $this->assertSame('2026-09-21', $document['comparison']['previousFrom']);
        $this->assertSame('2026-09-30', $document['comparison']['previousTo']);

        $work = collect($document['comparison']['metrics'])->firstWhere('key', 'workHours');
        $this->assertSame(3.0, $work['current']);
        $this->assertSame(1.0, $work['previous']);
        $this->assertSame('up', $work['direction']);
        $this->assertSame('+200%', $work['percentLabel']);
        $this->assertStringContainsString('Work time is up +200%', $document['summary']['text']);
    }

    public function test_jpeg_logo_is_embedded_in_the_pdf_without_gd(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('report-logos/logo.jpg', base64_decode(
            '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK7D5I/9k='
        ));
        ReportSetting::forUser($this->user)->update(['logo_path' => 'report-logos/logo.jpg']);
        $this->seedReportData();

        $this->postJson('/api/reports', $this->config(['sections' => ['cover']]))->assertCreated();

        $report = Report::firstOrFail();
        $pdf = Storage::disk('local')->get($report->file_path);

        $this->assertStringContainsString('%PDF-', $pdf);
        $this->assertStringContainsString('/DCTDecode', $pdf);
    }

    public function test_png_logo_is_previewed_and_pdf_generation_does_not_require_gd(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('report-logos/logo.png', base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Z6sAAAAASUVORK5CYII='));
        ReportSetting::forUser($this->user)->update(['logo_path' => 'report-logos/logo.png']);
        $this->seedReportData();

        $response = $this->postJson('/api/reports/preview', $this->config(['sections' => ['cover', 'summary']]))->assertOk();
        $this->assertStringContainsString('data:image/png;base64,', $response->json('html'));

        $this->postJson('/api/reports', $this->config(['sections' => ['cover', 'summary']]))->assertCreated();
    }

    public function test_source_data_returns_only_the_users_calendars_and_tasks(): void
    {
        $task = $this->seedReportData();
        $other = User::factory()->create();
        WorkTask::factory()->for($other)->create(['title' => 'Someone else task']);

        $response = $this->getJson('/api/reports/source-data?from=2026-10-01&to=2026-10-10&timezone=UTC')
            ->assertOk();

        $this->assertSame(2, $response->json('eventCount'));
        $this->assertCount(2, $response->json('accounts'));
        $this->assertCount(2, $response->json('calendars'));
        $this->assertSame($task->id, $response->json('tasks.0.id'));
        $this->assertSame('Team standup', collect($response->json('events'))->firstWhere('title', 'Team standup')['title']);
        $this->assertTrue(collect($response->json('events'))->firstWhere('title', 'Team standup')['isWork']);
        $this->assertFalse($response->json('truncated'));
    }

    public function test_generate_stores_a_pdf_and_download_and_delete_are_scoped(): void
    {
        Storage::fake('local');
        $this->seedReportData();

        $response = $this->postJson('/api/reports', $this->config())->assertCreated();

        $reportId = $response->json('report.id');
        $this->assertIsInt($reportId);
        $this->assertStringContainsString('/api/reports/'.$reportId.'/download', $response->json('downloadUrl'));

        $report = Report::findOrFail($reportId);
        $this->assertSame($this->user->id, $report->user_id);
        $this->assertSame('October review', $report->title);
        Storage::disk('local')->assertExists($report->file_path);
        $pdf = Storage::disk('local')->get($report->file_path);
        $this->assertStringStartsWith('%PDF', $pdf);
        $this->assertGreaterThan(1000, strlen($pdf));

        $this->get('/api/reports/'.$reportId.'/download')
            ->assertOk()
            ->assertHeader('content-type', 'application/pdf');

        $other = User::factory()->create();
        $this->actingAs($other);
        $this->get('/api/reports/'.$reportId.'/download')->assertNotFound();
        $this->deleteJson('/api/reports/'.$reportId)->assertNotFound();

        $this->actingAs($this->user);
        $this->deleteJson('/api/reports/'.$reportId)->assertOk();
        $this->assertDatabaseMissing('reports', ['id' => $reportId]);
        Storage::disk('local')->assertMissing($report->file_path);
    }

    public function test_history_is_scoped_to_the_authenticated_user(): void
    {
        $mine = Report::factory()->for($this->user)->create(['title' => 'Mine']);
        Report::factory()->create(['title' => 'Theirs']);

        $response = $this->getJson('/api/reports')->assertOk();

        $this->assertCount(1, $response->json('reports'));
        $this->assertSame($mine->id, $response->json('reports.0.id'));
        $this->assertSame('Mine', $response->json('reports.0.title'));
    }

    public function test_preview_validates_range_and_sections(): void
    {
        $this->postJson('/api/reports/preview', $this->config(['to' => '2028-10-02']))
            ->assertStatus(422)
            ->assertJsonValidationErrors('to');

        $this->postJson('/api/reports/preview', $this->config(['sections' => []]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('sections');
    }

    public function test_requires_authentication(): void
    {
        auth()->logout();

        $this->postJson('/api/reports/preview', $this->config())->assertStatus(401);
        $this->getJson('/api/reports')->assertStatus(401);
        $this->getJson('/api/reports/source-data?from=2026-10-01&to=2026-10-10&timezone=UTC')->assertStatus(401);
    }
}
