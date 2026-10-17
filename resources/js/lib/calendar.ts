import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { DAILY_GOAL_HOURS, formatHM, type Segment } from "./tracker";

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
  /** Days the user *can* work, 0 = Sunday … 6 = Saturday. A day here is not a day off. */
  workDays: number[];
  /** Days the user *must* work. These drive the 8h/day goal and the monthly target. */
  requiredDays: number[];
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

/** Default compulsory week; used when a legacy payload omits `requiredDays`. */
export const DEFAULT_REQUIRED_DAYS = DEFAULT_WORK_DAYS;

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

/** Response from the AI coach endpoint. */
export interface CoachResponse {
  available: boolean;
  text?: string;
  generatedAt?: string;
  message?: string;
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
        required_days: s.requiredDays,
      })
      .then((r) => r.data),
  focusBlocks: (from: string, to: string) =>
    api.get<FocusBlock[]>("/calendar/focus-blocks", { params: { from, to } }).then((r) => r.data),
  createFocusBlock: (b: { title?: string; start: string; end: string }) =>
    api.post<FocusBlock>("/calendar/focus-blocks", b).then((r) => r.data),
  deleteFocusBlock: (id: number) => api.delete(`/calendar/focus-blocks/${id}`),
  coachStatus: () => api.get<{ available: boolean }>("/calendar/coach/status").then((r) => r.data),
  coach: (facts: DayFacts) => api.post<CoachResponse>("/calendar/coach", { facts }).then((r) => r.data),
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

/** Whether the AI coach is configured on the server. */
export function useCoachStatus() {
  return useQuery({
    queryKey: ["calendar", "coach-status"],
    queryFn: calendarApi.coachStatus,
    staleTime: 60 * 60_000,
  });
}

/** On-demand AI coaching: only runs when the user clicks the button. */
export function useDayCoach() {
  return useMutation({ mutationFn: (facts: DayFacts) => calendarApi.coach(facts) });
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

/**
 * Whether a date is a day the user is *obliged* to work. Only these days build up
 * the daily goal; a day the user can work but isn't required on never demands hours.
 */
export function isRequiredDay(day: Date, settings: CalendarSettings): boolean {
  const days = settings.requiredDays?.length ? settings.requiredDays : DEFAULT_REQUIRED_DAYS;
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
  /** The user can work this day (it is not a day off). */
  isWorkDay: boolean;
  /** The user is obliged to work this day; only then is there a goal. */
  isRequiredDay: boolean;
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
  const required = isRequiredDay(day, settings);
  const goalMs = required ? goalHours * 3600_000 : 0;

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
    isRequiredDay: required,
  };
}

export interface WorkableTimeLeft {
  /** `max(now, work-window start)` — where the countdown begins. */
  windowStartMs: number;
  /** Work-window end (`workEnd` setting) for this day. */
  windowEndMs: number;
  /** Total length of the remaining work window. */
  windowMs: number;
  /** Non-work event time inside the window (overlaps merged, never double counted). */
  busyMs: number;
  /** `windowMs − busyMs`, clamped at 0: how long you can still work today. */
  remainingMs: number;
  isWorkDay: boolean;
  isRequiredDay: boolean;
}

/**
 * How much time the user can still work today: from `now` until the configured
 * work end, minus every non-work calendar event in between. Work-tagged events
 * are skipped on purpose — during those the user is already working — and
 * all-day events never block time, matching `computeDayBudget`.
 */
export function computeWorkableTimeLeft(args: {
  day: Date;
  now: number;
  events: CalendarEvent[];
  settings: CalendarSettings;
}): WorkableTimeLeft {
  const { day, now, events, settings } = args;
  const working = isWorkDay(day, settings);
  const required = isRequiredDay(day, settings);

  const window = workWindow(day, settings);
  const start = Math.max(window.start, now);
  if (start >= window.end) {
    return {
      windowStartMs: start,
      windowEndMs: window.end,
      windowMs: 0,
      busyMs: 0,
      remainingMs: 0,
      isWorkDay: working,
      isRequiredDay: required,
    };
  }

  const remainingWindow: Interval = { start, end: window.end };
  const busy = clipAll(
    events.filter((e) => !e.allDay && !e.isWork).map(eventInterval),
    remainingWindow,
  );
  const busyMs = totalMs(busy);

  return {
    windowStartMs: start,
    windowEndMs: window.end,
    windowMs: window.end - start,
    busyMs,
    remainingMs: Math.max(0, window.end - start - busyMs),
    isWorkDay: working,
    isRequiredDay: required,
  };
}

export type InsightTone = "good" | "info" | "warn" | "critical";

export interface CoachMeeting {
  title: string;
  start: string;
  end: string;
}

export interface DayFacts {
  dayKey: string;
  isWorkDay: boolean;
  isRequiredDay: boolean;
  now: string;
  windowStart: string | null;
  windowEnd: string | null;
  windowMs: number;
  busyMs: number;
  freeMs: number;
  longestGapMs: number;
  trackedMs: number;
  goalMs: number;
  remainingMs: number;
  meetings: CoachMeeting[];
  backlogHours: number | null;
  perDayNeededHours: number | null;
  eventTitles: string[];
}

