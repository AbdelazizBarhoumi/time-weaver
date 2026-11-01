import { useState } from "react";
import {
  CalendarClock,
  CalendarOff,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CategoryPicker } from "@/components/CategoryPicker";
import { cn } from "@/lib/utils";
import { categoryIcon, type Category } from "@/lib/categories";
import {
  SIDE_TASK_DRAG_TYPE,
  isSideTaskDone,
  isStaleSuggestion,
  sortSideTasks,
  staleSuggestionNote,
  useCoachStatus,
  useCreateSideTask,
  usePlanSideTasks,
  useUpdateSideTask,
  type CoachContext,
  type CoachPlanSuggestion,
  type SideTask,
} from "@/lib/calendar";
import { formatHM, formatTime } from "@/lib/tracker";

const MIN_ESTIMATE_MINUTES = 5;
const MAX_ESTIMATE_MINUTES = 1440;

/** "Today", "Tomorrow", else the short weekday — for a placed task's slot. */
function dayLabel(iso: string, now: number): string {
  const day = new Date(iso);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (key(day) === key(today)) return "Today";
  if (key(day) === key(tomorrow)) return "Tomorrow";
  return day.toLocaleDateString("en-US", { weekday: "short" });
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(MAX_ESTIMATE_MINUTES, Math.max(MIN_ESTIMATE_MINUTES, Math.round(value)));
}

