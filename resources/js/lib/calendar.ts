import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { DAILY_GOAL_HOURS, type Segment } from "./tracker";

export interface CalendarAccount {
  id: number;
  provider: "google";
  email: string;
  color: string;
  /** Count every timed event from this mailbox as work unless tagged otherwise. */
  defaultWork: boolean;
  /** ISO timestamp of the last successful manual sync for this account. */
  lastSyncedAt?: string | null;
  /** True when the account was disconnected; its cached events are kept. */
  disconnected?: boolean;
  /** Events deleted for good from this mailbox, which a sync will not restore. */
  hiddenCount?: number;
}

export interface SyncAccountResult {
  accountId: number;
  email: string;
  synced: number;
  removed: number;
  lastSyncedAt: string | null;
  failed: boolean;
}

export interface SyncResult {
  synced: number;
  accounts: SyncAccountResult[];
  errors: { accountId: number; email: string; message: string }[];
  syncedAt: string;
}

/** How much of a recurring event to delete from the local cache. */
export type DeleteScope = "this" | "series";

/** What to delete, and whether the deletion should survive later syncs. */
export interface DeleteEventInput {
  cacheId: number;
  scope: DeleteScope;
  /** When true the event is remembered as dismissed and never re-synced. */
  permanent: boolean;
}

export interface CalendarEvent {
  id: string;
  /** Primary key of the cached row, used to delete a single event. */
  cacheId: number;
  eventId: string;
  /** Google series id shared by every occurrence of a recurring event (null for one-offs). */
  recurringEventId: string | null;
  accountId: number;
  accountEmail: string;
  accountColor: string;
  calendarId: string;
  calendarName: string;
  title: string;
  /** ISO datetime, or YYYY-MM-DD for all-day (end exclusive) */
  start: string;
  end: string;
  allDay: boolean;
  isWork: boolean;
  workSource: "manual" | "rule" | "account" | null;
  /** ISO timestamp of the last sync that stored this event. */
  syncedAt?: string | null;
}

/** A tracked work session, rendered onto the calendar grid. */
export interface CalendarSession {
  id: number;
  start: string;
  /** null while the session is still running. */
  end: string | null;
  note: string;
  source: "manual" | "calendar";
  /** Work/pause pieces tiling the session; only work pieces count as tracked time. */
  segments: Segment[];
  /** True when the server synthesized the breakdown for a record made before segments existed. */
  segmentsInferred: boolean;
}

/**
 * One drawn piece of a session: a work segment clipped to one day. A session
 * recorded before the breakdown existed yields a single piece covering it all.
 */
export interface SessionBand {
  session: CalendarSession;
  start: number;
  end: number;
}

export interface CalendarSettings {
  workStart: string;
  workEnd: string;
  workKeywords: string[];
  /** Working days of the week, 0 = Sunday … 6 = Saturday */
  workDays: number[];
}

export interface FocusBlock {
  id: number;
  title: string;
  start: string;
  end: string;
}

export interface Interval {
  start: number;
  end: number;
}

/** Sunday = 0 … Saturday = 6 */
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

export const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ API */

export interface TagEventInput {
  accountId: number;
  eventId: string;
  isWork: boolean | null;
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
}

export const calendarApi = {
  accounts: () => api.get<CalendarAccount[]>("/calendar/accounts").then((r) => r.data),
  connectUrl: () => api.post<{ url: string }>("/calendar/accounts/connect").then((r) => r.data.url),
  disconnect: (id: number) => api.delete(`/calendar/accounts/${id}`),
  purgeAccountEvents: (id: number) => api.delete<{ removed: number }>(`/calendar/accounts/${id}/events`).then((r) => r.data),
  restoreAccountEvents: (id: number) => api.delete<{ restored: number }>(`/calendar/accounts/${id}/dismissals`).then((r) => r.data),
  updateAccount: (id: number, defaultWork: boolean) =>
    api
      .patch<{ id: number; defaultWork: boolean }>(`/calendar/accounts/${id}`, { default_work: defaultWork })
      .then((r) => r.data),
  deleteEvent: (input: DeleteEventInput) =>
    api
      .delete<{ removed: number }>(`/calendar/events/${input.cacheId}`, {
        params: { scope: input.scope, permanent: input.permanent ? 1 : 0 },
      })
      .then((r) => r.data),
  sync: () => api.post<SyncResult>("/calendar/sync").then((r) => r.data),
  events: (from: string, to: string) =>
    api
      .get<{ events: CalendarEvent[]; errors: { accountId: number; email: string; message: string }[] }>(
        "/calendar/events",
        { params: { from, to } },
      )
      .then((r) => r.data),
  tag: (payload: TagEventInput) =>
    api.post("/calendar/events/tag", {
      account_id: payload.accountId,
      event_id: payload.eventId,
      is_work: payload.isWork,
      title: payload.title,
      start: payload.start,
      end: payload.end,
      all_day: payload.allDay,
    }),
  settings: () => api.get<CalendarSettings>("/calendar/settings").then((r) => r.data),
  saveSettings: (s: CalendarSettings) =>
    api
      .put<CalendarSettings>("/calendar/settings", {
        work_start: s.workStart,
        work_end: s.workEnd,
        work_keywords: s.workKeywords,
        work_days: s.workDays,
      })
      .then((r) => r.data),
  focusBlocks: (from: string, to: string) =>
    api.get<FocusBlock[]>("/calendar/focus-blocks", { params: { from, to } }).then((r) => r.data),
  createFocusBlock: (b: { title?: string; start: string; end: string }) =>
    api.post<FocusBlock>("/calendar/focus-blocks", b).then((r) => r.data),
  deleteFocusBlock: (id: number) => api.delete(`/calendar/focus-blocks/${id}`),
};

