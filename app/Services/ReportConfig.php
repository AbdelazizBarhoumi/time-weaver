<?php

namespace App\Services;

use App\Models\ReportSetting;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The report builder's shared vocabulary: allowed options, validation rules,
 * and the normalization that turns a request payload into a stable config.
 */
class ReportConfig
{
    /** The longest period a single report may cover, in days. */
    public const MAX_DAYS = 731;

    public const SECTIONS = [
        'cover',
        'summary',
        'kpis',
        'trend',
        'heatmap',
        'daily',
        'sessions',
        'calendar',
        'tasks',
        'study',
        'monthly',
        'comparison',
        'sideTasks',
        'focusBlocks',
        'dayOffs',
        'notes',
    ];

    /**
     * Sections that are safe to show in an employer-facing, work-only report.
     * Study, personal context, and day-off tables are deliberately absent.
     *
     * @var array<int, string>
     */
    public const WORK_ONLY_SECTIONS = [
        'cover', 'summary', 'kpis', 'trend', 'heatmap', 'daily', 'sessions',
        'calendar', 'tasks', 'monthly', 'comparison', 'notes',
    ];

    /** @var array<string, array<int, string>> */
    public const TEMPLATES = [
        'work' => [
            'cover', 'summary', 'kpis', 'trend', 'daily', 'sessions', 'calendar',
            'tasks', 'comparison', 'notes',
        ],
        'full' => [
            'cover', 'summary', 'kpis', 'trend', 'heatmap', 'daily', 'sessions',
            'calendar', 'tasks', 'study', 'monthly', 'comparison', 'sideTasks',
            'focusBlocks', 'dayOffs', 'notes',
        ],
        'time' => [
            'cover', 'summary', 'kpis', 'trend', 'heatmap', 'daily', 'sessions',
            'study', 'monthly', 'notes',
        ],
        'calendar' => [
            'cover', 'summary', 'kpis', 'trend', 'calendar', 'daily', 'comparison', 'notes',
        ],
        'tasks' => [
            'cover', 'summary', 'kpis', 'tasks', 'sideTasks', 'focusBlocks', 'comparison', 'notes',
        ],
    ];

    public const SESSION_TYPES = ['work', 'study'];

    public const SESSION_SOURCES = ['manual', 'calendar'];

    public const EVENT_WORK_FILTERS = ['all', 'work', 'personal'];

    public const TASK_FILTERS = ['all', 'open', 'done'];

    public const GROUPINGS = ['day', 'week', 'month'];

    public const COMPARISONS = ['none', 'previous_period', 'previous_year'];

    public const PAPERS = ['a4', 'letter'];

    public const ORIENTATIONS = ['portrait', 'landscape'];

