import { useMemo, useState } from "react";
import { dayKey, hoursForDay, DAILY_GOAL_HOURS, type WorkSession } from "@/lib/tracker";

const LEVEL_CLASSES = ["bg-line", "bg-l1", "bg-l2", "bg-l3", "bg-l4", "bg-l5"];
const WEEKS = 52;

function levelFor(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 6) return 3;
  if (hours < DAILY_GOAL_HOURS) return 4;
  return 5;
}

interface Cell {
  key: string;
  date: Date;
  hours: number;
  future: boolean;
}

export function Heatmap({ sessions, now }: { sessions: WorkSession[]; now: number }) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date(now);
    // end of current week (Saturday)
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - ((end.getDay() + 6) % 7)) % 7 + ((end.getDay() + 6) % 7 === 6 ? 0 : 0));
    // start: Monday of the week WEEKS-1 weeks before current week
    const start = new Date(today);
    const dow = (start.getDay() + 6) % 7; // Mon=0
    start.setDate(start.getDate() - dow - (WEEKS - 1) * 7);

    const weeksArr: Cell[][] = [];
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    const cursor = new Date(start);
    for (let w = 0; w < WEEKS; w++) {
      const week: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(cursor);
        const future = date.getTime() > now;
        week.push({
          key: dayKey(date),
          date,
          hours: future ? 0 : hoursForDay(sessions, dayKey(date), now),
          future,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      const firstOfWeek = week[0]!.date;
      if (firstOfWeek.getMonth() !== lastMonth) {
        labels.push({
          label: firstOfWeek.toLocaleString("en", { month: "short" }),
          weekIndex: w,
        });
        lastMonth = firstOfWeek.getMonth();
      }
      weeksArr.push(week);
    }
    return { weeks: weeksArr, monthLabels: labels };
  }, [sessions, now]);

  return (
    <section className="col-span-12 rounded-xl bg-panel p-7 ring-1 ring-line animate-rise" style={{ animationDelay: "180ms" }}>
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] tracking-[0.2em] text-mut">ACTIVITY · LAST {WEEKS} WEEKS</div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-mut">
          less
          {LEVEL_CLASSES.slice(1).map((c) => (
            <span key={c} className={`size-3 rounded-sm ${c}`} />
          ))}
          more
        </div>
      </div>

      <div className="relative mt-5">
        {/* month labels */}
        <div className="mb-2 flex gap-[3px] pl-8">
          {weeks.map((_, w) => {
            const label = monthLabels.find((l) => l.weekIndex === w);
            return (
              <div key={w} className="w-3 shrink-0 overflow-visible font-mono text-[9px] text-mut">
                {label ? label.label : ""}
              </div>
            );
          })}
        </div>
        <div className="flex gap-[3px] overflow-x-auto pb-1">
          <div className="grid shrink-0 grid-rows-7 gap-[3px] pr-1 font-mono text-[9px] text-mut">
            <span className="h-3" />
            <span className="h-3 leading-3">Mon</span>
            <span className="h-3" />
            <span className="h-3 leading-3">Wed</span>
            <span className="h-3" />
            <span className="h-3 leading-3">Fri</span>
            <span className="h-3" />
          </div>
          {weeks.map((week, w) => (
            <div key={w} className="grid shrink-0 grid-rows-7 gap-[3px]">
              {week.map((cell, d) => {
                const level = cell.future ? 0 : levelFor(cell.hours);
                const isToday = cell.key === dayKey(new Date(now));
                return (
                  <span
                    key={cell.key}
                    className={`size-3 rounded-[3px] ${cell.future ? "bg-line/40" : LEVEL_CLASSES[level]} animate-rise ${
                      isToday ? "ring-1 ring-neon" : ""
                    }`}
                    style={{ animationDelay: `${Math.min(w * 12 + d * 4, 600)}ms` }}
                    onMouseEnter={(e) => {
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      const parent = (e.currentTarget.closest("section") as HTMLElement).getBoundingClientRect();
                      setTooltip({
                        text: cell.future
                          ? cell.date.toLocaleDateString("en", { month: "short", day: "numeric" })
                          : `${cell.hours.toFixed(1)}h · ${cell.date.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}`,
                        x: rect.left - parent.left + rect.width / 2,
                        y: rect.top - parent.top,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-void px-2 py-1 font-mono text-[10px] text-ink ring-1 ring-line"
            style={{ left: tooltip.x, top: tooltip.y - 6 }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </section>
  );
}
