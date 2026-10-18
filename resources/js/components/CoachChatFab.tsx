import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  addDays,
  startOfDay,
  useCoachChat,
  useCoachStatus,
  useUpdateSideTask,
  type CoachChatMessage,
  type CoachContext,
  type CoachHorizonDay,
  type CoachPlanSuggestion,
} from "@/lib/calendar";

const FAB_SIZE = 48;
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;
const EDGE = 12;
const DRAG_THRESHOLD = 4;
const POSITION_KEY = "shiftgrid.coach.fab";
const MAX_MESSAGE_CHARS = 4000;
/** How many times one question may trigger a calendar load before we stop. */
const MAX_FETCH_ROUNDS = 2;
/** Never load further ahead than this, so a stray marker cannot pull a huge range. */
const MAX_FETCH_DAYS_AHEAD = 60;
const DAY_MS = 86_400_000;

/** Quick questions offered before the first turn. */
const SUGGESTIONS = [
  "How much free time do I have today?",
  "How long do I still need to work today?",
  "How much do I need to work this week?",
  "What should I focus on next?",
];

interface Point {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readPosition(): Point | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Point).x === "number" &&
      typeof (parsed as Point).y === "number"
    ) {
      return { x: (parsed as Point).x, y: (parsed as Point).y };
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

function storePosition(point: Point): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(point));
  } catch {
    /* storage unavailable */
  }
}

function defaultPosition(): Point {
  return { x: 24, y: Math.max(EDGE, window.innerHeight - FAB_SIZE - 24) };
}

/** Extract a friendly message from an axios-ish error. */
function errorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { message?: string } } }).response;
  return response?.data?.message ?? "The AI coach could not be reached.";
}

