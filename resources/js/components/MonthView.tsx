import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  dayInterval,
  isWorkDay,
  monthGrid,
  sameDay,
  startOfMonth,
  summarizeDay,
  type CalendarEvent,
  type CalendarSettings,
  type FocusBlock,
  type Interval,
} from "@/lib/calendar";
import { DAILY_GOAL_HOURS, formatHM, formatTime } from "@/lib/tracker";

interface Props {
  month: Date;
  now: number;
  settings: CalendarSettings;
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  trackedIntervals: Interval[];
  onSelectDay: (d: Date) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({ month, now, settings, events, focusBlocks, trackedIntervals, onSelectDay }: Props) {
  const cells = useMemo(() => monthGrid(month), [month]);
  const monthIndex = month.getMonth();
  const today = new Date(now);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-mut">
            {d}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {cells.map((day) => {
          const inMonth = day.getMonth() === monthIndex;
          const working = isWorkDay(day, settings);
          const isToday = sameDay(day, today);
          const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
          const dayIv = dayInterval(day);

          const dayEvents = events
            .filter((e) => {
              if (e.allDay) {
                return e.start <= key && key < e.end;
              }
              const start = new Date(e.start).getTime();
              const end = new Date(e.end).getTime();
              return end > dayIv.start && start < dayIv.end;
            })
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime());

          const summary = summarizeDay({
            day,
            events,
            focusBlocks,
            trackedIntervals,
            settings,
            goalHours: DAILY_GOAL_HOURS,
          });

          return (
            <button
              type="button"
              key={key}
              onClick={() => onSelectDay(day)}
              className={cn(
                "flex min-h-[104px] flex-col gap-1 border-b border-l border-line p-1.5 text-left align-top transition hover:bg-neon/[0.04]",
                !inMonth && "opacity-40",
                !working && "bg-void/40",
                isToday && "ring-1 ring-inset ring-neon/50",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("font-mono text-xs", isToday ? "font-bold text-neon" : "text-ink")}>{day.getDate()}</span>
                {working && summary.goalMs > 0 && (
                  <span className={cn("font-mono text-[10px]", summary.remainingMs === 0 ? "text-neon" : "text-mut")}>
                    {formatHM(summary.doneMs)}
                  </span>
                )}
              </div>

              {working && summary.goalMs > 0 && (
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className={cn("h-full rounded-full", summary.remainingMs === 0 ? "bg-neon" : "bg-l3")}
                    style={{ width: `${Math.round(summary.progress * 100)}%` }}
                  />
                </div>
              )}

              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    className={cn("truncate rounded px-1 py-0.5 text-[10px]", e.isWork ? "text-neon" : "text-ink")}
                    style={{ background: e.isWork ? "var(--l2)" : `${e.accountColor}2e`, borderLeft: `2px solid ${e.isWork ? "var(--neon)" : e.accountColor}` }}
                  >
                    {!e.allDay && <span className="mr-1 font-mono text-mut">{formatTime(e.start)}</span>}
                    {e.title}
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="px-1 font-mono text-[10px] text-mut">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-2 py-1 font-mono text-[10px] text-mut">
        {startOfMonth(month).toLocaleDateString("en", { month: "long", year: "numeric" })}
      </div>
    </div>
  );
}
