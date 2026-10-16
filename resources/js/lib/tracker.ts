export interface Segment {
  type: "work" | "pause";
  /** ISO timestamp of segment start */
  start: string;
  /** ISO timestamp of segment end; null only for the open segment of an active session */
  end: string | null;
}

export interface WorkSession {
  id: string;
  /** ISO timestamp of session start */
  start: string;
  /** ISO timestamp of session end, null while running */
  end: string | null;
  note: string;
  /** Where the session came from: a manual timer/entry, or a calendar work event */
  source?: "manual" | "calendar";
  /** Accumulated paused milliseconds (excluded from duration) */
  pausedMs: number;
  /** ISO timestamp when paused, null while running */
  pausedAt: string | null;
  /** Work/pause segments tiling the session; always materialized by the API */
  segments: Segment[];
  /** True when the server synthesized the breakdown for a record made before segments existed */
  segmentsInferred: boolean;
}

const STORAGE_KEY = "shiftgrid.sessions.v1";
const SEED_FLAG = "shiftgrid.seeded.v1";

export const DAILY_GOAL_HOURS = 8;

export function levelFor(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 6) return 3;
  if (hours < DAILY_GOAL_HOURS) return 4;
  return 5;
}

export function loadSessions(): WorkSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: WorkSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function clearAll() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SEED_FLAG);
}

function iso(d: Date) {
  return d.toISOString();
}

/** Seed ~70 days of plausible history so the heatmap isn't empty on first run. */
export function seedDemoData(): WorkSession[] {
  if (localStorage.getItem(SEED_FLAG)) return loadSessions();
  const sessions: WorkSession[] = [];
  const now = new Date();
  let id = 0;
  for (let daysAgo = 70; daysAgo >= 1; daysAgo--) {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    const dow = d.getDay();
    if (dow === 0) continue; // Sundays off
    const r = Math.random();
    if (dow === 6 && r < 0.7) continue; // usually Saturdays off
    if (r < 0.12) continue; // occasional missed day
    // target hours: mostly 6–9.5
    let remaining = 5.5 + Math.random() * 4;
    let cursor = new Date(d);
    cursor.setHours(8 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0);
    while (remaining > 0.4) {
      const chunk = Math.min(remaining, 1 + Math.random() * 2.5);
      const start = new Date(cursor);
      const end = new Date(start.getTime() + chunk * 3600_000);
      sessions.push({
        id: `seed-${id++}`,
        start: iso(start),
        end: iso(end),
        note: "",
        pausedMs: 0,
        pausedAt: null,
        segments: [{ type: "work", start: iso(start), end: iso(end) }],
        segmentsInferred: false,
      });
      remaining -= chunk;
      cursor = new Date(end.getTime() + (0.5 + Math.random() * 2.5) * 3600_000);
      if (cursor.getDate() !== d.getDate()) break;
    }
  }
  localStorage.setItem(SEED_FLAG, "1");
  saveSessions(sessions);
  return sessions;
}

export function dayKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function sessionDurationMs(s: WorkSession, now: number = Date.now()): number {
  const start = new Date(s.start).getTime();
  const end = s.end ? new Date(s.end).getTime() : now;
  let paused = s.pausedMs;
  if (s.pausedAt) paused += now - new Date(s.pausedAt).getTime();
  return Math.max(0, end - start - paused);
}

export function segmentDurationMs(seg: Segment, now: number = Date.now()): number {
  const start = new Date(seg.start).getTime();
  const end = seg.end ? new Date(seg.end).getTime() : now;
  return Math.max(0, end - start);
}

/** Open work segment for a freshly started session. */
export function startSegments(now: number = Date.now()): Segment[] {
  return [{ type: "work", start: new Date(now).toISOString(), end: null }];
}

function closeOpenSegment(segments: Segment[], at: number): Segment[] {
  return segments.map((seg, i) =>
    i === segments.length - 1 && seg.end === null
      ? { ...seg, end: new Date(at).toISOString() }
      : seg,
  );
}

export function pauseSegments(segments: Segment[], now: number = Date.now()): Segment[] {
  return [...closeOpenSegment(segments, now), { type: "pause", start: new Date(now).toISOString(), end: null }];
}

export function resumeSegments(segments: Segment[], now: number = Date.now()): Segment[] {
  return [...closeOpenSegment(segments, now), { type: "work", start: new Date(now).toISOString(), end: null }];
}

