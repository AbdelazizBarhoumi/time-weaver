import { formatHM, monthlyBreakdown, type MonthStats, type WorkSession } from "@/lib/tracker";

function MonthRow({ m }: { m: MonthStats }) {
  const over = m.paceDeltaHours >= 0;
  const pct = Math.round(m.progress * 100);
  // Use abbreviated month name on small screens
  const shortLabel = m.label.replace(/(\w{3})\w*/, "$1");
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-xs text-ink truncate max-w-[120px] sm:max-w-none">
          {m.label}
        </div>
        <div className="font-mono text-xs">
          <span className="text-ink">{m.doneHours.toFixed(1)}h</span>
          <span className="text-mut"> / {m.targetHours}h</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${m.isCurrent ? "bg-neon" : over ? "bg-l3" : "bg-l2"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-mut">
        <span>{m.isCurrent ? `${m.daysLeft} day${m.daysLeft === 1 ? "" : "s"} left` : "ended"}</span>
        <span className={m.isCurrent && over ? "text-neon" : "text-mut"}>
          {m.isCurrent
            ? over
              ? `+${m.paceDeltaHours.toFixed(1)}h ahead`
              : `${Math.abs(m.paceDeltaHours).toFixed(1)}h behind pace`
            : `${Math.abs(m.paceDeltaHours).toFixed(1)}h vs target`}
        </span>
      </div>
    </div>
  );
}

export function MonthlyCard({ sessions, now }: { sessions: WorkSession[]; now: number }) {
  const current = monthlyBreakdown(sessions, now, 1)[0]!;
  const months = monthlyBreakdown(sessions, now, 4);
  const deg = Math.round(current.progress * 360);

  const statusLine = (() => {
    if (current.remainingHours <= 0) return "Monthly target cleared — anything extra is a bonus.";
    if (current.daysLeft <= 0) return "Month closed — see the gap below and reset next month.";
    if (current.paceDeltaHours >= 0) return `On pace — keep ~${current.perDayNeeded.toFixed(1)}h/day to stay ahead.`;
    return `Behind pace — you need ${current.perDayNeeded.toFixed(1)}h/day to close the gap.`;
  })();

  return (
    <section className="col-span-12 rounded-xl bg-panel p-7 ring-1 ring-line animate-rise" style={{ animationDelay: "200ms" }}>
      <div className="font-mono text-[11px] tracking-[0.2em] text-mut">MONTHLY · {current.label.toUpperCase()}</div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[auto_1fr_260px] lg:items-center">
        {/* progress ring */}
        <div
          className="grid size-32 shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--neon) 0deg ${deg}deg, var(--line) ${deg}deg 360deg)` }}
        >
          <div className="grid size-24 place-items-center rounded-full bg-panel text-center">
            <div>
              <div className="font-mono text-2xl font-bold tabular-nums text-ink">{Math.round(current.progress * 100)}%</div>
              <div className="font-mono text-[9px] tracking-[0.2em] text-mut">OF MONTH</div>
            </div>
          </div>
        </div>

        {/* key numbers */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-mut">DONE</div>
            <div className="mt-1 text-2xl font-bold text-ink">
              {current.doneHours.toFixed(1)}
              <span className="text-sm text-mut"> h</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-mut">TARGET</div>
            <div className="mt-1 text-2xl font-bold text-ink">
              {current.targetHours}
              <span className="text-sm text-mut"> h</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-mut">REMAINING</div>
            <div className={`mt-1 text-2xl font-bold ${current.remainingHours <= 0 ? "text-neon" : "text-ink"}`}>
              {current.remainingHours.toFixed(1)}
              <span className="text-sm text-mut"> h</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-mut">PER DAY LEFT</div>
            <div className={`mt-1 text-2xl font-bold ${current.paceDeltaHours >= 0 ? "text-neon" : "text-ink"}`}>
              {current.remainingHours <= 0 ? "0.0" : current.perDayNeeded.toFixed(1)}
              <span className="text-sm text-mut"> h</span>
            </div>
          </div>
          <div className="col-span-2 font-mono text-xs leading-relaxed text-mut sm:col-span-4">
            {statusLine}
            {current.remainingHours > 0 && current.daysLeft > 0 && (
              <span className="text-ink">
                {" "}
                That's {formatHM(current.remainingHours * 3_600_000)} still to work across {current.daysLeft} day
                {current.daysLeft === 1 ? "" : "s"}.
              </span>
            )}
          </div>
        </div>

        {/* history */}
        <div className="divide-y divide-line lg:border-l lg:border-line lg:pl-6">
          {months.map((m) => (
            <MonthRow key={m.key} m={m} />
          ))}
        </div>
      </div>
    </section>
  );
}
