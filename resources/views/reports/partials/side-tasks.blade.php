@php
    $sideTasks = $report['sideTasks'];
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Side tasks</div>
                <h2 class="section-title">Scheduled personal work</h2>
            </td>
            <td class="section-note">{{ count($sideTasks) }} items</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($sideTasks) === 0)
        <div class="empty-state">No side tasks were scheduled or completed in this period.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Task</th>
                    <th>Slot</th>
                    <th class="right">Estimate</th>
                    <th>Status</th>
                    <th>Blocks work time</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($sideTasks as $task)
                    <tr>
                        <td class="cell-title">{{ $task['title'] }}</td>
                        <td>{{ $task['slotLabel'] }}</td>
                        <td class="right nowrap">{{ $task['estimateLabel'] }}</td>
                        <td>
                            <span class="pill {{ $task['statusLabel'] === 'Done' ? 'pill-done' : 'pill-open' }}">{{ $task['statusLabel'] }}</span>
                        </td>
                        <td>{{ $task['blocksWork'] ? 'Yes' : 'No' }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
