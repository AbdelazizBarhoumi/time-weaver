import { useState } from "react";
import { dayKey } from "@/lib/tracker";
import { DateTimePicker } from "@/components/ui/datetime-picker";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (entry: { date: string; start: string; end: string; note: string }) => void;
}

export function ManualEntryDialog({ open, onClose, onAdd }: Props) {
  const [date, setDate] = useState(dayKey(new Date()));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  // The picker gives us "HH:MM - HH:MM"
  const handleTimeRange = (v: string) => {
    const [s, e] = v.split(" - ");
    if (s && e) {
      setStart(s);
      setEnd(e);
      setError("");
    }
  };

  const submit = () => {
    const s = new Date(`${date}T${start}`);
    const e = new Date(`${date}T${end}`);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
      setError("End time must be after start time (same day).");
      return;
    }
    onAdd({ date, start, end, note });
    setNote("");
    setError("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl bg-panel p-6 ring-1 ring-line animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[11px] tracking-[0.2em] text-mut">MANUAL ENTRY</div>
        <div className="mt-1 text-lg font-semibold text-ink">Log a past session</div>

        <div className="mt-5 space-y-4">
          <DateTimePicker
            label="DATE"
            value={date}
            onChange={setDate}
            placeholder={dayKey(new Date())}
            min="2020-01-01"
            max={dayKey(new Date())}
          />
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
          {error && <div className="font-mono text-xs text-destructive">{error}</div>}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={submit}
            className="flex-1 rounded-lg bg-neon px-4 py-2 text-sm font-semibold text-void ring-1 ring-neon/40 transition hover:brightness-110"
          >
            Add session
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-panel px-4 py-2 text-sm font-medium text-mut ring-1 ring-line transition hover:ring-neon/40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}