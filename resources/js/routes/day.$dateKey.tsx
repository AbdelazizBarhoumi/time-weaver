import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  CalendarOffIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  EditIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import {
  formatHM,
  formatTime,
  sessionDurationMs,
  workSessionsOnly,
  type WorkSession,
} from "@/lib/tracker";
import { Button } from "@/components/ui/button";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import { EditSessionDialog } from "@/components/EditSessionDialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { SegmentBreakdown } from "@/components/SegmentBreakdown";
import {
  useAddDayOff,
  useCreateSession,
  useDaySessions,
  useDeleteSession,
  useRemoveDayOff,
  useUpdateSession,
} from "@/lib/queries";
import { sessionsApi, dayOffsApi, type ApiWorkSession } from "@/lib/api";

interface ApiDayOff {
  date: string;
  type: "excluded" | "included";
  created_at: string;
}

interface DayLoaderData {
  sessions: ApiWorkSession[];
  dayOff: ApiDayOff | undefined;
  dateKey: string;
}

function apiToWorkSession(session: ApiWorkSession): WorkSession {
  return {
    id: String(session.id),
    start: session.start,
    end: session.end,
    note: session.note,
    type: session.type ?? "work",
    pausedMs: session.pausedMs,
    pausedAt: session.pausedAt,
    segments: session.segments,
    segmentsInferred: session.segmentsInferred,
  };
}

export const Route = createFileRoute("/day/$dateKey")({
  loader: async ({
    params,
    context: { queryClient },
  }): Promise<DayLoaderData> => {
    const [sessionsRes, dayOffsRes] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ["sessions", "day", params.dateKey],
        queryFn: () =>
          sessionsApi
            .list({ from: params.dateKey, to: params.dateKey })
            .then((response) => response.data.data),
      }),
      queryClient.fetchQuery({
        queryKey: ["dayOffs"],
        queryFn: () => dayOffsApi.list().then((response) => response.data),
      }),
    ]);

    const dayOff = dayOffsRes.find((item) => item.date === params.dateKey);

    return {
      sessions: sessionsRes,
      dayOff,
      dateKey: params.dateKey,
    };
  },

  component: DayDetailPage,
});

