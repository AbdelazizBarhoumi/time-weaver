import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent, FocusBlock, SideTask } from "./calendar";

/**
 * Pointer-driven drag for the calendar grid.
 *
 * The grid is hand-built, so moving a block onto another day — or stretching it
 * by an edge — is plain arithmetic over pointer coordinates. This module keeps
 * that arithmetic in pure helpers (easy to unit test) and wraps the pointer
 * bookkeeping in `useBlockDrag`.
 *
 * Native HTML5 drag-and-drop was not used because it is desktop-only; these
 * handlers are pointer events, so the same code drives a mouse and a finger.
 */

/** What a block on the grid represents. */
export type DragKind = "event" | "focus" | "task";

/** Which part of the block the pointer grabbed. */
export type DragMode = "move" | "resize-start" | "resize-end";

export type DragPayload = CalendarEvent | FocusBlock | SideTask;

export interface DragEntity {
  kind: DragKind;
  /** Render key that matches the block on the grid. */
  key: string;
  allDay: boolean;
  /** Absolute milliseconds at drag start. */
  start: number;
  end: number;
  /** The object the block was drawn from, handed back on commit. */
  payload: DragPayload;
}

export interface DragPreview {
  entity: DragEntity;
  mode: DragMode;
  /** The day under the pointer, or the block's own day after a small move. */
  dayKey: string;
  /** Snapped preview bounds in milliseconds. */
  start: number;
  end: number;
  /** False until the pointer has travelled past the click threshold. */
  moved: boolean;
}

export interface DragControls {
  active: DragPreview | null;
  /** Begin a drag. `grabMinutes` is how far into a moved block the pointer sits. */
  start: (entity: DragEntity, mode: DragMode, grabMinutes: number, client: Pointer) => void;
  /** Feed the day and minute under the pointer while dragging. */
  hover: (dayKey: string, minute: number, client: Pointer) => void;
  /** Finish the drag on the day and minute under the pointer. */
  drop: (dayKey: string, minute: number, client: Pointer) => void;
  cancel: () => void;
  /** True once after a drag that actually moved; lets a click be suppressed. */
  wasDragged: () => boolean;
}

export interface Pointer {
  x: number;
  y: number;
}

export const DRAG_SNAP_MINUTES = 15;
export const DRAG_MIN_DURATION_MINUTES = 15;
/** How far the pointer must travel before a press counts as a drag, not a click. */
export const DRAG_CLICK_THRESHOLD_PX = 4;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
/** How long a completed drag suppresses the trailing click. */
const CLICK_SUPPRESS_MS = 250;

const pad = (value: number): string => String(value).padStart(2, "0");

/** Local `YYYY-MM-DD` for a Date. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local `YYYY-MM-DD` for an absolute millisecond timestamp. */
export function localDayKeyOfMs(ms: number): string {
  return localDayKey(new Date(ms));
}

/** Local midnight for a `YYYY-MM-DD` key, in milliseconds. */
export function dayKeyStartMs(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0).getTime();
}

