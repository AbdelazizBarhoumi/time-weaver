@php
    $trend = $report['trend'];
    $workOnly = $report['meta']['workOnly'] ?? false;
    $groupLabel = ['day' => 'Daily', 'week' => 'Weekly', 'month' => 'Monthly'][$trend['groupBy']] ?? 'Daily';
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Activity trend</div>
                <h2 class="section-title">{{ $groupLabel }} tracked time</h2>
            </td>
            <td class="section-note">Peak {{ number_format($trend['maxHours'], 1) }}h</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($trend['buckets']) === 0)
        <div class="empty-state">No tracked sessions fall inside this period.</div>
    @else
        <table style="width: 100%; border-collapse: collapse;">
            @foreach ($trend['buckets'] as $bucket)
                <tr class="bar-row">
                    <td class="bar-label">{{ $bucket['label'] }}</td>
                    <td>
                        <div class="bar-track">
                            <div class="bar-fill" style="width: {{ max($bucket['workPercent'], $bucket['workHours'] > 0 ? 1 : 0) }}%; background-color: {{ $accent }};"></div>
                            @if (! $workOnly && $bucket['studyHours'] > 0)
                                <div class="bar-fill-study" style="width: {{ max($bucket['studyPercent'], 1) }}%;"></div>
                            @endif
                        </div>
                    </td>
                    <td class="bar-hours">{{ number_format($bucket['totalHours'], 1) }}h</td>
                </tr>
            @endforeach
        </table>

        <div class="chart-caption">
            <span class="heat-swatch" style="background-color: {{ $accent }};"></span> Work
            @if (! $workOnly)
                <span class="heat-swatch" style="background-color: #93c5fd;"></span> Study
            @endif
            · Bars are scaled to the busiest {{ $trend['groupBy'] === 'day' ? 'day' : $trend['groupBy'] }} in the report.
        </div>
    @endif
</section>