    /**
     * @return array<string, mixed>
     */
    public static function rules(): array
    {
        return [
            'template' => ['sometimes', 'string', Rule::in(array_keys(self::TEMPLATES))],
            'title' => ['sometimes', 'nullable', 'string', 'max:160'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:200'],
            'company' => ['sometimes', 'nullable', 'string', 'max:160'],
            'preparedFor' => ['sometimes', 'nullable', 'string', 'max:160'],
            'preparedBy' => ['sometimes', 'nullable', 'string', 'max:160'],
            'accentColor' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'footerText' => ['sometimes', 'nullable', 'string', 'max:500'],
            'showPageNumbers' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'timezone' => ['required', 'timezone'],
            'comparison' => ['sometimes', 'string', Rule::in(self::COMPARISONS)],
            'groupBy' => ['sometimes', 'string', Rule::in(self::GROUPINGS)],
            'paper' => ['sometimes', 'string', Rule::in(self::PAPERS)],
            'orientation' => ['sometimes', 'string', Rule::in(self::ORIENTATIONS)],
            'sections' => ['required', 'array', 'min:1'],
            'sections.*' => ['string', Rule::in(self::SECTIONS)],

            'filters' => ['sometimes', 'array'],
            'filters.sessionTypes' => ['sometimes', 'array', 'max:2'],
            'filters.sessionTypes.*' => ['string', Rule::in(self::SESSION_TYPES)],
            'filters.sessionSources' => ['sometimes', 'array', 'max:2'],
            'filters.sessionSources.*' => ['string', Rule::in(self::SESSION_SOURCES)],
            'filters.workTaskIds' => ['sometimes', 'array', 'max:500'],
            'filters.workTaskIds.*' => ['integer'],
            'filters.taskFilter' => ['sometimes', 'string', Rule::in(self::TASK_FILTERS)],
            'filters.search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'filters.includeSessionNotes' => ['sometimes', 'boolean'],

            'filters.calendar' => ['sometimes', 'array'],
            'filters.calendar.include' => ['sometimes', 'boolean'],
            'filters.calendar.accountIds' => ['sometimes', 'array', 'max:200'],
            'filters.calendar.accountIds.*' => ['integer'],
            'filters.calendar.calendarIds' => ['sometimes', 'array', 'max:500'],
            'filters.calendar.calendarIds.*' => ['string', 'max:255'],
            'filters.calendar.eventIds' => ['sometimes', 'array', 'max:2000'],
            'filters.calendar.eventIds.*' => ['string', 'max:1100'],
            'filters.calendar.eventMode' => ['sometimes', 'string', Rule::in(['all', 'selected'])],
            'filters.calendar.workFilter' => ['sometimes', 'string', Rule::in(self::EVENT_WORK_FILTERS)],
            'filters.calendar.search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'filters.calendar.includeAllDay' => ['sometimes', 'boolean'],

            'filters.includeSideTasks' => ['sometimes', 'boolean'],
            'filters.includeFocusBlocks' => ['sometimes', 'boolean'],
            'filters.includeDayOffs' => ['sometimes', 'boolean'],
        ];
    }

    public static function dayCount(Carbon $from, Carbon $to): int
    {
        return (int) round($from->copy()->startOfDay()->diffInDays($to->copy()->startOfDay())) + 1;
    }

    /**
     * @param  array<string, mixed>  $input
     */
    public static function assertRange(array $input): void
    {
        $from = Carbon::createFromFormat('Y-m-d', $input['from'], $input['timezone'])->startOfDay();
        $to = Carbon::createFromFormat('Y-m-d', $input['to'], $input['timezone'])->startOfDay();

        if (self::dayCount($from, $to) > self::MAX_DAYS) {
            throw ValidationException::withMessages([
                'to' => 'Reports can cover at most two years at a time.',
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public static function normalize(array $input, User $user, ?ReportSetting $setting = null): array
    {
        $setting ??= ReportSetting::forUser($user);
        $from = Carbon::createFromFormat('Y-m-d', $input['from'], $input['timezone'])->startOfDay();
        $to = Carbon::createFromFormat('Y-m-d', $input['to'], $input['timezone'])->startOfDay();
        $template = $input['template'] ?? 'full';
        $sections = self::normalizeList($input['sections'] ?? self::TEMPLATES[$template] ?? self::TEMPLATES['full']);
        $sections = array_values(array_intersect(self::SECTIONS, $sections));
        $filters = is_array($input['filters'] ?? null) ? $input['filters'] : [];
        $calendar = is_array($filters['calendar'] ?? null) ? $filters['calendar'] : [];
        $days = self::dayCount($from, $to);
        $workOnly = $template === 'work';

        if ($workOnly) {
            // Employer reports are guarded at the server boundary: no study,
            // personal calendar events, side tasks, focus blocks, or day-off
            // sections can be reintroduced by a modified request.
            $sections = array_values(array_intersect(self::WORK_ONLY_SECTIONS, $sections));
            $filters['sessionTypes'] = ['work'];
            $filters['includeSideTasks'] = false;
            $filters['includeFocusBlocks'] = false;
            $filters['includeDayOffs'] = false;
            $calendar['workFilter'] = 'work';
            $calendar['includeAllDay'] = false;
        }

        return [
            'template' => $template,
            'title' => self::text($input['title'] ?? null, $workOnly ? 'Work Report' : 'Time & Work Report'),
            'subtitle' => self::text($input['subtitle'] ?? null, self::periodLabel($from, $to)),
            'company' => self::text($input['company'] ?? null, $setting->company_name),
            'preparedFor' => self::text($input['preparedFor'] ?? null, null),
            'preparedBy' => self::text($input['preparedBy'] ?? null, $setting->prepared_by ?? $user->name),
            'accentColor' => $input['accentColor'] ?? $setting->accent_color ?: ReportSetting::DEFAULT_ACCENT,
            'footerText' => self::text($input['footerText'] ?? null, $setting->footer_text),
            'showPageNumbers' => (bool) ($input['showPageNumbers'] ?? true),
            'notes' => (string) ($input['notes'] ?? ''),
            'from' => $from->format('Y-m-d'),
            'to' => $to->format('Y-m-d'),
            'timezone' => $input['timezone'],
            'comparison' => $input['comparison'] ?? 'none',
            'groupBy' => $input['groupBy'] ?? self::defaultGrouping($days),
            'paper' => $input['paper'] ?? 'a4',
            'orientation' => $input['orientation'] ?? 'portrait',
            'sections' => $sections === [] ? ($workOnly ? self::TEMPLATES['work'] : self::TEMPLATES['full']) : $sections,
            'filters' => [
                'sessionTypes' => self::normalizeList($filters['sessionTypes'] ?? self::SESSION_TYPES, self::SESSION_TYPES),
                'sessionSources' => self::normalizeList($filters['sessionSources'] ?? self::SESSION_SOURCES, self::SESSION_SOURCES),
                'workTaskIds' => array_values(array_unique(array_map('intval', $filters['workTaskIds'] ?? []))),
                'taskFilter' => $filters['taskFilter'] ?? 'all',
                'search' => trim((string) ($filters['search'] ?? '')),
                'includeSessionNotes' => (bool) ($filters['includeSessionNotes'] ?? true),
                'calendar' => [
                    'include' => (bool) ($calendar['include'] ?? true),
                    'accountIds' => array_values(array_unique(array_map('intval', $calendar['accountIds'] ?? []))),
                    'calendarIds' => array_values(array_unique(array_map('strval', $calendar['calendarIds'] ?? []))),
                    'eventIds' => array_values(array_unique(array_map('strval', $calendar['eventIds'] ?? []))),
                    'eventMode' => $calendar['eventMode'] ?? 'all',
                    'workFilter' => $calendar['workFilter'] ?? 'all',
                    'search' => trim((string) ($calendar['search'] ?? '')),
                    'includeAllDay' => (bool) ($calendar['includeAllDay'] ?? true),
                ],
                'includeSideTasks' => (bool) ($filters['includeSideTasks'] ?? true),
                'includeFocusBlocks' => (bool) ($filters['includeFocusBlocks'] ?? true),
                'includeDayOffs' => (bool) ($filters['includeDayOffs'] ?? true),
            ],
        ];
    }

    /**
     * @return array<int, string>
     */
    public static function templateSections(string $template): array
    {
        return self::TEMPLATES[$template] ?? self::TEMPLATES['full'];
    }

    public static function periodLabel(Carbon $from, Carbon $to): string
    {
        if ($from->isSameDay($from->copy()->startOfMonth()) && $to->isSameDay($to->copy()->endOfMonth()) && $from->isSameMonth($to)) {
            return $from->format('F Y');
        }

        if ($from->month === 1 && $from->day === 1 && $to->month === 12 && $to->day === 31 && $from->year === $to->year) {
            return (string) $from->year;
        }

        return $from->format('M j, Y').' – '.$to->format('M j, Y');
    }

    public static function defaultGrouping(int $days): string
    {
        return match (true) {
            $days <= 31 => 'day',
            $days <= 120 => 'week',
            default => 'month',
        };
    }

    /**
     * @param  array<int, mixed>  $values
     * @param  array<int, string>|null  $allowed
     * @return array<int, string>
     */
    private static function normalizeList(array $values, ?array $allowed = null): array
    {
        $values = array_values(array_unique(array_map('strval', $values)));

        return $allowed === null ? $values : array_values(array_intersect($allowed, $values));
    }

    private static function text(mixed $value, ?string $fallback): ?string
    {
        if (! is_string($value)) {
            return $fallback;
        }

        $value = trim($value);

        return $value === '' ? $fallback : $value;
    }
}
