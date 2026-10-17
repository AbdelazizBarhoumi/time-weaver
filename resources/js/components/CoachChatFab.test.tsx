import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/utils";
import { CoachChatFab } from "@/components/CoachChatFab";
import type { CoachContext } from "@/lib/calendar";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const context: CoachContext = {
  now: "2026-10-14T12:00:00.000Z",
  timeZone: "Europe/Berlin",
  utcOffsetMinutes: 120,
  dailyGoalHours: 8,
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
    longestGapMs: 7_200_000,
    trackedMs: 0,
    goalMs: 28_800_000,
    remainingMs: 28_800_000,
    meetings: [],
    backlogHours: 2.5,
    perDayNeededHours: 4,
    eventTitles: [],
  },
  week: null,
  month: null,
  backlogHours: 2.5,
  streak: 4,
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
});
