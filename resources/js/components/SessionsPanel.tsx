import { formatHM, formatTime, sessionDurationMs, todaySessions, type WorkSession } from "@/lib/tracker";

interface Props {
  sessions: WorkSession[];
  now: number;
  onDelete: (id: string) => void;
}

export function SessionsPanel({ sessions, now, onDelete }: Props) {
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
          return (
            <div
              key={s.id}
              className={`group flex items-center justify-between py-2 ${i < today.length - 1 ? "border-b border-line" : ""}`}
            >
              <div>
                <div className="font-mono text-sm text-ink">
                  {formatTime(s.start)} – {s.end ? formatTime(s.end) : "now"}
                  {running && s.pausedAt && <span className="ml-2 text-[10px] text-mut">(paused)</span>}
                </div>
                <div className="mt-1 font-mono text-[10px] text-mut">{s.note || (running ? "active" : "—")}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="font-mono text-sm text-neon">{formatHM(ms)}</div>
                {!running && (
                  <button
                    onClick={() => onDelete(s.id)}
                    aria-label="Delete session"
                    className="font-mono text-xs text-mut opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
