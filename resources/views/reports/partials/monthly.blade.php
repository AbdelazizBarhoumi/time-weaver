@php
    $monthly = $report['monthly'];
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Monthly goals</div>
                <h2 class="section-title">Pace against required days</h2>
            </td>
            <td class="section-note">Target uses 8h per required day</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($monthly) === 0)
        <div class="empty-state">No monthly targets fall inside this period.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Month</th>
                    <th class="right">Done</th>
                    <th class="right">Target</th>
                    <th class="right">Remaining</th>
                    <th>Progress</th>
                    <th class="right">Pace</th>
                    <th class="right">Days left</th>
                    <th class="right">Needed / day</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($monthly as $month)
                    <tr>
                        <td class="nowrap"><span class="cell-title">{{ $month['label'] }}</span></td>
                        <td class="right nowrap">{{ $month['doneLabel'] }}</td>
                        <td class="right nowrap">{{ $month['targetLabel'] }}</td>
                        <td class="right nowrap">{{ $month['remainingLabel'] }}</td>
                        <td style="min-width: 92px;">
                            <div class="progress-track">
                                <div class="progress-fill" style="width: {{ round($month['progress'] * 100) }}%; background-color: {{ $accent }};"></div>
                            </div>
                            <div class="cell-sub">{{ round($month['progress'] * 100) }}%</div>
                        </td>
                        <td class="right nowrap" style="color: {{ $month['pace'] < 0 ? '#b91c1c' : '#166534' }};">{{ $month['paceLabel'] }}</td>
                        <td class="right">{{ $month['daysLeft'] }}</td>
                        <td class="right nowrap">{{ $month['perDayLabel'] }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