/** UTC midnight for a date-only key. All-day events are anchored to UTC. */
export function allDayKeyMs(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00Z`);
}

/** Date-only key for a UTC-midnight timestamp. */
export function msToAllDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Round a minute to the nearest `step`. */
export function snapMinute(minute: number, step = DRAG_SNAP_MINUTES): number {
  return Math.round(minute / step) * step;
}

function clampMinute(minute: number): number {
  return Math.max(0, Math.min(24 * 60, minute));
}

/**
 * Bounds after moving a block so its grabbed point lands on `dayKey` at
 * `minute`. All-day events ignore the minute and shift by whole days instead.
 */
export function movedBounds(entity: DragEntity, dayKey: string, minute: number, grabMinutes: number): { start: number; end: number } {
  if (entity.allDay) {
    const deltaDays = Math.round((allDayKeyMs(dayKey) - allDayKeyMs(msToAllDayKey(entity.start))) / MS_PER_DAY);
    return { start: entity.start + deltaDays * MS_PER_DAY, end: entity.end + deltaDays * MS_PER_DAY };
  }

  const duration = entity.end - entity.start;
  const startMinute = clampMinute(snapMinute(minute - grabMinutes));
  const start = dayKeyStartMs(dayKey) + startMinute * MS_PER_MINUTE;
  return { start, end: start + duration };
}

/**
 * Bounds after dragging one edge of a block to `minute` on its own day. The
 * opposite edge stays put and the block cannot shrink past the minimum.
 */
export function resizedBounds(entity: DragEntity, minute: number, mode: DragMode): { start: number; end: number } {
  const dayKey = localDayKeyOfMs(entity.start);
  const dayStart = dayKeyStartMs(dayKey);
  const minimum = DRAG_MIN_DURATION_MINUTES * MS_PER_MINUTE;

  if (mode === "resize-start") {
    const start = dayStart + clampMinute(snapMinute(minute)) * MS_PER_MINUTE;
    return { start: Math.min(start, entity.end - minimum), end: entity.end };
  }

  const end = dayStart + clampMinute(snapMinute(minute)) * MS_PER_MINUTE;
  return { start: entity.start, end: Math.max(end, entity.start + minimum) };
}

/** Bounds for a preview, whichever gesture is in flight. */
export function previewBounds(entity: DragEntity, mode: DragMode, dayKey: string, minute: number, grabMinutes: number) {
  return mode === "move" ? movedBounds(entity, dayKey, minute, grabMinutes) : resizedBounds(entity, minute, mode);
}

/**
 * Track one pointer drag over the grid. The component supplies the day and
 * minute under the pointer (it owns the column geometry) and gets the snapped
 * result back as `active`; `onCommit` fires when the drag ends on a valid spot.
 */
export function useBlockDrag(onCommit: (entity: DragEntity, start: number, end: number) => void): DragControls {
  const [active, setActive] = useState<DragPreview | null>(null);
  const activeRef = useRef<DragPreview | null>(null);
  const grabRef = useRef(0);
  const originRef = useRef<Pointer | null>(null);
  const draggedRef = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const keep = useCallback((next: DragPreview | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const start = useCallback(
    (entity: DragEntity, mode: DragMode, grabMinutes: number, client: Pointer) => {
      grabRef.current = grabMinutes;
      originRef.current = client;
      keep({ entity, mode, dayKey: localDayKeyOfMs(entity.start), start: entity.start, end: entity.end, moved: false });
    },
    [keep],
  );

  const hover = useCallback(
    (dayKey: string, minute: number, client: Pointer) => {
      const current = activeRef.current;
      if (!current) {
        return;
      }

      const origin = originRef.current;
      const moved =
        current.moved ||
        (origin !== null && Math.abs(client.x - origin.x) + Math.abs(client.y - origin.y) >= DRAG_CLICK_THRESHOLD_PX);

      if (!moved) {
        return;
      }

      const bounds = previewBounds(current.entity, current.mode, dayKey, minute, grabRef.current);
      keep({ ...current, dayKey, start: bounds.start, end: bounds.end, moved: true });
    },
    [keep],
  );

  const suppressClick = useCallback(() => {
    draggedRef.current = true;
    if (suppressTimer.current) {
      clearTimeout(suppressTimer.current);
    }
    suppressTimer.current = setTimeout(() => {
      draggedRef.current = false;
    }, CLICK_SUPPRESS_MS);
  }, []);

  const drop = useCallback(
    (dayKey: string, minute: number, client: Pointer) => {
      const current = activeRef.current;
      if (!current) {
        return;
      }

      hover(dayKey, minute, client);
      const settled = activeRef.current;

      if (settled && settled.moved) {
        const bounds = previewBounds(settled.entity, settled.mode, dayKey, minute, grabRef.current);
        suppressClick();
        onCommitRef.current(settled.entity, bounds.start, bounds.end);
      }

      keep(null);
    },
    [hover, keep, suppressClick],
  );

  const cancel = useCallback(() => keep(null), [keep]);

  const wasDragged = useCallback(() => {
    const value = draggedRef.current;
    draggedRef.current = false;
    return value;
  }, []);

  useEffect(() => {
    if (active === null) {
      return;
    }

    const onUp = () => keep(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        keep(null);
      }
    };

    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // Only the active/inactive flip should resubscribe; hover updates `active` often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active !== null, keep]);

  useEffect(
    () => () => {
      if (suppressTimer.current) {
        clearTimeout(suppressTimer.current);
      }
    },
    [],
  );

  return { active, start, hover, drop, cancel, wasDragged };
}
