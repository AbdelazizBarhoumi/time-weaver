<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $report['meta']['title'] }}</title>
    @include('reports.partials.styles')
</head>
<body class="{{ $forPdf ? 'pdf' : 'preview' }}">
@php
    $meta = $report['meta'];
    $accent = $meta['accentColor'] ?: '#0f766e';
    $sections = $meta['sections'];
    $sectionLabels = [
        'cover' => 'Cover',
        'summary' => 'Executive summary',
        'kpis' => 'Key numbers',
        'trend' => 'Activity trend',
        'heatmap' => 'Consistency',
        'daily' => 'Daily breakdown',
        'sessions' => 'Tracked sessions',
        'calendar' => 'Calendar agenda',
        'tasks' => 'Work tasks',
        'study' => 'Study focus',
        'monthly' => 'Monthly goals',
        'comparison' => 'Period comparison',
        'sideTasks' => 'Side tasks',
        'focusBlocks' => 'Focus blocks',
        'dayOffs' => 'Days off',
        'notes' => 'Notes',
    ];
@endphp

@php
    // Printable width in pt = paper width - 2 × 0.5in margin (72pt), so the PDF
    // doesn't depend on Dompdf resolving width:100% against the page.
    $paperWidthsPt = [
        'a4' => ['portrait' => 595.28, 'landscape' => 841.89],
        'letter' => ['portrait' => 612, 'landscape' => 792],
    ];
    $printablePt = floor(($paperWidthsPt[$meta['paper']][$meta['orientation']] ?? 595.28) - 72);
@endphp

<div class="report {{ $forPdf ? '' : 'preview-paper' }} report-{{ $report['meta']['paper'] }} report-{{ $report['meta']['orientation'] }}"
     @if ($forPdf) style="width: {{ $printablePt }}pt; margin: 0;" @endif>
    @foreach ($sections as $section)
        @switch($section)
            @case('cover')
                @include('reports.partials.cover')
                @if ($forPdf)
                    <div class="cover-break"></div>
                @endif
                @break
            @case('summary')
                @if ($report['summary'])
                    @include('reports.partials.summary')
                @endif
                @break
            @case('kpis')
                @include('reports.partials.kpis')
                @break
            @case('trend')
                @if ($report['trend'])
                    @include('reports.partials.trend')
                @endif
                @break
            @case('heatmap')
                @if ($report['heatmap'])
                    @include('reports.partials.heatmap')
                @endif
                @break
            @case('daily')
                @if ($report['daily'])
                    @include('reports.partials.daily')
                @endif
                @break
            @case('sessions')
                @if ($report['sessions'])
                    @include('reports.partials.sessions')
                @endif
                @break
            @case('calendar')
                @if ($report['events'])
                    @include('reports.partials.calendar')
                @endif
                @break
            @case('tasks')
                @if ($report['tasks'])
                    @include('reports.partials.tasks')
                @endif
                @break
            @case('study')
                @if ($report['study'])
                    @include('reports.partials.study')
                @endif
                @break
            @case('monthly')
                @if ($report['monthly'])
                    @include('reports.partials.monthly')
                @endif
                @break
            @case('comparison')
                @if ($report['comparison'])
                    @include('reports.partials.comparison')
                @endif
                @break
            @case('sideTasks')
                @if ($report['sideTasks'])
                    @include('reports.partials.side-tasks')
                @endif
                @break
            @case('focusBlocks')
                @if ($report['focusBlocks'])
                    @include('reports.partials.focus-blocks')
                @endif
                @break
            @case('dayOffs')
                @if ($report['dayOffs'])
                    @include('reports.partials.day-offs')
                @endif
                @break
            @case('notes')
                @if (trim((string) $report['notes']) !== '')
                    @include('reports.partials.notes')
                @endif
                @break
        @endswitch
    @endforeach

    @if (count($report['warnings']) > 0)
        <div class="warning-box avoid">
            <strong>Report notes:</strong>
            @foreach ($report['warnings'] as $warning)
                <div>· {{ $warning }}</div>
            @endforeach
        </div>
    @endif

    <div class="document-footer">
        <span class="right">{{ $meta['periodLabel'] }} · {{ $meta['generatedAt'] }} · {{ $meta['paperLabel'] }}</span>
        {{ $meta['footerText'] ?: 'Generated with ShiftGrid' }}
    </div>
</div>
</body>
</html>
