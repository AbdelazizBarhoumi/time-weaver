import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReportPreviewProps {
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  html: string | null;
  loading: boolean;
  error: string | null;
  warnings: string[];
  paperLabel: string;
}

export function ReportPreview({ iframeRef, html, loading, error, warnings, paperLabel }: ReportPreviewProps) {
  const [height, setHeight] = useState(1100);
  const fallback = useRef(
    '<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#64748b;display:flex;align-items:center;justify-content:center;height:900px;">Rendering your report…</body></html>',
  );

  useEffect(() => {
    setHeight(1100);
  }, [html]);

  function fitHeight() {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const next = Math.max(600, doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    setHeight(next);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-[#14161a]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-mut">
          <span className={cn("h-2 w-2 rounded-full", loading ? "animate-pulse bg-amber-400" : "bg-neon")} />
          Live preview
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wide text-mut">{paperLabel}</span>
      </div>

      <div className="relative max-h-[calc(100vh-8.5rem)] overflow-auto bg-[radial-gradient(circle_at_top,_#252a31_0%,_#111317_65%)] p-3 sm:p-5">
        <div className="mx-auto w-full max-w-[1100px]">
          <iframe
            ref={iframeRef}
            title="Report preview"
            srcDoc={html ?? fallback.current}
            onLoad={fitHeight}
            className="block w-full border-0 bg-white shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
            style={{ height }}
          />
        </div>

        {loading && html && (
          <div className="pointer-events-none absolute right-5 top-5 flex items-center gap-1.5 rounded-full bg-void/80 px-2.5 py-1 font-mono text-[10px] text-neon shadow-lg ring-1 ring-line">
            <Loader2 className="h-3 w-3 animate-spin" />
            updating
          </div>
        )}

        {error && (
          <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/40 bg-red-950/90 px-4 py-3 text-sm text-red-200 shadow-xl">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">The preview could not be rendered.</p>
                <p className="mt-0.5 text-xs text-red-300/80">{error}</p>
              </div>
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mx-auto mt-3 max-w-[860px] rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
