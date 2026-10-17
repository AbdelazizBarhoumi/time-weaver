import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, Zap } from "lucide-react";
import {
  computeDayBudget,
  connectGoogleAccount,
  useCalendarAccounts,
  useCalendarEvents,
  useCalendarSettings,
  useFocusBlocks,
  type CalendarSettings,
  type Interval,
} from "@/lib/calendar";
import { useTodaySessions } from "@/lib/queries";
import { DAILY_GOAL_HOURS, formatHM, formatTime, isStudySession } from "@/lib/tracker";

const DEFAULT_SETTINGS: CalendarSettings = {
  workStart: "06:00",
  workEnd: "22:00",
  workKeywords: [],
  workDays: [1, 2, 3, 4, 5],
  requiredDays: [1, 2, 3, 4, 5],
};

/**
 * Dashboard summary that ties tracked time to the calendar: how much is left
 * today and which meeting is up next.
 */
export function TodayPlanCard() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const accounts = useCalendarAccounts();
  const settingsQ = useCalendarSettings();
  const { data: todaySessions = [] } = useTodaySessions();

  const today = useMemo(() => new Date(), []);
  const from = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()), [today]);
  const to = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1), [today]);

  const eventsQ = useCalendarEvents(from, to);
  const focusQ = useFocusBlocks(from, to);

  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const events = useMemo(() => (eventsQ.data?.events ?? []).filter((e) => !e.allDay), [eventsQ.data]);
  const focusBlocks = focusQ.data ?? [];

  // Work sessions count toward the goal; study sessions only eat into free gaps.
  const toInterval = (s: { start: string; end: string | null }): Interval => ({
    start: new Date(s.start).getTime(),
    end: s.end ? new Date(s.end).getTime() : now,
  });
  const tracked: Interval[] = todaySessions.filter((s) => !isStudySession(s)).map(toInterval);
  const studyBusy: Interval[] = todaySessions.filter((s) => isStudySession(s)).map(toInterval);

  const budget = computeDayBudget({
    day: today,
    now,
    events,
    focusBlocks,
    settings,
    trackedIntervals: tracked,
    extraBusy: studyBusy,
  });

  const nextEvent = useMemo(
    () =>
      [...events]
        .filter((e) => new Date(e.end).getTime() > now)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0],
    [events, now],
  );

  const connected = (accounts.data ?? []).length > 0;

  return (
    <section className="col-span-12 rounded-xl bg-panel p-6 ring-1 ring-line animate-rise" style={{ animationDelay: "80ms" }}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em] text-mut">
          <CalendarClock className="h-4 w-4 text-neon" /> TODAY&apos;S PLAN
        </div>
        <Link to="/calendar" className="ml-auto flex items-center gap-1 font-mono text-[11px] text-mut hover:text-neon">
          Open calendar <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {!connected ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-mut">Connect a Google calendar to see how your remaining hours fit around your meetings.</p>
          <button
            onClick={() => void connectGoogleAccount()}
            className="rounded-lg bg-neon/10 px-3 py-2 font-mono text-xs text-neon ring-1 ring-neon/40 hover:bg-neon/20"
          >
            Connect Google
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-mut">Remaining today</div>
            <div className="mt-1 text-3xl font-semibold text-neon">
              {budget.isRequiredDay ? formatHM(budget.remainingMs) : "—"}
            </div>
            <div className="mt-1 font-mono text-[11px] text-mut">
              {budget.isRequiredDay
                ? budget.remainingMs === 0
                  ? "Goal covered"
                  : `${formatHM(budget.freeLeftMs)} of free time left`
                : budget.isWorkDay
                  ? "Optional day"
                  : "Day off"}
            </div>
          </div>

          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-mut">Tracked + scheduled</div>
            <div className="mt-1 text-3xl font-semibold">
              {formatHM(budget.trackedMs + budget.workEventsDoneMs + budget.plannedMs)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-mut">of {formatHM(DAILY_GOAL_HOURS * 3_600_000)} goal</div>
          </div>

          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-mut">Up next</div>
            {nextEvent ? (
              <>
                <div className="mt-1 flex items-center gap-2 truncate text-lg font-semibold">
                  {nextEvent.isWork && <Zap className="h-4 w-4 shrink-0 text-neon" />}
                  <span className="truncate" style={{ borderColor: nextEvent.accountColor }}>
                    {nextEvent.title}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-mut">
                  {formatTime(nextEvent.start)}–{formatTime(nextEvent.end)}
                  {nextEvent.isWork ? " · counts as work" : ""}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-mut">Nothing scheduled.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
