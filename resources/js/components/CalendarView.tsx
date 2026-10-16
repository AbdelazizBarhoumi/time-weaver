import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Briefcase, Play, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentBreakdown } from "@/components/SegmentBreakdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addDays,
  eventInterval,
  hhmmToMinutes,
  isWorkDay,
  layoutColumns,
  sameDay,
  sessionBands,
  startOfDay,
  trackedMsOf,
  type CalendarEvent,
  type CalendarSession,
  type CalendarSettings,
  type DaySummary,
  type DeleteScope,
  type FocusBlock,
  type SessionBand,
  type SuggestedSlot,
} from "@/lib/calendar";
import { formatHM, formatTime } from "@/lib/tracker";

const HOUR_PX = 56;
const SNAP_MIN = 15;

export type CalendarDensity = "work" | "full";

interface Props {
  firstDay: Date;
  dayCount: number;
  now: number;
  settings: CalendarSettings;
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  /** Tracked work sessions to draw onto the grid, live ones included. */
  sessions: CalendarSession[];
  todaySlots: SuggestedSlot[];
  density: CalendarDensity;
  /** Per-day totals, same length as the number of visible days. */
  summaries?: DaySummary[];
  onToggleWork: (e: CalendarEvent) => void;
  onResetWork: (e: CalendarEvent) => void;
  onDeleteEvent: (e: CalendarEvent, scope: DeleteScope, permanent: boolean) => void;
  onCreateFocus: (start: Date, end: Date) => void;
  onDeleteFocus: (b: FocusBlock) => void;
  onStartFocus: (b: FocusBlock) => void;
  onLogWork?: (start: Date, end: Date) => void;
  onDeleteSession: (s: CalendarSession) => void;
}

function timeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function CalendarView(props: Props) {
  const { firstDay, dayCount, now, settings, density, events, summaries } = props;
  const winStart = density === "full" ? 0 : hhmmToMinutes(settings.workStart);
  const winEnd = density === "full" ? 1440 : Math.max(hhmmToMinutes(settings.workEnd), hhmmToMinutes(settings.workStart) + 60);
  const totalMin = Math.max(60, winEnd - winStart);
  const heightPx = (totalMin / 60) * HOUR_PX;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(firstDay, i)), [firstDay, dayCount]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const minuteToPx = (m: number) => ((m - winStart) / 60) * HOUR_PX;
  const msToPx = (day: Date, ms: number) => minuteToPx((ms - startOfDay(day).getTime()) / 60_000);

  const hours: number[] = [];
  for (let m = Math.ceil(winStart / 60) * 60; m <= winEnd; m += 60) hours.push(m);

  const allDay = events.filter((e) => e.allDay);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const workBand = { top: minuteToPx(hhmmToMinutes(settings.workStart)), bottom: minuteToPx(hhmmToMinutes(settings.workEnd)) };

  // Keep the current-time line in view when the calendar opens.
  const scrolledFor = useRef<string>("");
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const key = `${firstDay.toDateString()}-${dayCount}-${density}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const nowMin = (now - startOfDay(new Date(now)).getTime()) / 60_000;
    const target = (minuteToPx(Math.max(winStart, nowMin - 90)) / 60) * 60;
    container.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, dayCount, density]);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-panel lg:min-h-0 lg:flex-1">
      <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
        {/* Sticky day headers */}
        <div
          className="sticky top-0 z-20 grid border-b border-line bg-panel/95 backdrop-blur"
          style={{ gridTemplateColumns: `56px repeat(${dayCount}, 1fr)` }}
        >
          <div className="flex items-end justify-end px-2 py-2 font-mono text-[9px] uppercase tracking-wider text-mut" title={tz}>
            {tz.split("/").pop()}
          </div>
          {Array.from({ length: dayCount }, (_, i) => addDays(firstDay, i)).map((d) => (
            <DayHeader key={d.toISOString()} day={d} now={now} settings={settings} events={allDay} onDeleteEvent={props.onDeleteEvent} />
          ))}
        </div>

        {/* Time grid */}
        <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${dayCount}, 1fr)`, height: heightPx }}>
          <div className="relative">
            {hours.map((m) => (
              <div
                key={m}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-mut"
                style={{ top: minuteToPx(m) }}
              >
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {Array.from({ length: dayCount }, (_, i) => addDays(firstDay, i)).map((day) => (
            <DayColumn
              {...props}
              key={day.toISOString()}
              day={day}
              hours={hours}
              heightPx={heightPx}
              minuteToPx={minuteToPx}
              msToPx={msToPx}
              winStart={winStart}
              winEnd={winEnd}
              workBand={workBand}
            />
          ))}
        </div>

        {/* Work-time totals strip */}
        {summaries && summaries.length > 0 && (
          <div
            className="sticky bottom-0 grid border-t border-line bg-panel/95 backdrop-blur"
            style={{ gridTemplateColumns: `56px repeat(${dayCount}, 1fr)` }}
          >
            <div className="flex items-center justify-end px-2 py-2 font-mono text-[9px] uppercase tracking-wider text-mut">
              done
            </div>
            {summaries.map((s, i) => (
              <div key={i} className="border-l border-line px-2 py-2">
                {s.isWorkDay ? (
                  <>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={cn("h-full rounded-full", s.remainingMs === 0 ? "bg-neon" : "bg-l4")}
                        style={{ width: `${Math.round(s.progress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-mut">
                      <span className="text-ink">{formatHM(s.doneMs)}</span> / {formatHM(s.goalMs)}
                    </div>
                  </>
                ) : (
                  <div className="font-mono text-[10px] text-mut">off</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Trash control for a cached event. The menu separates a normal delete (which a
 * later sync can undo) from a permanent one (which it cannot), and — for a
 * recurring event — offers the same choice for the whole series.
 */
function DeleteEventButton({
  event,
  onDelete,
  className,
  iconClassName = "h-3 w-3",
}: {
  event: CalendarEvent;
  onDelete: (e: CalendarEvent, scope: DeleteScope, permanent: boolean) => void;
  className?: string;
  iconClassName?: string;
}) {
  const series = event.recurringEventId !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className}
          title={series ? "Delete this event or the whole series" : "Delete this event"}
          onClick={(ev) => ev.stopPropagation()}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <Trash2 className={iconClassName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => onDelete(event, "this", false)}>Delete this event</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDelete(event, "this", true)}>Delete this event permanently</DropdownMenuItem>
        {series && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(event, "series", false)}>Delete all in series</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(event, "series", true)}>Delete all in series permanently</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DayHeader({
  day,
  now,
  settings,
  events,
  onDeleteEvent,
}: {
  day: Date;
  now: number;
  settings: CalendarSettings;
  events: CalendarEvent[];
  onDeleteEvent: (e: CalendarEvent, scope: DeleteScope, permanent: boolean) => void;
}) {
  const isToday = sameDay(day, new Date(now));
  const working = isWorkDay(day, settings);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const dayAllDay = events.filter((e) => e.start <= key && key < e.end);

  return (
    <div className={cn("border-l border-line px-2 py-2", !working && "bg-void/40")}>
      <div className={cn("font-mono text-[11px] uppercase tracking-widest", isToday ? "text-neon" : "text-mut")}>
        {day.toLocaleDateString("en", { weekday: "short" })}{" "}
        <span className={cn("text-base font-semibold", isToday ? "text-neon" : "text-ink")}>{day.getDate()}</span>
        {!working && <span className="ml-1 text-[9px] uppercase text-mut/70">off</span>}
      </div>
      {dayAllDay.slice(0, 3).map((e) => (
        <div
          key={e.id}
          className="group relative mt-1 flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] text-ink"
          style={{ background: `${e.accountColor}33`, borderLeft: `3px solid ${e.accountColor}` }}
          title={`${e.title} · ${e.accountEmail}`}
        >
          <span className="truncate">{e.title}</span>
          <DeleteEventButton
            event={e}
            onDelete={onDeleteEvent}
            className="ml-auto shrink-0 rounded p-0.5 text-mut/60 hover:text-destructive"
          />
        </div>
      ))}
      {dayAllDay.length > 3 && <div className="mt-1 font-mono text-[10px] text-mut">+{dayAllDay.length - 3} more</div>}
    </div>
  );
}

function DayColumn(
  props: Props & {
    day: Date;
    hours: number[];
    heightPx: number;
    minuteToPx: (m: number) => number;
    msToPx: (day: Date, ms: number) => number;
    winStart: number;
    winEnd: number;
    density: CalendarDensity;
    workBand: { top: number; bottom: number };
  },
) {
  const { day, now, hours, heightPx, minuteToPx, msToPx, winStart, winEnd, density, workBand, settings } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const isToday = sameDay(day, new Date(now));
  const working = isWorkDay(day, settings);
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 86_400_000;

  const items: { kind: "event" | "focus"; start: string; end: string; event?: CalendarEvent; block?: FocusBlock }[] =
    useMemo(() => {
      const ev = props.events
        .filter((e) => !e.allDay)
        .filter((e) => {
          const iv = eventInterval(e);
          return iv.end > dayStart && iv.start < dayEnd;
        })
        .map((e) => ({ kind: "event" as const, start: e.start, end: e.end, event: e }));
      const fb = props.focusBlocks
        .filter((b) => {
          const iv = eventInterval(b);
          return iv.end > dayStart && iv.start < dayEnd;
        })
        .map((b) => ({ kind: "focus" as const, start: b.start, end: b.end, block: b }));
      return [...ev, ...fb];
    }, [props.events, props.focusBlocks, dayStart, dayEnd]);

  const laid = layoutColumns(items);

  const yToMinute = (clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const m = winStart + ((clientY - rect.top) / heightPx) * (winEnd - winStart);
    return Math.max(winStart, Math.min(winEnd, Math.round(m / SNAP_MIN) * SNAP_MIN));
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const m = yToMinute(e.clientY);
    setDrag({ a: m, b: m + SNAP_MIN * 2 });
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    if (!drag) return;
    setDrag({ ...drag, b: yToMinute(e.clientY) });
  };
  const onMouseUp = () => {
    if (!drag) return;
    const s = Math.min(drag.a, drag.b);
    const en = Math.max(drag.a, drag.b);
    setDrag(null);
    if (en - s < SNAP_MIN) return;
    props.onCreateFocus(new Date(dayStart + s * 60_000), new Date(dayStart + en * 60_000));
  };

  const nowMin = (now - dayStart) / 60_000;

  return (
    <div
      ref={ref}
      className={cn("relative select-none border-l border-line", isToday && "bg-neon/[0.02]", !working && "bg-void/40")}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => setDrag(null)}
    >
      {hours.map((m) => (
        <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: minuteToPx(m) }} />
      ))}

      {/* Working-hours band when showing the full day */}
      {props.density === "full" && (
        <div
          className="pointer-events-none absolute inset-x-0 bg-neon/[0.04]"
          style={{ top: workBand.top, height: Math.max(0, workBand.bottom - workBand.top) }}
        />
      )}

      {/* Past shading */}
      {isToday && nowMin > winStart && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 bg-void/50"
          style={{ height: Math.min(heightPx, minuteToPx(nowMin)) }}
        />
      )}

      {/* Tracked sessions — drawn behind events so nothing is hidden */}
      {sessionBands(props.sessions, day, now).map((band, index) => {
        const top = Math.max(0, msToPx(day, band.start));
        const bottom = Math.min(heightPx, msToPx(day, band.end));
        if (bottom <= 0 || top >= heightPx) return null;
        return (
          <SessionBlock
            key={`s-${band.session.id}-${index}`}
            band={band}
            style={{
              top,
              height: Math.max(10, bottom - top),
              left: "2px",
              width: "calc(100% - 4px)",
            }}
            onDelete={() => props.onDeleteSession(band.session)}
          />
        );
      })}

      {/* Free-slot suggestions (today) */}
      {isToday &&
        props.todaySlots.map((s) => {
          const slotStyle = {
            top: msToPx(day, s.start),
            height: Math.max(2, msToPx(day, s.end) - msToPx(day, s.start)),
          };
          if (s.suggested && props.onLogWork) {
            return (
              <button
                key={`${s.start}-${s.suggested}`}
                type="button"
                title={`Log ${formatHM(s.end - s.start)} of work here`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => props.onLogWork!(new Date(s.start), new Date(s.end))}
                className="group absolute inset-x-1 rounded-sm border border-dashed border-neon/60 bg-neon/10 text-left transition hover:bg-neon/20"
                style={slotStyle}
              >
                {s.end - s.start >= 30 * 60_000 && (
                  <span className="absolute left-1.5 top-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-neon/80">
                    <Plus className="h-3 w-3" /> {formatHM(s.end - s.start)}
                  </span>
                )}
              </button>
            );
          }
          return (
            <div
              key={`${s.start}-${s.suggested}`}
              className={cn(
                "pointer-events-none absolute inset-x-1 rounded-sm border border-dashed",
                s.suggested ? "border-neon/60 bg-neon/10" : "border-line bg-transparent",
              )}
              style={slotStyle}
            >
              {s.suggested && s.end - s.start >= 30 * 60_000 && (
                <span className="absolute left-1.5 top-1 font-mono text-[10px] uppercase tracking-wider text-neon/80">
                  work here · {formatHM(s.end - s.start)}
                </span>
              )}
            </div>
          );
        })}

      {/* Events and focus blocks (overlaps laid out side by side) */}
      {laid.map(({ item, col, cols }) => {
        const iv = eventInterval(item);
        const top = Math.max(0, msToPx(day, Math.max(iv.start, dayStart)));
        const bottom = Math.min(heightPx, msToPx(day, Math.min(iv.end, dayEnd)));
        if (bottom <= 0 || top >= heightPx) return null;
        const style = {
          top,
          height: Math.max(18, bottom - top),
          left: `calc(${(col / cols) * 100}% + 2px)`,
          width: `calc(${100 / cols}% - 4px)`,
        };

        if (item.kind === "focus" && item.block) {
          const b = item.block;
          return (
            <div
              key={`f-${b.id}`}
              className="group absolute overflow-hidden rounded border border-neon bg-l1 px-1.5 py-1 text-[11px] text-ink shadow"
              style={style}
            >
              <div className="flex items-center gap-1 font-medium text-neon">
                <Briefcase className="h-3 w-3" /> <span className="truncate">{b.title}</span>
              </div>
              <div className="font-mono text-[10px] text-mut">
                {formatTime(b.start)}–{formatTime(b.end)}
              </div>
              <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                <button
                  className="rounded bg-neon p-0.5 text-void"
                  title="Start timer for this block"
                  onClick={() => props.onStartFocus(b)}
                >
                  <Play className="h-3 w-3" />
                </button>
                <button
                  className="rounded bg-panel p-0.5 text-mut hover:text-destructive"
                  title="Delete block"
                  onClick={() => props.onDeleteFocus(b)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        }

        const e = item.event;
        if (!e) return null;
        return (
          <div
            key={e.id}
            role="button"
            tabIndex={0}
            onClick={() => props.onToggleWork(e)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                props.onToggleWork(e);
              }
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              props.onResetWork(e);
            }}
            title={`${e.title}\n${e.accountEmail}${e.calendarName ? ` · ${e.calendarName}` : ""}\nClick: ${
              e.isWork ? "not work" : "mark as work"
            } · Right-click: back to automatic`}
            className={cn(
              "group absolute cursor-pointer overflow-hidden rounded px-1.5 py-1 text-left text-[11px] text-ink transition hover:brightness-125",
              e.isWork ? "ring-1 ring-neon" : "opacity-90",
            )}
            style={{
              ...style,
              background: e.isWork ? "var(--l2)" : `${e.accountColor}2e`,
              borderLeft: `3px solid ${e.isWork ? "var(--neon)" : e.accountColor}`,
            }}
          >
            <div className="flex items-center gap-1 font-medium">
              {e.isWork && <Briefcase className="h-3 w-3 shrink-0 text-neon" />}
              <span className="truncate">{e.title}</span>
            </div>
            <div className="font-mono text-[10px] text-mut">
              {formatTime(e.start)}–{formatTime(e.end)}
              {e.workSource === "rule" && " · auto"}
              {e.workSource === "account" && " · mailbox"}
            </div>
            <DeleteEventButton
              event={e}
              onDelete={props.onDeleteEvent}
              className="absolute right-0.5 top-0.5 rounded bg-panel/80 p-0.5 text-mut/60 hover:text-destructive"
            />
          </div>
        );
      })}

      {/* Drag preview */}
      {drag && (
        <div
          className="pointer-events-none absolute inset-x-1 rounded border border-neon bg-neon/20"
          style={{
            top: minuteToPx(Math.min(drag.a, drag.b)),
            height: Math.abs(minuteToPx(drag.b) - minuteToPx(drag.a)),
          }}
        />
      )}

      {/* Current-time line with clock label */}
      {isToday && nowMin >= winStart && nowMin <= winEnd && (
        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: minuteToPx(nowMin) }}>
          <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
          <div className="h-px bg-destructive" />
          {props.dayCount === 1 && (
            <span className="absolute -top-2.5 left-2 rounded bg-destructive px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow">
              {formatTime(new Date(now).toISOString())}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A tracked session drawn behind the day's events. A session with pauses is
 * drawn as several pieces — one per work segment — and every piece opens the
 * same popover: note, times, tracked time, a pause breakdown and a delete action.
 */
function SessionBlock({
  band,
  style,
  onDelete,
}: {
  band: SessionBand;
  style: CSSProperties;
  onDelete: () => void;
}) {
  const now = Date.now();
  const session = band.session;
  const running = session.end === null;
  const sessionEnd = session.end ? new Date(session.end).getTime() : now;
  const trackedMs = trackedMsOf(session, now);
  const pausedMs = Math.max(0, sessionEnd - new Date(session.start).getTime() - trackedMs);
  const last = session.segments[session.segments.length - 1];
  const paused = running && last?.type === "pause" && last.end === null;
  const stateLabel = paused ? "paused" : running ? "working" : "tracked";
  const sessionLabel = `${formatTime(session.start)}–${session.end ? formatTime(session.end) : "now"}`;
  const pieceLabel = `${formatTime(new Date(band.start).toISOString())}–${formatTime(
    new Date(band.end).toISOString(),
  )}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          style={style}
          title={`${session.note || "Tracked session"} · ${pieceLabel} · ${formatHM(trackedMs)} tracked${
            pausedMs > 0 ? ` · ${formatHM(pausedMs)} paused` : ""
          }`}
          className={cn(
            "absolute overflow-hidden rounded-sm border-l-2 border-neon/70 bg-neon/10 px-1.5 py-0.5 text-left text-[10px] text-neon transition hover:bg-neon/20",
            running && !paused && "ring-1 ring-neon/40",
          )}
        >
          <span className="flex items-center gap-1 font-mono uppercase tracking-wider">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full bg-neon", running && !paused && "animate-pulse")} />
            {stateLabel}
          </span>
          {band.end - band.start >= 45 * 60_000 && (
            <span className="mt-0.5 block truncate text-ink/80">{session.note || formatHM(trackedMs)}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[75vh] w-64 overflow-y-auto border-line bg-panel text-ink">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mut">
          {paused ? "Session paused" : running ? "In session" : "Tracked session"}
        </div>
        <div className="mt-1 text-sm font-medium">{session.note || "Untitled session"}</div>
        <div className="mt-1 font-mono text-[11px] text-mut">
          {sessionLabel} · {formatHM(trackedMs)} tracked
          {pausedMs > 0 && ` · ${formatHM(pausedMs)} paused`}
          {session.source === "calendar" && " · from calendar"}
        </div>
        <div className="mt-2">
          <SegmentBreakdown
            session={{
              id: String(session.id),
              start: session.start,
              end: session.end,
              note: session.note,
              source: session.source,
              pausedMs,
              pausedAt: null,
              segments: session.segments,
              segmentsInferred: session.segmentsInferred,
            }}
            now={now}
          />
        </div>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onDelete}>
          <Trash2 className="mr-1 h-4 w-4" /> Delete session
        </Button>
      </PopoverContent>
    </Popover>
  );
}