export function TodoCard({
  tasks,
  categories,
  now,
  coachContext,
  placingId,
  onTogglePlacing,
  onDelete,
  onManageCategories,
}: {
  tasks: SideTask[];
  /** The user's categories, offered on the add form and each task. */
  categories: Category[];
  now: number;
  /** Fresh snapshot sent with an AI planning request. */
  coachContext: CoachContext;
  /** The task whose chip is armed for manual placement, if any. */
  placingId: number | null;
  /** Arm (or disarm) click-to-place for a task. */
  onTogglePlacing: (task: SideTask) => void;
  /** Deleting asks for confirmation, which the page owns. */
  onDelete: (task: SideTask) => void;
  /** Open the category manager from a picker. */
  onManageCategories?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [blocksWork, setBlocksWork] = useState(true);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<CoachPlanSuggestion[]>([]);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMinutes, setEditMinutes] = useState(30);
  const [editCategoryId, setEditCategoryId] = useState<number | null>(null);

  const coachStatus = useCoachStatus();
  const create = useCreateSideTask();
  const update = useUpdateSideTask();
  const plan = usePlanSideTasks();

  const coachAvailable = coachStatus.data?.available !== false;
  const live = sortSideTasks(tasks.filter((task) => !isSideTaskDone(task, now)));
  const unplaced = live.filter((task) => task.start === null);
  const unplacedMs = unplaced.reduce((sum, task) => sum + task.estimateMinutes * 60_000, 0);

  const add = () => {
    const title = draft.trim();
    if (title === "") return;

    create.mutate(
      { title, estimateMinutes: clampMinutes(minutes), blocksWork, categoryId },
      {
        onSuccess: () => {
          setDraft("");
          setCategoryId(null);
          toast.success(`Added "${title}"`);
        },
        onError: () => toast.error("Could not add that task."),
      },
    );
  };

  const setCompleted = (task: SideTask, completed: boolean) => {
    update.mutate(
      { id: task.id, patch: { completed } },
      {
        onSuccess: () =>
          toast.success(completed ? `Done: ${task.title}` : `Reopened: ${task.title}`),
        onError: () => toast.error("Could not update that task."),
      },
    );
  };

  const toggleBlocksWork = (task: SideTask) => {
    update.mutate({ id: task.id, patch: { blocksWork: !task.blocksWork } });
  };

  /** Take a task off the calendar but keep it in the list. */
  const unplace = (task: SideTask) => {
    update.mutate(
      { id: task.id, patch: { start: null } },
      {
        onSuccess: () => toast.success(`Moved "${task.title}" back to the list`),
        onError: () => toast.error("Could not move that task back to the list."),
      },
    );
  };

  const beginEdit = (task: SideTask) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditMinutes(task.estimateMinutes);
    setEditCategoryId(task.category?.id ?? null);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (task: SideTask) => {
    const title = editTitle.trim();
    if (title === "") return;

    update.mutate(
      {
        id: task.id,
        patch: { title, estimateMinutes: clampMinutes(editMinutes), categoryId: editCategoryId },
      },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.success("Task updated");
        },
        onError: () => toast.error("Could not update that task."),
      },
    );
  };

  const runPlan = () => {
    setPlanNote(null);
    plan.mutate(coachContext, {
      onSuccess: (res) => {
        // The server drops past slots too; this catches any that went stale
        // between the snapshot and the reply (clock skew, an ageing tab).
        const returned = res.suggestions ?? [];
        const found = returned.filter((suggestion) => !isStaleSuggestion(suggestion.start, now));
        setSuggestions(found);
        if (res.message) {
          setPlanNote(res.message);
        } else if (found.length === 0) {
          setPlanNote(
            returned.length > 0
              ? "Those slots have already passed. Run the plan again for the time still ahead."
              : (res.reply ?? "Nothing to place right now."),
          );
        } else if (found.length < returned.length) {
          setPlanNote("Past slots the coach proposed were skipped.");
        }
      },
      onError: () => setPlanNote("The AI coach could not be reached. Try again in a moment."),
    });
  };

  const placeSuggestion = (suggestion: CoachPlanSuggestion) => {
    const task = tasks.find((t) => t.id === suggestion.taskId);
    if (!task) return;

    const start = new Date(suggestion.start);
    update.mutate(
      { id: task.id, patch: { start: start.toISOString() } },
      {
        onSuccess: () => {
          setSuggestions((prev) => prev.filter((s) => s.taskId !== suggestion.taskId));
          toast.success(`Placed "${task.title}" on ${dayLabel(start.toISOString(), now)} ${formatTime(start.toISOString())}`);
        },
        onError: () => toast.error("Could not place that task."),
      },
    );
  };

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Side tasks</div>
        {live.length > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-mut">{live.length}</span>
        )}
      </div>

      {live.length === 0 ? (
        <p className="mt-3 text-xs text-mut">
          No side tasks. Add one with an estimate, then place it on the calendar.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {live.map((task) => {
            const armed = placingId === task.id;
            const editing = editingId === task.id;
            const CategoryIcon = task.category ? categoryIcon(task.category.icon) : null;
            return (
              <li
                key={task.id}
                // The row drags to place the task; the edit fields switch it off
                // so typing does not start a drag.
                draggable={!editing}
                onDragStart={(event) => {
                  if (editing) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData(SIDE_TASK_DRAG_TYPE, String(task.id));
                  event.dataTransfer.effectAllowed = "move";
                }}
                title={editing ? undefined : "Drag onto a day to schedule it"}
                className={cn(
                  "group flex items-start gap-2 rounded border px-2 py-1.5",
                  armed ? "border-neon bg-neon/5" : "border-line bg-void/40",
                )}
              >
                {editing ? (
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveEdit(task);
                        if (event.key === "Escape") cancelEdit();
                      }}
                      aria-label="Edit task title"
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                      className="w-full rounded border border-line bg-void px-2 py-1 text-sm text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-2">
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
                            if (event.key === "Escape") cancelEdit();
                          }}
                          aria-label="Edit estimated minutes"
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                          className="w-16 rounded border border-line bg-void px-1.5 py-0.5 text-right font-mono text-xs text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        est
                      </label>
                      <CategoryPicker
                        categories={categories}
                        value={editCategoryId}
                        onChange={setEditCategoryId}
                        onManage={onManageCategories}
                        title="Category"
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
                        onClick={cancelEdit}
                        title="Cancel editing"
                      >
                        <span className="font-mono text-[10px] uppercase tracking-wider">cancel</span>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setCompleted(task, true)}
                      title="Mark done"
                      className="mt-0.5 shrink-0 text-mut transition-colors hover:text-neon"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">{task.title}</div>
                      {task.category && (
                        <div
                          className="flex items-center gap-1 truncate text-[10px]"
                          style={{ color: task.category.color }}
                          title={`Category: ${task.category.name}`}
                        >
                          {CategoryIcon && <CategoryIcon className="h-3 w-3 shrink-0" />}
                          <span className="truncate">{task.category.name}</span>
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-mut">
                        {formatHM(task.estimateMinutes * 60_000)}
                        {" · "}
                        <button
                          type="button"
                          onClick={() => toggleBlocksWork(task)}
                          title="Toggle whether this task counts against your work time"
                          className={cn(
                            "underline-offset-2 hover:underline",
                            task.blocksWork ? "text-l3" : "text-mut",
                          )}
                        >
                          {task.blocksWork ? "blocks work" : "flexible"}
                        </button>
                        {task.start !== null && (
                          <span className="text-l3">
                            {" · "}
                            {dayLabel(task.start, now)} {formatTime(task.start)}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => beginEdit(task)}
                      title="Edit title and estimate"
                      className="mt-0.5 shrink-0 text-mut opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    {task.start !== null && (
                      <button
                        type="button"
                        onClick={() => unplace(task)}
                        title="Take off the calendar but keep the task"
                        className="mt-0.5 shrink-0 text-mut transition-colors hover:text-ink"
                      >
                        <CalendarOff className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onTogglePlacing(task)}
                      title={
                        armed
                          ? "Cancel placing — press Esc on the calendar"
                          : task.start === null
                            ? "Place on the calendar"
                            : "Move on the calendar"
                      }
                      className={cn(
                        "mt-0.5 shrink-0 transition-colors",
                        armed ? "text-neon" : "text-mut hover:text-ink",
                      )}
                    >
                      {armed ? <Check className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => onDelete(task)}
                      title="Delete"
                      className="mt-0.5 shrink-0 text-mut transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 space-y-2 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            placeholder="Add a task…"
            aria-label="New side task"
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

        <div className="flex items-center gap-3">
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
          <label
            className="flex cursor-pointer items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-mut"
            title="While it is on the calendar, subtract this task from your work time"
          >
            <input
              type="checkbox"
              checked={blocksWork}
              onChange={(event) => setBlocksWork(event.target.checked)}
              aria-label="Blocks work time"
            />
            blocks work
          </label>
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            onManage={onManageCategories}
            title="Category"
            className="ml-auto"
          />
        </div>

        {unplaced.length > 0 && (
          <div className="flex items-center justify-between font-mono text-[10px] text-mut">
            <span>
              {unplaced.length} unplaced
            </span>
            <span>{formatHM(unplacedMs)} to fit</span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full px-2"
          onClick={runPlan}
          disabled={!coachAvailable || plan.isPending || unplaced.length === 0}
          title={
            !coachAvailable
              ? "AI coaching is unavailable"
              : unplaced.length === 0
                ? "Every task is placed"
                : "Ask the coach where these should go"
          }
        >
          {plan.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-3.5 w-3.5" />
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider">
            {plan.isPending ? "planning…" : "AI plan my tasks"}
          </span>
        </Button>

        {planNote && <p className="text-[11px] text-mut">{planNote}</p>}

        {suggestions.length > 0 && (
          <ul className="space-y-2">
            {suggestions.map((suggestion) => {
              const task = tasks.find((t) => t.id === suggestion.taskId);
              const start = new Date(suggestion.start);
              const staleNote = staleSuggestionNote(suggestion.start, now);
              return (
                <li
                  key={suggestion.taskId}
                  className={cn(
                    "rounded border p-2",
                    staleNote ? "border-amber-400/50 bg-amber-400/10" : "border-neon/40 bg-neon/5",
                  )}
                >
                  <div
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-wider",
                      staleNote ? "text-amber-400" : "text-neon",
                    )}
                  >
                    {dayLabel(start.toISOString(), now)} {formatTime(start.toISOString())}
                  </div>
                  {task && <div className="mt-0.5 truncate text-xs text-ink">{task.title}</div>}
                  {suggestion.reason && (
                    <div className="mt-1 text-[11px] text-mut">{suggestion.reason}</div>
                  )}
                  {staleNote && (
                    <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-400">
                      <Clock className="mt-px h-3 w-3 shrink-0" />
                      <span>{staleNote}</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 px-2"
                    onClick={() => placeSuggestion(suggestion)}
                    disabled={update.isPending}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    <span className="font-mono text-[10px] uppercase tracking-wider">place</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
