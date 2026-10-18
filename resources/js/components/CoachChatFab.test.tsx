import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/utils";
import { CoachChatFab } from "@/components/CoachChatFab";
import type { CoachContext } from "@/lib/calendar";

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

const context: CoachContext = {
  now: "2026-10-14T12:00:00.000Z",
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
    now: "2026-10-14T12:00:00.000Z",
    windowStart: "2026-10-14T12:00:00.000Z",
    windowEnd: "2026-10-14T17:00:00.000Z",
    windowMs: 18_000_000,
    busyMs: 3_600_000,
    freeMs: 14_400_000,
    workableMs: 14_400_000,
    longestGapMs: 7_200_000,
    trackedMs: 0,
    goalMs: 28_800_000,
    remainingMs: 28_800_000,
    meetings: [],
    studyMs: 0,
    studyTodayMs: 0,
    studySessions: [],
    backlogHours: 2.5,
    perDayNeededHours: 4,
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
  backlogHours: 2.5,
  streak: 4,
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
/** The same snapshot, but with one unplaced side task the coach can schedule. */
const contextWithTask: CoachContext = {
  ...context,
  tasks: [
    {
      id: 7,
      title: "Clean the room",
      estimateMinutes: 45,
      blocksWork: false,
      start: null,
      end: null,
      done: false,
    },
  ],
  tasksSummary: {
    total: 1,
    unplaced: 1,
    scheduled: 0,
    done: 0,
    unplacedEstimateHours: 0.8,
    blockingHoursToday: 0,
  },
};

/** The same snapshot, but with tomorrow already present in the horizon. */
const contextWithHorizon: CoachContext = {
  ...context,
  horizon: {
    from: "2026-10-14T00:00:00.000Z",
    to: "2026-10-28T00:00:00.000Z",
    days: [
      {
        dayKey: "2026-10-15",
        weekday: "Thursday",
        isToday: false,
        isWorkDay: true,
        isRequired: true,
        windowStart: "09:00",
        windowEnd: "17:00",
        busyHours: 0,
        freeHours: 8,
        isPast: false,
        dataCovered: true,
      },
    ],
  },
};

function fab(): HTMLElement {
  return screen.getByRole("button", { name: /AI coach/i });
}

describe("CoachChatFab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { available: true } });
    post.mockResolvedValue({ data: { available: true, reply: "You have 3 hours of free time." } });

    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it("opens the chat panel on click and closes it again", async () => {
    render(<CoachChatFab context={context} />);

    expect(screen.queryByText(/Ask about your free time/i)).not.toBeInTheDocument();

    fireEvent.click(fab());
    expect(await screen.findByText(/Ask about your free time/i)).toBeInTheDocument();

    fireEvent.click(fab());
    expect(screen.queryByText(/Ask about your free time/i)).not.toBeInTheDocument();
  });

  it("sends a suggestion and renders the coach's reply", async () => {
    render(<CoachChatFab context={context} />);
    fireEvent.click(fab());

    fireEvent.click(await screen.findByRole("button", { name: "How much free time do I have today?" }));

    expect(await screen.findByText("You have 3 hours of free time.")).toBeInTheDocument();

    expect(post).toHaveBeenCalledWith(
      "/calendar/coach/chat",
      expect.objectContaining({
        messages: [
          { role: "user", content: "How much free time do I have today?" },
        ],
        context,
      }),
    );
  });

  it("submits typed text with Enter and keeps shift+Enter for new lines", async () => {
    render(<CoachChatFab context={context} />);
    fireEvent.click(fab());

    const input = screen.getByPlaceholderText("Ask the coach…");

    fireEvent.change(input, { target: { value: "What next?" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(post).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await screen.findByText("You have 3 hours of free time.");

    fireEvent.change(input, { target: { value: "And tomorrow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith(
      "/calendar/coach/chat",
      expect.objectContaining({
        messages: [
          { role: "user", content: "What next?" },
          { role: "assistant", content: "You have 3 hours of free time." },
          { role: "user", content: "And tomorrow?" },
        ],
      }),
    );
  });

  it("drags the button to a new position without opening the panel", async () => {
    render(<CoachChatFab context={context} />);
    const button = fab();

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 700 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 200, clientY: 600 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 200, clientY: 600 });
    fireEvent.click(button);

    expect(screen.queryByText(/Ask about your free time/i)).not.toBeInTheDocument();
    expect(button.style.left).toBe("100px");
    expect(button.style.top).toBe("12px");
  });

  it("does not open the panel when Gemini is unconfigured", async () => {
    get.mockResolvedValue({ data: { available: false } });
    render(<CoachChatFab context={context} />);
    fireEvent.click(fab());

    expect(await screen.findByText(/Add a GEMINI_API_KEY/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("renders a proposed slot for a task and places it on click", async () => {
    post.mockResolvedValue({
      data: {
        available: true,
        reply: "Tuesday 5pm still leaves you three hours.",
        suggestions: [{ taskId: 7, start: "2026-10-20T17:00", reason: "Still leaves 3h for work" }],
      },
    });
    put.mockResolvedValue({ data: {} });

    render(<CoachChatFab context={contextWithTask} />);
    fireEvent.click(fab());
    fireEvent.click(await screen.findByRole("button", { name: "How much free time do I have today?" }));

    expect(await screen.findByText("Clean the room")).toBeInTheDocument();
    expect(screen.getByText("Still leaves 3h for work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /place/i }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/side-tasks/7", {
        start: new Date("2026-10-20T17:00").toISOString(),
      }),
    );
  });

  it("loads a day the coach asks for and asks the question again", async () => {
    post
      .mockResolvedValueOnce({ data: { available: true, reply: "Loading that day.", fetch: { day: "2026-10-20" } } })
      .mockResolvedValueOnce({ data: { available: true, reply: "You have 3 hours on Tuesday." } });
    const onFetchRange = vi.fn().mockResolvedValue(undefined);

    render(<CoachChatFab context={context} onFetchRange={onFetchRange} />);
    fireEvent.click(fab());
    fireEvent.click(await screen.findByRole("button", { name: "How much free time do I have today?" }));

    // The coach's second answer replaces the "loading" placeholder.
    expect(await screen.findByText("You have 3 hours on Tuesday.")).toBeInTheDocument();
    expect(screen.queryByText("Loading that day.")).not.toBeInTheDocument();

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(onFetchRange).toHaveBeenCalledTimes(1);
    const [from, to] = onFetchRange.mock.calls[0] as [Date, Date];
    expect(from.getDate()).toBe(20);
    expect(to.getDate()).toBe(21);
  });

  it("stops re-asking after the fetch round cap", async () => {
    // Every reply keeps asking for the same missing day.
    post.mockResolvedValue({ data: { available: true, reply: "Still loading.", fetch: { day: "2026-10-20" } } });
    const onFetchRange = vi.fn().mockResolvedValue(undefined);

    render(<CoachChatFab context={context} onFetchRange={onFetchRange} />);
    fireEvent.click(fab());
    fireEvent.click(await screen.findByRole("button", { name: "How much free time do I have today?" }));

    await waitFor(() => expect(onFetchRange).toHaveBeenCalledTimes(2));
    // One original turn plus two fetches; the cap stops it there.
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("ignores a fetch request for a day past the load limit", async () => {
    // 2026-12-31 is more than the sixty-day cap away from the snapshot's today.
    post.mockResolvedValueOnce({ data: { available: true, reply: "That is far away.", fetch: { day: "2026-12-31" } } });
    const onFetchRange = vi.fn().mockResolvedValue(undefined);

    render(<CoachChatFab context={context} onFetchRange={onFetchRange} />);
    fireEvent.click(fab());
    fireEvent.click(await screen.findByRole("button", { name: "How much free time do I have today?" }));

    expect(await screen.findByText("That is far away.")).toBeInTheDocument();
    expect(onFetchRange).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("answers from the horizon instead of reloading a day it already has", async () => {
    post
      .mockResolvedValueOnce({ data: { available: true, reply: "Loading that day.", fetch: { day: "2026-10-15" } } })
      .mockResolvedValueOnce({ data: { available: true, reply: "You work 09:00 to 17:00 tomorrow." } });
    const onFetchRange = vi.fn().mockResolvedValue(undefined);

    render(<CoachChatFab context={contextWithHorizon} onFetchRange={onFetchRange} />);
    fireEvent.click(fab());
    fireEvent.click(await screen.findByRole("button", { name: "How much free time do I have today?" }));

    // Nothing is loaded: the day is already there, so the coach is asked again with it.
    expect(await screen.findByText("You work 09:00 to 17:00 tomorrow.")).toBeInTheDocument();
    expect(screen.queryByText("Loading that day.")).not.toBeInTheDocument();
    expect(onFetchRange).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(2);

    // The retry carries the day's row as invisible guidance.
    const retry = post.mock.calls[1]![1] as { messages: { role: string; content: string }[] };
    expect(retry.messages[retry.messages.length - 1]!.content).toContain("2026-10-15");
    expect(retry.messages[retry.messages.length - 1]!.content).toContain("windowStart 09:00");
  });
});
