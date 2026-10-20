import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { sessionDurationMs, type WorkSession } from "./tracker";

/**
 * A work task — a to-do item from the work list with an estimate, an optional
 * deadline, and real tracked time linked through work sessions. Completed tasks
 * are never deleted: they stay in the list, flagged `done`, with their history.
 */
export interface WorkTask {
  id: number;
  title: string;
  /** How long the user expects it to take, in minutes. */
  estimateMinutes: number;
  /** When work on it first began, or null while it is untouched. */
  startedAt: string | null;
  /** When it was ticked off by hand; null while open. Never clears the row. */
  completedAt: string | null;
  /** Optional deadline, used only to flag the task overdue. */
  dueAt: string | null;
  position: number;
  notes: string | null;
  /** Server snapshot; re-derive against the ticking clock with `workTaskStatus`. */
  status: WorkTaskStatus;
  /** Server snapshot of the deadline flag; prefer `isWorkTaskOverdue` for live checks. */
  overdue: boolean;
  done: boolean;
  /** Total time the server has recorded against the task, in milliseconds. */
  trackedMs: number;
  /** The session currently running against it, if any. */
  activeSessionId: number | null;
}

/** Derived, never stored: active (timer on it), in progress, todo, or done. */
export type WorkTaskStatus = "todo" | "in_progress" | "active" | "done";

export interface WorkTaskInput {
  title: string;
  estimateMinutes: number;
  dueAt?: string | null;
  notes?: string | null;
}

export interface WorkTaskPatch {
  title?: string;
  estimateMinutes?: number;
  dueAt?: string | null;
  notes?: string | null;
  position?: number;
  completed?: boolean;
}

export const workTasksApi = {
  list: () => api.get<WorkTask[]>("/work-tasks").then((r) => r.data),
  create: (t: WorkTaskInput) =>
    api
      .post<WorkTask>("/work-tasks", {
        title: t.title,
        estimate_minutes: t.estimateMinutes,
        due_at: t.dueAt ?? null,
        notes: t.notes ?? null,
      })
      .then((r) => r.data),
  update: (id: number, patch: WorkTaskPatch) =>
    api
      .put<WorkTask>(`/work-tasks/${id}`, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.estimateMinutes !== undefined ? { estimate_minutes: patch.estimateMinutes } : {}),
        ...(patch.dueAt !== undefined ? { due_at: patch.dueAt } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
      })
      .then((r) => r.data),
  start: (id: number) => api.post<WorkTask>(`/work-tasks/${id}/start`).then((r) => r.data),
  remove: (id: number) => api.delete(`/work-tasks/${id}`),
};

/* ---------------------------------------------------------------- Hooks */

export function useWorkTasks() {
  return useQuery({ queryKey: ["work-tasks"], queryFn: workTasksApi.list });
}

function useWorkTaskMutation<TArg, TResult>(fn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-tasks"] });
      // Linking or unlinking a session changes tracked time and stats.
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export const useCreateWorkTask = () => useWorkTaskMutation((t: WorkTaskInput) => workTasksApi.create(t));
export const useUpdateWorkTask = () =>
  useWorkTaskMutation((args: { id: number; patch: WorkTaskPatch }) => workTasksApi.update(args.id, args.patch));
export const useStartWorkTask = () => useWorkTaskMutation((id: number) => workTasksApi.start(id));
export const useDeleteWorkTask = () => useWorkTaskMutation((id: number) => workTasksApi.remove(id));

/* ---------------------------------------------------------------- Logic */

/** Time tracked against one task, computed live from its linked sessions. */
export function workTaskTrackedMs(task: WorkTask, sessions: WorkSession[], now: number): number {
  return sessions.reduce(
    (sum, session) => (session.workTaskId === task.id ? sum + sessionDurationMs(session, now) : sum),
    0,
  );
}

/** Estimated time left, in milliseconds; negative once the estimate is blown. */
export function workTaskRemainingMs(task: WorkTask, sessions: WorkSession[], now: number): number {
  return task.estimateMinutes * 60_000 - workTaskTrackedMs(task, sessions, now);
}

/** Past its deadline and still open — re-derived so it flips as the clock moves. */
export function isWorkTaskOverdue(task: WorkTask, now: number): boolean {
  return task.completedAt === null && task.dueAt !== null && new Date(task.dueAt).getTime() < now;
}

/** The live status, re-derived from the ticking clock and the session list. */
export function workTaskStatus(task: WorkTask, sessions: WorkSession[], now: number): WorkTaskStatus {
  if (task.completedAt !== null) return "done";
  if (sessions.some((s) => s.workTaskId === task.id && !s.end)) return "active";
  if (task.startedAt !== null || workTaskTrackedMs(task, sessions, now) > 0) return "in_progress";
  return "todo";
}

const STATUS_RANK: Record<WorkTaskStatus, number> = { active: 0, in_progress: 1, todo: 2, done: 3 };
/**
 * Panel order: the live work first (active, then in-progress), then the queue,
 * then finished tasks last — overdue tasks jump ahead of their peers.
 */
export function sortWorkTasks(tasks: WorkTask[], sessions: WorkSession[], now: number): WorkTask[] {
  return [...tasks].sort((a, b) => {
    const rank =
      STATUS_RANK[workTaskStatus(a, sessions, now)] - STATUS_RANK[workTaskStatus(b, sessions, now)];
    if (rank !== 0) return rank;

    const overdue = Number(isWorkTaskOverdue(b, now)) - Number(isWorkTaskOverdue(a, now));
    if (overdue !== 0) return overdue;

    if (a.position !== b.position) return a.position - b.position;
    return a.id - b.id;
  });
}

/** A `yyyy-mm-dd` deadline from a date input → end-of-day ISO, or null. */
export function dueInputToIso(value: string): string | null {
  if (value === "") return null;
  const date = new Date(`${value}T23:59`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An ISO deadline → the `yyyy-mm-dd` a date input expects (local time). */
export function isoToDueInput(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

