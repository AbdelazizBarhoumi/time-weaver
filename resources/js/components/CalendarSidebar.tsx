import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  connectGoogleAccount,
  useDisconnectAccount,
  useSaveCalendarSettings,
  type CalendarAccount,
  type CalendarSettings,
  type DayBudget,
} from "@/lib/calendar";
import { formatHM } from "@/lib/tracker";

export function BudgetCard({ budget }: { budget: DayBudget }) {
  const done = budget.trackedMs + budget.workEventsDoneMs;
  const pct = (v: number) => `${Math.min(100, (v / budget.goalMs) * 100)}%`;
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Today's budget</div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line">
        <div className="bg-neon" style={{ width: pct(done) }} />
        <div className="bg-l2" style={{ width: pct(budget.plannedMs) }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 font-mono text-xs">
        <dt className="text-mut">Timer</dt>
        <dd className="text-right text-ink">{formatHM(budget.trackedMs)}</dd>
        <dt className="text-mut">Work events done</dt>
        <dd className="text-right text-ink">{formatHM(budget.workEventsDoneMs)}</dd>
        <dt className="text-mut">Planned ahead</dt>
        <dd className="text-right text-l3">{formatHM(budget.plannedMs)}</dd>
        <dt className="text-mut">Still to place</dt>
        <dd className="text-right text-neon">{formatHM(budget.remainingMs)}</dd>
        <dt className="text-mut">Free time left</dt>
        <dd className="text-right text-ink">{formatHM(budget.freeLeftMs)}</dd>
      </dl>
      <p className="mt-3 text-xs text-mut">
        {budget.remainingMs === 0
          ? "Your 8 hours are covered for today."
          : budget.overbooked
            ? `Not enough free time: you are ${formatHM(budget.remainingMs - budget.freeLeftMs)} short before your day ends.`
            : "Green dashed gaps on the calendar show where your remaining hours fit."}
      </p>
    </div>
  );
}

export function AccountsCard({ accounts }: { accounts: CalendarAccount[] }) {
  const disconnect = useDisconnectAccount();
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Calendars</div>
      <ul className="mt-3 space-y-2">
        {accounts.length === 0 && <li className="text-xs text-mut">No Google account connected yet.</li>}
        {accounts.map((a) => (
          <li key={a.id} className="group flex items-center gap-2 text-sm text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />
            <span className="flex-1 truncate">{a.email}</span>
            <button
              className="hidden text-mut hover:text-destructive group-hover:block"
              title="Disconnect"
              onClick={() => {
                if (confirm(`Disconnect ${a.email}?`)) disconnect.mutate(a.id);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void connectGoogleAccount()}>
        <Plus className="mr-1 h-4 w-4" /> Add Google account
      </Button>
    </div>
  );
}

export function SettingsCard({ settings }: { settings: CalendarSettings }) {
  const save = useSaveCalendarSettings();
  const [start, setStart] = useState(settings.workStart);
  const [end, setEnd] = useState(settings.workEnd);
  const [keywords, setKeywords] = useState(settings.workKeywords.join(", "));

  useEffect(() => {
    setStart(settings.workStart);
    setEnd(settings.workEnd);
    setKeywords(settings.workKeywords.join(", "));
  }, [settings]);

  const invalid = end <= start;

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Working window</div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-full rounded border border-line bg-void px-2 py-1 font-mono text-sm text-ink"
        />
        <span className="text-mut">→</span>
        <input
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="w-full rounded border border-line bg-void px-2 py-1 font-mono text-sm text-ink"
        />
      </div>
      <label className="mt-4 block font-mono text-[11px] uppercase tracking-widest text-mut">
        Auto-work keywords
      </label>
      <textarea
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        rows={2}
        placeholder="standup, client, sprint"
        className="mt-1 w-full rounded border border-line bg-void px-2 py-1 text-sm text-ink"
      />
      <p className="mt-1 text-[11px] text-mut">Events whose title contains one of these count as work.</p>
      {invalid && <p className="mt-1 text-[11px] text-destructive">End must be after start.</p>}
      <Button
        size="sm"
        className="mt-3 w-full"
        disabled={invalid || save.isPending}
        onClick={() =>
          save.mutate({
            workStart: start,
            workEnd: end,
            workKeywords: keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
          })
        }
      >
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
