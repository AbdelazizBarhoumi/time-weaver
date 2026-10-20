import { useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDownIcon,
  CircleDashed,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatHM, type WorkSession } from "@/lib/tracker";
import {
  dueInputToIso,
  isWorkTaskOverdue,
  isoToDueInput,
  sortWorkTasks,
  workTaskRemainingMs,
  workTaskStatus,
  workTaskTrackedMs,
  useCreateWorkTask,
  useStartWorkTask,
  useUpdateWorkTask,
  type WorkTask,
  type WorkTaskStatus,
} from "@/lib/workTasks";

const MIN_ESTIMATE_MINUTES = 5;
const MAX_ESTIMATE_MINUTES = 1440;

const STATUS_META: Record<WorkTaskStatus, { label: string; className: string }> = {
  active: { label: "tracking", className: "bg-neon/10 text-neon" },
  in_progress: { label: "in progress", className: "bg-amber-300/10 text-amber-300" },
  todo: { label: "to do", className: "bg-line/60 text-mut" },
  done: { label: "done", className: "bg-l3/10 text-l3" },
};

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(MAX_ESTIMATE_MINUTES, Math.max(MIN_ESTIMATE_MINUTES, Math.round(value)));
}

/** "Today", "Tomorrow", else a short date — for a task's deadline. */
function dueLabel(iso: string, now: number): string {
  const due = new Date(iso);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (key(due) === key(today)) return "due today";
  if (key(due) === key(tomorrow)) return "due tomorrow";
  return `due ${due.toLocaleDateString("en-US", { day: "numeric", month: "short" })}`;
}

interface Props {
  tasks: WorkTask[];
  /** Today's/loaded sessions — the source of each task's live tracked time. */
  sessions: WorkSession[];
  now: number;
  /** The task the running timer is bound to, if any. */
  activeTaskId: number | null;
  /** Begin the work timer bound to this task. */
  onStartTask: (task: WorkTask) => void;
  /** Deleting asks for confirmation, which the page owns. */
  onDelete: (task: WorkTask) => void;
}

