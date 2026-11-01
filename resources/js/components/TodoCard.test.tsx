import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/utils";
import { TodoCard } from "@/components/TodoCard";
import type { CoachContext, SideTask } from "@/lib/calendar";

const { get, post, put, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

/** Wednesday, midday. */
const now = new Date(2026, 9, 14, 12, 0, 0, 0).getTime();

function at(hour: number, minute = 0): string {
  return new Date(2026, 9, 14, hour, minute).toISOString();
}

function task(overrides: Partial<SideTask> = {}): SideTask {
  return {
    id: 1,
    title: "Clean the room",
    estimateMinutes: 30,
    blocksWork: true,
    start: null,
    end: null,
    completedAt: null,
    done: false,
    ...overrides,
  };
}

const context: CoachContext = {
  now: new Date(now).toISOString(),
  timeZone: "Europe/Berlin",
  utcOffsetMinutes: 120,
  dailyGoalHours: 8,
  settings: {
    workStart: "09:00",
    workEnd: "17:00",
    workKeywords: [],
    workDays: [1, 2, 3, 4, 5],
    requiredDays: [1, 2, 3, 4, 5],
  },
  today: {
    dayKey: "2026-10-14",
    isWorkDay: true,
    isRequiredDay: true,
    now: new Date(now).toISOString(),
    windowStart: new Date(now).toISOString(),
    windowEnd: at(17),
    windowMs: 18_000_000,
    busyMs: 0,
    freeMs: 18_000_000,
    workableMs: 18_000_000,
    longestGapMs: 18_000_000,
    trackedMs: 0,
    goalMs: 28_800_000,
    remainingMs: 28_800_000,
    meetings: [],
    studyMs: 0,
    studyTodayMs: 0,
    studySessions: [],
    backlogHours: null,
    perDayNeededHours: null,
    eventTitles: [],
  },
  week: null,
  horizon: {
    from: "2026-10-14T00:00:00.000Z",
    to: "2026-10-28T00:00:00.000Z",
    days: [],
  },
  coverage: { from: "2026-10-14T00:00:00.000Z", to: "2026-10-28T00:00:00.000Z" },
  month: null,
  backlogHours: null,
  streak: null,
  tasks: [],
  tasksSummary: {
    total: 0,
    unplaced: 0,
    scheduled: 0,
    done: 0,
    unplacedEstimateHours: 0,
    blockingHoursToday: 0,
  },
  study: {
    todayHours: 0,
    remainingTodayHours: 0,
    weekHours: 0,
    sessions: [],
  },
};

const noop = () => {};

function renderCard(props: Partial<Parameters<typeof TodoCard>[0]> = {}) {
  return render(
    <TodoCard
      tasks={[]}
      categories={[]}
      now={now}
      coachContext={context}
      placingId={null}
      onTogglePlacing={noop}
      onDelete={noop}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { available: true } });
});

