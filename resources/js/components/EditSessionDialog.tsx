import { useState, useEffect, useRef } from "react";
import {
  formatHM,
  dayKey,
  insertSplitSegment,
  prepareSegments,
  segmentDurationMs,
  validateSegments,
  type Segment,
  type WorkSession,
} from "@/lib/tracker";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { useUpdateSession } from "@/lib/queries";

interface Props {
  open: boolean;
  session: WorkSession | null;
  onClose: () => void;
  onSuccess: () => void;
}

function toHm(isoStr: string): string {
  return new Date(isoStr).toTimeString().slice(0, 5);
}

export function EditSessionDialog({ open, session, onClose, onSuccess }: Props) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const initialEndRef = useRef("");

  const updateSession = useUpdateSession();

  useEffect(() => {
    if (session) {
      const startDate = new Date(session.start);
      const endDate = session.end ? new Date(session.end) : new Date();
      const nextEnd = endDate.toTimeString().slice(0, 5);
      setDate(dayKey(startDate));
      setStart(startDate.toTimeString().slice(0, 5));
      setEnd(nextEnd);
      setNote(session.note);
      setSegments(session.segments.map((seg) => ({ ...seg })));
      initialEndRef.current = nextEnd;
      setError("");
    }
  }, [session]);

  if (!open || !session) return null;

  const isActiveSession = session.end === null;
  const endTouched = isActiveSession && end !== initialEndRef.current;
  const willComplete = !isActiveSession || endTouched;

  const handleTimeRange = (v: string) => {
    const [s, e] = v.split(" - ");
    if (s && e) {
      setStart(s);
      setEnd(e);
      setError("");
    }
  };

  const setSegmentField = (index: number, field: "start" | "end", hhmm: string) => {
    if (!hhmm) return;
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === index ? { ...seg, [field]: new Date(`${date}T${hhmm}`).toISOString() } : seg,
      ),
    );
    setError("");
  };

  const toggleSegmentType = (index: number) => {
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === index ? { ...seg, type: seg.type === "work" ? "pause" : "work" } : seg,
      ),
    );
    setError("");
  };

  const removeSegment = (index: number) => {
    setSegments((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const addSegment = (type: Segment["type"]) => {
    const next = insertSplitSegment(segments, type, Date.now());
    if (next) {
      setSegments(next);
      setError("");
    }
  };

  const canSplit = (type: Segment["type"]) =>
    insertSplitSegment(segments, type, Date.now()) !== null;

  const submit = () => {
    const s = new Date(`${date}T${start}`);
    const e = new Date(`${date}T${end}`);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
      setError("End time must be after start time (same day).");
      return;
    }

    const boundMs = willComplete ? e.getTime() : Date.now();
    const prepared = prepareSegments(segments, s.getTime(), boundMs, willComplete);
    const segmentsError = validateSegments(prepared);
    if (segmentsError) {
      setError(segmentsError);
      return;
    }

    setIsSubmitting(true);
    updateSession.mutate(
      {
        id: Number(session.id),
        data: {
          start: s.toISOString(),
          note,
          segments: prepared,
          ...(willComplete ? { end: new Date(boundMs).toISOString() } : {}),
        },
      },
      {
        onSuccess: () => {
          setIsSubmitting(false);
          onSuccess();
          onClose();
        },
        onError: () => {
          setIsSubmitting(false);
          setError("Failed to update session. Please try again.");
        },
      }
    );
  };

  const displayRefMs = isActiveSession ? Date.now() : new Date(`${date}T${end}`).getTime();
  const workedMs = segments.reduce(
    (sum, seg) => (seg.type === "work" ? sum + segmentDurationMs(seg, displayRefMs) : sum),
    0,
  );
  const pausedMs = segments.reduce(
    (sum, seg) => (seg.type === "pause" ? sum + segmentDurationMs(seg, displayRefMs) : sum),
    0,
  );

  const inputClass =
    "rounded-lg bg-void px-2 py-1.5 font-mono text-xs text-ink ring-1 ring-line outline-none transition focus:ring-neon/60 [color-scheme:dark]";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-panel p-6 ring-1 ring-line animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[11px] tracking-[0.2em] text-mut">EDIT SESSION</div>
        <div className="mt-1 text-lg font-semibold text-ink">Modify session details</div>

        <div className="mt-4 p-3 rounded-lg bg-void/50">
          <div className="font-mono text-[10px] tracking-[0.15em] text-mut">DATE (FIXED)</div>
          <div className="mt-1 font-mono text-sm text-ink">{date}</div>
          <div className="mt-1 font-mono text-[10px] tracking-[0.15em] text-mut">DURATION</div>
          <div className="mt-1 flex items-center gap-3 font-mono text-sm">
            <span className="text-neon">{formatHM(workedMs)} worked</span>
            <span className="text-mut">{formatHM(pausedMs)} paused</span>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <DateTimePicker
            label="START – END"
            type="timerange"
            value={`${start} - ${end}`}
            onChange={handleTimeRange}
            step={0.25}
          />
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] tracking-[0.15em] text-mut">NOTE (OPTIONAL)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="deep work, calls…"
              className="w-full rounded-lg bg-void px-3 py-2 font-mono text-sm text-ink ring-1 ring-line outline-none transition focus:ring-neon/60 [color-scheme:dark]"
            />
          </label>

          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.15em] text-mut">SEGMENTS</span>
              <div className="flex gap-1">
                <button
                  onClick={() => addSegment("work")}
                  disabled={!canSplit("work")}
                  className="rounded bg-void px-2 py-1 font-mono text-[9px] tracking-wider text-neon ring-1 ring-neon/40 transition hover:bg-neon/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  + WORK
                </button>
                <button
                  onClick={() => addSegment("pause")}
                  disabled={!canSplit("pause")}
                  className="rounded bg-void px-2 py-1 font-mono text-[9px] tracking-wider text-mut ring-1 ring-line transition hover:ring-neon/40 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  + PAUSE
                </button>
              </div>
            </div>

            <div className="mt-2 space-y-1.5">
              {segments.map((seg, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <button
                    onClick={() => toggleSegmentType(index)}
                    title="Toggle work/pause"
                    className={`w-12 shrink-0 rounded px-1 py-1.5 font-mono text-[9px] tracking-wider ring-1 transition ${
                      seg.type === "work"
                        ? "bg-neon/10 text-neon ring-neon/40"
                        : "bg-void text-mut ring-line"
                    }`}
                  >
                    {seg.type === "work" ? "WORK" : "PAUSE"}
                  </button>
                  <input
                    type="time"
                    step={60}
                    value={toHm(seg.start)}
                    onChange={(e) => setSegmentField(index, "start", e.target.value)}
                    aria-label={`Segment ${index + 1} start`}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-mut">–</span>
                  {seg.end ? (
                    <input
                      type="time"
                      step={60}
                      value={toHm(seg.end)}
                      onChange={(e) => setSegmentField(index, "end", e.target.value)}
                      aria-label={`Segment ${index + 1} end`}
                      className={inputClass}
                    />
                  ) : (
                    <span className="rounded-lg bg-void px-2 py-1.5 font-mono text-xs text-mut ring-1 ring-line">
                      now
                    </span>
                  )}
                  <button
                    onClick={() => removeSegment(index)}
                    disabled={segments.length <= 1}
                    aria-label="Remove segment"
                    className="ml-auto font-mono text-xs text-mut transition hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="font-mono text-xs text-destructive">{error}</div>}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={submit}
            disabled={isSubmitting}
            className="flex-1 rounded-lg bg-neon px-4 py-2 text-sm font-semibold text-void ring-1 ring-neon/40 transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg bg-panel px-4 py-2 text-sm font-medium text-mut ring-1 ring-line transition hover:ring-neon/40 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
