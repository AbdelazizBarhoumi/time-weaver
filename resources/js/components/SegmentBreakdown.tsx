import { formatHM, formatTime, segmentDurationMs, type WorkSession } from "@/lib/tracker";

interface Props {
  session: WorkSession;
  now: number;
}

export function SegmentBreakdown({ session, now }: Props) {
  const segments = session.segments;

  if (segments.length === 0) {
    return (
      <div className="rounded-lg bg-void/50 p-3 font-mono text-[10px] text-mut">
        No breakdown recorded for this session.
      </div>
    );
  }

  let workedMs = 0;
  let pausedMs = 0;
  for (const seg of segments) {
    if (seg.type === "work") {
      workedMs += segmentDurationMs(seg, now);
    } else {
      pausedMs += segmentDurationMs(seg, now);
    }
  }

  return (
    <div className="rounded-lg bg-void/50 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.15em] text-mut">BREAKDOWN</span>
        {session.segmentsInferred && (
          <span className="font-mono text-[9px] tracking-[0.1em] text-mut">(estimated)</span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {segments.map((seg, index) => (
          <div
            key={`${seg.start}-${index}`}
            className="flex items-center justify-between font-mono text-[11px]"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${seg.type === "work" ? "bg-neon" : "bg-mut"}`}
              />
              <span className={seg.type === "work" ? "text-ink" : "text-mut"}>
                {formatTime(seg.start)} – {seg.end ? formatTime(seg.end) : "now"}
              </span>
            </div>
            <span className={seg.type === "work" ? "text-neon" : "text-mut"}>
              {formatHM(segmentDurationMs(seg, now))}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-mono text-[10px] tracking-[0.1em] text-mut">
        <span>
          WORKED <span className="text-neon">{formatHM(workedMs)}</span>
        </span>
        <span>PAUSED {formatHM(pausedMs)}</span>
      </div>
    </div>
  );
}
