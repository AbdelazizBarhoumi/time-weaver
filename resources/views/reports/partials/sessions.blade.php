@php
    $sessions = $report['sessions'];
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Tracked time</div>
                <h2 class="section-title">Session log</h2>
            </td>
            <td class="section-note">{{ count($sessions) }} of {{ $report['counts']['sessions'] }} sessions</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($sessions) === 0)
        <div class="empty-state">No tracked sessions matched the selected filters.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Type</th>
                    <th class="right">Duration</th>
                    <th>Task / note</th>
                    <th>Source</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($sessions as $session)
                    <tr>
                        <td class="nowrap">
                            <span class="cell-title">{{ $session['dateLabel'] }}</span>
                            <div class="cell-sub">{{ $session['date'] }}</div>
                        </td>
                        <td class="nowrap">{{ $session['timeLabel'] }}</td>
                        <td>
                            <span class="pill {{ $session['type'] === 'study' ? 'pill-study' : 'pill-work' }}">{{ $session['typeLabel'] }}</span>
                            @if ($session['active'])
                                <div class="cell-sub">running</div>
                            @endif
                        </td>
                        <td class="right nowrap">{{ $session['durationLabel'] }}</td>
                        <td>
                            @if ($session['task'])
                                <div class="cell-title">{{ $session['task'] }}</div>
                            @endif
                            @if ($session['note'])
                                <div class="cell-sub">{{ $session['note'] }}</div>
                            @elseif (! $session['task'])
                                <span class="muted">—</span>
                            @endif
                        </td>
                        <td class="nowrap">{{ $session['sourceLabel'] }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