/* ---------------------------------------------------------------- Hooks */

export function useCalendarAccounts() {
  return useQuery({ queryKey: ["calendar", "accounts"], queryFn: calendarApi.accounts });
}

export function useCalendarEvents(from: Date, to: Date) {
  const f = from.toISOString();
  const t = to.toISOString();
  return useQuery({
    queryKey: ["calendar", "events", f, t],
    queryFn: () => calendarApi.events(f, t),
    // Events come from the local cache; only a manual sync updates them.
  });
}

export function useCalendarSettings() {
  return useQuery({ queryKey: ["calendar", "settings"], queryFn: calendarApi.settings });
}

export function useFocusBlocks(from: Date, to: Date) {
  const f = from.toISOString();
  const t = to.toISOString();
  return useQuery({ queryKey: ["calendar", "focus", f, t], queryFn: () => calendarApi.focusBlocks(f, t) });
}

function useCalendarMutation<TArg, TResult>(fn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      // Tagging work events creates/removes tracked sessions, so refresh those too.
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export const useDisconnectAccount = () => useCalendarMutation((id: number) => calendarApi.disconnect(id));
export const usePurgeAccountEvents = () => useCalendarMutation((id: number) => calendarApi.purgeAccountEvents(id));
export const useRestoreAccountEvents = () => useCalendarMutation((id: number) => calendarApi.restoreAccountEvents(id));
export const useUpdateCalendarAccount = () =>
  useCalendarMutation((args: { id: number; defaultWork: boolean }) => calendarApi.updateAccount(args.id, args.defaultWork));
export const useDeleteCalendarEvent = () =>
  useCalendarMutation((input: DeleteEventInput) => calendarApi.deleteEvent(input));
export const useSyncCalendars = () => useCalendarMutation(() => calendarApi.sync());
export const useTagEvent = () => useCalendarMutation((input: TagEventInput) => calendarApi.tag(input));
export const useSaveCalendarSettings = () => useCalendarMutation((s: CalendarSettings) => calendarApi.saveSettings(s));
export const useCreateFocusBlock = () =>
  useCalendarMutation((b: { title?: string; start: string; end: string }) => calendarApi.createFocusBlock(b));
export const useDeleteFocusBlock = () => useCalendarMutation((id: number) => calendarApi.deleteFocusBlock(id));

export async function connectGoogleAccount() {
  const url = await calendarApi.connectUrl();
  window.location.href = url;
}

/* ---------------------------------------------------------------- Logic */

/** "06:30" → 390, "24:00" → 1440 */
export function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-start week */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "just now", "12m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Whether a date is one of the user's configured working days. */
export function isWorkDay(day: Date, settings: CalendarSettings): boolean {
  const days = settings.workDays?.length ? settings.workDays : DEFAULT_WORK_DAYS;
  return days.includes(day.getDay());
}

/** Monday-start grid of whole weeks covering the month of `d`. */
export function monthGrid(d: Date): Date[] {
  const first = startOfWeek(startOfMonth(d));
  const cells: Date[] = [];
  for (let cursor = first; cells.length < 42; cursor = addDays(cursor, 1)) {
    cells.push(cursor);
    if (cells.length % 7 === 0 && cursor.getMonth() !== d.getMonth() && cursor > new Date(d.getFullYear(), d.getMonth() + 1, 0)) {
      break;
    }
  }
  return cells;
}

export function workWindow(day: Date, settings: CalendarSettings): Interval {
  const base = startOfDay(day).getTime();
  return {
    start: base + hhmmToMinutes(settings.workStart) * 60_000,
    end: base + hhmmToMinutes(settings.workEnd) * 60_000,
  };
}

export function eventInterval(e: { start: string; end: string }): Interval {
  return { start: new Date(e.start).getTime(), end: new Date(e.end).getTime() };
}

export function dayInterval(day: Date): Interval {
  const start = startOfDay(day).getTime();
  return { start, end: start + MS_PER_DAY };
}

/**
 * The work-only intervals of a session. A running session (`end === null`) is
 * treated as ending at `now`, so it grows as the clock ticks.
 *
 * Sessions recorded before the segment breakdown existed fall back to the whole
 * `start − end` span.
 */
export function sessionWorkIntervals(session: CalendarSession, now: number): Interval[] {
  const end = session.end ? new Date(session.end).getTime() : now;
  const toInterval = (seg: Segment): Interval => ({
    start: new Date(seg.start).getTime(),
    end: seg.end ? new Date(seg.end).getTime() : now,
  });

  let pieces = session.segments.filter((seg) => seg.type === "work").map(toInterval);
  if (pieces.length === 0) pieces = [{ start: new Date(session.start).getTime(), end }];

  return pieces.filter((piece) => piece.end > piece.start);
}

/** Tracked hours this session actually contributes (pauses excluded). */
export function trackedMsOf(session: CalendarSession, now: number): number {
  return sessionWorkIntervals(session, now).reduce((sum, piece) => sum + (piece.end - piece.start), 0);
}

/**
 * Tracked session pieces intersected with one day: one band per work segment,
 * so pauses stay visible as gaps instead of counting as work. A session
 * recorded before the breakdown existed yields one band covering it all.
 */
export function sessionBands(sessions: CalendarSession[], day: Date, now: number): SessionBand[] {
  const dayIv = dayInterval(day);
  const out: SessionBand[] = [];

  for (const session of sessions) {
    const sessionEnd = session.end ? new Date(session.end).getTime() : now;
    if (sessionEnd <= dayIv.start || new Date(session.start).getTime() >= dayIv.end) continue;

    for (const piece of sessionWorkIntervals(session, now)) {
      const clipped = clip(piece, dayIv);
      if (clipped) out.push({ session, start: clipped.start, end: clipped.end });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function clip(iv: Interval, window: Interval): Interval | null {
  const start = Math.max(iv.start, window.start);
  const end = Math.min(iv.end, window.end);
  return end > start ? { start, end } : null;
}

export function clipAll(list: Interval[], window: Interval): Interval[] {
  return list.map((i) => clip(i, window)).filter((x): x is Interval => !!x);
}

export function totalMs(list: Interval[]): number {
  return mergeIntervals(list).reduce((sum, i) => sum + (i.end - i.start), 0);
}

/** Window minus busy intervals. */
export function freeIntervals(window: Interval, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy.map((b) => clip(b, window)).filter((x): x is Interval => !!x));
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of merged) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}

/** Portions of `from` that are not covered by `minus`. */
export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const merged = mergeIntervals(minus);
  const out: Interval[] = [];
  for (const iv of from) {
    let parts: Interval[] = [{ ...iv }];
    for (const m of merged) {
      if (m.end <= iv.start) continue;
      if (m.start >= iv.end) break;
      const next: Interval[] = [];
      for (const p of parts) {
        if (m.end <= p.start || m.start >= p.end) {
          next.push(p);
        } else {
          if (m.start > p.start) next.push({ start: p.start, end: m.start });
          if (m.end < p.end) next.push({ start: m.end, end: p.end });
        }
      }
      parts = next;
    }
    out.push(...parts);
  }
  return out;
}

export interface SuggestedSlot {
  start: number;
  end: number;
  suggested: boolean;
}

export interface DayBudget {
  goalMs: number;
  trackedMs: number;
  /** Work-event time already in the past (tracked time removed to avoid double counting). */
  workEventsDoneMs: number;
  /** Future work events + focus blocks (tracked time removed). */
  plannedMs: number;
  remainingMs: number;
  freeLeftMs: number;
  overbooked: boolean;
  slots: SuggestedSlot[];
  isWorkDay: boolean;
}

/**
 * Turn the day's calendar, focus blocks and tracked time into a budget:
 * how much is done, how much is planned, how much is still unplaced, and where
 * the remaining hours fit in the free gaps of the working window.
 */
export function computeDayBudget(args: {
  day: Date;
  now: number;
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  settings: CalendarSettings;
  /** Tracked intervals, so a work event that is also a session is not counted twice. */
  trackedIntervals?: Interval[];
  goalHours?: number;
  minSlotMs?: number;
}): DayBudget {
  const { day, now, settings, events, focusBlocks } = args;
  const goalHours = args.goalHours ?? DAILY_GOAL_HOURS;
  const minSlot = args.minSlotMs ?? 15 * 60_000;
  const working = isWorkDay(day, settings);
  const goalMs = working ? goalHours * 3600_000 : 0;

  const dayIv = dayInterval(day);
  const tracked = mergeIntervals(args.trackedIntervals ?? [])
    .map((iv) => clip(iv, dayIv))
    .filter((x): x is Interval => !!x);
  const trackedMs = totalMs(tracked);

  const timed = events.filter((e) => !e.allDay);
  const work = timed
    .filter((e) => e.isWork)
    .map((e) => clip(eventInterval(e), dayIv))
    .filter((x): x is Interval => !!x);
  const focus = focusBlocks
    .map((b) => clip(eventInterval(b), dayIv))
    .filter((x): x is Interval => !!x);
  const busy = timed.filter((e) => !e.isWork).map(eventInterval);

  const pastBoundary = Math.min(args.now, dayIv.end);
  const futureBoundary = Math.max(args.now, dayIv.start);

  const workPast = work
    .filter((i) => i.start < pastBoundary)
    .map((i) => ({ start: i.start, end: Math.min(i.end, pastBoundary) }));
  const workFuture = work
    .filter((i) => i.end > futureBoundary)
    .map((i) => ({ start: Math.max(i.start, futureBoundary), end: i.end }));
  const focusFuture = focus
    .filter((i) => i.end > futureBoundary)
    .map((i) => ({ start: Math.max(i.start, futureBoundary), end: i.end }));

  const workEventsDoneMs = totalMs(subtractIntervals(workPast, tracked));
  const plannedMs = totalMs(subtractIntervals([...workFuture, ...focusFuture], tracked));
  const remainingMs = Math.max(0, goalMs - trackedMs - workEventsDoneMs - plannedMs);

  const freeAll = freeIntervals(workWindow(day, settings), [...busy, ...work, ...focus, ...tracked]);
  const freeFuture = freeAll
    .map((i) => ({ start: Math.max(i.start, futureBoundary), end: i.end }))
    .filter((i) => i.end > i.start);
  const freeLeftMs = totalMs(freeFuture);

  const slots: SuggestedSlot[] = [];
  let toPlace = remainingMs;
  for (const f of freeFuture) {
    const len = f.end - f.start;
    if (toPlace <= 0) {
      slots.push({ ...f, suggested: false });
    } else if (len <= toPlace) {
      slots.push({ ...f, suggested: true });
      toPlace -= len;
    } else {
      slots.push({ start: f.start, end: f.start + toPlace, suggested: true });
      slots.push({ start: f.start + toPlace, end: f.end, suggested: false });
      toPlace = 0;
    }
  }

  return {
    goalMs,
    trackedMs,
    workEventsDoneMs,
    plannedMs,
    remainingMs,
    freeLeftMs,
    overbooked: remainingMs > freeLeftMs,
    slots,
    isWorkDay: working,
  };
}

export interface DaySummary {
  isWorkDay: boolean;
  goalMs: number;
  /** Tracked sessions + work events (deduplicated) */
  doneMs: number;
  trackedMs: number;
  remainingMs: number;
  progress: number;
}

/** Compact per-day totals used by the week-strip and month view. */
export function summarizeDay(args: {
  day: Date;
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  trackedIntervals: Interval[];
  settings: CalendarSettings;
  goalHours?: number;
}): DaySummary {
  const goalHours = args.goalHours ?? DAILY_GOAL_HOURS;
  const working = isWorkDay(args.day, args.settings);
  const goalMs = working ? goalHours * 3600_000 : 0;
  const dayIv = dayInterval(args.day);

  const tracked = mergeIntervals(args.trackedIntervals)
    .map((iv) => clip(iv, dayIv))
    .filter((x): x is Interval => !!x);
  const trackedMs = totalMs(tracked);

  const work = args.events
    .filter((e) => !e.allDay && e.isWork)
    .map((e) => clip(eventInterval(e), dayIv))
    .filter((x): x is Interval => !!x);
  const focus = args.focusBlocks
    .map((b) => clip(eventInterval(b), dayIv))
    .filter((x): x is Interval => !!x);

  const doneMs = trackedMs + totalMs(subtractIntervals([...work, ...focus], tracked));

  return {
    isWorkDay: working,
    goalMs,
    doneMs,
    trackedMs,
    remainingMs: Math.max(0, goalMs - doneMs),
    progress: goalMs > 0 ? Math.min(1, doneMs / goalMs) : 0,
  };
}

/** Assign side-by-side columns to overlapping events (Outlook style). */
export function layoutColumns<T extends { start: string; end: string }>(
  items: T[],
): { item: T; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const out: { item: T; col: number; cols: number }[] = [];
  let group: { item: T; col: number; cols: number }[] = [];
  let groupEnd = 0;
  const colEnds: number[] = [];

  const flush = () => {
    for (const g of group) g.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds.length = 0;
    groupEnd = 0;
  };

  for (const item of sorted) {
    const start = new Date(item.start).getTime();
    const end = new Date(item.end).getTime() || start + 1;
    if (group.length && start >= groupEnd) flush();
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = end;
    group.push({ item, col, cols: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return out;
}
