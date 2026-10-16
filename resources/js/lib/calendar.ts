import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface CalendarAccount {
  id: number;
  provider: "google";
  email: string;
  color: string;
}

export interface CalendarEvent {
  id: string;
  eventId: string;
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
  workSource: "manual" | "rule" | null;
}

export interface CalendarSettings {
  workStart: string;
  workEnd: string;
  workKeywords: string[];
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

/* ------------------------------------------------------------------ API */

export const calendarApi = {
  accounts: () => api.get<CalendarAccount[]>("/calendar/accounts").then((r) => r.data),
  connectUrl: () => api.post<{ url: string }>("/calendar/accounts/connect").then((r) => r.data.url),
  disconnect: (id: number) => api.delete(`/calendar/accounts/${id}`),
  events: (from: string, to: string) =>
    api
      .get<{ events: CalendarEvent[]; errors: { accountId: number; email: string; message: string }[] }>(
        "/calendar/events",
        { params: { from, to } },
      )
      .then((r) => r.data),
  tag: (accountId: number, eventId: string, isWork: boolean | null) =>
    api.post("/calendar/events/tag", { account_id: accountId, event_id: eventId, is_work: isWork }),
  settings: () => api.get<CalendarSettings>("/calendar/settings").then((r) => r.data),
  saveSettings: (s: CalendarSettings) =>
    api
      .put<CalendarSettings>("/calendar/settings", {
        work_start: s.workStart,
        work_end: s.workEnd,
        work_keywords: s.workKeywords,
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
    refetchInterval: 5 * 60_000,
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

function useCalendarMutation<T>(fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

export const useDisconnectAccount = () => useCalendarMutation((id: number) => calendarApi.disconnect(id));
export const useTagEvent = () =>
  useCalendarMutation((a: { accountId: number; eventId: string; isWork: boolean | null }) =>
    calendarApi.tag(a.accountId, a.eventId, a.isWork),
  );
export const useSaveCalendarSettings = () => useCalendarMutation((s: CalendarSettings) => calendarApi.saveSettings(s));
export const useCreateFocusBlock = () =>
  useCalendarMutation((b: { title?: string; start: string; end: string }) => calendarApi.createFocusBlock(b));
export const useDeleteFocusBlock = () => useCalendarMutation((id: number) => calendarApi.deleteFocusBlock(id));

export async function connectGoogleAccount() {
  const url = await calendarApi.connectUrl();
  window.location.href = url;
}

/* ---------------------------------------------------------------- Logic */

/** "06:30" → 390 */
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

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Work window of a given day as absolute ms. */
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

export function clip(i: Interval, w: Interval): Interval | null {
  const s = Math.max(i.start, w.start);
  const e = Math.min(i.end, w.end);
  return e > s ? { start: s, end: e } : null;
}

/** Sort + merge overlapping intervals. */
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

export interface SuggestedSlot extends Interval {
  /** true = we suggest working here to hit the goal */
  suggested: boolean;
}

export interface DayBudget {
  goalMs: number;
  /** tracked timer sessions */
  trackedMs: number;
  /** work events already passed (not overlapping tracked time is not checked — keep sessions and events separate) */
  workEventsDoneMs: number;
  /** work events + focus blocks still ahead today */
  plannedMs: number;
  /** goal − tracked − work done − planned (≥ 0) */
  remainingMs: number;
  /** free time left in the work window from now on */
  freeLeftMs: number;
  /** true when remaining work cannot fit in the free time left */
  overbooked: boolean;
  /** free slots from now to window end; the first ones filling `remainingMs` are flagged */
  slots: SuggestedSlot[];
}

/**
 * The core day logic:
 *  - Work events count toward the daily goal (past part = done, future part = planned).
 *  - Non-work events are busy time that cannot be worked.
 *  - Remaining hours are laid into the earliest free gaps of the work window.
 */
export function computeDayBudget(args: {
  day: Date;
  now: number;
  goalHours: number;
  trackedMs: number;
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  settings: CalendarSettings;
  /** Minimum gap worth suggesting (default 15 min) */
  minSlotMs?: number;
}): DayBudget {
  const { day, now, goalHours, trackedMs, events, focusBlocks, settings } = args;
  const minSlot = args.minSlotMs ?? 15 * 60_000;
  const goalMs = goalHours * 3600_000;
  const win = workWindow(day, settings);
  const dayIv = { start: startOfDay(day).getTime(), end: addDays(startOfDay(day), 1).getTime() };

  const timed = events.filter((e) => !e.allDay);
  const work = timed.filter((e) => e.isWork).map((e) => clip(eventInterval(e), dayIv)).filter((x): x is Interval => !!x);
  const focus = focusBlocks.map((b) => clip(eventInterval(b), dayIv)).filter((x): x is Interval => !!x);
  const busy = timed.filter((e) => !e.isWork).map(eventInterval);

  const past = { start: dayIv.start, end: Math.min(now, dayIv.end) };
  const future = { start: Math.max(now, dayIv.start), end: dayIv.end };

  const workEventsDoneMs = totalMs(work.map((i) => clip(i, past)).filter((x): x is Interval => !!x));
  const plannedMs = totalMs([...work, ...focus].map((i) => clip(i, future)).filter((x): x is Interval => !!x));
  const remainingMs = Math.max(0, goalMs - trackedMs - workEventsDoneMs - plannedMs);

  const ahead = { start: Math.max(win.start, now), end: win.end };
  const free = ahead.end > ahead.start ? freeIntervals(ahead, [...busy, ...work, ...focus]) : [];
  const usable = free.filter((f) => f.end - f.start >= minSlot);
  const freeLeftMs = usable.reduce((s, f) => s + (f.end - f.start), 0);

  let toPlace = remainingMs;
  const slots: SuggestedSlot[] = [];
  for (const f of usable) {
    if (toPlace <= 0) {
      slots.push({ ...f, suggested: false });
      continue;
    }
    const len = f.end - f.start;
    if (len <= toPlace) {
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
  };
}

/** Assign side-by-side columns to overlapping events (Outlook style). */
export function layoutColumns<T extends { start: string; end: string }>(
  items: T[],
): { item: T; col: number; cols: number }[] {
  const sorted = [...items].sort((a, b) => eventInterval(a).start - eventInterval(b).start);
  const out: { item: T; col: number; cols: number }[] = [];
  let group: { item: T; col: number; cols: number }[] = [];
  let groupEnd = -Infinity;
  const colEnds: number[] = [];

  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    group.forEach((g) => (g.cols = cols));
    out.push(...group);
    group = [];
    colEnds.length = 0;
  };

  for (const item of sorted) {
    const iv = eventInterval(item);
    if (iv.start >= groupEnd && group.length) flush();
    let col = colEnds.findIndex((end) => end <= iv.start);
    if (col === -1) col = colEnds.length;
    colEnds[col] = iv.end;
    group.push({ item, col, cols: 1 });
    groupEnd = Math.max(groupEnd, iv.end);
  }
  if (group.length) flush();
  return out;
}
