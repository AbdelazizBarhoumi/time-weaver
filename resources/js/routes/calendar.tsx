import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarView, type CalendarDensity } from "@/components/CalendarView";
import { MonthView } from "@/components/MonthView";
import { AccountsCard, BudgetCard, Legend, SettingsCard } from "@/components/CalendarSidebar";
import {
  addDays,
  computeDayBudget,
  isWorkDay,
  relativeTime,
  sameDay,
  sessionWorkIntervals,
  startOfDay,
  startOfMonth,
  startOfWeek,
  summarizeDay,
  useCalendarAccounts,
  useCalendarEvents,
  useCalendarSettings,
  useCreateFocusBlock,
  useDeleteCalendarEvent,
  useDeleteFocusBlock,
  useFocusBlocks,
  usePurgeAccountEvents,
  useRestoreAccountEvents,
  useSyncCalendars,
  useTagEvent,
  useUpdateCalendarAccount,
  type CalendarEvent,
  type CalendarSession,
  type CalendarSettings,
  type DaySummary,
  type DeleteScope,
  type Interval,
} from "@/lib/calendar";
import { useCreateSession, useDeleteSession, useSessions } from "@/lib/queries";
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
  const [syncErrors, setSyncErrors] = useState<{ accountId: number; email: string; message: string }[]>([]);

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
  const deleteSession = useDeleteSession();
  const syncCalendars = useSyncCalendars();
  const purgeEvents = usePurgeAccountEvents();
  const restoreEvents = useRestoreAccountEvents();
  const deleteEvent = useDeleteCalendarEvent();
  const updateAccount = useUpdateCalendarAccount();

  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const allEvents = eventsQ.data?.events ?? [];
  const focusBlocks = focusQ.data ?? [];
  const sessions: ApiWorkSession[] = sessionsQ.data ?? [];

  const hasRunningSession = sessions.some((s) => !s.end);

  // The time line ticks every 15s; while a session is running it ticks each
  // second so the live "working" band grows smoothly.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), hasRunningSession ? 1_000 : 15_000);
    return () => clearInterval(t);
  }, [hasRunningSession]);

  const calendarSessions: CalendarSession[] = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        note: s.note,
        source: s.source ?? "manual",
        segments: s.segments ?? [],
        segmentsInferred: s.segmentsInferred ?? false,
      })),
    [sessions],
  );

  const lastSyncedAt = useMemo(() => {
    const times = (accounts.data ?? []).map((a) => a.lastSyncedAt).filter((v): v is string => Boolean(v));
    return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
  }, [accounts.data]);

  const events = useMemo(() => allEvents.filter((e) => !hidden.has(e.accountId)), [allEvents, hidden]);

  const workIntervalsOf = useCallback(
    (s: CalendarSession): Interval[] => sessionWorkIntervals(s, now),
    [now],
  );
  const intervalsForDay = useCallback(
    (day: Date) =>
      calendarSessions.filter((s) => sameDay(new Date(s.start), day)).flatMap(workIntervalsOf),
    [calendarSessions, workIntervalsOf],
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

  const allIntervals = useMemo(() => calendarSessions.flatMap(workIntervalsOf), [calendarSessions, workIntervalsOf]);

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

  const runSync = () => {
    syncCalendars.mutate(undefined, {
      onSuccess: (result) => {
        setSyncErrors(result.errors);
        const removed = result.accounts.reduce((sum, a) => sum + a.removed, 0);
        if (result.errors.length > 0) {
          toast.error(`${result.errors.length} calendar(s) could not be synced. Try reconnecting them.`);
        } else {
          toast.success(`Synced ${result.synced} event${result.synced === 1 ? "" : "s"}${removed ? `, removed ${removed}` : ""}`);
        }
      },
      onError: () => toast.error("Sync failed. Please try again."),
    });
  };

  const removeSession = (session: CalendarSession) => {
    deleteSession.mutate(session.id, { onSuccess: () => toast.success("Session deleted") });
  };

  const removeEvent = (event: CalendarEvent, scope: DeleteScope, permanent: boolean) => {
    const target = scope === "series" ? `every saved event in the "${event.title}" series` : `"${event.title}"`;
    const message = permanent
      ? `Permanently delete ${target}?\n\nIt stays gone: future syncs will not bring it back.`
      : `Delete ${target} from the database?\n\nA later sync will bring it back if it still exists in Google.`;
    if (!confirm(message)) return;

    deleteEvent.mutate(
      { cacheId: event.cacheId, scope, permanent },
      {
        onSuccess: (r) => {
          const what = scope === "series" ? `${r.removed} events in the series` : "Event";
          toast.success(permanent ? `${what} deleted permanently` : `${what} deleted from database`);
        },
      },
    );
  };

  const restoreHidden = (id: number) => {
    const account = accounts.data?.find((a) => a.id === id);
    const count = account?.hiddenCount ?? 0;
    if (
      !confirm(
        `Restore ${count} permanently deleted event${count === 1 ? "" : "s"} for ${account?.email ?? "this account"}?\n\nThe next sync will load them again.`,
      )
    ) {
      return;
    }

    restoreEvents.mutate(id, {
      onSuccess: (r) => toast.success(`Restored ${r.restored} hidden event${r.restored === 1 ? "" : "s"}`),
    });
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
    <div className="flex min-h-screen flex-col bg-void text-ink lg:h-screen lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-4">
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
          <Button
            variant="outline"
            size="sm"
            disabled={syncCalendars.isPending || (accounts.data ?? []).every((a) => a.disconnected)}
            onClick={runSync}
            title="Fetch the latest events from Google (manual refresh)"
          >
            <RefreshCw className={cn("h-4 w-4", syncCalendars.isPending && "animate-spin")} />
            <span className="ml-1 font-mono text-xs uppercase">{syncCalendars.isPending ? "syncing" : "sync"}</span>
          </Button>
          {lastSyncedAt && <span className="font-mono text-[10px] text-mut">synced {relativeTime(lastSyncedAt, now)}</span>}
        </div>
      </header>

      {oauthError && (
        <div className="mx-6 mt-4 rounded border border-line bg-panel px-4 py-2 text-sm text-destructive">
          Google connection failed: {oauthError}
        </div>
      )}
      {syncErrors.length > 0 && (
        <div className="mx-6 mt-4 rounded border border-line bg-panel px-4 py-2 text-sm text-mut">
          Some calendars could not be synced: {syncErrors.map((err) => `${err.email} (${err.message})`).join(", ")}
        </div>
      )}

      <main className="grid min-h-0 flex-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-0 flex-col">
          {isMonth ? (
            <div className="min-h-0 lg:flex-1 lg:overflow-y-auto">
              <MonthView
              month={anchor}
              now={now}
              settings={settings}
              events={events}
              focusBlocks={focusBlocks}
              trackedIntervals={allIntervals}
              sessions={calendarSessions}
              onSelectDay={(day) => {
                setAnchor(day);
                setMode("day");
              }}
              />
            </div>
          ) : (
            <>
              <CalendarView
                firstDay={gridFirst}
                dayCount={dayCount}
                now={now}
                settings={settings}
                events={events}
                focusBlocks={focusBlocks}
                sessions={calendarSessions}
                todaySlots={budget.isWorkDay ? budget.slots : []}
                density={density}
                summaries={summaries}
                onToggleWork={(e) => onToggleWork(e)}
                onResetWork={(e) => onResetWork(e)}
                onDeleteEvent={removeEvent}
                onCreateFocus={(start, end) => {
                  const title = prompt("Name this work block", "Focus block");
                  if (title === null) return;
                  createFocus.mutate({ title: title || "Focus block", start: start.toISOString(), end: end.toISOString() });
                }}
                onDeleteFocus={(b) => deleteFocus.mutate(b.id)}
                onStartFocus={(b) => createSession.mutate({ start: new Date().toISOString(), note: b.title })}
                onLogWork={logWork}
                onDeleteSession={removeSession}
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

        <aside className="min-h-0 space-y-4 lg:overflow-y-auto lg:pr-1">
          <BudgetCard budget={budget} />
          <AccountsCard
            accounts={accounts.data ?? []}
            hidden={hidden}
            syncing={syncCalendars.isPending}
            onToggleVisibility={toggleVisibility}
            onToggleDefaultWork={(id, defaultWork) =>
              updateAccount.mutate(
                { id, defaultWork },
                {
                  onSuccess: () =>
                    toast.success(
                      defaultWork
                        ? "This mailbox now counts as work by default"
                        : "This mailbox no longer counts as work by default",
                    ),
                },
              )
            }
            onSync={runSync}
            onPurge={(id) =>
              purgeEvents.mutate(id, {
                onSuccess: (r) => toast.success(`Removed ${r.removed} saved event${r.removed === 1 ? "" : "s"}`),
              })
            }
            onRestoreHidden={restoreHidden}
          />
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
