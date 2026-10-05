import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Heatmap } from "@/components/Heatmap";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { MonthlyCard } from "@/components/MonthlyCard";
import { SessionsPanel } from "@/components/SessionsPanel";
import { TimerCard } from "@/components/TimerCard";
import {
  clearAll,
  computeStats,
  dayKey,
  hoursForDay,
  loadSessions,
  newId,
  saveSessions,
  seedDemoData,
  DAILY_GOAL_HOURS,
  type WorkSession,
} from "@/lib/tracker";

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
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded.length ? loaded : seedDemoData());
  }, []);

  const hasActive = sessions.some((s) => !s.end);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const update = (next: WorkSession[]) => {
    setSessions(next);
    saveSessions(next);
  };

  const startSession = () => {
    if (hasActive) return;
    update([
      ...sessions,
      { id: newId(), start: new Date().toISOString(), end: null, note: "", pausedMs: 0, pausedAt: null },
    ]);
  };

  const pauseSession = () => {
    update(
      sessions.map((s) => (!s.end && !s.pausedAt ? { ...s, pausedAt: new Date().toISOString() } : s)),
    );
  };

  const resumeSession = () => {
    update(
      sessions.map((s) =>
        !s.end && s.pausedAt
          ? { ...s, pausedMs: s.pausedMs + (Date.now() - new Date(s.pausedAt).getTime()), pausedAt: null }
          : s,
      ),
    );
  };

  const stopSession = () => {
    update(
      sessions.map((s) => {
        if (s.end) return s;
        const end = new Date().toISOString();
        const pausedMs = s.pausedAt ? s.pausedMs + (Date.now() - new Date(s.pausedAt).getTime()) : s.pausedMs;
        return { ...s, end, pausedMs, pausedAt: null };
      }),
    );
  };

  const deleteSession = (id: string) => update(sessions.filter((s) => s.id !== id));

  const addManual = ({ date, start, end, note }: { date: string; start: string; end: string; note: string }) => {
    update([
      ...sessions,
      {
        id: newId(),
        start: new Date(`${date}T${start}`).toISOString(),
        end: new Date(`${date}T${end}`).toISOString(),
        note,
        pausedMs: 0,
        pausedAt: null,
      },
    ]);
  };

  const resetAll = () => {
    if (window.confirm("Delete all tracked data? This cannot be undone.")) {
      clearAll();
      setSessions([]);
    }
  };

  const stats = useMemo(() => computeStats(sessions, now), [sessions, now]);
  const todayHours = hoursForDay(sessions, dayKey(new Date(now)), now);

  const statCards = [
    { label: "STREAK", value: String(stats.streak), unit: stats.streak === 1 ? "day" : "days", neon: true },
    { label: "THIS WEEK", value: stats.weekHours.toFixed(1), unit: "h", neon: false },
    { label: "BEST DAY", value: stats.bestDayHours.toFixed(1), unit: "h", neon: false },
    { label: "AVG / DAY", value: stats.avgPerActiveDay.toFixed(1), unit: "h", neon: false },
  ];

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
              ⚡ {stats.streak} streak
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
            sessions={sessions}
            now={now}
            onStart={startSession}
            onPause={pauseSession}
            onResume={resumeSession}
            onStop={stopSession}
            onAddManual={() => setManualOpen(true)}
          />
          <SessionsPanel sessions={sessions} now={now} onDelete={deleteSession} />
          <Heatmap sessions={sessions} now={now} />
          <MonthlyCard sessions={sessions} now={now} />

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
          DATA LIVES IN YOUR BROWSER · LOCALSTORAGE ONLY
        </footer>
      </div>

      <ManualEntryDialog open={manualOpen} onClose={() => setManualOpen(false)} onAdd={addManual} />
    </div>
  );
}
