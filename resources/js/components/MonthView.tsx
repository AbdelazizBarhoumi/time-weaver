import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  dayInterval,
  isWorkDay,
  monthGrid,
  sameDay,
  sessionBands,
  startOfMonth,
  summarizeDay,
  trackedMsOf,
  type CalendarEvent,
  type CalendarSession,
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
  /** Tracked sessions, shown as compact chips under the day's events. */
  sessions?: CalendarSession[];
  onSelectDay: (d: Date) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({ month, now, settings, events, focusBlocks, trackedIntervals, sessions = [], onSelectDay }: Props) {
  const cells = useMemo(() => monthGrid(month), [month]);
  const monthIndex = month.getMonth();
  const today = new Date(now);

  // Study hours tracked this month, reported apart from the work goal.
  const monthStudyMs = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            (s.type ?? "work") === "study" &&
            new Date(s.start).getMonth() === monthIndex &&
            new Date(s.start).getFullYear() === month.getFullYear(),
        )
        .reduce((sum, s) => sum + trackedMsOf(s, now), 0),
    [sessions, month, monthIndex, now],
  );

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

          const bands = sessionBands(sessions, day, now);
          // A session split by pauses shows one chip holding its tracked total for the day.
          const chips = Array.from(
            bands.reduce((map, band) => {
              const found = map.get(band.session.id);
              if (found) found.ms += band.end - band.start;
              else map.set(band.session.id, { session: band.session, ms: band.end - band.start });
              return map;
            }, new Map<number, { session: CalendarSession; ms: number }>()),
            ([, chip]) => chip,
          );
          const eventLimit = chips.length > 0 ? 2 : 3;

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
                {chips.slice(0, 2).map((chip) => {
                  const study = (chip.session.type ?? "work") === "study";
                  return (
                    <span
                      key={`s-${chip.session.id}`}
                      className={cn(
                        "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px]",
                        study ? "bg-amber-300/10 text-amber-300" : "bg-neon/10 text-neon",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          study ? "bg-amber-300" : "bg-neon",
                          chip.session.end === null && "animate-pulse",
                        )}
                      />
                      <span className="font-mono">{formatHM(chip.ms)}</span>
                      <span className="truncate text-ink/80">{chip.session.note || (study ? "Study" : "Tracked")}</span>
                    </span>
                  );
                })}
                {dayEvents.slice(0, eventLimit).map((e) => (
                  <span
                    key={e.id}
                    className={cn("truncate rounded px-1 py-0.5 text-[10px]", e.isWork ? "text-neon" : "text-ink")}
                    style={{ background: e.isWork ? "var(--l2)" : `${e.accountColor}2e`, borderLeft: `2px solid ${e.isWork ? "var(--neon)" : e.accountColor}` }}
                  >
                    {!e.allDay && <span className="mr-1 font-mono text-mut">{formatTime(e.start)}</span>}
                    {e.title}
                  </span>
                ))}
                {dayEvents.length > eventLimit && (
                  <span className="px-1 font-mono text-[10px] text-mut">+{dayEvents.length - eventLimit} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-2 py-1 font-mono text-[10px] text-mut">
        <span>{startOfMonth(month).toLocaleDateString("en", { month: "long", year: "numeric" })}</span>
        {monthStudyMs > 0 && (
          <span className="text-amber-300" title="Study hours this month — never counted as work">
            {formatHM(monthStudyMs)} study
          </span>
        )}
      </div>
    </div>
  );
}
