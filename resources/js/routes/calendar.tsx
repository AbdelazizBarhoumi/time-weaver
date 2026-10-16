import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarView } from "@/components/CalendarView";
import { AccountsCard, BudgetCard, SettingsCard } from "@/components/CalendarSidebar";
import {
  addDays,
  computeDayBudget,
  sameDay,
  startOfDay,
  startOfWeek,
  useCalendarAccounts,
  useCalendarEvents,
  useCalendarSettings,
  useCreateFocusBlock,
  useDeleteFocusBlock,
  useFocusBlocks,
  useTagEvent,
  type CalendarSettings,
} from "@/lib/calendar";
import { useCreateSession, useTodaySessions } from "@/lib/queries";
import { DAILY_GOAL_HOURS } from "@/lib/tracker";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — ShiftGrid" },
      { name: "description", content: "See your Google calendars and where your remaining work hours fit today." },
      { property: "og:title", content: "Calendar — ShiftGrid" },
      { property: "og:description", content: "See your Google calendars and where your remaining work hours fit today." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CalendarPage,
});

const DEFAULT_SETTINGS: CalendarSettings = { workStart: "06:00", workEnd: "22:00", workKeywords: [] };

function CalendarPage() {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const firstDay = mode === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const dayCount = mode === "week" ? 7 : 1;
  const lastDay = addDays(firstDay, dayCount);

  // Always also load today so the budget works when browsing other weeks.
  const rangeFrom = new Date(Math.min(firstDay.getTime(), startOfDay(new Date(now)).getTime()));
  const rangeTo = new Date(Math.max(lastDay.getTime(), addDays(startOfDay(new Date(now)), 1).getTime()));

  const accounts = useCalendarAccounts();
  const settingsQ = useCalendarSettings();
  const eventsQ = useCalendarEvents(rangeFrom, rangeTo);
  const focusQ = useFocusBlocks(rangeFrom, rangeTo);
  const today = useTodaySessions();

  const tag = useTagEvent();
  const createFocus = useCreateFocusBlock();
  const deleteFocus = useDeleteFocusBlock();
  const createSession = useCreateSession();

  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const events = eventsQ.data?.events ?? [];
  const focusBlocks = focusQ.data ?? [];

  const trackedMs = (today.data ?? []).reduce((s, x) => s + x.durationMs, 0);

  const budget = useMemo(() => {
    const todayDate = new Date(now);
    const todays = events.filter((e) => !e.allDay && sameDay(new Date(e.start), todayDate));
    const todaysFocus = focusBlocks.filter((b) => sameDay(new Date(b.start), todayDate));
    return computeDayBudget({
      day: todayDate,
      now,
      goalHours: DAILY_GOAL_HOURS,
      trackedMs,
      events: todays,
      focusBlocks: todaysFocus,
      settings,
    });
  }, [events, focusBlocks, now, settings, trackedMs]);

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const oauthError = params.get("error");

  const step = (dir: -1 | 1) => setAnchor((a) => addDays(a, dir * dayCount));

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <Link to="/" className="font-mono text-sm text-mut hover:text-neon">
          ← ShiftGrid
        </Link>
        <h1 className="text-lg font-semibold">
          {firstDay.toLocaleDateString("en", { month: "long", year: "numeric" })}
        </h1>
        <div className="ml-auto flex items-center gap-2">
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
            {(["day", "week"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 font-mono text-xs uppercase ${mode === m ? "bg-neon text-void" : "text-mut hover:text-ink"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>

      {oauthError && (
        <div className="mx-6 mt-4 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          Google connection didn't finish ({oauthError}). Please try again.
        </div>
      )}
      {eventsQ.data?.errors.map((e) => (
        <div key={e.accountId} className="mx-6 mt-4 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          {e.email}: {e.message}
        </div>
      ))}

      <main className="grid gap-6 p-6 lg:grid-cols-[1fr_280px]">
        <div>
          <CalendarView
            firstDay={firstDay}
            dayCount={dayCount}
            now={now}
            settings={settings}
            events={events}
            focusBlocks={focusBlocks}
            todaySlots={budget.slots}
            onToggleWork={(e) => tag.mutate({ accountId: e.accountId, eventId: e.eventId, isWork: !e.isWork })}
            onResetWork={(e) => tag.mutate({ accountId: e.accountId, eventId: e.eventId, isWork: null })}
            onCreateFocus={(start, end) => {
              const title = prompt("Name this work block", "Focus block");
              if (title === null) return;
              createFocus.mutate({ title: title || "Focus block", start: start.toISOString(), end: end.toISOString() });
            }}
            onDeleteFocus={(b) => deleteFocus.mutate(b.id)}
            onStartFocus={(b) => createSession.mutate({ start: new Date().toISOString(), note: b.title })}
          />
          <p className="mt-2 font-mono text-[11px] text-mut">
            Drag on empty space to plan a work block · Click an event to mark it as work · Right-click to reset to
            automatic
          </p>
        </div>
        <aside className="space-y-4">
          <BudgetCard budget={budget} />
          <AccountsCard accounts={accounts.data ?? []} />
          <SettingsCard settings={settings} />
        </aside>
      </main>
    </div>
  );
}
