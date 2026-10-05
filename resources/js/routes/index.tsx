import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Heatmap } from "@/components/Heatmap";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { MonthlyCard } from "@/components/MonthlyCard";
import { SessionsPanel } from "@/components/SessionsPanel";
import { TimerCard } from "@/components/TimerCard";
import {
  dayKey,
  hoursForDay,
  DAILY_GOAL_HOURS,
  type WorkSession,
} from "@/lib/tracker";
import {
  useSessions,
  useTodaySessions,
  useStats,
  useMonthlyBreakdown,
  useCreateSession,
  useUpdateSession,
  useDeleteSession,
  useClearAllSessions,
} from "@/lib/queries";
import type { ApiWorkSession } from "@/lib/api";

function apiToWorkSession(s: ApiWorkSession): WorkSession {
  return {
    id: String(s.id),
    start: s.start,
    end: s.end,
    note: s.note,
    pausedMs: s.pausedMs,
    pausedAt: s.pausedAt,
  };
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ShiftGrid — Work-hours tracker" },
      {
        name: "description",
        content:
          "Track flexible work hours with a live session timer, split sessions, an 8-hour daily goal, and a GitHub-style activity heatmap.",
      },
      { property: "og:title", content: "ShiftGrid — Work-hours tracker" },
      {
        property: "og:description",
        content:
          "Track flexible work hours with a live session timer, split sessions, an 8-hour daily goal, and a GitHub-style activity heatmap.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [now, setNow] = useState(() => Date.now());
  const [manualOpen, setManualOpen] = useState(false);

  const { data: sessions = [], isLoading, error } = useSessions();
  const { data: todaySessionsData = [] } = useTodaySessions();
  const { data: stats } = useStats();
  const { data: monthlyBreakdown = [] } = useMonthlyBreakdown();

  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  const clearAllSessions = useClearAllSessions();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sessionsTyped = sessions as ApiWorkSession[];
  const hasActive = sessionsTyped.some((s) => !s.end);

  const startSession = () => {
    if (hasActive) return;
    createSession.mutate({
      start: new Date().toISOString(),
    });
  };

  const pauseSession = () => {
    const activeSession = sessionsTyped.find((s) => !s.end && !s.pausedAt);
    if (activeSession) {
      updateSession.mutate({
        id: activeSession.id,
        data: { paused_at: new Date().toISOString() },
      });
    }
  };

  const resumeSession = () => {
    const pausedSession = sessionsTyped.find((s) => !s.end && s.pausedAt);
    if (pausedSession && pausedSession.pausedAt) {
      const pausedMs = pausedSession.pausedMs + (Date.now() - new Date(pausedSession.pausedAt).getTime());
      updateSession.mutate({
        id: pausedSession.id,
        data: { paused_ms: pausedMs, paused_at: null },
      });
    }
  };

  const stopSession = () => {
    const activeSession = sessionsTyped.find((s) => !s.end);
    if (activeSession) {
      const pausedMs = activeSession.pausedAt
        ? activeSession.pausedMs + (Date.now() - new Date(activeSession.pausedAt).getTime())
        : activeSession.pausedMs;
      updateSession.mutate({
        id: activeSession.id,
        data: { end: new Date().toISOString(), paused_ms: pausedMs, paused_at: null },
      });
    }
  };

  const handleDeleteSession = (id: string) => {
    deleteSession.mutate(Number(id));
  };

  const addManual = ({ date, start, end, note }: { date: string; start: string; end: string; note: string }) => {
    createSession.mutate({
      start: new Date(`${date}T${start}`).toISOString(),
      end: new Date(`${date}T${end}`).toISOString(),
      note,
    });
  };

  const resetAll = () => {
    if (window.confirm("Delete all tracked data? This cannot be undone.")) {
      clearAllSessions.mutate();
    }
  };

  const workSessions = sessionsTyped.map(apiToWorkSession);
  const todayHours = hoursForDay(workSessions, dayKey(new Date(now)), now);

  const statCards = [
    { label: "STREAK", value: String(stats?.streak ?? 0), unit: stats?.streak === 1 ? "day" : "days", neon: true },
    { label: "THIS WEEK", value: stats?.weekHours.toFixed(1) ?? "0.0", unit: "h", neon: false },
    { label: "BEST DAY", value: stats?.bestDayHours.toFixed(1) ?? "0.0", unit: "h", neon: false },
    { label: "AVG / DAY", value: stats?.avgPerActiveDay.toFixed(1) ?? "0.0", unit: "h", neon: false },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-void grid-bg font-display text-ink flex items-center justify-center">
        <div className="text-center">
          <div className="text-neon font-mono">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-void grid-bg font-display text-ink flex items-center justify-center">
        <div className="text-center text-red-500">
          Failed to load data. Please refresh the page.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void grid-bg font-display text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex items-center justify-between animate-rise">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-[10px] bg-neon/10 ring-1 ring-neon/40">
              <span className="font-mono text-sm font-bold text-neon">◈</span>
            </div>
            <div className="leading-none">
              <div className="font-mono text-[11px] tracking-[0.2em] text-mut">SHIFTGRID</div>
              <div className="mt-1 text-lg font-semibold">Work-hours tracker</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-panel px-3 py-2 font-mono text-xs ring-1 ring-line">
              {todayHours.toFixed(1)}h <span className="text-mut">/ {DAILY_GOAL_HOURS}h</span>
            </div>
            <div className="rounded-lg bg-neon/10 px-3 py-2 font-mono text-xs text-neon ring-1 ring-neon/40">
              ⚡ {stats?.streak ?? 0} streak
            </div>
            <button
              onClick={resetAll}
              title="Clear all data"
              className="rounded-lg bg-panel px-3 py-2 font-mono text-xs text-mut ring-1 ring-line transition hover:ring-neon/40"
            >
              Reset
            </button>
          </div>
        </header>

        <main className="mt-8 grid grid-cols-12 gap-5">
          <TimerCard
            sessions={workSessions}
            now={now}
            onStart={startSession}
            onPause={pauseSession}
            onResume={resumeSession}
            onStop={stopSession}
            onAddManual={() => setManualOpen(true)}
          />
          <SessionsPanel sessions={workSessions} now={now} onDelete={handleDeleteSession} />
          <Heatmap sessions={workSessions} now={now} />
          <MonthlyCard sessions={workSessions} now={now} />

          <section className="col-span-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {statCards.map((c, i) => (
              <div
                key={c.label}
                className="rounded-xl bg-panel p-5 ring-1 ring-line animate-rise"
                style={{ animationDelay: `${220 + i * 40}ms` }}
              >
                <div className="font-mono text-[10px] tracking-[0.2em] text-mut">{c.label}</div>
                <div className={`mt-2 text-3xl font-bold ${c.neon ? "text-neon" : "text-ink"}`}>
                  {c.value}
                  <span className="text-sm text-mut"> {c.unit}</span>
                </div>
              </div>
            ))}
          </section>
        </main>

        <footer className="mt-10 text-center font-mono text-[10px] tracking-[0.15em] text-mut">
          DATA SYNCED WITH SERVER
        </footer>
      </div>

      <ManualEntryDialog open={manualOpen} onClose={() => setManualOpen(false)} onAdd={addManual} />
    </div>
  );
}