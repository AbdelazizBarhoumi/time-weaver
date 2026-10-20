@php
    $dayOffs = $report['dayOffs'];
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Calendar exceptions</div>
                <h2 class="section-title">Days off</h2>
            </td>
            <td class="section-note">{{ count($dayOffs) }} days</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($dayOffs) === 0)
        <div class="empty-state">No days off were recorded in this period.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Effect on targets</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($dayOffs as $dayOff)
                    <tr>
                        <td class="cell-title">{{ $dayOff['dateLabel'] }}</td>
                        <td>
                            <span class="pill {{ $dayOff['type'] === 'included' ? 'pill-work' : 'pill-personal' }}">{{ $dayOff['typeLabel'] }}</span>
                        </td>
                        <td>{{ $dayOff['type'] === 'included' ? 'Counts toward the monthly target' : 'Excluded from the monthly target' }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
