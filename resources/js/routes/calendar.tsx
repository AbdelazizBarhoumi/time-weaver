import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CalendarView, type CalendarDensity } from "@/components/CalendarView";
import { MonthView } from "@/components/MonthView";
import { AccountsCard, BudgetCard, Legend, SettingsCard } from "@/components/CalendarSidebar";
import {
  addDays,
  computeDayBudget,
  isWorkDay,
  sameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  summarizeDay,
  useCalendarAccounts,
  useCalendarEvents,
  useCalendarSettings,
  useCreateFocusBlock,
  useDeleteFocusBlock,
  useFocusBlocks,
  useTagEvent,
  type CalendarEvent,
  type CalendarSettings,
  type DaySummary,
  type Interval,
} from "@/lib/calendar";
import { useCreateSession, useSessions } from "@/lib/queries";
import { DAILY_GOAL_HOURS, formatHM, formatTime } from "@/lib/tracker";
import type { ApiWorkSession } from "@/lib/api";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — ShiftGrid" },
      { name: "description", content: "See your Google calendars and where your remaining work hours fit today." },
      { property: "og:title", content: "Calendar — ShiftGrid" },
      { property: "og:description", content: "See your Google calendars and where your remaining work hours fit today." },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary" },
    ],
  }),
  component: CalendarPage,
});

type ViewMode = "day" | "week" | "month";

const DEFAULT_SETTINGS: CalendarSettings = {
  workStart: "06:00",
  workEnd: "22:00",
  workKeywords: [],
  workDays: [1, 2, 3, 4, 5],
};

const DENSITY_KEY = "shiftgrid.calendar.density";
const HIDDEN_KEY = "shiftgrid.calendar.hidden";

function readDensity(): CalendarDensity {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return value === "full" ? "full" : "work";
  } catch {
    return "work";
  }
}

function readHidden(): Set<number> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(Number) : []);
  } catch {
    return new Set();
  }
}

