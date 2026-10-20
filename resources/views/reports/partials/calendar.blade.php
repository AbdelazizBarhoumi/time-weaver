@php
    $events = $report['events'];
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Calendar</div>
                <h2 class="section-title">Agenda</h2>
            </td>
            <td class="section-note">{{ count($events) }} of {{ $report['counts']['events'] }} events</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($events) === 0)
        <div class="empty-state">No calendar events matched the selected filters.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Calendar</th>
                    <th class="right">Length</th>
                    <th>Classification</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($events as $event)
                    <tr>
                        <td class="nowrap">{{ $event['dateLabel'] }}</td>
                        <td class="nowrap">{{ $event['timeLabel'] }}</td>
                        <td>
                            <span class="cell-title">{{ $event['title'] }}</span>
                            @if ($event['allDay'])
                                <div class="cell-sub">All-day event</div>
                            @endif
                        </td>
                        <td>
                            <div>{{ $event['calendar'] }}</div>
                            <div class="cell-sub">{{ $event['account'] }}</div>
                        </td>
                        <td class="right nowrap">{{ $event['durationLabel'] }}</td>
                        <td>
                            <span class="pill {{ $event['isWork'] ? 'pill-work' : 'pill-personal' }}">{{ $event['workLabel'] }}</span>
                            @if ($event['workSource'] === 'rule')
                                <div class="cell-sub">matched keyword</div>
                            @elseif ($event['workSource'] === 'account')
                                <div class="cell-sub">default-work calendar</div>
                            @elseif ($event['workSource'] === 'manual')
                                <div class="cell-sub">manual tag</div>
                            @endif
                        </td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
