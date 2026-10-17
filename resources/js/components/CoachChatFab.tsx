import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCoachChat,
  useCoachStatus,
  type CoachChatMessage,
  type CoachContext,
} from "@/lib/calendar";

const FAB_SIZE = 48;
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 480;
const EDGE = 12;
const DRAG_THRESHOLD = 4;
const POSITION_KEY = "shiftgrid.coach.fab";
const MAX_MESSAGE_CHARS = 4000;

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

export function CoachChatFab({ context }: { context: CoachContext }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  }));
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const chat = useCoachChat();
  const status = useCoachStatus();
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

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || chat.isPending) return;

    const next: CoachChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);

    try {
      const res = await chat.mutateAsync({ messages: next, context });
      if (res.reply) {
        setMessages([...next, { role: "assistant", content: res.reply }]);
      } else {
        setError(res.message ?? "The coach had nothing to say.");
      }
    } catch (err) {
      setError(errorMessage(err));
    }
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