function CalendarPage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [now, setNow] = useState(() => Date.now());
  const [density, setDensity] = useState<CalendarDensity>(readDensity);
  const [hidden, setHidden] = useState<Set<number>>(readHidden);

  // The time line ticks every 15s so the clock and "time left" feel live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {
      /* storage unavailable */
    }
  }, [density, hidden]);

  const isMonth = mode === "month";
  const dayCount = mode === "week" ? 7 : 1;
  const gridFirst = isMonth ? startOfWeek(startOfMonth(anchor)) : mode === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const gridDays = isMonth ? 42 : dayCount;
  const gridLast = addDays(gridFirst, gridDays);

  // Always also load today so the live budget works when browsing other weeks/months.
  const todayStart = startOfDay(new Date(now));
  const rangeFrom = new Date(Math.min(gridFirst.getTime(), todayStart.getTime()));
  const rangeTo = new Date(Math.max(gridLast.getTime(), addDays(todayStart, 1).getTime()));

  const accounts = useCalendarAccounts();
  const settingsQ = useCalendarSettings();
  const eventsQ = useCalendarEvents(rangeFrom, rangeTo);
  const focusQ = useFocusBlocks(rangeFrom, rangeTo);
  const sessionsQ = useSessions({ from: rangeFrom.toISOString(), to: rangeTo.toISOString(), per_page: 500 });

  const tag = useTagEvent();
  const createFocus = useCreateFocusBlock();
  const deleteFocus = useDeleteFocusBlock();
  const createSession = useCreateSession();

  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const allEvents = eventsQ.data?.events ?? [];
  const focusBlocks = focusQ.data ?? [];
  const sessions: ApiWorkSession[] = sessionsQ.data ?? [];

  const events = useMemo(() => allEvents.filter((e) => !hidden.has(e.accountId)), [allEvents, hidden]);

  const intervalOf = useCallback(
    (s: ApiWorkSession): Interval => ({ start: new Date(s.start).getTime(), end: s.end ? new Date(s.end).getTime() : now }),
    [now],
  );
  const intervalsForDay = useCallback(
    (day: Date) => sessions.filter((s) => sameDay(new Date(s.start), day)).map(intervalOf),
    [sessions, intervalOf],
  );

  const todayIntervals = intervalsForDay(todayStart);
  const budget = useMemo(
    () =>
      computeDayBudget({
        day: todayStart,
        now,
        goalHours: DAILY_GOAL_HOURS,
        trackedIntervals: todayIntervals,
        events,
        focusBlocks,
        settings,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, focusBlocks, settings, now, sessions],
  );

  const summaries: DaySummary[] = useMemo(() => {
    if (isMonth) return [];
    return Array.from({ length: dayCount }, (_, i) => {
      const day = addDays(gridFirst, i);
      return summarizeDay({ day, events, focusBlocks, trackedIntervals: intervalsForDay(day), settings });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonth, dayCount, gridFirst, events, focusBlocks, settings, sessions]);

  const allIntervals = useMemo(() => sessions.map(intervalOf), [sessions, intervalOf]);

  const step = useCallback(
    (dir: -1 | 1) => {
      setAnchor((a) =>
        mode === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, Math.min(a.getDate(), 28)) : addDays(a, dir * dayCount),
      );
    },
    [mode, dayCount],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === "d") setMode("day");
      else if (ev.key === "w") setMode("week");
      else if (ev.key === "m") setMode("month");
      else if (ev.key === "t") setAnchor(new Date());
      else if (ev.key === "ArrowLeft") step(-1);
      else if (ev.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const oauthError = params.get("error");
  const oauthConnected = params.get("connected") === "1";

  useEffect(() => {
    if (oauthConnected) toast.success("Google account connected");
    if (oauthError) toast.error(`Could not connect Google account: ${oauthError}`);
  }, [oauthConnected, oauthError]);

  const logWork = (start: Date, end: Date) => {
    createSession.mutate(
      { start: start.toISOString(), end: end.toISOString(), note: "Planned work" },
      { onSuccess: () => toast.success(`Logged ${formatHM(end.getTime() - start.getTime())} of work`) },
    );
  };

  const title = isMonth
    ? anchor.toLocaleDateString("en", { month: "long", year: "numeric" })
    : mode === "week"
      ? `${gridFirst.toLocaleDateString("en", { month: "short", day: "numeric" })} – ${addDays(gridFirst, 6).toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        })}`
      : gridFirst.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <Link to="/" className="font-mono text-sm text-mut hover:text-neon">
          ← ShiftGrid
        </Link>
        <h1 className="text-lg font-semibold">{title}</h1>
        <span className="hidden items-center gap-2 font-mono text-xs text-mut sm:flex">
          <span className="inline-block h-2 w-2 rounded-full bg-neon" />
          {formatTime(new Date(now).toISOString())}
          {budget.isWorkDay && budget.remainingMs > 0 && <span className="text-neon">{formatHM(budget.remainingMs)} left</span>}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="ml-2 flex overflow-hidden rounded-md border border-line">
            {(["day", "week", "month"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 font-mono text-xs uppercase ${mode === m ? "bg-neon text-void" : "text-mut hover:text-ink"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(["work", "full"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                title={d === "work" ? "Show working hours only" : "Show all 24 hours"}
                className={`px-3 py-1 font-mono text-xs uppercase ${density === d ? "bg-l3 text-void" : "text-mut hover:text-ink"}`}
              >
                {d === "work" ? "work h" : "24h"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {oauthError && (
        <div className="mx-6 mt-4 rounded border border-line bg-panel px-4 py-2 text-sm text-destructive">
          Google connection failed: {oauthError}
        </div>
      )}
      {eventsQ.data?.errors && eventsQ.data.errors.length > 0 && (
        <div className="mx-6 mt-4 rounded border border-line bg-panel px-4 py-2 text-sm text-mut">
          Some calendars could not be read:{" "}
          {eventsQ.data.errors.map((err) => `${err.email} (${err.message})`).join(", ")}
        </div>
      )}

      <main className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <div>
          {isMonth ? (
            <MonthView
              month={anchor}
              now={now}
              settings={settings}
              events={events}
              focusBlocks={focusBlocks}
              trackedIntervals={allIntervals}
              onSelectDay={(day) => {
                setAnchor(day);
                setMode("day");
              }}
            />
          ) : (
            <>
              <CalendarView
                firstDay={gridFirst}
                dayCount={dayCount}
                now={now}
                settings={settings}
                events={events}
                focusBlocks={focusBlocks}
                todaySlots={budget.isWorkDay ? budget.slots : []}
                density={density}
                summaries={summaries}
                onToggleWork={(e) => onToggleWork(e)}
                onResetWork={(e) => onResetWork(e)}
                onCreateFocus={(start, end) => {
                  const title = prompt("Name this work block", "Focus block");
                  if (title === null) return;
                  createFocus.mutate({ title: title || "Focus block", start: start.toISOString(), end: end.toISOString() });
                }}
                onDeleteFocus={(b) => deleteFocus.mutate(b.id)}
                onStartFocus={(b) => createSession.mutate({ start: new Date().toISOString(), note: b.title })}
                onLogWork={logWork}
              />
              {!isWorkDay(gridFirst, settings) && dayCount === 1 && (
                <p className="mt-2 font-mono text-[11px] text-mut">This is one of your days off.</p>
              )}
            </>
          )}
          <p className="mt-3 font-mono text-[11px] text-mut">
            Drag empty space to plan · Click an event to mark it as work (adds a tracked session) · Right-click to reset ·
            Click a green gap to log that time
          </p>
        </div>

        <aside className="space-y-4">
          <BudgetCard budget={budget} />
          <AccountsCard accounts={accounts.data ?? []} hidden={hidden} onToggleVisibility={toggleVisibility} />
          <SettingsCard settings={settings} />
          <Legend />
        </aside>
      </main>
    </div>
  );

  function onToggleWork(event: CalendarEvent) {
    const payload = {
      accountId: event.accountId,
      eventId: event.eventId,
      isWork: !event.isWork,
      title: event.title,
      allDay: event.allDay,
    };
    tag.mutate(
      event.allDay
        ? payload
        : { ...payload, start: new Date(event.start).toISOString(), end: new Date(event.end).toISOString() },
      { onSuccess: () => toast.success(event.isWork ? `"${event.title}" no longer counts as work` : `"${event.title}" counted as work`) },
    );
  }

  function onResetWork(event: CalendarEvent) {
    tag.mutate(
      { accountId: event.accountId, eventId: event.eventId, isWork: null, title: event.title, allDay: event.allDay },
      { onSuccess: () => toast("Back to automatic tagging") },
    );
  }

  function toggleVisibility(id: number) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
}
