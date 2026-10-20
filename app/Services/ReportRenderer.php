<?php

namespace App\Services;

use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Support\Str;

/**
 * Renders the shared report view once for the live preview and once through
 * Dompdf. Keeping both paths on the same Blade template prevents drift between
 * what the user sees and what they download.
 */
class ReportRenderer
{
    /**
     * @param  array<string, mixed>  $document
     */
    public function html(array $document, bool $forPdf = false): string
    {
        return view('reports.document', [
            'report' => $document,
            'forPdf' => $forPdf,
        ])->render();
    }

    /**
     * @param  array<string, mixed>  $document
     */
    public function pdf(array $document): string
    {
        // Dompdf's PNG embedder needs GD; JPEGs embed without it. Fall back to
        // the brand mark rather than failing the whole export on hosts without GD.
        if (! function_exists('imagecreatefrompng')) {
            $logo = $document['meta']['logoDataUri'] ?? null;

            if (is_string($logo) && str_starts_with($logo, 'data:image/png')) {
                $document['meta']['logoDataUri'] = null;
            }
        }

        $pdf = Pdf::loadHTML($this->html($document, true))
            ->setPaper($document['meta']['paper'], $document['meta']['orientation'])
            ->setOption('defaultFont', 'DejaVu Sans')
            ->setOption('isHtml5ParserEnabled', true)
            ->setOption('isRemoteEnabled', false)
            ->setOption('dpi', 96);

        $pdf->render();

        $dompdf = $pdf->getDomPDF();
        $canvas = $dompdf->getCanvas();
        $footer = trim((string) ($document['meta']['footerText'] ?? ''));
        $footer = Str::limit($footer, 100, '');
        $showPageNumbers = (bool) $document['meta']['showPageNumbers'];
        $hasCover = in_array('cover', $document['meta']['sections'], true);

        if ($footer !== '' || $showPageNumbers) {
            $canvas->page_script(function (int $pageNumber, int $pageCount, $canvas, $fontMetrics) use ($footer, $showPageNumbers, $hasCover): void {
                if ($pageNumber === 1 && $hasCover) {
                    return;
                }

                $font = $fontMetrics->getFont('DejaVu Sans');
                $width = $canvas->get_width();
                $height = $canvas->get_height();
                $grey = [0.42, 0.45, 0.5];

                if ($footer !== '') {
                    $canvas->text(36, $height - 24, $footer, $font, 8, $grey);
                }

                if ($showPageNumbers) {
                    $label = 'Page '.$pageNumber.' of '.$pageCount;
                    $textWidth = $fontMetrics->getTextWidth($label, $font, 8);
                    $canvas->text($width - 36 - $textWidth, $height - 24, $label, $font, 8, $grey);
                }
            });
        }

        return $pdf->output();
    }

    /**
     * @param  array<string, mixed>  $document
     */
    public function fileName(array $document, string $extension = 'pdf'): string
    {
        $title = Str::slug((string) $document['meta']['title']);
        $period = Str::slug((string) $document['meta']['periodLabel']);

        return trim($title.'-'.$period, '-').'.'.$extension;
    }
}
