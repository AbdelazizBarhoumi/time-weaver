@php
    $summary = $report['summary'];
    $workOnly = $report['meta']['workOnly'] ?? false;
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Key numbers</div>
                <h2 class="section-title">The period in figures</h2>
            </td>
            <td class="section-note">{{ $workOnly ? 'Tracked work and work calendar load' : 'Tracked time and calendar load' }}</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    <table class="kpi-table">
        <tr>
            <td>
                <div class="kpi-label">{{ $workOnly ? 'Work tracked' : 'Total tracked' }}</div>
                <div class="kpi-value">{{ $workOnly ? $summary['workLabel'] : $summary['totalLabel'] }}</div>
                <div class="kpi-hint">{{ $workOnly ? 'Work sessions only' : 'Work + study' }}</div>
            </td>
            <td>
                <div class="kpi-label">Active days</div>
                <div class="kpi-value">{{ $summary['activeDays'] }}</div>
                <div class="kpi-hint">{{ $workOnly ? 'Days with tracked work' : 'Days with tracked time' }}</div>
            </td>
            <td>
                <div class="kpi-label">Average day</div>
                <div class="kpi-value">{{ $summary['avgLabel'] }}</div>
                <div class="kpi-hint">Across active days</div>
            </td>
            <td>
                <div class="kpi-label">Best day</div>
                <div class="kpi-value">{{ $summary['bestDay'] ? $summary['bestDay']['hoursLabel'] : '0.0h' }}</div>
                <div class="kpi-hint">{{ $summary['bestDay'] ? $summary['bestDay']['label'] : 'No tracked days yet' }}</div>
            </td>
        </tr>
        <tr>
            <td>
                <div class="kpi-label">Scheduled work</div>
                <div class="kpi-value">{{ $summary['workEventLabel'] }}</div>
                <div class="kpi-hint">From calendar events</div>
            </td>
            <td>
                @if ($workOnly)
                    <div class="kpi-label">Sessions tracked</div>
                    <div class="kpi-value">{{ $summary['sessionCount'] }}</div>
                    <div class="kpi-hint">Work sessions in scope</div>
                @else
                    <div class="kpi-label">Work / study split</div>
                    <div class="kpi-value">{{ $summary['workHours'] > 0 || $summary['studyHours'] > 0 ? round(($summary['workHours'] / max(0.1, $summary['workHours'] + $summary['studyHours'])) * 100).'%' : '0%' }}</div>
                    <div class="kpi-hint">Work share of tracked time</div>
                @endif
            </td>
            <td>
                <div class="kpi-label">Top task</div>
                <div class="kpi-value" style="font-size: 13px;">{{ $summary['topTask'] ? $summary['topTask']['title'] : '—' }}</div>
                <div class="kpi-hint">{{ $summary['topTask'] ? $summary['topTask']['label'].' tracked' : 'No task sessions' }}</div>
            </td>
            <td>
                <div class="kpi-label">Top calendar</div>
                <div class="kpi-value" style="font-size: 13px;">{{ $summary['topCalendar'] ? $summary['topCalendar']['name'] : '—' }}</div>
                <div class="kpi-hint">{{ $summary['topCalendar'] ? $summary['topCalendar']['label'].' of work events' : 'No work events' }}</div>
            </td>
        </tr>
    </table>
</section>
