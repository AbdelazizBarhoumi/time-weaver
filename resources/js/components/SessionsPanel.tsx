import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { formatHM, formatTime, sessionDurationMs, todaySessions, type WorkSession } from "@/lib/tracker";
import { SegmentBreakdown } from "@/components/SegmentBreakdown";

interface Props {
  sessions: WorkSession[];
  now: number;
  onDelete: (id: string) => void;
  onEdit: (session: WorkSession) => void;
}

export function SessionsPanel({ sessions, now, onDelete, onEdit }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const today = todaySessions(sessions, now);

  return (
    <section className="col-span-12 rounded-xl bg-panel p-6 ring-1 ring-line animate-rise lg:col-span-4" style={{ animationDelay: "120ms" }}>
      <div className="font-mono text-[11px] tracking-[0.2em] text-mut">SESSIONS · TODAY</div>
      <div className="mt-4 space-y-1">
        {today.length === 0 && (
          <div className="py-6 text-center font-mono text-xs text-mut">
            No sessions yet.
            <br />
            Hit start when you begin working.
          </div>
        )}
        {today.map((s, i) => {
          const ms = sessionDurationMs(s, now);
          const running = !s.end;
          const expanded = expandedId === s.id;
          return (
            <div
              key={s.id}
              className={i < today.length - 1 ? "border-b border-line" : ""}
            >
              <div className="group flex items-center justify-between py-2">
                <div>
                  <div className="font-mono text-sm text-ink">
                    {formatTime(s.start)} – {s.end ? formatTime(s.end) : "now"}
                    {running && s.pausedAt && <span className="ml-2 text-[10px] text-mut">(paused)</span>}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-mut">
                    {s.source === "calendar" && (
                      <span className="mr-1 rounded bg-neon/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-neon" title="Auto-created from a calendar work event">
                        calendar
                      </span>
                    )}
                    {s.note || (running ? "active" : "—")}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-mono text-sm text-neon">{formatHM(ms)}</div>
                  <button
                    onClick={() => onEdit(s)}
                    aria-label="Edit session"
                    className="font-mono text-xs text-mut opacity-0 transition group-hover:opacity-100 hover:text-neon"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onDelete(s.id)}
                    aria-label="Delete session"
                    className="font-mono text-xs text-mut opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                  >
                    ✕
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : s.id)}
                    aria-label="Toggle segment breakdown"
                    aria-expanded={expanded}
                    className="text-mut transition hover:text-neon"
                  >
                    <ChevronDownIcon
                      className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                </div>
              </div>
              {expanded && (
                <div className="pb-3">
                  <SegmentBreakdown session={s} now={now} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
