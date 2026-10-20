@php
    $daily = $report['daily'];
    $workOnly = $report['meta']['workOnly'] ?? false;
    $totalWork = array_sum(array_column($daily, 'workHours'));
    $totalStudy = array_sum(array_column($daily, 'studyHours'));
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Day by day</div>
                <h2 class="section-title">Daily breakdown</h2>
            </td>
            <td class="section-note">{{ count($daily) }} rows</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($daily) === 0)
        <div class="empty-state">No daily activity to show.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th class="right">Work</th>
                    @if (! $workOnly)
                        <th class="right">Study</th>
                    @endif
                    <th class="right">Sessions</th>
                    <th class="right">Events</th>
                    @if (! $workOnly)
                        <th>Day off</th>
                    @endif
                </tr>
            </thead>
            <tbody>
                @foreach ($daily as $day)
                    <tr>
                        <td class="nowrap">
                            <span class="cell-title">{{ $day['label'] }}</span>
                            <div class="cell-sub">{{ $day['date'] }}</div>
                        </td>
                        <td class="right">{{ $day['workLabel'] }}</td>
                        @if (! $workOnly)
                            <td class="right">{{ $day['studyLabel'] }}</td>
                        @endif
                        <td class="right">{{ $day['sessionCount'] }}</td>
                        <td class="right">{{ $day['eventCount'] }}</td>
                        @if (! $workOnly)
                            <td>
                                @if ($day['dayOff'])
                                    <span class="pill {{ $day['dayOff'] === 'included' ? 'pill-work' : 'pill-personal' }}">{{ $day['dayOffLabel'] }}</span>
                                @else
                                    <span class="muted">-</span>
                                @endif
                            </td>
                        @endif
                    </tr>
                @endforeach
                <tr class="total-row">
                    <td>Total</td>
                    <td class="right">{{ number_format($totalWork, 1) }}h</td>
                    @if (! $workOnly)
                        <td class="right">{{ number_format($totalStudy, 1) }}h</td>
                    @endif
                    <td class="right">{{ array_sum(array_column($daily, 'sessionCount')) }}</td>
                    <td class="right">{{ array_sum(array_column($daily, 'eventCount')) }}</td>
                    @if (! $workOnly)
                        <td></td>
                    @endif
                </tr>
            </tbody>
        </table>
    @endif
</section>
