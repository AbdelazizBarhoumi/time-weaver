import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { dayKey, hoursForDay, DAILY_GOAL_HOURS, type WorkSession } from "@/lib/tracker";

const LEVEL_CLASSES = ["bg-line", "bg-l1", "bg-l2", "bg-l3", "bg-l4", "bg-l5"];
const WEEKS = 52;

// Geometry: cell = size-3 (12px), gap = 3px -> each week column is 15px wide.
const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;

// Rows are Monday-first, so Mon = row 0, Wed = row 2, Fri = row 4.
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

// Minimum number of week-columns between two month labels so they never overlap.
const MIN_LABEL_GAP_WEEKS = 3;

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const todayKey = dayKey(new Date(now));

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date(now);
    const dow = (today.getDay() + 6) % 7; // Mon = 0
    // Monday of the week (WEEKS - 1) weeks before the current week
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - (WEEKS - 1) * 7);

    const weeksArr: Cell[][] = [];
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    const cursor = new Date(start);

    for (let w = 0; w < WEEKS; w++) {
      const week: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(cursor);
        const key = dayKey(date);
        const future = date.getTime() > now;
        week.push({ key, date, hours: future ? 0 : hoursForDay(sessions, key, now), future });
        cursor.setDate(cursor.getDate() + 1);
      }
      const firstOfWeek = week[0]!.date;
      if (firstOfWeek.getMonth() !== lastMonth) {
        labels.push({ label: firstOfWeek.toLocaleString("en", { month: "short" }), weekIndex: w });
        lastMonth = firstOfWeek.getMonth();
      }
      weeksArr.push(week);
    }

    // The first month is often only a column or two wide; drop its label if it would crowd the next one.
    if (labels.length > 1 && labels[1]!.weekIndex - labels[0]!.weekIndex < MIN_LABEL_GAP_WEEKS) {
      labels.shift();
    }

    return { weeks: weeksArr, monthLabels: labels };
  }, [sessions, now]);

  // Start scrolled to the right so the current week is visible.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const showTooltip = (e: MouseEvent<HTMLSpanElement>, cell: Cell) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const c = e.currentTarget.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const half = 60; // keep the tooltip inside the card
    const x = Math.min(Math.max(c.left - w.left + c.width / 2, half), w.width - half);
    setTooltip({
      text: cell.future
        ? cell.date.toLocaleDateString("en", { month: "short", day: "numeric" })
        : `${cell.hours.toFixed(1)}h · ${cell.date.toLocaleDateString("en", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}`,
      x,
      y: c.top - w.top,
    });
  };

  return (
    <section
      className="col-span-12 rounded-xl bg-panel p-7 ring-1 ring-line animate-rise"
      style={{ animationDelay: "180ms" }}
    >
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

      <div ref={wrapRef} className="relative mt-5">
        {/* One scroll container for labels + grid so they always move together */}
        <div ref={scrollRef} className="overflow-x-auto pb-2" onScroll={() => setTooltip(null)}>
          <div className="flex w-max gap-2 pr-4">
            {/* Weekday labels: sticky so they stay visible while scrolling */}
            <div className="sticky left-0 z-10 shrink-0 bg-panel pr-1">
              <div className="h-4" />
              <div className="grid grid-rows-7 font-mono text-[9px] text-mut" style={{ gap: GAP }}>
                {DAY_LABELS.map((label, i) => (
                  <span key={i} className="h-3 leading-3">
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div>
              {/* Month labels, positioned on the exact week column they belong to */}
              <div className="relative h-4">
                {monthLabels.map((m) => (
                  <span
                    key={m.weekIndex}
                    className="absolute top-0 whitespace-nowrap font-mono text-[9px] leading-4 text-mut"
                    style={{ left: m.weekIndex * PITCH }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>

              <div className="flex" style={{ gap: GAP }}>
                {weeks.map((week, w) => (
                  <div key={w} className="grid grid-rows-7" style={{ gap: GAP }}>
                    {week.map((cell, d) => {
                      const level = cell.future ? 0 : levelFor(cell.hours);
                      const isToday = cell.key === todayKey;
                      return (
                        <span
                          key={cell.key}
                          className={`size-3 rounded-[3px] ${
                            cell.future ? "bg-line/40" : LEVEL_CLASSES[level]
                          } animate-rise ${isToday ? "ring-1 ring-neon" : ""}`}
                          style={{ animationDelay: `${Math.min(w * 12 + d * 4, 600)}ms` }}
                          onMouseEnter={(e) => showTooltip(e, cell)}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Outside the scroll container so it isn't clipped */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-void px-2 py-1 font-mono text-[10px] text-ink ring-1 ring-line"
            style={{ left: tooltip.x, top: tooltip.y - 6 }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </section>
  );
}