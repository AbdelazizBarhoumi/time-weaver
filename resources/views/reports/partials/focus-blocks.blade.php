@php
    $focusBlocks = $report['focusBlocks'];
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Focus blocks</div>
                <h2 class="section-title">Protected time</h2>
            </td>
            <td class="section-note">{{ count($focusBlocks) }} blocks</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($focusBlocks) === 0)
        <div class="empty-state">No focus blocks overlap this period.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Block</th>
                    <th>When</th>
                    <th class="right">Duration</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($focusBlocks as $block)
                    <tr>
                        <td class="cell-title">{{ $block['title'] }}</td>
                        <td>{{ $block['timeLabel'] }}</td>
                        <td class="right nowrap">{{ $block['durationLabel'] }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