function DayDetailPage() {
  const { sessions: loaderSessions, dayOff, dateKey } = Route.useLoaderData();

  const [manualOpen, setManualOpen] = useState(false);
  const [editSession, setEditSession] = useState<WorkSession | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dayOffType, setDayOffType] = useState<
    "excluded" | "included" | null
  >(dayOff?.type ?? null);
  const [isDayOffLoading, setIsDayOffLoading] = useState(false);

  const { data: apiSessions = loaderSessions } = useDaySessions(dateKey);
  const sessions = apiSessions.map(apiToWorkSession);
  // The daily goal bar is work-only; study sessions are listed but not counted.
  const totalMs = workSessionsOnly(sessions).reduce(
    (total: number, session: WorkSession) => total + sessionDurationMs(session),
    0,
  );
  const totalHours = totalMs / 3_600_000;
  const goalHours = 8;
  const progress = Math.min(1, totalHours / goalHours);

  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  const confirm = useConfirm();
  const addDayOff = useAddDayOff();
  const removeDayOff = useRemoveDayOff();

  const dateObj = new Date(`${dateKey}T00:00:00`);
  const dateLabel = dateObj.toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const handleAddManual = ({
    date,
    start,
    end,
    note,
  }: {
    date: string;
    start: string;
    end: string;
    note: string;
  }) => {
    createSession.mutate({
      start: new Date(`${date}T${start}`).toISOString(),
      end: new Date(`${date}T${end}`).toISOString(),
      note,
    });

    setManualOpen(false);
  };

  const handleEditSession = (session: WorkSession) => {
    setEditSession(session);
    setEditOpen(true);
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

  const handleDayOffChange = (type: "excluded" | "included") => {
    setIsDayOffLoading(true);

    addDayOff.mutate(
      { date: dateKey, type },
      {
        onSuccess: () => {
          setDayOffType(type);
          setIsDayOffLoading(false);
        },
        onError: () => {
          setIsDayOffLoading(false);
        },
      },
    );
  };

  const handleDayOffRemove = () => {
    setIsDayOffLoading(true);

    removeDayOff.mutate(dateKey, {
      onSuccess: () => {
        setDayOffType(null);
        setIsDayOffLoading(false);
      },
      onError: () => {
        setIsDayOffLoading(false);
      },
    });
  };

  return (
    <div className="min-h-screen bg-void grid-bg font-display text-ink">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between animate-rise">
          <Link
            to="/"
            className="flex items-center gap-2 font-mono text-sm text-mut transition hover:text-neon"
            onClick={(event) => {
              event.preventDefault();
              window.history.back();
            }}
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back
          </Link>

          <div className="flex items-center gap-3">
            <div className="font-mono text-[11px] tracking-[0.2em] text-mut">
              {dateLabel}
            </div>

            <div className="h-2 w-32 overflow-hidden rounded-full bg-line ring-1 ring-line">
              <div
                className="h-full bg-neon transition-all duration-500 ease-out"
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            <div className="font-mono text-sm tabular-nums text-neon">
              {totalHours.toFixed(1)}h / {goalHours}h
            </div>
          </div>
        </header>

        {dayOffType && (
          <div
            className="mb-6 flex items-center justify-between gap-4 rounded-lg bg-panel/50 p-4 ring-1 ring-line animate-rise"
            style={{ animationDelay: "60ms" }}
          >
            <div className="flex items-center gap-3">
              <CalendarOffIcon className="h-5 w-5 text-mut" />

              <div>
                <div className="font-mono text-sm text-ink">Day off</div>
                <div className="font-mono text-xs text-mut">
                  {dayOffType === "excluded"
                    ? "Hours excluded from daily target"
                    : "Hours still count toward daily target"}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <select
                value={dayOffType}
                onChange={(event) =>
                  handleDayOffChange(
                    event.target.value as "excluded" | "included",
                  )
                }
                disabled={isDayOffLoading}
                className="cursor-pointer rounded-lg bg-void px-3 py-2 font-mono text-sm text-ink outline-none ring-1 ring-line transition focus:ring-neon/60"
              >
                <option value="excluded">⊘ Exclude hours</option>
                <option value="included">⏸ Include hours</option>
              </select>

              <Button
                variant="ghost"
                size="icon"
                onClick={handleDayOffRemove}
                disabled={isDayOffLoading}
                aria-label="Remove day off"
              >
                <Trash2Icon className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        )}

        {!dayOffType && (
          <Button
            variant="outline"
            className="mb-6 w-full animate-rise"
            onClick={() => handleDayOffChange("excluded")}
            disabled={isDayOffLoading}
            style={{ animationDelay: "60ms" }}
          >
            <CalendarOffIcon className="mr-2 h-4 w-4" />
            Mark as day off
          </Button>
        )}

        <section
          className="rounded-xl bg-panel ring-1 ring-line animate-rise"
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex items-center justify-between border-b border-line p-5">
            <div className="font-mono text-[11px] tracking-[0.2em] text-mut">
              SESSIONS
            </div>

            <Button
              size="sm"
              onClick={() => setManualOpen(true)}
              className="gap-1"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add session
            </Button>
          </div>

          <div className="divide-y divide-line">
            {sessions.length === 0 ? (
              <div className="py-12 text-center">
                <div className="font-mono text-sm text-mut">
                  No sessions yet
                </div>

                <Button
                  className="mt-4"
                  onClick={() => setManualOpen(true)}
                >
                  <PlusIcon className="mr-2 h-4 w-4" />
                  Add your first session
                </Button>
              </div>
            ) : (
              sessions.map((session: WorkSession) => {
                const durationMs = sessionDurationMs(session);
                const running = !session.end;
                const expanded = expandedId === session.id;

                return (
                  <div key={session.id} className="group">
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <div className="font-mono text-sm text-ink">
                            {formatTime(session.start)} –{" "}
                            {session.end ? formatTime(session.end) : "now"}

                            {running && session.pausedAt && (
                              <span className="ml-2 text-[10px] text-mut">
                                (paused)
                              </span>
                            )}

                            {running && !session.pausedAt && (
                              <span
                                className={`ml-2 flex items-center gap-1 text-[10px] animate-pulse ${
                                  session.type === "study" ? "text-amber-300" : "text-neon"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    session.type === "study" ? "bg-amber-300" : "bg-neon"
                                  }`}
                                />
                                Live
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mt-1 font-mono text-[10px] text-mut">
                          {session.type === "study" && (
                            <span
                              className="mr-1 rounded bg-amber-300/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber-300"
                              title="Study session — blocks your work window, never counts toward work goals"
                            >
                              study
                            </span>
                          )}
                          {session.note || (running ? "active" : "—")}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <div className="font-mono text-sm tabular-nums text-neon">
                          {formatHM(durationMs)}
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditSession(session)}
                          disabled={running}
                          aria-label="Edit session"
                          className="text-mut opacity-0 transition group-hover:opacity-100 hover:text-neon"
                        >
                          <EditIcon className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteSession(session.id)}
                          disabled={running}
                          aria-label="Delete session"
                          className="text-mut opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setExpandedId(expanded ? null : session.id)
                          }
                          aria-label="Toggle segment breakdown"
                          aria-expanded={expanded}
                          className="text-mut hover:text-neon"
                        >
                          <ChevronDownIcon
                            className={`h-4 w-4 transition-transform ${
                              expanded ? "rotate-180" : ""
                            }`}
                          />
                        </Button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="px-5 pb-4">
                        <SegmentBreakdown session={session} now={Date.now()} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <ManualEntryDialog
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onAdd={handleAddManual}
        initialDate={dateKey}
      />

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