export function TaskPanel({ tasks, sessions, now, activeTaskId, onStartTask, onDelete }: Props) {
  const [draft, setDraft] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [due, setDue] = useState("");
  const [showDone, setShowDone] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMinutes, setEditMinutes] = useState(30);
  const [editDue, setEditDue] = useState("");

  const create = useCreateWorkTask();
  const update = useUpdateWorkTask();
  const start = useStartWorkTask();

  const ordered = sortWorkTasks(tasks, sessions, now);
  const open = ordered.filter((task) => workTaskStatus(task, sessions, now) !== "done");
  const completed = ordered.filter((task) => workTaskStatus(task, sessions, now) === "done");

  const add = () => {
    const title = draft.trim();
    if (title === "") return;

    create.mutate(
      { title, estimateMinutes: clampMinutes(minutes), dueAt: dueInputToIso(due) },
      {
        onSuccess: () => {
          setDraft("");
          setDue("");
          toast.success(`Added "${title}"`);
        },
        onError: () => toast.error("Could not add that task."),
      },
    );
  };

  const setCompleted = (task: WorkTask, completedNow: boolean) => {
    update.mutate(
      { id: task.id, patch: { completed: completedNow } },
      {
        onSuccess: () => toast.success(completedNow ? `Done: ${task.title}` : `Reopened: ${task.title}`),
        onError: () => toast.error("Could not update that task."),
      },
    );
  };

  const beginEdit = (task: WorkTask) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditMinutes(task.estimateMinutes);
    setEditDue(isoToDueInput(task.dueAt));
  };

  const saveEdit = (task: WorkTask) => {
    const title = editTitle.trim();
    if (title === "") return;

    update.mutate(
      { id: task.id, patch: { title, estimateMinutes: clampMinutes(editMinutes), dueAt: dueInputToIso(editDue) } },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.success("Task updated");
        },
        onError: () => toast.error("Could not update that task."),
      },
    );
  };

  const startTask = (task: WorkTask) => {
    // Mark it begun even if the timer cannot start (a session is already running).
    start.mutate(task.id);
    onStartTask(task);
  };

  const renderRow = (task: WorkTask) => {
    const status = workTaskStatus(task, sessions, now);
    const tracked = workTaskTrackedMs(task, sessions, now);
    const estimateMs = task.estimateMinutes * 60_000;
    const remaining = workTaskRemainingMs(task, sessions, now);
    const overdue = isWorkTaskOverdue(task, now);
    const done = status === "done";
    const over = !done && remaining < 0;
    const pct = Math.min(100, estimateMs === 0 ? 0 : (tracked / estimateMs) * 100);
    const editing = editingId === task.id;
    const tracking = activeTaskId === task.id && status === "active";

    return (
      <li
        key={task.id}
        className={cn(
          "group rounded border px-2.5 py-2",
          tracking ? "border-neon/50 bg-neon/5" : "border-line bg-void/40",
        )}
      >
        {editing ? (
          <div className="space-y-1.5">
            <input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveEdit(task);
                if (event.key === "Escape") setEditingId(null);
              }}
              aria-label="Edit task title"
              className="w-full rounded border border-line bg-void px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-mut">
                <input
                  type="number"
                  min={MIN_ESTIMATE_MINUTES}
                  max={MAX_ESTIMATE_MINUTES}
                  step={5}
                  value={editMinutes}
                  onChange={(event) => setEditMinutes(clampMinutes(Number(event.target.value)))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveEdit(task);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                  aria-label="Edit estimated minutes"
                  className="w-16 rounded border border-line bg-void px-1.5 py-0.5 text-right font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                est
              </label>
              <input
                type="date"
                value={editDue}
                onChange={(event) => setEditDue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveEdit(task);
                  if (event.key === "Escape") setEditingId(null);
                }}
                aria-label="Edit due date"
                className="rounded border border-line bg-void px-1.5 py-0.5 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={() => saveEdit(task)}
                disabled={update.isPending || editTitle.trim() === ""}
                title="Save changes"
              >
                <Check className="mr-1 h-3 w-3" />
                <span className="font-mono text-[10px] uppercase tracking-wider">save</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-mut"
                onClick={() => setEditingId(null)}
                title="Cancel editing"
              >
                <span className="font-mono text-[10px] uppercase tracking-wider">cancel</span>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setCompleted(task, !done)}
                aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                title={done ? "Reopen — the record is kept either way" : "Mark done"}
                className={cn(
                  "mt-0.5 shrink-0 transition-colors",
                  done ? "text-l3" : "text-mut hover:text-neon",
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn("truncate text-sm", done ? "text-mut line-through" : "text-ink")}>
                    {task.title}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                      STATUS_META[status].className,
                    )}
                  >
                    {STATUS_META[status].label}
                  </span>
                  {overdue && (
                    <span className="shrink-0 rounded bg-destructive/10 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-destructive">
                      overdue
                    </span>
                  )}
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500", over ? "bg-amber-400" : "bg-neon")}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
                  <span className="text-mut">
                    <span className={done ? "text-mut" : "text-neon"}>{formatHM(tracked)}</span>
                    {" / "}
                    {formatHM(estimateMs)}
                  </span>
                  <span className={cn(over ? "text-amber-400" : "text-mut")}>
                    {over && !done ? `+${formatHM(-remaining)} over` : task.dueAt ? dueLabel(task.dueAt, now) : `${formatHM(Math.max(0, remaining))} left`}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-1.5 flex items-center gap-2 pl-6">
              {tracking ? (
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-neon">
                  <span className="size-1.5 animate-rec rounded-full bg-neon" />
                  timer running
                </span>
              ) : done ? (
                <button
                  type="button"
                  onClick={() => setCompleted(task, false)}
                  className="font-mono text-[10px] uppercase tracking-wider text-mut transition-colors hover:text-neon"
                >
                  reopen
                </button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => startTask(task)}
                  disabled={start.isPending}
                  title={activeTaskId !== null ? "Another session is already running" : "Start the timer on this task"}
                >
                  <Play className="mr-1 h-3 w-3" />
                  <span className="font-mono text-[10px] uppercase tracking-wider">start</span>
                </Button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => beginEdit(task)}
                  aria-label={`Edit ${task.title}`}
                  title="Edit title, estimate and deadline"
                  className="text-mut opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  aria-label={`Delete ${task.title}`}
                  title="Delete permanently"
                  className="text-mut opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </li>
    );
  };

  return (
    <section
      className="col-span-12 rounded-xl bg-panel p-6 ring-1 ring-line animate-rise lg:col-span-4"
      style={{ animationDelay: "140ms" }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] tracking-[0.2em] text-mut">WORK TASKS</div>
        {open.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-mut">
            {open.length} open
          </span>
        )}
      </div>

      {open.length === 0 && completed.length === 0 ? (
        <p className="mt-3 text-xs text-mut">
          No work tasks yet. Add one below, then hit start to log real time against it.
        </p>
      ) : (
        <>
          {open.length > 0 && <ul className="mt-3 space-y-2">{open.map(renderRow)}</ul>}

          {completed.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setShowDone((value) => !value)}
                aria-expanded={showDone}
                className="flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-widest text-mut transition-colors hover:text-ink"
              >
                <span>completed · {completed.length}</span>
                <ChevronDownIcon className={cn("h-3.5 w-3.5 transition-transform", showDone && "rotate-180")} />
              </button>
              {showDone && <ul className="mt-2 space-y-2 opacity-80">{completed.map(renderRow)}</ul>}
            </div>
          )}
        </>
      )}

      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            placeholder="Add a work task…"
            aria-label="New work task"
            className="min-w-0 flex-1 rounded border border-line bg-void px-2 py-1 text-sm text-ink placeholder:text-mut focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={add}
            disabled={create.isPending || draft.trim() === ""}
            title="Add the task"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            <span className="font-mono text-[10px] uppercase tracking-wider">add</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-mut">
            <input
              type="number"
              min={MIN_ESTIMATE_MINUTES}
              max={MAX_ESTIMATE_MINUTES}
              step={5}
              value={minutes}
              onChange={(event) => setMinutes(clampMinutes(Number(event.target.value)))}
              aria-label="Estimated minutes"
              className="w-16 rounded border border-line bg-void px-1.5 py-0.5 text-right font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            est
          </label>
          <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-mut">
            <input
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              aria-label="Due date"
              className="rounded border border-line bg-void px-1.5 py-0.5 font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            due
          </label>
        </div>
      </div>
    </section>
  );
}
