import { useEffect, useState } from "react";
import { Briefcase, Eye, EyeOff, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import {
  connectGoogleAccount,
  relativeTime,
  useDisconnectAccount,
  useSaveCalendarSettings,
  WEEKDAY_LABELS,
  type CalendarAccount,
  type CalendarSettings,
  type DayBudget,
} from "@/lib/calendar";
import { formatHM } from "@/lib/tracker";

export function BudgetCard({ budget }: { budget: DayBudget }) {
  const done = budget.trackedMs + budget.workEventsDoneMs;
  const pct = (v: number) => `${Math.min(100, budget.goalMs > 0 ? (v / budget.goalMs) * 100 : 0)}%`;
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Today&apos;s budget</div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-line">
        <div className="bg-neon" style={{ width: pct(done) }} />
        <div className="bg-l2" style={{ width: pct(budget.plannedMs) }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 font-mono text-xs">
        <dt className="text-mut">Timer + events</dt>
        <dd className="text-right text-ink">{formatHM(done)}</dd>
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
        {!budget.isWorkDay
          ? "Today is not a working day."
          : budget.remainingMs === 0
            ? "Your hours are covered for today."
            : budget.overbooked
              ? `Not enough free time: you are ${formatHM(budget.remainingMs - budget.freeLeftMs)} short before your day ends.`
              : "Green dashed gaps on the calendar show where your remaining hours fit."}
      </p>
    </div>
  );
}

export function AccountsCard({
  accounts,
  hidden,
  syncing,
  onToggleVisibility,
  onToggleDefaultWork,
  onSync,
  onPurge,
  onRestoreHidden,
}: {
  accounts: CalendarAccount[];
  hidden: Set<number>;
  syncing: boolean;
  onToggleVisibility: (id: number) => void;
  onToggleDefaultWork: (id: number, defaultWork: boolean) => void;
  onSync: () => void;
  onPurge: (id: number) => void;
  onRestoreHidden: (id: number) => void;
}) {
  const disconnect = useDisconnectAccount();
  const confirm = useConfirm();
  const hasConnected = accounts.some((a) => !a.disconnected);

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Calendars</div>
        {accounts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={syncing || !hasConnected}
            onClick={onSync}
            title="Fetch the latest events from Google"
          >
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", syncing && "animate-spin")} />
            <span className="font-mono text-[10px] uppercase tracking-wider">{syncing ? "syncing" : "sync"}</span>
          </Button>
        )}
      </div>
      <ul className="mt-3 space-y-3">
        {accounts.length === 0 && <li className="text-xs text-mut">No Google account connected yet.</li>}
        {accounts.map((a) => (
          <li key={a.id} className="group flex items-start gap-2 text-sm text-ink">
            <button
              type="button"
              onClick={() => onToggleVisibility(a.id)}
              disabled={a.disconnected}
              title={a.disconnected ? "Disconnected" : hidden.has(a.id) ? "Show this calendar" : "Hide this calendar"}
              className="mt-0.5 text-mut hover:text-ink disabled:opacity-40"
            >
              {hidden.has(a.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <span
              className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", (hidden.has(a.id) || a.disconnected) && "opacity-30")}
              style={{ background: a.color }}
            />
            <span className="flex-1 overflow-hidden">
              <span className={cn("block truncate", (hidden.has(a.id) || a.disconnected) && "text-mut")}>{a.email}</span>
              <span className="block font-mono text-[10px] text-mut">
                {a.disconnected
                  ? "disconnected · saved events kept"
                  : a.lastSyncedAt
                    ? `synced ${relativeTime(a.lastSyncedAt)}`
                    : "never synced"}
              </span>
              {(a.hiddenCount ?? 0) > 0 && (
                <span className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-mut">
                  {a.hiddenCount} deleted for good
                  <button
                    type="button"
                    className="underline decoration-dotted hover:text-neon"
                    title="Let the next sync load these events again"
                    onClick={() => onRestoreHidden(a.id)}
                  >
                    restore
                  </button>
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={a.disconnected}
              title={
                a.defaultWork
                  ? "Every event from this mailbox counts as work by default — click to stop"
                  : "Count every event from this mailbox as work by default"
              }
              onClick={() => onToggleDefaultWork(a.id, !a.defaultWork)}
              className={cn(
                "mt-0.5 shrink-0 disabled:opacity-30",
                a.defaultWork ? "text-neon" : "text-mut hover:text-ink",
              )}
            >
              <Briefcase className="h-4 w-4" />
            </button>
            {a.disconnected ? (
              <button
                className="mt-0.5 text-mut hover:text-destructive"
                title="Remove saved events"
                onClick={async () => {
                  const confirmed = await confirm({
                    title: "Remove saved events?",
                    description: `Remove all saved events for ${a.email}. This cannot be undone.`,
                    confirmLabel: "Remove",
                    destructive: true,
                  });
                  if (confirmed) onPurge(a.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : (
              <button
                className="mt-0.5 hidden text-mut hover:text-destructive group-hover:block"
                title="Disconnect"
                onClick={async () => {
                  const confirmed = await confirm({
                    title: "Disconnect account?",
                    description: `Disconnect ${a.email}? Its saved events stay on the calendar.`,
                    confirmLabel: "Disconnect",
                  });
                  if (confirmed) disconnect.mutate(a.id);
                }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void connectGoogleAccount()}>
        <Plus className="mr-1 h-4 w-4" /> Add Google account
      </Button>
    </div>
  );
}

export function Legend() {
  const items: { label: string; className: string }[] = [
    { label: "Work event", className: "bg-l2 ring-1 ring-neon" },
    { label: "Tracked session", className: "bg-neon/10 border-l-2 border-neon/70" },
    { label: "Planned block", className: "bg-l1 border border-neon" },
    { label: "Free gap for work", className: "border border-dashed border-neon/60" },
    { label: "Non-work / day off", className: "bg-line" },
  ];
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Legend</div>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2 font-mono text-[10px] text-mut">
            <span className={cn("h-3 w-4 rounded-sm", i.className)} />
            {i.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SettingsCard({ settings }: { settings: CalendarSettings }) {
  const save = useSaveCalendarSettings();
  const [start, setStart] = useState(settings.workStart);
  const [end, setEnd] = useState(settings.workEnd);
  const [keywords, setKeywords] = useState(settings.workKeywords.join(", "));
  const [workDays, setWorkDays] = useState<number[]>(settings.workDays);

  useEffect(() => {
    setStart(settings.workStart);
    setEnd(settings.workEnd);
    setKeywords(settings.workKeywords.join(", "));
    setWorkDays(settings.workDays);
  }, [settings]);

  const invalid = end <= start;

  const toggleDay = (day: number) =>
    setWorkDays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()));

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

      <div className="mt-4 font-mono text-[11px] uppercase tracking-widest text-mut">Working days</div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label, day) => {
          const active = workDays.includes(day);
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggleDay(day)}
              className={cn(
                "rounded border py-1 font-mono text-[11px] transition",
                active ? "border-neon bg-neon/15 text-neon" : "border-line text-mut hover:text-ink",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <label className="mt-4 block font-mono text-[11px] uppercase tracking-widest text-mut">Auto-work keywords</label>
      <input
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        className="mt-2 w-full rounded border border-line bg-void px-2 py-1 text-sm text-ink"
        placeholder="standup, client, sprint"
      />

      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        disabled={invalid}
        onClick={() => void save.mutateAsync({ workStart: start, workEnd: end, workKeywords: keywords.split(",").map((k) => k.trim()).filter(Boolean), workDays })}
      >
        Save working hours
      </Button>
      {invalid && <p className="mt-2 text-[11px] text-destructive">End time must be after start time.</p>}
    </div>
  );
}
