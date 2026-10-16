import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Heatmap } from "@/components/Heatmap";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { MonthlyCard } from "@/components/MonthlyCard";
import { SessionsPanel } from "@/components/SessionsPanel";
import { TimerCard } from "@/components/TimerCard";
import { TodayPlanCard } from "@/components/TodayPlanCard";
import { FloatingTimerWidget } from "@/components/FloatingTimerWidget";
import { EditSessionDialog } from "@/components/EditSessionDialog";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  dayKey,
  hoursForDay,
  DAILY_GOAL_HOURS,
  startSegments,
  pauseSegments,
  resumeSegments,
  stopSegments,
  type CustomDayOff,
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
  useDayOffs,
  useAddDayOff,
  useRemoveDayOff,
} from "@/lib/queries";
import type { ApiWorkSession } from "@/lib/api";

function apiToWorkSession(s: ApiWorkSession): WorkSession {
  return {
    id: String(s.id),
    start: s.start,
    end: s.end,
    note: s.note,
    source: s.source ?? "manual",
    pausedMs: s.pausedMs,
    pausedAt: s.pausedAt,
    segments: s.segments,
    segmentsInferred: s.segmentsInferred,
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
  const [manualDate, setManualDate] = useState<string | undefined>(undefined);
  const [editSession, setEditSession] = useState<WorkSession | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const { data: sessions = [], isLoading, error } = useSessions();
  const { data: todaySessionsData = [] } = useTodaySessions();
  const { data: stats } = useStats();
  const { data: monthlyBreakdown = [] } = useMonthlyBreakdown();
  const { data: dayOffs = [] } = useDayOffs();

  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  const confirm = useConfirm();
  const addDayOff = useAddDayOff();
  const removeDayOff = useRemoveDayOff();

  const customDayOffs = useMemo(
    () =>
      dayOffs.map((d: { date: string; type: "excluded" | "included" }) => ({
        date: d.date,
        type: d.type,
      })),
    [dayOffs]
  );

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
      segments: startSegments(Date.now()),
    });
  };

  const pauseSession = () => {
    const activeSession = sessionsTyped.find((s) => !s.end && !s.pausedAt);
    if (activeSession) {
      updateSession.mutate({
        id: activeSession.id,
        data: { segments: pauseSegments(activeSession.segments, Date.now()) },
      });
    }
  };

  const resumeSession = () => {
    const pausedSession = sessionsTyped.find((s) => !s.end && s.pausedAt);
    if (pausedSession) {
      updateSession.mutate({
        id: pausedSession.id,
        data: { segments: resumeSegments(pausedSession.segments, Date.now()) },
      });
    }
  };

  const stopSession = () => {
    const activeSession = sessionsTyped.find((s) => !s.end);
    if (activeSession) {
      updateSession.mutate({
        id: activeSession.id,
        data: { end: new Date().toISOString(), segments: stopSegments(activeSession.segments, Date.now()) },
      });
    }
  };

  const handleDeleteSession = async (id: string) => {
    const confirmed = await confirm({
      title: "Delete this session?",
      description: "The tracked time is removed permanently.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    deleteSession.mutate(Number(id));
  };

  const handleEditSession = (session: WorkSession) => {
    setEditSession(session);
    setEditOpen(true);
  };

  const handleToggleDayOff = (dateKey: string) => {
    const exists = customDayOffs.some((d) => d.date === dateKey);
    if (exists) {
      removeDayOff.mutate(dateKey);
    } else {
      addDayOff.mutate({ date: dateKey, type: "excluded" });
    }
  };

  const handleSetDayOffType = (dateKey: string, type: "excluded" | "included") => {
    addDayOff.mutate({ date: dateKey, type });
  };

  const handleAddSession = (dateKey: string) => {
    setManualDate(dateKey);
    setManualOpen(true);
  };

  const addManual = ({ date, start, end, note }: { date: string; start: string; end: string; note: string }) => {
    createSession.mutate({
      start: new Date(`${date}T${start}`).toISOString(),
      end: new Date(`${date}T${end}`).toISOString(),
      note,
    });
  };

  const workSessions = sessionsTyped.map(apiToWorkSession);
  const todayHours = hoursForDay(workSessions, dayKey(new Date(now)), now);

  const backlog = stats?.backlogHours ?? 0;
  const backlogT = Math.min(1, Math.max(0, backlog / DAILY_GOAL_HOURS));
  const backlogColor = `hsl(${Math.round(120 * (1 - backlogT))} 85% 55%)`;

  type StatCard = { label: string; value: string; unit: string; neon?: boolean; color?: string };
  const statCards: StatCard[] = [
    { label: "STREAK", value: String(stats?.streak ?? 0), unit: stats?.streak === 1 ? "day" : "days", neon: true },
    { label: "THIS WEEK", value: stats?.weekHours.toFixed(1) ?? "0.0", unit: "h", neon: false },
    { label: "BEST DAY", value: stats?.bestDayHours.toFixed(1) ?? "0.0", unit: "h", neon: false },
    { label: "AVG / DAY", value: stats?.avgPerActiveDay.toFixed(1) ?? "0.0", unit: "h", neon: false },
    { label: "BACKLOG", value: backlog.toFixed(1), unit: "h", color: backlogColor },
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
            <Link
              to="/calendar"
              className="rounded-lg bg-panel px-3 py-2 font-mono text-xs text-mut ring-1 ring-line transition-colors hover:text-neon"
            >
              ◷ Calendar
            </Link>
            <div className="rounded-lg bg-panel px-3 py-2 font-mono text-xs ring-1 ring-line">
              {todayHours.toFixed(1)}h <span className="text-mut">/ {DAILY_GOAL_HOURS}h</span>
            </div>
            <div className="rounded-lg bg-neon/10 px-3 py-2 font-mono text-xs text-neon ring-1 ring-neon/40">
              ⚡ {stats?.streak ?? 0} streak
            </div>
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
            onAddManual={() => { setManualDate(undefined); setManualOpen(true); }}
          />
          <SessionsPanel sessions={workSessions} now={now} onDelete={handleDeleteSession} onEdit={handleEditSession} />
          <TodayPlanCard />
          <Heatmap
            sessions={workSessions}
            now={now}
            customDayOffs={customDayOffs}
            onToggleDayOff={handleToggleDayOff}
            onSetDayOffType={handleSetDayOffType}
            onAddSession={handleAddSession}
            onEditSession={handleEditSession}
            onDeleteSession={handleDeleteSession}
          />
          <MonthlyCard sessions={workSessions} now={now} customDayOffs={customDayOffs} />

          <section className="col-span-12 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {statCards.map((c, i) => (
              <div
                key={c.label}
                className="rounded-xl bg-panel p-5 ring-1 ring-line animate-rise"
                style={{ animationDelay: `${220 + i * 40}ms` }}
              >
                <div className="font-mono text-[10px] tracking-[0.2em] text-mut">{c.label}</div>
                <div
                  className={`mt-2 text-3xl font-bold ${c.color ? "" : c.neon ? "text-neon" : "text-ink"}`}
                  style={c.color ? { color: c.color } : undefined}
                >
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

      <FloatingTimerWidget
        sessions={workSessions}
        now={now}
        onPause={pauseSession}
        onResume={resumeSession}
        onStop={stopSession}
      />
      <ManualEntryDialog open={manualOpen} onClose={() => { setManualOpen(false); setManualDate(undefined); }} onAdd={addManual} initialDate={manualDate} />
      <EditSessionDialog
        open={editOpen}
        session={editSession}
        onClose={() => {
          setEditOpen(false);
          setEditSession(null);
        }}
        onSuccess={() => {
          setEditOpen(false);
          setEditSession(null);
        }}
      />
    </div>
  );
}