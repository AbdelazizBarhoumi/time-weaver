import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { EyeIcon, PlusIcon, CalendarOffIcon, EditIcon, Trash2Icon, ChevronRightIcon } from "lucide-react";
import { dayKey, hoursForDay, DAILY_GOAL_HOURS, levelFor, type CustomDayOff, type WorkSession, formatTime, formatHM, sessionDurationMs } from "@/lib/tracker";

const LEVEL_CLASSES = ["bg-line", "bg-l1", "bg-l2", "bg-l3", "bg-l4", "bg-l5"];
const WEEKS = 52;

const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

const MIN_LABEL_GAP_WEEKS = 3;

interface Cell {
  key: string;
  date: Date;
  hours: number;
  future: boolean;
  dayOffType: "excluded" | "included" | null;
}

interface Props {
  sessions: WorkSession[];
  now: number;
  customDayOffs: CustomDayOff[];
  onToggleDayOff: (dateKey: string) => void;
  onSetDayOffType: (dateKey: string, type: "excluded" | "included") => void;
  onAddSession: (dateKey: string) => void;
  onEditSession: (session: WorkSession) => void;
  onDeleteSession: (id: string) => void;
}

export function Heatmap({
  sessions,
  now,
  customDayOffs,
  onToggleDayOff,
  onSetDayOffType,
  onAddSession,
  onEditSession,
  onDeleteSession,
}: Props) {
  const navigate = useNavigate();
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const todayKey = dayKey(new Date(now));

  const dayOffMap = useMemo(() => {
    const map = new Map<string, "excluded" | "included">();
    for (const d of customDayOffs) {
      map.set(d.date, d.type);
    }
    return map;
  }, [customDayOffs]);

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date(now);
    const dow = (today.getDay() + 6) % 7;
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
        const dayOffType = dayOffMap.get(key) ?? null;
        week.push({ key, date, hours: future ? 0 : hoursForDay(sessions, key, now), future, dayOffType });
        cursor.setDate(cursor.getDate() + 1);
      }
      const firstOfWeek = week[0]!.date;
      if (firstOfWeek.getMonth() !== lastMonth) {
        labels.push({ label: firstOfWeek.toLocaleString("en", { month: "short" }), weekIndex: w });
        lastMonth = firstOfWeek.getMonth();
      }
      weeksArr.push(week);
    }

    if (labels.length > 1 && labels[1]!.weekIndex - labels[0]!.weekIndex < MIN_LABEL_GAP_WEEKS) {
      labels.shift();
    }

    return { weeks: weeksArr, monthLabels: labels };
  }, [sessions, now, dayOffMap]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const showTooltip = (e: MouseEvent<HTMLSpanElement>, cell: Cell) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const c = e.currentTarget.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const half = 60;
    const x = Math.min(Math.max(c.left - w.left + c.width / 2, half), w.width - half);
    let text: string;
    const dateLabel = cell.date.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
    if (cell.future) {
      text = cell.date.toLocaleDateString("en", { month: "short", day: "numeric" });
    } else if (cell.dayOffType === "excluded") {
      text = `Day off (hours excluded) · ${dateLabel}`;
    } else if (cell.dayOffType === "included") {
      text = `Day off (hours required) · ${dateLabel}`;
    } else {
      text = `${cell.hours.toFixed(1)}h · ${dateLabel}`;
    }
    setTooltip({ text, x, y: c.top - w.top });
  };

  const isCellInteractive = (cell: Cell) => !cell.future && cell.key !== todayKey;

  const handleCellClick = (cell: Cell) => {
    if (!isCellInteractive(cell)) return;
    if (cell.dayOffType) {
      onToggleDayOff(cell.key);
    } else {
      onSetDayOffType(cell.key, "excluded");
    }
  };

  const getSessionsForDay = (dateKey: string) => {
    return sessions.filter((s) => dayKey(s.start) === dateKey);
  };

  const formatSessionTime = (session: WorkSession) => {
    const ms = sessionDurationMs(session, now);
    const running = !session.end;
    const timeStr = `${formatTime(session.start)} – ${session.end ? formatTime(session.end) : "now"}`;
    const durationStr = formatHM(ms);
    const status = running && !session.pausedAt ? " 🔴 Live" : running ? " ⏸ Paused" : "";
    return { timeStr, durationStr, status };
  };

  return (
    <section
      className="col-span-12 rounded-xl bg-panel p-7 ring-1 ring-line animate-rise relative z-10"
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
        <div ref={scrollRef} className="overflow-x-auto pb-2" onScroll={() => setTooltip(null)}>
          <div className="flex w-max gap-2 pr-4">
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
                      const interactive = isCellInteractive(cell);
                      const daySessions = getSessionsForDay(cell.key);

                      let baseClass = `size-3 rounded-[3px] animate-rise ${isToday ? "ring-1 ring-neon" : ""}`;

                      if (cell.future) {
                        baseClass += " bg-line/40 cursor-default";
                      } else if (cell.dayOffType === "excluded") {
                        baseClass += " bg-line relative cursor-pointer hover:ring-2 hover:ring-neon/50";
                      } else if (cell.dayOffType === "included") {
                        baseClass += " relative cursor-pointer hover:ring-2 hover:ring-neon/50";
                        baseClass += level > 0 ? ` ${LEVEL_CLASSES[level]} opacity-40` : " bg-line";
                      } else {
                        baseClass += ` ${LEVEL_CLASSES[level]} ${interactive ? "cursor-pointer hover:ring-2 hover:ring-neon/50" : "cursor-default"}`;
                      }

                      return (
                        <ContextMenu key={cell.key}>
                          <ContextMenuTrigger asChild>
                            <span
                              className={baseClass}
                              style={{ animationDelay: `${Math.min(w * 12 + d * 4, 600)}ms` }}
                              onMouseEnter={(e) => showTooltip(e, cell)}
                              onMouseLeave={() => setTooltip(null)}
                              onClick={() => handleCellClick(cell)}
                            >
                              {cell.dayOffType === "excluded" && !cell.future && (
                                <span className="absolute inset-0 flex items-center justify-center text-[8px] text-mut/60 select-none">
                                  ⊘
                                </span>
                              )}
                              {cell.dayOffType === "included" && !cell.future && (
                                <span className="absolute inset-0 flex items-center justify-center text-[8px] text-mut/70 select-none">
                                  ⏸
                                </span>
                              )}
                            </span>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="min-w-[200px] max-w-[280px] max-h-[60vh] overflow-auto">
                            <ContextMenuLabel className="px-3 py-1.5 font-mono text-xs tracking-[0.1em] text-mut">
                              {cell.date.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                            </ContextMenuLabel>
                            <ContextMenuSeparator />

                            <ContextMenuItem
                              className="font-medium flex items-center gap-2"
                              onSelect={() => navigate({ to: `/day/${cell.key}` })}
                            >
                              <EyeIcon className="h-4 w-4 text-neon" />
                              View details
                            </ContextMenuItem>

                            {!cell.future && (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  className="flex items-center gap-2"
                                  onSelect={() => onAddSession(cell.key)}
                                >
                                  <PlusIcon className="h-4 w-4" />
                                  Add session
                                </ContextMenuItem>
                              </>
                            )}

                            {daySessions.length > 0 && (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuLabel className="px-3 py-1 font-mono text-[10px] text-mut">
                                  Sessions ({daySessions.length})
                                </ContextMenuLabel>
                                {daySessions.slice(0, 5).map((s) => {
                                  const { timeStr, durationStr, status } = formatSessionTime(s);
                                  const running = !s.end;
                                  return (
                                    <ContextMenuItem
                                      key={s.id}
                                      className="px-3 py-1.5 text-xs flex flex-col gap-0.5"
                                      onSelect={() => !running && onEditSession(s)}
                                      disabled={running}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono truncate flex-1">
                                          {timeStr}
                                          <span className="text-neon ml-1">({durationStr})</span>
                                          {status && <span className="text-[10px] ml-1">{status}</span>}
                                        </span>
                                        {!running && <EditIcon className="h-3.5 w-3.5 text-mut opacity-50" />}
                                      </div>
                                      {s.note && <div className="text-[10px] text-mut truncate ml-6">• {s.note}</div>}
                                    </ContextMenuItem>
                                  );
                                })}
                                {daySessions.length > 5 && (
                                  <ContextMenuItem className="px-3 py-1 text-xs text-mut text-center" disabled>
                                    + {daySessions.length - 5} more…
                                  </ContextMenuItem>
                                )}
                              </>
                            )}

                            <ContextMenuSeparator />
                            <ContextMenuSub>
                              <ContextMenuSubTrigger className="font-mono text-xs flex items-center gap-2">
                                <CalendarOffIcon className="h-4 w-4" />
                                Day off
                                <ChevronRightIcon className="ml-auto h-3.5 w-3.5" />
                              </ContextMenuSubTrigger>
                              <ContextMenuSubContent className="min-w-[180px]">
                                {cell.dayOffType === null ? (
                                  <>
                                    <ContextMenuItem
                                      className="flex items-center gap-2"
                                      onSelect={() => {
                                        onSetDayOffType(cell.key, "excluded");
                                      }}
                                    >
                                      <span className="text-[10px]">⊘</span>
                                      Exclude hours from target
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className="flex items-center gap-2"
                                      onSelect={() => {
                                        onSetDayOffType(cell.key, "included");
                                      }}
                                    >
                                      <span className="text-[10px]">⏸</span>
                                      Include hours in target
                                    </ContextMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <ContextMenuLabel className="px-3 py-1 font-mono text-[10px] text-mut">
                                      {cell.dayOffType === "excluded"
                                        ? "Currently: hours excluded from target"
                                        : "Currently: hours still counted toward target"}
                                    </ContextMenuLabel>
                                    <ContextMenuItem
                                      className="flex items-center gap-2"
                                      onSelect={() => {
                                        onSetDayOffType(
                                          cell.key,
                                          cell.dayOffType === "excluded" ? "included" : "excluded"
                                        );
                                      }}
                                    >
                                      Switch to{" "}
                                      {cell.dayOffType === "excluded"
                                        ? <span>⏸ include hours</span>
                                        : <span>⊘ exclude hours</span>}
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      className="flex items-center gap-2 text-destructive"
                                      onSelect={() => {
                                        onToggleDayOff(cell.key);
                                      }}
                                    >
                                      <Trash2Icon className="h-4 w-4" />
                                      Remove day off
                                    </ContextMenuItem>
                                  </>
                                )}
                              </ContextMenuSubContent>
                            </ContextMenuSub>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

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