export function stopSegments(segments: Segment[], now: number = Date.now()): Segment[] {
  return closeOpenSegment(segments, now);
}

const MIN_SPLIT_MS = 12 * 60_000;
const DEFAULT_SPLIT_MS = 15 * 60_000;

/**
 * Clamp segments to the session bounds, close the open one when the session is
 * being completed, drop segments that collapse to zero length, sort by start.
 */
export function prepareSegments(
  segments: Segment[],
  startMs: number,
  boundMs: number,
  closeOpen: boolean,
): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const rawStart = new Date(seg.start).getTime();
    let segEnd = seg.end ? new Date(seg.end).getTime() : null;
    if (segEnd === null && closeOpen) segEnd = boundMs;
    if (segEnd === null) {
      const openStart = Math.min(Math.max(rawStart, startMs), boundMs);
      out.push({ type: seg.type, start: new Date(openStart).toISOString(), end: null });
      continue;
    }
    const clampedStart = Math.max(rawStart, startMs);
    const clampedEnd = Math.min(segEnd, boundMs);
    if (clampedEnd <= clampedStart) continue;
    out.push({
      type: seg.type,
      start: new Date(clampedStart).toISOString(),
      end: new Date(clampedEnd).toISOString(),
    });
  }
  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** Returns a user-facing error for a prepared segment list, or null when valid. */
export function validateSegments(segments: Segment[]): string | null {
  if (segments.length === 0) return "A session needs at least one segment.";
  for (const [i, seg] of segments.entries()) {
    if (seg.end === null && i !== segments.length - 1) return "Only the last segment can be left open.";
    if (seg.end === null) continue;
    const segStart = new Date(seg.start).getTime();
    const segEnd = new Date(seg.end).getTime();
    if (segEnd <= segStart) return `Segment ${i + 1} must end after it starts.`;
    const prev = segments[i - 1];
    if (prev?.end && segStart < new Date(prev.end).getTime()) return "Segments must not overlap.";
  }
  return null;
}

/**
 * Make room for a new segment by splitting the longest eligible segment of the
 * opposite type (so +PAUSE cuts a work block, +WORK cuts a pause block).
 * Returns null when nothing is long enough to split.
 */
export function insertSplitSegment(
  segments: Segment[],
  newType: Segment["type"],
  boundMs: number,
): Segment[] | null {
  const targetType: Segment["type"] = newType === "work" ? "pause" : "work";
  let targetIndex = -1;
  let targetDuration = 0;
  segments.forEach((seg, i) => {
    if (seg.type !== targetType) return;
    const startMs = new Date(seg.start).getTime();
    const endMs = seg.end ? new Date(seg.end).getTime() : boundMs;
    const duration = endMs - startMs;
    if (duration >= MIN_SPLIT_MS && duration > targetDuration) {
      targetIndex = i;
      targetDuration = duration;
    }
  });
  if (targetIndex === -1) return null;

  const target = segments[targetIndex];
  if (!target) return null;
  const targetStart = new Date(target.start).getTime();
  const insertDuration = Math.min(DEFAULT_SPLIT_MS, Math.floor(targetDuration / 3));
  const insertStart = targetStart + Math.floor((targetDuration - insertDuration) / 2);
  const insertEnd = insertStart + insertDuration;

  const head: Segment = {
    type: target.type,
    start: target.start,
    end: new Date(insertStart).toISOString(),
  };
  const inserted: Segment = {
    type: newType,
    start: new Date(insertStart).toISOString(),
    end: new Date(insertEnd).toISOString(),
  };
  const tail: Segment = {
    type: target.type,
    start: new Date(insertEnd).toISOString(),
    end: target.end,
  };

  const out = [...segments];
  out.splice(targetIndex, 1, head, inserted, tail);
  return out;
}

export function hoursForDay(sessions: WorkSession[], key: string, now: number = Date.now()): number {
  let ms = 0;
  for (const s of sessions) {
    if (dayKey(s.start) === key) ms += sessionDurationMs(s, now);
  }
  return ms / 3600_000;
}