export interface DayInsight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  hint?: string;
}

export interface DayIntelligence {
  insights: DayInsight[];
  tone: InsightTone;
  longestGapMs: number;
  facts: DayFacts;
}

export function formatTime(isoOrMs: string | number): string {
  const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export interface DaySummary {
  /** The user can work this day (it is not a day off). */
  isWorkDay: boolean;
  /** The user is obliged to work this day; only then is there a goal. */
  isRequiredDay: boolean;
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
  const required = isRequiredDay(args.day, args.settings);
  const goalMs = required ? goalHours * 3600_000 : 0;
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
    isRequiredDay: required,
    goalMs,
    doneMs,
    trackedMs,
    remainingMs: Math.max(0, goalMs - doneMs),
    progress: goalMs > 0 ? Math.min(1, doneMs / goalMs) : 0,
  };
}

/* ------------------------------------------------------ Day intelligence */

export function computeDayInsights(args: {
  day: Date;
  now: number;
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  settings: CalendarSettings;
  trackedIntervals?: Interval[];
  goalHours?: number;
  backlogHours?: number | null;
  perDayNeededHours?: number | null;
}): DayIntelligence {
  const budget = computeDayBudget(args);
  const window = workWindow(args.day, args.settings);
  const start = Math.max(window.start, args.now);
  const windowEnd = window.end;
  const remainingWindowMs = Math.max(0, windowEnd - start);
  const dayIv = dayInterval(args.day);

  const timed = args.events.filter((e) => !e.allDay);
  const busyAll = timed.filter((e) => !e.isWork);
  const workAll = timed.filter((e) => e.isWork);

  const busyFromNow = busyAll
    .map((e) => clip(eventInterval(e), { start, end: windowEnd }))
    .filter((x): x is Interval => !!x);
  const workFromNow = workAll
    .map((e) => clip(eventInterval(e), { start, end: windowEnd }))
    .filter((x): x is Interval => !!x);
  const focusFromNow = args.focusBlocks
    .map((b) => clip(eventInterval(b), { start, end: windowEnd }))
    .filter((x): x is Interval => !!x);
  const trackedFromNow = mergeIntervals(args.trackedIntervals ?? [])
    .map((iv) => clip(iv, { start, end: windowEnd }))
    .filter((x): x is Interval => !!x);

  const busyMs = totalMs(busyFromNow);
  const freeGaps = remainingWindowMs > 0 ? freeIntervals({ start, end: windowEnd }, [...busyFromNow, ...workFromNow, ...focusFromNow, ...trackedFromNow]) : [];
  const freeMs = totalMs(freeGaps);
  const longestGapMs = freeGaps.reduce((max, iv) => Math.max(max, iv.end - iv.start), 0);

  const dayEvents = timed.filter((e) => {
    const iv = eventInterval(e);
    return iv.start < dayIv.end && iv.end > dayIv.start;
  });
  const meetings: CoachMeeting[] = dayEvents
    .filter((e) => !e.isWork)
    .map((e) => ({ title: e.title, start: e.start, end: e.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const eventTitles = Array.from(new Set(dayEvents.map((e) => e.title)));

  const fmtDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtIso = (ms: number) => new Date(ms).toISOString();

  const facts: DayFacts = {
    dayKey: fmtDay(args.day),
    isWorkDay: budget.isWorkDay,
    isRequiredDay: budget.isRequiredDay,
    now: fmtIso(args.now),
    windowStart: remainingWindowMs > 0 ? fmtIso(start) : null,
    windowEnd: remainingWindowMs > 0 ? fmtIso(windowEnd) : null,
    windowMs: remainingWindowMs,
    busyMs,
    freeMs,
    longestGapMs,
    trackedMs: budget.trackedMs,
    goalMs: budget.goalMs,
    remainingMs: budget.remainingMs,
    meetings,
    backlogHours: args.backlogHours ?? null,
    perDayNeededHours: args.perDayNeededHours ?? null,
    eventTitles,
  };

  const insights: DayInsight[] = [];

  // R1 — day off, or working on a day off
  if (!budget.isWorkDay) {
    const busy = budget.trackedMs > 0 || dayEvents.length > 0;
    insights.push({
      id: "day-off",
      tone: busy ? "warn" : "info",
      title: busy ? "Working on a day off" : "Day off",
      detail: busy
        ? "You have events or tracked time on a day you normally take off."
        : "Today is not a working day, so nothing is expected of you.",
    });
  }

  // R2 — optional day
  if (budget.isWorkDay && !budget.isRequiredDay) {
    insights.push({
      id: "optional-day",
      tone: "good",
      title: "Optional day",
      detail: "Nothing is owed today. Anything you track counts as extra.",
    });
  }

  // R3/R4/R5 — capacity warnings
  const capacity = remainingWindowMs > 0 ? busyMs / remainingWindowMs : 0;
  if (remainingWindowMs > 0) {
    if (freeMs === 0) {
      insights.push({
        id: "fully-booked",
        tone: "warn",
        title: "Fully booked",
        detail: `Only your events fit for the rest of the day. There is no free time before ${formatTime(windowEnd)}.`,
        hint: "Move something to make room if you still need to work.",
      });
    } else {
      if (capacity >= 0.7) {
        insights.push({
          id: "tight",
          tone: "warn",
          title: "Meetings dominate the day",
          detail: `Events take ${Math.round(capacity * 100)}% of your remaining window (${formatHM(busyMs)} of ${formatHM(remainingWindowMs)}).`,
        });
      }
      if (longestGapMs < 45 * 60_000 && freeGaps.length > 1) {
        insights.push({
          id: "fragmented",
          tone: "info",
          title: "Fragmented day",
          detail: `Free time is split into ${freeGaps.length} short gaps, the longest under 45 minutes.`,
          hint: "Treat the small gaps as buffer, not work time.",
        });
      }
    }
  }

  // R5 — back-to-back meetings
  {
    const sortedBusy = busyFromNow.slice().sort((a, b) => a.start - b.start);
    let chained = 0;
    for (let i = 0; i < sortedBusy.length - 1; i++) {
      const current = sortedBusy[i];
      const next = sortedBusy[i + 1];
      if (current && next && next.start - current.end <= 10 * 60_000) chained++;
    }
    if (chained >= 2) {
      insights.push({
        id: "back-to-back",
        tone: "warn",
        title: "Back-to-back meetings",
        detail: `${chained} back-to-back joins with 10 minutes or less between them.`,
        hint: "Protect a break between blocks so you can reset.",
      });
    }
  }

  // R6 — free time for other things
  if (remainingWindowMs > 0 && freeMs >= 30 * 60_000) {
    insights.push({
      id: "free-time",
      tone: "good",
      title: "Free time available",
      detail: `${formatHM(freeMs)} of your window is unbooked — plenty of room for other things.`,
    });
  }

  // R7 — deep-work window
  if (longestGapMs >= 90 * 60_000 && freeGaps.length > 0) {
    const best = freeGaps.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    insights.push({
      id: "deep-work",
      tone: "good",
      title: "Deep-work window",
      detail: `Best focus block: ${formatTime(best.start)} to ${formatTime(best.end)} (${formatHM(best.end - best.start)}).`,
    });
  }

  // R8 — pace vs the daily goal
  if (budget.isRequiredDay && budget.goalMs > 0) {
    const doneMs = budget.trackedMs + budget.workEventsDoneMs + budget.plannedMs;
    const windowLength = window.end - window.start;
    const fraction = windowLength <= 0 ? 1 : Math.max(0, Math.min(1, (args.now - window.start) / windowLength));
    const expected = budget.goalMs * fraction;
    const delta = doneMs - expected;
    if (delta >= 60 * 60_000) {
      insights.push({
        id: "ahead",
        tone: "good",
        title: "Ahead of pace",
        detail: `${formatHM(delta)} ahead of where you need to be for this time of day.`,
      });
    } else if (delta <= -60 * 60_000) {
      insights.push({
        id: "behind",
        tone: "warn",
        title: "Behind pace",
        detail: `${formatHM(-delta)} behind where you need to be for this time of day.`,
        hint: "Block a chunk of the free time you have left.",
      });
    }
  }

  // R9 — goal cannot be covered
  if (budget.overbooked) {
    insights.push({
      id: "overbooked",
      tone: "critical",
      title: "Not enough time left",
      detail: `You are ${formatHM(budget.remainingMs - budget.freeLeftMs)} short of your goal before the day ends.`,
      hint: "Reschedule a meeting or accept the shortfall today.",
    });
  }

  // R10 — backlog pressure
  if ((args.backlogHours ?? 0) > 0 && freeMs > 0) {
    insights.push({
      id: "backlog",
      tone: "info",
      title: "Backlog",
      detail: `You carry ${formatHM(args.backlogHours! * 3600_000)} of backlog. Today's free time can cover ${formatHM(freeMs)}.`,
    });
  }

  // R11 — monthly pacing
  if ((args.perDayNeededHours ?? 0) > 0) {
    const pph = args.perDayNeededHours!;
    const perDayMs = pph * 3600_000;
    insights.push({
      id: "monthly",
      tone: perDayMs > freeMs ? "warn" : "info",
      title: "Monthly pacing",
      detail:
        perDayMs > freeMs
          ? `You need ${pph.toFixed(1)}h/day this month, but only ${formatHM(freeMs)} is free today.`
          : `You need ${pph.toFixed(1)}h/day this month. Today's ${formatHM(freeMs)} of free time covers it.`,
    });
  }

  // R12 — habit nags
  if (budget.isRequiredDay && remainingWindowMs > 0 && budget.trackedMs === 0 && budget.plannedMs === 0) {
    insights.push({
      id: "nothing-logged",
      tone: "warn",
      title: "Nothing logged yet",
      detail: `No time tracked and nothing scheduled so far on a required day.`,
      hint: "Start the timer or log what you already did.",
    });
  }

  const toneRank: Record<InsightTone, number> = { critical: 0, warn: 1, info: 2, good: 3 };
  insights.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  const tone: InsightTone = insights[0]?.tone ?? "good";

  return { insights, tone, longestGapMs, facts };
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
