<style>
    @page {
        margin: 36pt 36pt 36pt 36pt;
    }

    * {
        box-sizing: border-box;
    }

    /* Dompdf applies @page margins to the root frame; resetting html would override them. */
    body {
        margin: 0;
        padding: 0;
    }

    body {
        background: #ffffff;
        color: #1f2937;
        font-family: "DejaVu Sans", Arial, sans-serif;
        font-size: 11.5px;
        line-height: 1.55;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .report {
        width: 100%;
        margin: 0 auto;
        background: #ffffff;
    }

    .report.preview-paper {
        max-width: 856px;
        padding: 48px;
        /* 0.5in, same as the PDF @page margin */
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
    }

    /* max-width = paper width, since padding is now included (box-sizing: border-box) */
    .report.preview-paper.report-a4.report-portrait {
        max-width: 794px;
    }

    .report.preview-paper.report-letter.report-portrait {
        max-width: 816px;
    }

    .report.preview-paper.report-a4.report-landscape {
        max-width: 1122px;
    }

    .report.preview-paper.report-letter.report-landscape {
        max-width: 1056px;
    }

    /* Applied by the image export while capturing */
    .report.preview-paper.is-exporting {
        margin: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
    }

    .report.preview-paper.report-a4.report-portrait {
        max-width: 698px;
    }

    .report.preview-paper.report-letter.report-portrait {
        max-width: 720px;
    }

    .report.preview-paper.report-a4.report-landscape {
        max-width: 1026px;
    }

    .report.preview-paper.report-letter.report-landscape {
        max-width: 960px;
    }

    .cover {
        position: relative;
        padding: 34px 38px 30px;
        border: 1px solid #dbe4e2;
        overflow: hidden;
    }

    .cover-band {
        height: 8px;
        margin: -34px -38px 34px;
    }

    .cover-top {
        width: 100%;
        border-collapse: collapse;
    }

    .cover-top td {
        vertical-align: top;
    }

    .brand-lockup {
        width: 100%;
        border-collapse: collapse;
    }

    .brand-lockup td {
        vertical-align: middle;
    }

    .brand-mark {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        color: #ffffff;
        font-size: 18px;
        font-weight: bold;
        text-align: center;
        line-height: 44px;
    }

    .cover-logo {
        max-height: 58px;
        max-width: 190px;
    }

    .cover-kicker {
        color: #64748b;
        font-size: 9px;
        font-weight: bold;
        letter-spacing: 1.6px;
        text-transform: uppercase;
    }

    .cover-company {
        margin-top: 2px;
        color: #334155;
        font-size: 11px;
        font-weight: bold;
    }

    .cover-main {
        padding-top: 105px;
    }

    .cover-title {
        margin: 10px 0 8px;
        color: #0f172a;
        font-size: 34px;
        font-weight: bold;
        line-height: 1.1;
        letter-spacing: -0.6px;
    }

    .cover-subtitle {
        margin: 0;
        color: #475569;
        font-size: 15px;
        line-height: 1.45;
    }

    .cover-rule {
        width: 82px;
        height: 4px;
        margin: 24px 0;
    }

    .cover-meta {
        width: 100%;
        margin-top: 30px;
        border-collapse: collapse;
    }

    .cover-meta td {
        width: 50%;
        padding: 9px 0;
        vertical-align: top;
        border-top: 1px solid #e2e8f0;
    }

    .meta-label {
        color: #94a3b8;
        font-size: 8px;
        font-weight: bold;
        letter-spacing: 1px;
        text-transform: uppercase;
    }

    .meta-value {
        margin-top: 3px;
        color: #1e293b;
        font-size: 11px;
        font-weight: bold;
    }

    .cover-contents {
        margin-top: 38px;
        padding-top: 16px;
        border-top: 1px solid #e2e8f0;
    }

    .cover-contents-title {
        margin-bottom: 7px;
        color: #94a3b8;
        font-size: 8px;
        font-weight: bold;
        letter-spacing: 1.2px;
        text-transform: uppercase;
    }

    .cover-contents span {
        display: inline-block;
        margin: 0 12px 5px 0;
        color: #475569;
        font-size: 9.5px;
    }

    .cover-foot {
        margin-top: 34px;
        padding-top: 12px;
        border-top: 1px solid #e2e8f0;
        color: #94a3b8;
        font-size: 8.5px;
    }

    .section {
        margin-top: 26px;
    }

    .section:first-child {
        margin-top: 0;
    }

    .section-head {
        width: 100%;
        margin-bottom: 10px;
        border-collapse: collapse;
    }

    .section-head td {
        vertical-align: bottom;
    }

    .section-eyebrow {
        color: #94a3b8;
        font-size: 7.5px;
        font-weight: bold;
        letter-spacing: 1.5px;
        text-transform: uppercase;
    }

    .section-title {
        margin: 2px 0 0;
        color: #0f172a;
        font-size: 18px;
        font-weight: bold;
        line-height: 1.25;
        letter-spacing: -0.2px;
    }

    .section-note {
        color: #64748b;
        font-size: 9px;
        text-align: right;
    }

    .section-rule {
        height: 2px;
        margin-bottom: 14px;
    }

    .muted {
        color: #64748b;
    }

    .tiny {
        font-size: 8.5px;
    }

    .strong {
        font-weight: bold;
        color: #0f172a;
    }

    .narrative {
        margin: 0 0 12px;
        color: #334155;
        font-size: 12px;
        line-height: 1.65;
    }

    .highlight-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 14px;
    }

    .highlight-table td {
        padding: 3px 10px 3px 0;
        vertical-align: top;
        color: #475569;
        font-size: 9.5px;
    }

    .highlight-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-right: 6px;
        border-radius: 3px;
    }

    .kpi-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 7px;
        margin: 0 -7px;
    }

    .kpi-table td {
        width: 25%;
        padding: 11px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        vertical-align: top;
    }

    .kpi-label {
        color: #64748b;
        font-size: 8px;
        font-weight: bold;
        letter-spacing: 0.7px;
        text-transform: uppercase;
    }

    .kpi-value {
        margin-top: 4px;
        color: #0f172a;
        font-size: 20px;
        font-weight: bold;
        line-height: 1.15;
    }

    .kpi-hint {
        margin-top: 3px;
        color: #94a3b8;
        font-size: 8.2px;
    }

    .two-col {
        width: 100%;
        border-collapse: collapse;
    }

    .two-col>tbody>tr>td {
        width: 50%;
        vertical-align: top;
    }

    .two-col>tbody>tr>td:first-child {
        padding-right: 9px;
    }

    .two-col>tbody>tr>td:last-child {
        padding-left: 9px;
    }

    .data-table {
        width: 100%;
        border-collapse: collapse;
    }

    .data-table th {
        padding: 6px 7px;
        background: #f1f5f9;
        border-bottom: 2px solid #cbd5e1;
        color: #475569;
        font-size: 7.8px;
        font-weight: bold;
        letter-spacing: 0.5px;
        text-align: left;
        text-transform: uppercase;
    }

    .data-table td {
        padding: 6px 7px;
        border-bottom: 1px solid #e8eef3;
        color: #334155;
        font-size: 9.2px;
        vertical-align: top;
    }

    .data-table tr {
        page-break-inside: avoid;
    }

    .data-table tr.total-row td {
        background: #f8fafc;
        border-top: 2px solid #cbd5e1;
        font-weight: bold;
        color: #0f172a;
    }

    .data-table .right {
        text-align: right;
    }

    .data-table .nowrap {
        white-space: nowrap;
    }

    .data-table .cell-title {
        color: #0f172a;
        font-weight: bold;
    }

    .data-table .cell-sub {
        margin-top: 1px;
        color: #94a3b8;
        font-size: 8px;
    }

    .pill {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 7.6px;
        font-weight: bold;
        white-space: nowrap;
    }

    .pill-work {
        background: #ccfbf1;
        color: #115e59;
    }

    .pill-study {
        background: #dbeafe;
        color: #1d4ed8;
    }

    .pill-personal {
        background: #f1f5f9;
        color: #64748b;
    }

    .pill-done {
        background: #dcfce7;
        color: #166534;
    }

    .pill-active {
        background: #ccfbf1;
        color: #115e59;
    }

    .pill-open {
        background: #fef3c7;
        color: #92400e;
    }

    .pill-danger {
        background: #fee2e2;
        color: #b91c1c;
    }

    .bar-row {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 5px;
    }

    .bar-row td {
        vertical-align: middle;
        padding: 2px 0;
    }

    .bar-label {
        width: 58px;
        color: #64748b;
        font-size: 8px;
        white-space: nowrap;
    }

    .bar-hours {
        width: 42px;
        color: #334155;
        font-size: 8px;
        font-weight: bold;
        text-align: right;
        white-space: nowrap;
    }

    .bar-track {
        width: 100%;
        height: 7px;
        background: #eef2f6;
        border-radius: 4px;
        overflow: hidden;
    }

    .bar-fill {
        height: 7px;
        border-radius: 4px;
    }

    .bar-fill-study {
        height: 4px;
        margin-top: 2px;
        border-radius: 4px;
        background: #93c5fd;
    }

    .bar-empty {
        color: #94a3b8;
        font-size: 9px;
        font-style: italic;
    }

    .chart-caption {
        margin-top: 6px;
        color: #94a3b8;
        font-size: 8px;
    }

    .heat-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 2px;
    }

    .heat-table th {
        padding: 0 3px 4px 0;
        color: #64748b;
        font-size: 8px;
        font-weight: bold;
        text-align: left;
        white-space: nowrap;
    }

    .heat-table td {
        height: 13px;
        padding: 0;
        border: 1px solid #ffffff;
        border-radius: 2px;
    }

    .heat-legend {
        margin-top: 7px;
        color: #94a3b8;
        font-size: 7.5px;
    }

    .heat-swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin: 0 2px 0 5px;
        border: 1px solid #ffffff;
        border-radius: 2px;
        vertical-align: middle;
    }

    .progress-track {
        width: 100%;
        height: 8px;
        background: #eef2f6;
        border-radius: 4px;
        overflow: hidden;
    }

    .progress-fill {
        height: 8px;
        border-radius: 4px;
    }

    .notes-box {
        padding: 12px 14px;
        background: #f8fafc;
        border-left: 3px solid #cbd5e1;
        color: #334155;
        font-size: 10px;
        line-height: 1.65;
        white-space: pre-wrap;
    }

    .warning-box {
        margin-top: 14px;
        padding: 9px 11px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        color: #92400e;
        font-size: 8.5px;
        line-height: 1.55;
    }

    .empty-state {
        padding: 16px;
        background: #f8fafc;
        border: 1px dashed #cbd5e1;
        color: #64748b;
        font-size: 9.5px;
        text-align: center;
    }

    .document-footer {
        margin-top: 28px;
        padding-top: 10px;
        border-top: 1px solid #e2e8f0;
        color: #94a3b8;
        font-size: 8px;
    }

    .document-footer .right {
        float: right;
    }

    .page-break {
        page-break-before: always;
    }

    .cover-break {
        page-break-after: always;
    }

    .avoid {
        page-break-inside: avoid;
    }

    .pdf .section {
        page-break-inside: auto;
    }

    .pdf .section-title,
    .pdf .section-head {
        page-break-after: avoid;
    }

    .preview-paper .section {
        padding-bottom: 2px;
    }

    .preview-paper .cover {
        min-height: 880px;
    }

    .cover.landscape {
        min-height: 600px;
    }
</style>