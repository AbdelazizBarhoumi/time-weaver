export interface WorkSession {
  id: string;
  /** ISO timestamp of session start */
  start: string;
  /** ISO timestamp of session end, null while running */
  end: string | null;
  note: string;
  /** Accumulated paused milliseconds (excluded from duration) */
  pausedMs: number;
  /** ISO timestamp when paused, null while running */
  pausedAt: string | null;
}

const STORAGE_KEY = "shiftgrid.sessions.v1";
const SEED_FLAG = "shiftgrid.seeded.v1";

export const DAILY_GOAL_HOURS = 8;

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
  return {
    streak,
    weekHours: weekMs / 3600_000,
    bestDayHours: best / 3600_000,
    avgPerActiveDay: activeDays ? total / 3600_000 / activeDays : 0,
    totalHours: total / 3600_000,
  };
}

export interface MonthStats {
  /** e.g. "2026-10" */
  key: string;
  /** e.g. "October 2026" */
  label: string;
  doneHours: number;
  /** DAILY_GOAL_HOURS × days in month */
  targetHours: number;
  /** target − done, floored at 0 */
  remainingHours: number;
  /** days left in the month, today included */
  daysLeft: number;
  /** remainingHours ÷ daysLeft (0 when the month is over) */
  perDayNeeded: number;
  /** done − (DAILY_GOAL_HOURS × days elapsed, today included); negative = behind */
  paceDeltaHours: number;
  /** done / target, 0–1 (clamped for display) */
  progress: number;
  isCurrent: boolean;
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function hoursInMonth(sessions: WorkSession[], year: number, month: number, now: number): number {
  let ms = 0;
  for (const s of sessions) {
    const d = new Date(s.start);
    if (d.getFullYear() === year && d.getMonth() === month) ms += sessionDurationMs(s, now);
  }
  return ms / 3600_000;
}

function buildMonthStats(sessions: WorkSession[], year: number, month: number, now: number): MonthStats {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const doneHours = hoursInMonth(sessions, year, month, now);
  const targetHours = daysInMonth * DAILY_GOAL_HOURS;

  const today = new Date(now);
  const isCurrent = today.getFullYear() === year && today.getMonth() === month;
  const dayOfMonth = isCurrent ? today.getDate() : daysInMonth;
  const daysLeft = isCurrent ? daysInMonth - today.getDate() + 1 : 0;

  const remainingHours = Math.max(0, targetHours - doneHours);
  const perDayNeeded = daysLeft > 0 ? remainingHours / daysLeft : 0;
  const paceDeltaHours = doneHours - dayOfMonth * DAILY_GOAL_HOURS;

  return {
    key: monthKeyOf(new Date(year, month, 1)),
    label: new Date(year, month, 1).toLocaleString("en", { month: "long", year: "numeric" }),
    doneHours,
    targetHours,
    remainingHours,
    daysLeft,
    perDayNeeded,
    paceDeltaHours,
    progress: Math.min(1, doneHours / targetHours),
    isCurrent,
  };
}

export function computeCurrentMonth(sessions: WorkSession[], now: number = Date.now()): MonthStats {
  const t = new Date(now);
  return buildMonthStats(sessions, t.getFullYear(), t.getMonth(), now);
}

/** Last `count` months including the current one, oldest first. */
export function monthlyBreakdown(sessions: WorkSession[], now: number = Date.now(), count = 4): MonthStats[] {
  const t = new Date(now);
  const out: MonthStats[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    out.push(buildMonthStats(sessions, d.getFullYear(), d.getMonth(), now));
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

export function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
