@php
    $heatmap = $report['heatmap'];
    $levels = [
        0 => '#f1f5f9',
        1 => '#d1fae5',
        2 => '#6ee7b7',
        3 => '#34d399',
        4 => $accent,
    ];
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Consistency</div>
                <h2 class="section-title">Daily activity heatmap</h2>
            </td>
            <td class="section-note">Each cell is one day</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    <table class="heat-table">
        @foreach ($heatmap['months'] as $month)
            <tr>
                <th style="width: 54px;">{{ $month['label'] }}</th>
                @for ($day = 1; $day <= 31; $day++)
                    @php
                        $cell = $month['days'][$day - 1] ?? null;
                    @endphp
                    @if ($cell && $cell['inRange'])
                        <td style="background-color: {{ $levels[$cell['level']] }};" title="{{ $cell['title'] }}"></td>
                    @else
                        <td style="background-color: transparent;"></td>
                    @endif
                @endfor
            </tr>
        @endforeach
    </table>

    <div class="heat-legend">
        Less
        @foreach ($levels as $color)
            <span class="heat-swatch" style="background-color: {{ $color }};"></span>
        @endforeach
        More
        <span class="muted">· 0h, under 2h, under 4h, under 6h, 6h+</span>
    </div>
</section>
