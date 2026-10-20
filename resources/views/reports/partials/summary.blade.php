@php
    $summary = $report['summary'];
    $workOnly = $report['meta']['workOnly'] ?? false;
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">At a glance</div>
                <h2 class="section-title">Executive summary</h2>
            </td>
            <td class="section-note">{{ $report['meta']['periodLabel'] }}</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    <p class="narrative">{{ $summary['text'] }}</p>

    @if (count($summary['highlights']) > 0)
        <table class="highlight-table">
            @foreach ($summary['highlights'] as $highlight)
                <tr>
                    <td style="width: 12px;"><span class="highlight-dot" style="background-color: {{ $accent }};"></span></td>
                    <td>{{ $highlight }}</td>
                </tr>
            @endforeach
        </table>
    @endif

    <table class="kpi-table">
        <tr>
            <td>
                <div class="kpi-label">Work hours</div>
                <div class="kpi-value">{{ $summary['workLabel'] }}</div>
                <div class="kpi-hint">{{ $summary['sessionCount'] }} sessions tracked</div>
            </td>
            @if ($workOnly)
                <td>
                    <div class="kpi-label">Scheduled work</div>
                    <div class="kpi-value">{{ $summary['workEventLabel'] }}</div>
                    <div class="kpi-hint">From work calendar events</div>
                </td>
            @else
                <td>
                    <div class="kpi-label">Study hours</div>
                    <div class="kpi-value">{{ $summary['studyLabel'] }}</div>
                    <div class="kpi-hint">{{ $summary['studySessionCount'] }} study sessions</div>
                </td>
            @endif
            <td>
                <div class="kpi-label">Calendar events</div>
                <div class="kpi-value">{{ $summary['eventCount'] }}</div>
                <div class="kpi-hint">{{ $workOnly ? $summary['workEventCount'].' work '.($summary['workEventCount'] === 1 ? 'event' : 'events') : $summary['workEventCount'].' marked as work' }}</div>
            </td>
            <td>
                <div class="kpi-label">Tasks completed</div>
                <div class="kpi-value">{{ $summary['completedTasks'] }}</div>
                <div class="kpi-hint">{{ $summary['taskCount'] }} tasks in scope</div>
            </td>
        </tr>
    </table>
</section>
