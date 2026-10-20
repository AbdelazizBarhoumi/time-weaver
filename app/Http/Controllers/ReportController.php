<?php

namespace App\Http\Controllers;

use App\Http\Resources\ReportResource;
use App\Services\CalendarEventFeed;
use App\Services\ReportConfig;
use App\Services\ReportDataService;
use App\Services\ReportRenderer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportController extends Controller
{
    public function __construct(
        private ReportDataService $data,
        private ReportRenderer $renderer,
        private CalendarEventFeed $feed,
    ) {}

    public function preview(Request $request): JsonResponse
    {
        $data = $request->validate(ReportConfig::rules());
        ReportConfig::assertRange($data);
        $config = ReportConfig::normalize($data, $request->user());
        $document = $this->data->build($request->user(), $config);

        return response()->json([
            'html' => $this->renderer->html($document),
            'config' => $config,
            'meta' => $document['meta'],
            'counts' => $document['counts'],
            'warnings' => $document['warnings'],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(ReportConfig::rules() + [
            'presetId' => ['sometimes', 'nullable', 'integer'],
        ]);
        ReportConfig::assertRange($data);
        $user = $request->user();

        $preset = null;
        if (! empty($data['presetId'])) {
            $preset = $user->reportPresets()->find($data['presetId']);

            if ($preset === null) {
                throw ValidationException::withMessages(['presetId' => 'That report preset could not be found.']);
            }
        }

        $config = ReportConfig::normalize($data, $user);
        $document = $this->data->build($user, $config);
        $pdf = $this->renderer->pdf($document);
        $fileName = $this->renderer->fileName($document);
        $path = 'reports/'.$user->id.'/'.Str::uuid().'.pdf';

        Storage::disk('local')->put($path, $pdf);

        try {
            $report = $user->reports()->create([
                'report_preset_id' => $preset?->id,
                'title' => $config['title'],
                'file_name' => $fileName,
                'file_path' => $path,
                'file_size' => strlen($pdf),
                'format' => 'pdf',
                'period_from' => $config['from'],
                'period_to' => $config['to'],
                'config' => $config,
                'generated_at' => now(),
            ]);
        } catch (\Throwable $exception) {
            Storage::disk('local')->delete($path);

            throw $exception;
        }

        return response()->json([
            'report' => (new ReportResource($report))->resolve(),
            'downloadUrl' => route('reports.download', ['report' => $report->id]),
        ], 201);
    }

    public function index(Request $request): JsonResponse
    {
        $reports = $request->user()->reports()->orderByDesc('generated_at')->limit(50)->get();

        return response()->json([
            'reports' => ReportResource::collection($reports)->resolve(),
        ]);
    }

    public function destroy(Request $request, int $report): JsonResponse
    {
        $report = $request->user()->reports()->findOrFail($report);
        Gate::authorize('delete', $report);

        if (Storage::disk('local')->exists($report->file_path)) {
            Storage::disk('local')->delete($report->file_path);
        }

        $report->delete();

        return response()->json(['deleted' => true]);
    }

    public function download(Request $request, int $report): StreamedResponse
    {
        $report = $request->user()->reports()->findOrFail($report);
        Gate::authorize('download', $report);

        abort_unless(Storage::disk('local')->exists($report->file_path), 404);

        return Storage::disk('local')->download($report->file_path, $report->file_name);
    }

    public function sourceData(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'timezone' => ['required', 'timezone'],
        ]);
        ReportConfig::assertRange($data);

        $user = $request->user();
        $timezone = $data['timezone'];
        $from = Carbon::createFromFormat('Y-m-d', $data['from'], $timezone)->startOfDay();
        $to = Carbon::createFromFormat('Y-m-d', $data['to'], $timezone)->startOfDay();
        $fromUtc = $from->copy()->utc();
        $toExclusiveUtc = $to->copy()->addDay()->startOfDay()->utc();

        $events = $this->feed->eventsFor($user, $fromUtc, $toExclusiveUtc)
            ->map(function (array $event) use ($timezone): array {
                return [
                    'id' => $event['id'],
                    'eventId' => $event['eventId'],
                    'accountId' => $event['accountId'],
                    'calendarId' => $event['calendarId'],
                    'calendarName' => $event['calendarName'],
                    'accountEmail' => $event['accountEmail'],
                    'title' => $event['title'],
                    'start' => $event['start']->copy()->setTimezone($timezone)->toIso8601String(),
                    'end' => $event['end']->copy()->setTimezone($timezone)->toIso8601String(),
                    'allDay' => $event['allDay'],
                    'isWork' => $event['isWork'],
                    'workSource' => $event['workSource'],
                    'color' => $event['accountColor'],
                ];
            })
            ->sortBy('start')
            ->values();

        $accounts = $user->calendarAccounts()
            ->orderBy('email')
            ->get()
            ->map(fn ($account) => [
                'id' => $account->id,
                'email' => $account->email,
                'color' => $account->color,
                'defaultWork' => (bool) $account->default_work,
                'disconnected' => $account->disconnected_at !== null,
            ])
            ->values();

        $calendars = $events
            ->groupBy('calendarId')
            ->map(fn ($group, $calendarId) => [
                'id' => (string) $calendarId,
                'name' => $group->first()['calendarName'] ?: 'Calendar',
                'accountEmail' => $group->first()['accountEmail'],
            ])
            ->values();

        $tasks = $user->workTasks()
            ->orderBy('position')
            ->orderBy('id')
            ->get()
            ->map(fn ($task) => [
                'id' => $task->id,
                'title' => $task->title,
                'status' => $task->completed_at !== null ? 'done' : 'open',
            ])
            ->values();

        $dayOffs = $user->dayOffs()
            ->whereBetween('date', [$from->format('Y-m-d'), $to->format('Y-m-d')])
            ->orderBy('date')
            ->get()
            ->map(fn ($dayOff) => [
                'date' => $dayOff->date->format('Y-m-d'),
                'type' => $dayOff->type,
            ])
            ->values();

        $eventCount = $events->count();
        $truncated = $eventCount > 1000;
        $events = $events->take(1000)->values();

        return response()->json([
            'from' => $data['from'],
            'to' => $data['to'],
            'timezone' => $timezone,
            'accounts' => $accounts,
            'calendars' => $calendars,
            'tasks' => $tasks,
            'events' => $events,
            'dayOffs' => $dayOffs,
            'eventCount' => $eventCount,
            'truncated' => $truncated,
        ]);
    }
}
