@php
    $notes = trim((string) $report['notes']);
@endphp

<section class="section avoid">
    <table class="section-head">
        <tr>
            <td>
                <div class="section-eyebrow">Notes</div>
                <h2 class="section-title">Context and commentary</h2>
            </td>
            <td class="section-note">Included by the report builder</td>
        </tr>
    </table>
    <div class="section-rule" style="background-color: {{ $accent }};"></div>

    <div class="notes-box">{{ $notes }}</div>
</section>
