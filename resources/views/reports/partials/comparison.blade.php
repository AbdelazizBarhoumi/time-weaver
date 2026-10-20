@php
    $comparison = $report['comparison'];
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Period comparison</div>
                <h2 class="section-title">How this period compares</h2>
            </td>
            <td class="section-note">{{ $comparison['label'] }}</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    <table class="data-table">
        <thead>
            <tr>
                <th>Metric</th>
                <th class="right">This period</th>
                <th class="right">Previous</th>
                <th class="right">Change</th>
                <th class="right">Trend</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($comparison['metrics'] as $metric)
                <tr>
                    <td class="cell-title">{{ $metric['label'] }}</td>
                    <td class="right nowrap">{{ $metric['currentLabel'] }}</td>
                    <td class="right nowrap">{{ $metric['previousLabel'] }}</td>
                    <td class="right nowrap">{{ $metric['deltaLabel'] }}</td>
                    <td class="right nowrap" style="color: {{ $metric['direction'] === 'up' ? '#166534' : ($metric['direction'] === 'down' ? '#b91c1c' : '#64748b') }};">
                        @if ($metric['direction'] === 'up') ↑ @elseif ($metric['direction'] === 'down') ↓ @else → @endif
                        {{ $metric['percentLabel'] }}
                    </td>
                </tr>
            @endforeach
        </tbody>
    </table>
    <div class="chart-caption">Comparisons use the same filters and time zone for both periods.</div>
</section>