describe("TodoCard", () => {
  it("lists the live tasks and hides the finished ones", async () => {
    renderCard({
      tasks: [
        task({ id: 1, title: "Clean the room" }),
        // Its slot ended at 10:00, so it is done by the clock.
        task({ id: 2, title: "Old chore", start: at(9), end: at(10) }),
      ],
    });

    expect(screen.getByText("Clean the room")).toBeInTheDocument();
    expect(screen.queryByText("Old chore")).not.toBeInTheDocument();
  });

  it("summarises the unplaced work left to fit", () => {
    renderCard({ tasks: [task({ id: 1, estimateMinutes: 30 }), task({ id: 2, title: "Laundry", estimateMinutes: 45 })] });

    expect(screen.getByText("2 unplaced")).toBeInTheDocument();
    expect(screen.getByText("1h 15m to fit")).toBeInTheDocument();
  });

  it("adds a task with its estimate", async () => {
    post.mockResolvedValue({ data: task({ id: 9 }) });
    renderCard();

    fireEvent.change(screen.getByLabelText("New side task"), { target: { value: "Buy milk" } });
    fireEvent.change(screen.getByLabelText("Estimated minutes"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/side-tasks", {
        title: "Buy milk",
        estimate_minutes: 45,
        start: null,
        blocks_work: true,
        category_id: null,
      }),
    );
  });

  it("can add a task that does not block work", async () => {
    post.mockResolvedValue({ data: task({ id: 9 }) });
    renderCard();

    fireEvent.change(screen.getByLabelText("New side task"), { target: { value: "Call mum" } });
    fireEvent.click(screen.getByLabelText("Blocks work time"));
    fireEvent.click(screen.getByRole("button", { name: "add" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/side-tasks", {
        title: "Call mum",
        estimate_minutes: 30,
        start: null,
        blocks_work: false,
        category_id: null,
      }),
    );
  });

  it("ticks a task off", async () => {
    put.mockResolvedValue({ data: task() });
    renderCard({ tasks: [task()] });

    fireEvent.click(screen.getByTitle("Mark done"));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/side-tasks/1", { completed: true }));
  });

  it("flips a task between blocking and flexible", async () => {
    put.mockResolvedValue({ data: task() });
    renderCard({ tasks: [task({ blocksWork: true })] });

    fireEvent.click(screen.getByTitle("Toggle whether this task counts against your work time"));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/side-tasks/1", { blocks_work: false }));
  });

  it("asks the page to delete, which owns the confirmation", () => {
    const onDelete = vi.fn();
    renderCard({ tasks: [task()], onDelete });

    fireEvent.click(screen.getByTitle("Delete"));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("arms a task for click-to-place", () => {
    const onTogglePlacing = vi.fn();
    renderCard({ tasks: [task()], onTogglePlacing });

    fireEvent.click(screen.getByTitle("Place on the calendar"));

    expect(onTogglePlacing).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("only offers the AI plan when something is unplaced", () => {
    renderCard({ tasks: [task({ id: 1, start: at(15), end: at(16) })] });

    expect(screen.getByRole("button", { name: /ai plan my tasks/i })).toBeDisabled();
  });

  it("asks the coach where to place the unplaced tasks", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "Tuesday evening is free.",
        suggestions: [{ taskId: 1, start: "2026-10-20T17:00", reason: "Still leaves 3h" }],
      },
    });

    renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/side-tasks/plan", { context: expect.objectContaining({ dailyGoalHours: 8 }) }),
    );

    expect(await screen.findByText("Still leaves 3h")).toBeInTheDocument();
  });

  it("places a suggested slot when the user confirms it", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "Tuesday evening is free.",
        suggestions: [{ taskId: 1, start: "2026-10-20T17:00", reason: "Still leaves 3h" }],
      },
    });
    put.mockResolvedValue({ data: task() });

    renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));
    fireEvent.click(await screen.findByRole("button", { name: "place" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/side-tasks/1", {
        start: new Date("2026-10-20T17:00").toISOString(),
      }),
    );
  });

  it("shows a note when there is nothing left to place", async () => {
    post.mockResolvedValue({ data: { available: true, reply: "Everything is already scheduled.", suggestions: [] } });

    renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));

    expect(await screen.findByText("Everything is already scheduled.")).toBeInTheDocument();
  });

  it("drops suggestions whose slot has already passed", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "Later today still works.",
        // 09:00 is behind the clock (now is midday); Tuesday's slot is not.
        suggestions: [
          { taskId: 1, start: "2026-10-14T09:00", reason: "This morning is gone." },
          { taskId: 1, start: "2026-10-20T17:00", reason: "Later today still works." },
        ],
      },
    });

    renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));

    expect(await screen.findByText("Later today still works.")).toBeInTheDocument();
    expect(screen.queryByText("This morning is gone.")).not.toBeInTheDocument();
    expect(screen.getByText("Past slots the coach proposed were skipped.")).toBeInTheDocument();
  });

  it("says so when every proposed slot has already passed", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "This morning is gone.",
        suggestions: [{ taskId: 1, start: "2026-10-14T09:00", reason: "This morning is gone." }],
      },
    });

    renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));

    expect(
      await screen.findByText("Those slots have already passed. Run the plan again for the time still ahead."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "place" })).not.toBeInTheDocument();
  });

  it("disables the plan button when the coach is unavailable", async () => {
    get.mockResolvedValue({ data: { available: false } });

    renderCard({ tasks: [task()] });

    await waitFor(() => expect(screen.getByRole("button", { name: /ai plan my tasks/i })).toBeDisabled());
  });

  it("takes a placed task off the calendar but keeps it in the list", async () => {
    put.mockResolvedValue({ data: task() });
    renderCard({ tasks: [task({ id: 1, start: at(15), end: at(16) })] });

    fireEvent.click(screen.getByTitle("Take off the calendar but keep the task"));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/side-tasks/1", { start: null }));
    // The task is still listed, only its slot is gone.
    expect(screen.getByText("Clean the room")).toBeInTheDocument();
  });

  it("offers unplace only for a task that is on the calendar", () => {
    renderCard({ tasks: [task({ id: 1 })] });

    expect(screen.queryByTitle("Take off the calendar but keep the task")).not.toBeInTheDocument();
  });

  it("edits a task's title and estimate inline", async () => {
    put.mockResolvedValue({ data: task() });
    renderCard({ tasks: [task({ id: 1, title: "Clean the room", estimateMinutes: 30 })] });

    fireEvent.click(screen.getByTitle("Edit title and estimate"));
    fireEvent.change(screen.getByLabelText("Edit task title"), { target: { value: "Vacuum the room" } });
    fireEvent.change(screen.getByLabelText("Edit estimated minutes"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/side-tasks/1", {
        title: "Vacuum the room",
        estimate_minutes: 45,
        category_id: null,
      }),
    );
  });

  it("cancels an inline edit without saving", () => {
    renderCard({ tasks: [task({ id: 1, title: "Clean the room" })] });

    fireEvent.click(screen.getByTitle("Edit title and estimate"));
    fireEvent.change(screen.getByLabelText("Edit task title"), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(put).not.toHaveBeenCalled();
    expect(screen.getByText("Clean the room")).toBeInTheDocument();
  });

  it("flags a suggestion that goes stale while it sits on screen", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "That gap works.",
        // Ahead of the clock when the plan comes back (now is Wednesday noon)…
        suggestions: [{ taskId: 1, start: "2026-10-14T15:00", reason: "Quiet afternoon" }],
      },
    });

    const { rerender } = renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));
    expect(await screen.findByText("Quiet afternoon")).toBeInTheDocument();

    // …and behind it once the user leaves it waiting past the slot.
    rerender(
      <TodoCard
        tasks={[task()]}
        categories={[]}
        now={new Date(2026, 9, 14, 16, 0, 0, 0).getTime()}
        coachContext={context}
        placingId={null}
        onTogglePlacing={noop}
        onDelete={noop}
      />,
    );

    expect(await screen.findByText(/already passed today/i)).toBeInTheDocument();
    // It is flagged, not dropped: the user can still place it.
    expect(screen.getByRole("button", { name: "place" })).toBeEnabled();
  });

  it("leaves a future suggestion unflagged", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "Tuesday evening is free.",
        suggestions: [{ taskId: 1, start: "2026-10-20T17:00", reason: "Still leaves 3h" }],
      },
    });

    renderCard({ tasks: [task()] });
    fireEvent.click(screen.getByRole("button", { name: /ai plan my tasks/i }));

    expect(await screen.findByText("Still leaves 3h")).toBeInTheDocument();
    expect(screen.queryByText(/already passed/i)).not.toBeInTheDocument();
  });
});
