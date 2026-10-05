import {
  DAILY_GOAL_HOURS,
  formatHMS,
  hoursForDay,
  dayKey,
  sessionDurationMs,
  type WorkSession,
} from "@/lib/tracker";

interface Props {
  sessions: WorkSession[];
  now: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onAddManual: () => void;
}

export function TimerCard({ sessions, now, onStart, onPause, onResume, onStop, onAddManual }: Props) {
  const active = sessions.find((s) => !s.end);
  const isRunning = !!active && !active.pausedAt;
  const isPaused = !!active && !!active.pausedAt;

  const todayKey = dayKey(new Date(now));
  const todayHours = hoursForDay(sessions, todayKey, now);
  const progress = Math.min(1, todayHours / DAILY_GOAL_HOURS);
  const remaining = Math.max(0, DAILY_GOAL_HOURS - todayHours);

  const sessionMs = active ? sessionDurationMs(active, now) : 0;
  const deg = Math.round(progress * 360);

  const today = new Date(now);
  const dateLabel = today
    .toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" })
    .toUpperCase();

  return (
    <section className="col-span-12 rounded-xl bg-panel p-7 ring-1 ring-line animate-rise lg:col-span-8" style={{ animationDelay: "60ms" }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-mut">TODAY · {dateLabel}</div>
          <div className="mt-1 text-2xl font-semibold text-ink">
            {progress >= 1 ? "Goal reached — nice work" : isRunning ? "Session in progress" : isPaused ? "Paused" : "Ready when you are"}
          </div>
        </div>
        {active && (
          <div className="flex items-center gap-2 font-mono text-xs text-neon">
            <span className={`size-2 rounded-full bg-neon ${isRunning ? "animate-rec" : ""}`} />
            {isRunning ? "SESSION ACTIVE" : "PAUSED"}
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col items-start gap-10 sm:flex-row sm:items-end">
        <div
          className={`grid size-40 shrink-0 place-items-center rounded-full ${isRunning ? "animate-ring-glow" : ""}`}
          style={{ background: `conic-gradient(var(--neon) 0deg ${deg}deg, var(--line) ${deg}deg 360deg)` }}
        >
          <div className="grid size-32 place-items-center rounded-full bg-panel">
            <div className="text-center">
              <div className="font-mono text-3xl font-bold tabular-nums text-ink">{formatHMS(sessionMs)}</div>
              <div className="mt-1 font-mono text-[10px] tracking-[0.2em] text-mut">
                {active ? "CURRENT SESSION" : "NO SESSION"}
              </div>
            </div>
          </div>
        </div>

        <div className="w-full flex-1">
          <div className="mb-2 font-mono text-xs text-mut">DAILY GOAL · {DAILY_GOAL_HOURS}H</div>
          <div className="h-3 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-neon transition-[width] duration-700"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between font-mono text-xs">
            <span className="text-mut">{todayHours.toFixed(2)}h</span>
            <span className="text-neon">
              {Math.round(progress * 100)}%
              {progress >= 1 ? " · goal hit ✓" : ` · ${remaining.toFixed(1)}h to goal`}
            </span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {!active && (
              <button
                onClick={onStart}
                className="rounded-lg bg-neon px-5 py-2 text-sm font-semibold text-void ring-1 ring-neon/40 transition hover:brightness-110"
              >
                Start session
              </button>
            )}
            {isRunning && (
              <button
                onClick={onPause}
                className="rounded-lg bg-neon px-5 py-2 text-sm font-semibold text-void ring-1 ring-neon/40 transition hover:brightness-110"
              >
                Pause
              </button>
            )}
            {isPaused && (
              <button
                onClick={onResume}
                className="rounded-lg bg-neon px-5 py-2 text-sm font-semibold text-void ring-1 ring-neon/40 transition hover:brightness-110"
              >
                Resume
              </button>
            )}
            {active && (
              <button
                onClick={onStop}
                className="rounded-lg bg-panel px-5 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:ring-neon/40"
              >
                Stop
              </button>
            )}
            <button
              onClick={onAddManual}
              className="rounded-lg bg-panel px-5 py-2 text-sm font-medium text-mut ring-1 ring-line transition hover:ring-neon/40"
            >
              Add manual
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