/** Parse a "YYYY-MM-DD" day marker into a local midnight Date, or null if malformed. */
function parseDayKey(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** The "YYYY-MM-DD" key for a local date. */
function dayKeyOf(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/**
 * The row the coach claimed it was missing, spelled back at it. Used when it asks
 * to load a day the snapshot already holds: the answer is right there, so we hand
 * it the row instead of firing a pointless round trip that can time out.
 */
function dayGuidance(row: CoachHorizonDay): string {
  return (
    `The snapshot already contains ${row.dayKey} (${row.weekday}): ` +
    `windowStart ${row.windowStart ?? "none"}, windowEnd ${row.windowEnd ?? "none"}, ` +
    `isRequired ${row.isRequired}, busyHours ${row.busyHours}, freeHours ${row.freeHours}, ` +
    `dataCovered ${row.dataCovered}. Answer the user's question from this row and do not ask to load it again.`
  );
}

export function CoachChatFab({
  context,
  onFetchRange,
}: {
  context: CoachContext;
  /** Load a range the coach asked for; resolves once it is in the snapshot. */
  onFetchRange?: (from: Date, to: Date) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  }));
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Slots the coach proposed for side tasks in its latest reply. */
  const [suggestions, setSuggestions] = useState<CoachPlanSuggestion[]>([]);
  /**
   * A turn waiting to be re-asked: either while a range loads, or while we hand
   * the coach back a day the snapshot already had. `request` may carry guidance
   * the user never sees, while `visible` is what the next reply replaces.
   */
  const [pendingRetry, setPendingRetry] = useState<{
    request: CoachChatMessage[];
    visible: CoachChatMessage[];
    rounds: number;
    /** The instant the loaded range must reach first; null to retry immediately. */
    needToMs: number | null;
  } | null>(null);
  const [loadingRange, setLoadingRange] = useState(false);

  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const chat = useCoachChat();
  const status = useCoachStatus();
  const updateTask = useUpdateSideTask();
  const available = status.data?.available !== false;

  // Restore the dragged position (or place it bottom-left) once on the client.
  useEffect(() => {
    setPosition(readPosition() ?? defaultPosition());
  }, []);

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      setPosition((p) =>
        p
          ? {
              x: clamp(p.x, EDGE, window.innerWidth - FAB_SIZE - EDGE),
              y: clamp(p.y, EDGE, window.innerHeight - FAB_SIZE - EDGE),
            }
          : p,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, chat.isPending, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;

    if (!state.moved && Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < DRAG_THRESHOLD) {
      return;
    }
    state.moved = true;

    setPosition({
      x: clamp(e.clientX - state.dx, EDGE, window.innerWidth - FAB_SIZE - EDGE),
      y: clamp(e.clientY - state.dy, EDGE, window.innerHeight - FAB_SIZE - EDGE),
    });
  };

  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;

    // A real drag suppresses the click that follows; a tap lets it through.
    suppressClick.current = state.moved;
    setPosition((p) => {
      if (p) storePosition(p);
      return p;
    });
  };

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setOpen((v) => !v);
  };

  /**
   * Send one turn. When the coach says it is missing a day, either load it from
   * the local cache or hand back the row the snapshot already holds, then ask
   * again. The request transcript can carry that guidance unseen by the user.
   */
  const sendTurn = async (
    request: CoachChatMessage[],
    visible: CoachChatMessage[],
    rounds: number,
  ): Promise<void> => {
    try {
      const res = await chat.mutateAsync({ messages: request, context });
      if (!res.reply) {
        setError(res.message ?? "The coach had nothing to say.");
        return;
      }

      const shown: CoachChatMessage[] = [...visible, { role: "assistant", content: res.reply }];
      setMessages(shown);
      setSuggestions(res.suggestions ?? []);

      const requested = res.fetch?.day ? parseDayKey(res.fetch.day) : null;
      if (!requested) return;

      // The coach promised to load a day; keep that promise in the transcript the
      // model sees, so the next reply reads as a continuation, not a fresh thought.
      const asked: CoachChatMessage[] = [...request, { role: "assistant", content: res.reply }];

      if (rounds >= MAX_FETCH_ROUNDS) {
        setError("I could not load that day's schedule. Try asking again.");
        return;
      }

      // Already in the snapshot? Then the answer is right there, so hand the row
      // back instead of reloading, which would just repeat the same question.
      const row = context.horizon.days.find((day) => day.dayKey === dayKeyOf(requested));
      if (row) {
        setPendingRetry({
          request: [...asked, { role: "user", content: dayGuidance(row) }],
          visible,
          rounds: rounds + 1,
          needToMs: null,
        });
        return;
      }

      // Anchor the limit to the snapshot's own clock, so the guard matches the
      // "today" the coach reasoned about.
      const todayMs = startOfDay(new Date(context.now)).getTime();
      const daysAhead = Math.round((requested.getTime() - todayMs) / DAY_MS);
      if (daysAhead < 0 || daysAhead > MAX_FETCH_DAYS_AHEAD) {
        setError("That day is too far ahead to load.");
        return;
      }

      setLoadingRange(true);
      setPendingRetry({ request: asked, visible, rounds: rounds + 1, needToMs: addDays(requested, 1).getTime() });
      onFetchRange?.(requested, addDays(requested, 1)).catch(() => {
        setPendingRetry(null);
        setLoadingRange(false);
        setError("Could not load that part of your calendar.");
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  // Keep a stable handle to the latest turn runner: the retry effect must run on
  // snapshot changes, not whenever this component re-renders.
  const sendTurnRef = useRef(sendTurn);
  useEffect(() => {
    sendTurnRef.current = sendTurn;
  });

  useEffect(() => {
    if (!pendingRetry) return;
    // A "hand back the row" retry needs nothing loaded; a range retry waits until
    // the snapshot's coverage actually reaches the day we asked for.
    if (pendingRetry.needToMs !== null) {
      if (!context.coverage) return;
      if (Date.parse(context.coverage.to) < pendingRetry.needToMs) return;
    }

    const { request, visible, rounds } = pendingRetry;
    setPendingRetry(null);
    setLoadingRange(false);
    void sendTurnRef.current(request, visible, rounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRetry, context.coverage]);

  /** A user-initiated turn: append the message and let `sendTurn` do the rest. */
  const send = (text: string) => {
    const content = text.trim();
    if (!content || chat.isPending || loadingRange) return;

    const next: CoachChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setSuggestions([]);
    setPendingRetry(null);
    void sendTurn(next, next, 0);
  };

  const titleOf = (taskId: number) => context.tasks.find((task) => task.id === taskId)?.title ?? "Task";

  /** Confirm a coach proposal: the task moves only when the user clicks Place. */
  const placeSuggestion = (suggestion: CoachPlanSuggestion) => {
    const start = new Date(suggestion.start);
    updateTask.mutate(
      { id: suggestion.taskId, patch: { start: start.toISOString() } },
      {
        onSuccess: () => {
          setSuggestions((prev) => prev.filter((item) => item !== suggestion));
          toast.success(
            `${titleOf(suggestion.taskId)} → ${start.toLocaleString("en-US", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`,
          );
        },
        onError: () => toast.error("Could not place that task."),
      },
    );
  };

  const panelStyle = useMemo(() => {
    const width = Math.min(PANEL_WIDTH, viewport.w - EDGE * 2);
    const height = Math.min(PANEL_HEIGHT, viewport.h - EDGE * 2);
    const anchor = position ?? { x: 24, y: viewport.h - FAB_SIZE - 24 };

    let left = anchor.x + FAB_SIZE + 12;
    if (left + width > viewport.w - EDGE) {
      left = anchor.x - width - 12;
    }

    return {
      left: clamp(left, EDGE, viewport.w - width - EDGE),
      top: clamp(anchor.y + FAB_SIZE - height, EDGE, viewport.h - height - EDGE),
      width,
      height,
    };
  }, [position, viewport]);

  const fabStyle = position
    ? { left: position.x, top: position.y, width: FAB_SIZE, height: FAB_SIZE }
    : { left: 24, bottom: 24, width: FAB_SIZE, height: FAB_SIZE };

  return (
    <>
      {open && (
        <div
          style={panelStyle}
          className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Sparkles className="h-3.5 w-3.5 text-neon" />
            <span className="font-mono text-[11px] uppercase tracking-widest text-mut">Coach</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-label="Clear conversation"
                title="Clear conversation"
                onClick={() => {
                  setMessages([]);
                  setError(null);
                  setSuggestions([]);
                  setPendingRetry(null);
                  setLoadingRange(false);
                }}
                disabled={messages.length === 0}
                className="rounded p-1 text-mut hover:text-ink disabled:opacity-30"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Close the coach"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-mut hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <p className="text-xs text-mut">
                Ask about your free time, what you still owe today, or this week. The coach sees your live calendar
                and hours.
              </p>
            )}

            {messages.map((message, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-xs",
                  message.role === "user"
                    ? "ml-auto bg-l3/20 text-ink"
                    : "mr-auto border border-line bg-background/40 text-ink",
                )}
              >
                {message.content}
              </div>
            ))}

            {chat.isPending && (
              <div className="mr-auto flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-mut">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}

            {loadingRange && !chat.isPending && (
              <div className="mr-auto flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-mut">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your calendar…
              </div>
            )}

            {suggestions.length > 0 && (
              <ul className="space-y-2">
                {suggestions.map((suggestion, i) => {
                  const start = new Date(suggestion.start);
                  return (
                    <li key={`${suggestion.taskId}-${i}`} className="rounded-lg border border-neon/40 bg-neon/5 p-2">
                      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-neon">
                        <CalendarClock className="h-3 w-3" />
                        {titleOf(suggestion.taskId)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-mut">
                        {start.toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      {suggestion.reason && <div className="mt-1 text-[11px] text-mut">{suggestion.reason}</div>}
                      <button
                        type="button"
                        onClick={() => placeSuggestion(suggestion)}
                        disabled={updateTask.isPending}
                        className="mt-2 flex items-center gap-1 rounded border border-neon/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-neon hover:bg-neon/10 disabled:opacity-40"
                      >
                        <Check className="h-3 w-3" /> place
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div ref={endRef} />
          </div>

          {error && <div className="px-3 pb-1 text-[11px] text-amber-400">{error}</div>}
          {!available && (
            <div className="px-3 pb-1 text-[11px] text-mut">Add a GEMINI_API_KEY to enable AI coaching.</div>
          )}

          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!available || chat.isPending}
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-mut hover:border-neon/40 hover:text-ink disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-2 border-t border-line p-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={available ? "Ask the coach…" : "Coaching is unavailable"}
              disabled={!available || chat.isPending}
              className="max-h-28 min-h-[36px] flex-1 resize-none rounded-md border border-line bg-transparent px-2 py-2 text-xs text-ink placeholder:text-mut focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon/40 disabled:opacity-50"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!available || chat.isPending || input.trim() === ""}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neon/10 text-neon ring-1 ring-neon/40 hover:bg-neon/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        aria-label={open ? "Close the AI coach" : "Open the AI coach"}
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        style={fabStyle}
        className={cn(
          "fixed z-50 flex touch-none cursor-grab items-center justify-center rounded-full border border-neon/40 bg-panel/95 text-neon shadow-lg backdrop-blur transition-colors hover:bg-neon/10 active:cursor-grabbing",
          open && "bg-neon/15",
        )}
      >
        <span className="flex items-center justify-center">
          {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
      </button>
    </>
  );
}
