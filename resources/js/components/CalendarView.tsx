import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Ban, Briefcase, CalendarClock, CalendarOff, Check, Copy, MoreHorizontal, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentBreakdown } from "@/components/SegmentBreakdown";
import { allDayKeyMs, localDayKey, useBlockDrag, type DragControls, type DragEntity, type DragMode } from "@/lib/blockDrag";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EVENT_COLORS,
  SIDE_TASK_DRAG_TYPE,
  addDays,
  eventAccent,
  eventBackground,
  eventInterval,
  hhmmToMinutes,
  isSideTaskDone,
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
  type SideTask,
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
  /** Personal side tasks; placed ones are drawn as amber blocks on their day. */
  tasks: SideTask[];
  /** The task armed for click-to-place, if any. */
  placingId: number | null;
  /** Tracked work sessions to draw onto the grid, live ones included. */
  sessions: CalendarSession[];
  todaySlots: SuggestedSlot[];
  density: CalendarDensity;
  /** Per-day totals, same length as the number of visible days. */
  summaries?: DaySummary[];
  onToggleWork: (e: CalendarEvent) => void;
  onResetWork: (e: CalendarEvent) => void;
  onDeleteEvent: (e: CalendarEvent, scope: DeleteScope, permanent: boolean) => void;
  /** Copy an event onto another day; the copy stays local to Time Weaver. */
  onDuplicateEvent: (e: CalendarEvent) => void;
  /** Override an event's color; null restores the automatic one. */
  onSetEventColor: (e: CalendarEvent, color: string | null) => void;
  onCreateFocus: (start: Date, end: Date) => void;
  onDeleteFocus: (b: FocusBlock) => void;
  onStartFocus: (b: FocusBlock) => void;
  onLogWork?: (start: Date, end: Date) => void;
  onDeleteSession: (s: CalendarSession) => void;
  /** Drop or click-place a side task at a concrete time. */
  onPlaceTask: (task: SideTask, start: Date) => void;
  /** Move or resize a placed task straight from the grid. */
  onScheduleTask: (task: SideTask, start: Date, end: Date) => void;
  /** Move or resize a focus block from the grid. */
  onMoveFocus: (block: FocusBlock, start: Date, end: Date) => void;
  /** Move a cached Google event (local override, never written back to Google). */
  onMoveEvent: (event: CalendarEvent, start: Date, end: Date) => void;
  /** Tick a task off (or reopen it) straight from the grid. */
  onCompleteTask: (task: SideTask, completed: boolean) => void;
  onDeleteTask: (task: SideTask) => void;
  /** Take a task off the calendar but keep it in the todo list. */
  onUnplaceTask: (task: SideTask) => void;
  /** Arm click-to-place for a task, e.g. from its "Move" control. */
  onMoveTask: (task: SideTask) => void;
  /** Leave click-to-place mode. */
  onCancelPlacing: () => void;
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

/** Hour-gutter label in 12-hour time: 0 → "12 AM", 13 → "1 PM". */
function hourLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