export function todaySessions(sessions: WorkSession[], now: number = Date.now()): WorkSession[] {
  const key = dayKey(new Date(now));
  return sessions
    .filter((s) => dayKey(s.start) === key)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export interface Stats {
  streak: number;
  weekHours: number;
  bestDayHours: number;
  avgPerActiveDay: number;
  totalHours: number;
  /** Elapsed working days × DAILY_GOAL_HOURS − all hours worked, floored at 0 */
  backlogHours: number;
}

export function computeStats(sessions: WorkSession[], now: number = Date.now()): Stats {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.start);
    byDay.set(k, (byDay.get(k) ?? 0) + sessionDurationMs(s, now));
  }
  const today = new Date(now);
  // streak: consecutive days (ending today or yesterday) with any work
  let streak = 0;
  const cursor = new Date(today);
  if ((byDay.get(dayKey(cursor)) ?? 0) <= 0) cursor.setDate(cursor.getDate() - 1);
  while ((byDay.get(dayKey(cursor)) ?? 0) > 0) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  // this week (Mon-start)
  const weekStart = new Date(today);
  const dow = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dow);
  let weekMs = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    if (d.getTime() > now) break;
    weekMs += byDay.get(dayKey(d)) ?? 0;
  }
  let best = 0;
  let total = 0;
  let activeDays = 0;
  for (const ms of byDay.values()) {
    total += ms;
    if (ms > 0) activeDays++;
    if (ms > best) best = ms;
  }
  // Backlog against the 8h/day goal: elapsed working days (Mon–Fri) from the first
  // session through today, minus all hours worked. Overtime and work on off-days
  // reduce it (the client has no day-off data), and it never goes below zero.
  let backlogMs = 0;
  if (sessions.length > 0) {
    const first = new Date(Math.min(...sessions.map(s => new Date(s.start).getTime())));
    first.setHours(0, 0, 0, 0);
    let workingDays = 0;
    for (let d = new Date(first); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) workingDays++;
    }
    backlogMs = Math.max(0, workingDays * DAILY_GOAL_HOURS * 3600_000 - total);
  }
  return {
    streak,
    weekHours: weekMs / 3600_000,
    bestDayHours: best / 3600_000,
    avgPerActiveDay: activeDays ? total / 3600_000 / activeDays : 0,
    totalHours: total / 3600_000,
    backlogHours: backlogMs / 3600_000,
  };
}

export interface MonthStats {
  /** e.g. "2026-10" */
  key: string;
  /** e.g. "October 2026" */
  label: string;
  doneHours: number;
  /** DAILY_GOAL_HOURS × working days in month */
  targetHours: number;
  /** target − done, floored at 0 */
  remainingHours: number;
  /** working days left in the month, today included */
  daysLeft: number;
  /** remainingHours ÷ daysLeft (0 when the month is over) */
  perDayNeeded: number;
  /** done − (DAILY_GOAL_HOURS × working days elapsed, today included); negative = behind */
  paceDeltaHours: number;
  /** done / target, 0–1 (clamped for display) */
  progress: number;
  isCurrent: boolean;
  /** Number of custom days off in this month (both excluded and included) */
  customDaysOff: number;
}

