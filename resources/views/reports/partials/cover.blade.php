@php
    $meta = $report['meta'];
    $contents = array_values(array_filter($meta['sections'], fn (string $section): bool => $section !== 'cover' && isset($sectionLabels[$section])));
@endphp

<div class="cover {{ $meta['orientation'] === 'landscape' ? 'landscape' : '' }}">
    <div class="cover-band" style="background-color: {{ $accent }};"></div>

    <table class="cover-top">
        <tr>
            <td style="text-align: left;">
                <table class="brand-lockup">
                    <tr>
                        @if ($meta['logoDataUri'])
                            <td style="width: 200px; padding-right: 14px;">
                                <img class="cover-logo" src="{{ $meta['logoDataUri'] }}" alt="Logo">
                            </td>
                        @else
                            <td style="width: 56px;">
                                <div class="brand-mark" style="background-color: {{ $accent }};">TW</div>
                            </td>
                        @endif
                        <td>
                            @if ($meta['company'])
                                <div class="cover-company">{{ $meta['company'] }}</div>
                            @endif
                            <div class="cover-kicker">Time Weaver · Work report</div>
                        </td>
                    </tr>
                </table>
            </td>
            <td style="text-align: right;">
                <div class="cover-kicker">Reporting period</div>
                <div class="metadata strong" style="margin-top: 3px;">{{ $meta['periodLabel'] }}</div>
                <div class="tiny muted">{{ $meta['from'] }} → {{ $meta['to'] }}</div>
            </td>
        </tr>
    </table>

    <div class="cover-main">
        <div class="cover-kicker">Prepared report</div>
        <h1 class="cover-title">{{ $meta['title'] }}</h1>
        @if ($meta['subtitle'])
            <p class="cover-subtitle">{{ $meta['subtitle'] }}</p>
        @endif
        <div class="cover-rule" style="background-color: {{ $accent }};"></div>
    </div>

    <table class="cover-meta">
        <tr>
            <td>
                <div class="meta-label">Prepared by</div>
                <div class="meta-value">{{ $meta['preparedBy'] ?: '—' }}</div>
            </td>
            <td>
                <div class="meta-label">Prepared for</div>
                <div class="meta-value">{{ $meta['preparedFor'] ?: '—' }}</div>
            </td>
        </tr>
        <tr>
            <td>
                <div class="meta-label">Generated</div>
                <div class="meta-value">{{ $meta['generatedAt'] }}</div>
            </td>
            <td>
                <div class="meta-label">Time zone</div>
                <div class="meta-value">{{ $meta['timezone'] }}</div>
            </td>
        </tr>
        <tr>
            <td>
                <div class="meta-label">Format</div>
                <div class="meta-value">{{ $meta['paperLabel'] }}</div>
            </td>
            <td>
                <div class="meta-label">Days covered</div>
                <div class="meta-value">{{ $report['counts']['days'] }}</div>
            </td>
        </tr>
    </table>

    @if (count($contents) > 0)
        <div class="cover-contents">
            <div class="cover-contents-title">Inside this report</div>
            @foreach ($contents as $section)
                <span>{{ $sectionLabels[$section] }}</span>
            @endforeach
        </div>
    @endif

    <div class="cover-foot">
        {{ $meta['company'] ?: 'ShiftGrid' }} · {{ $meta['periodLabel'] }} · Generated {{ $meta['generatedAt'] }}
    </div>
</div>