export function CalendarView(props: Props) {
  const { firstDay, dayCount, now, settings, density, events, summaries } = props;
  const winStart = density === "full" ? 0 : hhmmToMinutes(settings.workStart);
  const winEnd = density === "full" ? 1440 : Math.max(hhmmToMinutes(settings.workEnd), hhmmToMinutes(settings.workStart) + 60);
  const totalMin = Math.max(60, winEnd - winStart);
  const heightPx = (totalMin / 60) * HOUR_PX;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, i) => addDays(firstDay, i)), [firstDay, dayCount]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // One drag engine drives every block on the grid; the block that started the
  // drag reports its kind, and we route the committed times back to the page.
  const drag = useBlockDrag((entity, start, end) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (entity.kind === "event") {
      props.onMoveEvent(entity.payload as CalendarEvent, startDate, endDate);
    } else if (entity.kind === "focus") {
      props.onMoveFocus(entity.payload as FocusBlock, startDate, endDate);
    } else {
      props.onScheduleTask(entity.payload as SideTask, startDate, endDate);
    }
  });

  const placingTask = props.placingId === null ? null : props.tasks.find((t) => t.id === props.placingId) ?? null;
  const { onCancelPlacing } = props;

  // Esc leaves placement mode without scheduling anything.
  useEffect(() => {
    if (placingTask === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelPlacing();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingTask, onCancelPlacing]);

  const minuteToPx = (m: number) => ((m - winStart) / 60) * HOUR_PX;
  const msToPx = (day: Date, ms: number) => minuteToPx((ms - startOfDay(day).getTime()) / 60_000);

  const hours: number[] = [];
  for (let m = Math.ceil(winStart / 60) * 60; m <= winEnd; m += 60) hours.push(m);

  const allDay = events.filter((e) => e.allDay);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const workBand = { top: minuteToPx(hhmmToMinutes(settings.workStart)), bottom: minuteToPx(hhmmToMinutes(settings.workEnd)) };

  // Open the day scrolled to the working hours, not the current time.
  const scrolledFor = useRef<string>("");
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const key = `${firstDay.toDateString()}-${dayCount}-${density}-${settings.workStart}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    container.scrollTop = Math.max(0, minuteToPx(hhmmToMinutes(settings.workStart)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, dayCount, density, settings.workStart]);

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
            <DayHeader key={d.toISOString()} day={d} now={now} settings={settings} events={allDay} onDeleteEvent={props.onDeleteEvent} onDuplicateEvent={props.onDuplicateEvent} onSetEventColor={props.onSetEventColor} drag={drag} />
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
                {m < 1440 ? hourLabel(m) : ""}
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
              drag={drag}
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
                {s.isRequiredDay ? (
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
                  <div className="font-mono text-[10px] text-mut">
                    {s.doneMs > 0 ? <span className="text-ink">{formatHM(s.doneMs)}</span> : "off"}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Placement hint: shown while a task is armed for click-to-place */}
      {placingTask && (
        <div className="flex items-center gap-2 border-t border-neon/40 bg-neon/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-neon">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            Click a time to place “{placingTask.title}” ({formatHM(placingTask.estimateMinutes * 60_000)}) · Esc to cancel
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The event's "…" menu: duplicate it, recolor it, or delete it. The delete
 * section separates a normal delete (which a later sync can undo) from a
 * permanent one (which it cannot), and — for a recurring event — offers the
 * same choice for the whole series.
 */
function EventActionsMenu({
  event,
  onDuplicate,
  onSetColor,
  onDelete,
  className,
  iconClassName = "h-3 w-3",
}: {
  event: CalendarEvent;
  onDuplicate: (e: CalendarEvent) => void;
  onSetColor: (e: CalendarEvent, color: string | null) => void;
  onDelete: (e: CalendarEvent, scope: DeleteScope, permanent: boolean) => void;
  className?: string;
  iconClassName?: string;
}) {
  const series = event.recurringEventId !== null;
  // Controlled so picking a color closes the menu like every other action.
  const [open, setOpen] = useState(false);
  // Only a color the user picked is "selected"; Google's own color is not one of ours.
  const current = event.hasCustomColor ? event.color?.toLowerCase() ?? null : null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className}
          title="Event actions"
          // The block around us treats a click/Enter as "toggle work", so nothing that
          // belongs to this control may reach it. `DropdownMenuContent` guards its own
          // events (see `menu-guards.ts`); the trigger needs the same treatment.
          onClick={(ev) => ev.stopPropagation()}
          onPointerDown={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
          onContextMenu={(ev) => ev.stopPropagation()}
        >
          <MoreHorizontal className={iconClassName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        // Selecting an item always opens the confirm dialog, which then owns focus.
        // Without this the menu grabs focus back to its (now hidden) trigger.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem onSelect={() => onDuplicate(event)}>
          <Copy className="h-3 w-3" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuLabel className="pb-1 pt-2 text-[10px] font-mono uppercase tracking-widest text-mut">
          Color
        </DropdownMenuLabel>
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
          <button
            type="button"
            title="Automatic color"
            aria-label="Automatic color"
            onClick={() => {
              onSetColor(event, null);
              setOpen(false);
            }}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full border border-line text-mut hover:text-ink",
              current === null && "ring-2 ring-neon ring-offset-1 ring-offset-popover",
            )}
          >
            <Ban className="h-3 w-3" />
          </button>
          {EVENT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              title={color.name}
              aria-label={color.name}
              onClick={() => {
                onSetColor(event, color.value);
                setOpen(false);
              }}
              className={cn(
                "h-5 w-5 rounded-full ring-1 ring-inset ring-black/30 transition hover:scale-110",
                current === color.value && "ring-2 ring-ink ring-offset-1 ring-offset-popover",
              )}
              style={{ background: color.value }}
            />
          ))}
        </div>
        <DropdownMenuSeparator />
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

/**
 * Thin strips on a block's edges that stretch it instead of moving it. They sit
 * above the block body, so a press here resizes while a press anywhere else
 * drags the whole block to another time or day.
 */
function ResizeHandles({
  entity,
  onResize,
}: {
  entity: DragEntity;
  onResize: (event: ReactPointerEvent, entity: DragEntity, mode: DragMode) => void;
}) {
  return (
    <>
      <span
        role="presentation"
        title="Drag to change the start time"
        onPointerDown={(event) => onResize(event, entity, "resize-start")}
        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize touch-none bg-neon/0 hover:bg-neon/30"
      />
      <span
        role="presentation"
        title="Drag to change the end time"
        onPointerDown={(event) => onResize(event, entity, "resize-end")}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize touch-none bg-neon/0 hover:bg-neon/30"
      />
    </>
  );
}

function DayHeader({
  day,
  now,
  settings,
  events,
  onDeleteEvent,
  onDuplicateEvent,
  onSetEventColor,
  drag,
}: {
  day: Date;
  now: number;
  settings: CalendarSettings;
  events: CalendarEvent[];
  onDeleteEvent: (e: CalendarEvent, scope: DeleteScope, permanent: boolean) => void;
  onDuplicateEvent: (e: CalendarEvent) => void;
  onSetEventColor: (e: CalendarEvent, color: string | null) => void;
  drag: DragControls;
}) {
  const isToday = sameDay(day, new Date(now));
  const working = isWorkDay(day, settings);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const dayAllDay = events.filter((e) => e.start <= key && key < e.end);
  const dropTarget = drag.active?.entity.allDay === true && drag.active.dayKey === key;

  const beginAllDayDrag = (event: ReactPointerEvent, e: CalendarEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    event.stopPropagation();
    drag.start(
      {
        kind: "event",
        key: e.id,
        allDay: true,
        start: allDayKeyMs(e.start.slice(0, 10)),
        end: allDayKeyMs(e.end.slice(0, 10)),
        payload: e,
      },
      "move",
      0,
      { x: event.clientX, y: event.clientY },
    );
  };

  return (
    <div
      data-day-header={key}
      className={cn("border-l border-line px-2 py-2", !working && "bg-void/40", dropTarget && "bg-neon/10 ring-1 ring-inset ring-neon")}
      onPointerMove={(event) => {
        if (drag.active) {
          drag.hover(key, 0, { x: event.clientX, y: event.clientY });
        }
      }}
      onPointerUp={(event) => {
        if (drag.active) {
          drag.drop(key, 0, { x: event.clientX, y: event.clientY });
        }
      }}
    >
      <div className={cn("font-mono text-[11px] uppercase tracking-widest", isToday ? "text-neon" : "text-mut")}>
        {day.toLocaleDateString("en", { weekday: "short" })}{" "}
        <span className={cn("text-base font-semibold", isToday ? "text-neon" : "text-ink")}>{day.getDate()}</span>
        {!working && <span className="ml-1 text-[9px] uppercase text-mut/70">off</span>}
      </div>
      {dayAllDay.slice(0, 3).map((e) => (
        <div
          key={e.id}
          onPointerDown={(event) => beginAllDayDrag(event, e)}
          className={cn(
            "group relative mt-1 flex cursor-grab touch-none items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] text-ink",
            drag.active?.entity.key === e.id && drag.active.entity.allDay && "opacity-40",
          )}
          style={{ background: eventBackground(e, "33"), borderLeft: `3px solid ${eventAccent(e)}` }}
          title={`${e.title} · ${e.accountEmail} · Drag to another day`}
        >
          <span className="truncate">{e.title}</span>
          <EventActionsMenu
            event={e}
            onDuplicate={onDuplicateEvent}
            onSetColor={onSetEventColor}
            onDelete={onDeleteEvent}
            className="ml-auto shrink-0 rounded p-0.5 text-mut/60 hover:text-ink"
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
    drag: DragControls;
  },
) {
  const { day, now, hours, heightPx, minuteToPx, msToPx, winStart, winEnd, density, workBand, settings } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [createDrag, setCreateDrag] = useState<{ a: number; b: number } | null>(null);
  const isToday = sameDay(day, new Date(now));
  const working = isWorkDay(day, settings);
  const dayStart = startOfDay(day).getTime();
  const dayEnd = dayStart + 86_400_000;
  const dayKey = localDayKey(day);

  const items: {
    kind: "event" | "focus" | "task";
    start: string;
    end: string;
    event?: CalendarEvent;
    block?: FocusBlock;
    task?: SideTask;
  }[] = useMemo(() => {
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
    const tk = props.tasks
      .filter((t) => t.start !== null && t.end !== null)
      .filter((t) => {
        const iv = eventInterval({ start: t.start!, end: t.end! });
        return iv.end > dayStart && iv.start < dayEnd;
      })
      .map((t) => ({ kind: "task" as const, start: t.start!, end: t.end!, task: t }));
    return [...ev, ...fb, ...tk];
  }, [props.events, props.focusBlocks, props.tasks, dayStart, dayEnd]);

  const laid = layoutColumns(items);

  const yToMinute = (clientY: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const m = winStart + ((clientY - rect.top) / heightPx) * (winEnd - winStart);
    return Math.max(winStart, Math.min(winEnd, Math.round(m / SNAP_MIN) * SNAP_MIN));
  };

  const placingTask = props.placingId === null ? null : props.tasks.find((t) => t.id === props.placingId) ?? null;

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const m = yToMinute(e.clientY);
    // While a task is armed, a click lands it here instead of starting a focus block.
    setCreateDrag({ a: m, b: m + (placingTask ? placingTask.estimateMinutes : SNAP_MIN * 2) });
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    if (!createDrag) return;
    setCreateDrag({ ...createDrag, b: yToMinute(e.clientY) });
  };
  const onMouseUp = () => {
    if (!createDrag) return;
    const s = Math.min(createDrag.a, createDrag.b);
    const en = Math.max(createDrag.a, createDrag.b);
    setCreateDrag(null);
    if (placingTask) {
      // The task's own estimate sets the length; only the drop time matters.
      props.onPlaceTask(placingTask, new Date(dayStart + s * 60_000));
      return;
    }
    if (en - s < SNAP_MIN) return;
    props.onCreateFocus(new Date(dayStart + s * 60_000), new Date(dayStart + en * 60_000));
  };

  /** Start moving a block, remembering how far into it the pointer grabbed. */
  const beginBlockMove = (event: ReactPointerEvent, entity: DragEntity) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    event.stopPropagation();
    const blockStartMinute = (entity.start - dayStart) / 60_000;
    const durationMinute = (entity.end - entity.start) / 60_000;
    const grabbed = Math.max(0, Math.min(durationMinute, yToMinute(event.clientY) - blockStartMinute));
    props.drag.start(entity, "move", grabbed, { x: event.clientX, y: event.clientY });
  };

  /** Start stretching a block from one of its edges. */
  const beginBlockResize = (event: ReactPointerEvent, entity: DragEntity, mode: DragMode) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    props.drag.start(entity, mode, 0, { x: event.clientX, y: event.clientY });
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (!e.dataTransfer.types.includes(SIDE_TASK_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: ReactDragEvent) => {
    const raw = e.dataTransfer.getData(SIDE_TASK_DRAG_TYPE);
    if (!raw) return;
    const task = props.tasks.find((t) => String(t.id) === raw);
    if (!task) return;
    e.preventDefault();
    props.onPlaceTask(task, new Date(dayStart + yToMinute(e.clientY) * 60_000));
  };

  /** While a timed block is being dragged, follow the pointer over this column. */
  const onColumnPointerMove = (event: ReactPointerEvent) => {
    if (!props.drag.active || props.drag.active.entity.allDay) {
      return;
    }

    props.drag.hover(dayKey, yToMinute(event.clientY), { x: event.clientX, y: event.clientY });
  };
  const onColumnPointerUp = (event: ReactPointerEvent) => {
    if (!props.drag.active || props.drag.active.entity.allDay) {
      return;
    }

    props.drag.drop(dayKey, yToMinute(event.clientY), { x: event.clientX, y: event.clientY });
  };

  const dragPreview = props.drag.active;
  const ghost = dragPreview && !dragPreview.entity.allDay && dragPreview.dayKey === dayKey
    ? (() => {
        const top = Math.max(0, msToPx(day, dragPreview.start));
        const bottom = Math.min(heightPx, msToPx(day, dragPreview.end));
        if (bottom <= 0 || top >= heightPx) return null;
        return { top, height: Math.max(18, bottom - top) };
      })()
    : null;
  const isDragSource = (key: string) => dragPreview?.entity.key === key;

  const nowMin = (now - dayStart) / 60_000;

  return (
    <div
      ref={ref}
      data-day={dayKey}
      className={cn(
        "relative select-none border-l border-line",
        isToday && "bg-neon/[0.02]",
        !working && "bg-void/40",
        ghost && "bg-neon/[0.06]",
      )}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => setCreateDrag(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerMove={onColumnPointerMove}
      onPointerUp={onColumnPointerUp}
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

        if (item.kind === "task" && item.task) {
          const t = item.task;
          const done = isSideTaskDone(t, now);
          const entity: DragEntity = { kind: "task", key: `t-${t.id}`, allDay: false, start: iv.start, end: iv.end, payload: t };
          return (
            <div
              key={entity.key}
              onPointerDown={(event) => beginBlockMove(event, entity)}
              className={cn(
                "group absolute touch-none cursor-grab overflow-hidden rounded border border-amber-400/70 bg-amber-400/15 px-1.5 py-1 text-[11px] text-ink",
                done && "opacity-60",
                isDragSource(entity.key) && "opacity-40",
              )}
              style={style}
              title={`${t.title} · ${formatHM(t.estimateMinutes * 60_000)}${
                t.blocksWork ? " · blocks work" : " · flexible"
              }${t.completedAt ? ` · finished ${formatTime(t.completedAt)}` : ""} · Drag to reschedule`}
            >
              <div className="flex items-center gap-1 font-medium text-amber-300">
                <span className="truncate" style={done ? { textDecoration: "line-through" } : undefined}>
                  {t.title}
                </span>
                {t.blocksWork && <Briefcase className="h-3 w-3 shrink-0 opacity-70" />}
              </div>
              <div className="font-mono text-[10px] text-mut">
                {formatTime(t.start!)}–{formatTime(t.end!)}
                {done && " · done"}
              </div>
              <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                {!done && (
                  <button
                    type="button"
                    className="rounded bg-panel p-0.5 text-mut hover:text-neon"
                    title="Mark done now"
                    onClick={() => props.onCompleteTask(t, true)}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                )}
                {t.completedAt !== null && (
                  <button
                    type="button"
                    className="rounded bg-panel p-0.5 text-mut hover:text-neon"
                    title="Undo — put it back on its slot"
                    onClick={() => props.onCompleteTask(t, false)}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  className="rounded bg-panel p-0.5 text-mut hover:text-ink"
                  title="Take off the calendar but keep the task"
                  onClick={() => props.onUnplaceTask(t)}
                >
                  <CalendarOff className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="rounded bg-panel p-0.5 text-mut hover:text-neon"
                  title="Move this task"
                  onClick={() => props.onMoveTask(t)}
                >
                  <CalendarClock className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="rounded bg-panel p-0.5 text-mut hover:text-destructive"
                  title="Delete task"
                  onClick={() => props.onDeleteTask(t)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <ResizeHandles entity={entity} onResize={beginBlockResize} />
            </div>
          );
        }

        if (item.kind === "focus" && item.block) {
          const b = item.block;
          const entity: DragEntity = { kind: "focus", key: `f-${b.id}`, allDay: false, start: iv.start, end: iv.end, payload: b };
          return (
            <div
              key={entity.key}
              onPointerDown={(event) => beginBlockMove(event, entity)}
              className={cn(
                "group absolute touch-none cursor-grab overflow-hidden rounded border border-neon bg-l1 px-1.5 py-1 text-[11px] text-ink shadow",
                isDragSource(entity.key) && "opacity-40",
              )}
              style={style}
              title={`${b.title} · Drag to reschedule`}
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
              <ResizeHandles entity={entity} onResize={beginBlockResize} />
            </div>
          );
        }

        const e = item.event;
        if (!e) return null;
        const entity: DragEntity = { kind: "event", key: e.id, allDay: false, start: iv.start, end: iv.end, payload: e };
        return (
          <div
            key={entity.key}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => beginBlockMove(event, entity)}
            onClick={() => {
              // A drag ends in a click on some browsers; ignore that one.
              if (props.drag.wasDragged()) return;
              props.onToggleWork(e);
            }}
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
            title={`${e.title}\n${e.accountEmail}${e.calendarName ? ` · ${e.calendarName}` : ""}${
              e.isLocal ? "\nCopied event — saved here only, not in Google" : ""
            }\nDrag to reschedule · Click: ${e.isWork ? "not work" : "mark as work"} · Right-click: back to automatic`}
            className={cn(
              "group absolute cursor-grab touch-none overflow-hidden rounded px-1.5 py-1 text-left text-[11px] text-ink transition hover:brightness-125",
              e.isWork ? "ring-1 ring-neon" : "opacity-90",
              isDragSource(entity.key) && "opacity-40",
            )}
            style={{
              ...style,
              // A color the user picked wins over the neutral work fill; the ring
              // and briefcase still mark the event as work.
              background: e.hasCustomColor || !e.isWork ? eventBackground(e) : "var(--l2)",
              borderLeft: `3px solid ${e.hasCustomColor || !e.isWork ? eventAccent(e) : "var(--neon)"}`,
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
              {e.isLocal && " · copy"}
            </div>
            <EventActionsMenu
              event={e}
              onDuplicate={props.onDuplicateEvent}
              onSetColor={props.onSetEventColor}
              onDelete={props.onDeleteEvent}
              className="absolute right-0.5 top-0.5 rounded bg-panel/80 p-0.5 text-mut/60 hover:text-ink"
            />
            <ResizeHandles entity={entity} onResize={beginBlockResize} />
          </div>
        );
      })}

      {/* Ghost of the block being dragged, snapped to where it would land */}
      {ghost && (
        <div
          className="pointer-events-none absolute inset-x-1 z-10 rounded border border-dashed border-neon bg-neon/20"
          style={{ top: ghost.top, height: ghost.height }}
        />
      )}

      {/* Drag preview for click/drag-to-create */}
      {createDrag && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-1 rounded border",
            placingTask ? "border-amber-400 bg-amber-400/20" : "border-neon bg-neon/20",
          )}
          style={{
            top: minuteToPx(Math.min(createDrag.a, createDrag.b)),
            height: Math.abs(minuteToPx(createDrag.b) - minuteToPx(createDrag.a)),
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
  const studying = (session.type ?? "work") === "study";
  const sessionEnd = session.end ? new Date(session.end).getTime() : now;
  const trackedMs = trackedMsOf(session, now);
  const pausedMs = Math.max(0, sessionEnd - new Date(session.start).getTime() - trackedMs);
  const last = session.segments[session.segments.length - 1];
  const paused = running && last?.type === "pause" && last.end === null;
  const stateLabel = studying
    ? paused
      ? "study paused"
      : running
        ? "studying"
        : "studied"
    : paused
      ? "paused"
      : running
        ? "working"
        : "tracked";
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
          title={`${session.note || (studying ? "Study session" : "Tracked session")} · ${pieceLabel} · ${formatHM(
            trackedMs,
          )} tracked${pausedMs > 0 ? ` · ${formatHM(pausedMs)} paused` : ""}`}
          className={cn(
            "absolute overflow-hidden rounded-sm border-l-2 px-1.5 py-0.5 text-left text-[10px] transition",
            studying
              ? "border-amber-300/70 bg-amber-300/10 text-amber-300 hover:bg-amber-300/20"
              : "border-neon/70 bg-neon/10 text-neon hover:bg-neon/20",
            running && !paused && (studying ? "ring-1 ring-amber-300/40" : "ring-1 ring-neon/40"),
          )}
        >
          <span className="flex items-center gap-1 font-mono uppercase tracking-wider">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                studying ? "bg-amber-300" : "bg-neon",
                running && !paused && "animate-pulse",
              )}
            />
            {stateLabel}
          </span>
          {band.end - band.start >= 45 * 60_000 && (
            <span className="mt-0.5 block truncate text-ink/80">{session.note || formatHM(trackedMs)}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[75vh] w-64 overflow-y-auto border-line bg-panel text-ink">
        <div className="font-mono text-[10px] uppercase tracking-widest text-mut">
          {studying
            ? paused
              ? "Study paused"
              : running
                ? "Study in session"
                : "Study session"
            : paused
              ? "Session paused"
              : running
                ? "In session"
                : "Tracked session"}
        </div>
        <div className="mt-1 text-sm font-medium">{session.note || (studying ? "Studying" : "Untitled session")}</div>
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
              type: session.type ?? "work",
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