export interface CustomDayOff {
  date: string;
  type: 'excluded' | 'included';
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function hoursInMonth(sessions: WorkSession[], year: number, month: number, now: number, excludedDayOffs: Set<string>): number {
  let ms = 0;
  for (const s of sessions) {
    const d = new Date(s.start);
    const dateKey = dayKey(d);
    // Skip sessions on EXCLUDED day-offs only
    if (excludedDayOffs.has(dateKey)) continue;
    // INCLUDED day-offs are counted in doneHours
    if (d.getFullYear() === year && d.getMonth() === month) ms += sessionDurationMs(s, now);
  }
  return ms / 3600_000;
}

function buildMonthStats(sessions: WorkSession[], year: number, month: number, now: number, customDayOffs: CustomDayOff[]): MonthStats {
  const excludedDayOffs = new Set(customDayOffs.filter(d => d.type === 'excluded').map(d => d.date));
  const includedDayOffs = new Set(customDayOffs.filter(d => d.type === 'included').map(d => d.date));
  const allDayOffs = new Set([...excludedDayOffs, ...includedDayOffs]);

  const workingDaysInMonth = getWorkingDaysInMonth(year, month, excludedDayOffs);
  const doneHours = hoursInMonth(sessions, year, month, now, excludedDayOffs);
  const targetHours = workingDaysInMonth * DAILY_GOAL_HOURS;

  const today = new Date(now);
  const isCurrent = today.getFullYear() === year && today.getMonth() === month;
  const workingDaysElapsed = isCurrent ? getWorkingDaysElapsed(year, month, today, excludedDayOffs) : workingDaysInMonth;
  const workingDaysLeft = isCurrent ? getWorkingDaysLeft(year, month, today, excludedDayOffs) : 0;

  const remainingHours = Math.max(0, targetHours - doneHours);
  const perDayNeeded = workingDaysLeft > 0 ? remainingHours / workingDaysLeft : 0;
  const paceDeltaHours = doneHours - workingDaysElapsed * DAILY_GOAL_HOURS;

  // Count custom days off in this month (both types)
  let customDaysOffInMonth = 0;
  for (const dateKey of allDayOffs) {
    const d = new Date(dateKey);
    if (d.getFullYear() === year && d.getMonth() === month) {
      customDaysOffInMonth++;
    }
  }

  return {
    key: monthKeyOf(new Date(year, month, 1)),
    label: new Date(year, month, 1).toLocaleString("en", { month: "long", year: "numeric" }),
    doneHours,
    targetHours,
    remainingHours,
    daysLeft: workingDaysLeft,
    perDayNeeded,
    paceDeltaHours,
    progress: Math.min(1, doneHours / targetHours),
    isCurrent,
    customDaysOff: customDaysOffInMonth,
  };
}

function getWorkingDaysInMonth(year: number, month: number, excludedDayOffs: Set<string>): number {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  let days = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const dateKey = dayKey(d);
    // Only excluded day-offs reduce working days
    if (dow !== 0 && dow !== 6 && !excludedDayOffs.has(dateKey)) days++;
  }
  return days;
}

function getWorkingDaysElapsed(year: number, month: number, today: Date, excludedDayOffs: Set<string>): number {
  const start = new Date(year, month, 1);
  const end = new Date(Math.min(today.getTime(), new Date(year, month + 1, 0).getTime()));
  let days = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const dateKey = dayKey(d);
    // Only excluded day-offs reduce working days
    if (dow !== 0 && dow !== 6 && !excludedDayOffs.has(dateKey)) days++;
  }
  return days;
}

function getWorkingDaysLeft(year: number, month: number, today: Date, excludedDayOffs: Set<string>): number {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const start = new Date(Math.max(today.getTime() + 86400000, monthStart.getTime()));
  if (start > monthEnd) return 0;
  let days = 0;
  for (let d = new Date(start); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const dateKey = dayKey(d);
    // Only excluded day-offs reduce working days
    if (dow !== 0 && dow !== 6 && !excludedDayOffs.has(dateKey)) days++;
  }
  return days;
}

export function computeCurrentMonth(sessions: WorkSession[], now: number = Date.now(), customDayOffs: CustomDayOff[] = []): MonthStats {
  const t = new Date(now);
  return buildMonthStats(sessions, t.getFullYear(), t.getMonth(), now, customDayOffs);
}

/** Last `count` months including the current one, oldest first. */
export function monthlyBreakdown(sessions: WorkSession[], now: number = Date.now(), count = 4, customDayOffs: CustomDayOff[] = []): MonthStats[] {
  const t = new Date(now);
  const out: MonthStats[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    out.push(buildMonthStats(sessions, d.getFullYear(), d.getMonth(), now, customDayOffs));
  }
  return out;
}

export function formatHMS(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatHM(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Clock time in 12-hour local time, e.g. "9:30 AM". */
export function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PersistedSessionState {
  sessionId: string | null;
  startTime: string;
  pausedAt: string | null;
  pausedMs: number;
  isRunning: boolean;
  pipWindowId: string | null;
}

const PIP_STATE_KEY = "shiftgrid.pip.state.v1";

export function savePipState(state: PersistedSessionState) {
  localStorage.setItem(PIP_STATE_KEY, JSON.stringify(state));
}

export function loadPipState(): PersistedSessionState | null {
  try {
    const raw = localStorage.getItem(PIP_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSessionState;
  } catch {
    return null;
  }
}

export function clearPipState() {
  localStorage.removeItem(PIP_STATE_KEY);
}

export function generatePipWindowId(): string {
  return `pip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
