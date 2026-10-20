@php
    $study = $report['study'];
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Study focus</div>
                <h2 class="section-title">Learning time</h2>
            </td>
            <td class="section-note">{{ $study['sessionCount'] }} study sessions</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    <table class="kpi-table">
        <tr>
            <td>
                <div class="kpi-label">Total study</div>
                <div class="kpi-value">{{ $study['totalLabel'] }}</div>
                <div class="kpi-hint">{{ $study['activeDays'] }} active study days</div>
            </td>
            <td>
                <div class="kpi-label">Weekly average</div>
                <div class="kpi-value">{{ $study['weeklyAverageLabel'] }}</div>
                <div class="kpi-hint">Across the report period</div>
            </td>
            <td>
                <div class="kpi-label">Best study day</div>
                <div class="kpi-value">{{ $study['bestDay'] ? $study['bestDay']['hoursLabel'] : '0.0h' }}</div>
                <div class="kpi-hint">{{ $study['bestDay'] ? $study['bestDay']['label'] : 'No study sessions yet' }}</div>
            </td>
            <td>
                <div class="kpi-label">Share of tracked time</div>
                <div class="kpi-value">{{ $study['sharePercent'] }}%</div>
                <div class="kpi-hint">Study vs. work + study</div>
            </td>
        </tr>
    </table>

    <div style="margin-top: 12px;">
        <div class="progress-track">
            <div class="progress-fill" style="width: {{ $study['sharePercent'] }}%; background-color: #3b82f6;"></div>
        </div>
        <div class="chart-caption">{{ $study['sharePercent'] }}% of all tracked time was study.</div>
    </div>
</section>
