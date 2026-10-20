@php
    $tasks = $report['tasks'];
@endphp

<section class="section">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Work tasks</div>
                <h2 class="section-title">Task progress</h2>
            </td>
            <td class="section-note">{{ count($tasks) }} of {{ $report['counts']['tasks'] }} tasks</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    @if (count($tasks) === 0)
        <div class="empty-state">No work tasks matched the selected filters.</div>
    @else
        <table class="data-table">
            <thead>
                <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th class="right">Tracked</th>
                    <th class="right">Estimate</th>
                    <th>Due</th>
                    <th>Completed</th>
                </tr>
            </thead>
            <tbody>
                @foreach ($tasks as $task)
                    <tr>
                        <td>
                            <span class="cell-title">{{ $task['title'] }}</span>
                            @if ($task['overdue'])
                                <div class="cell-sub" style="color: #b91c1c;">Overdue</div>
                            @endif
                        </td>
                        <td>
                            <span class="pill {{ $task['done'] ? 'pill-done' : ($task['status'] === 'active' ? 'pill-active' : 'pill-open') }}">{{ $task['statusLabel'] }}</span>
                        </td>
                        <td class="right nowrap">{{ $task['trackedLabel'] }}</td>
                        <td class="right nowrap">{{ $task['estimateLabel'] }}</td>
                        <td class="nowrap">{{ $task['dueLabel'] ?: '—' }}</td>
                        <td class="nowrap">{{ $task['completedLabel'] ?: '—' }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    @endif
</section>
