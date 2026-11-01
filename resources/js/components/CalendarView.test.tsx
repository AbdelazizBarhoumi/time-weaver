import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent } from "@/test/utils";
import { CalendarView } from "@/components/CalendarView";
import {
  SIDE_TASK_DRAG_TYPE,
  type CalendarAccount,
  type CalendarEvent,
  type CalendarSettings,
  type FocusBlock,
  type SideTask,
} from "@/lib/calendar";
import type { Category } from "@/lib/categories";

const settings: CalendarSettings = {
  workStart: "09:00",
  workEnd: "17:00",
  workKeywords: [],
  workDays: [1, 2, 3, 4, 5],
  requiredDays: [1, 2, 3, 4, 5],
};

/** Wednesday, with the whole 09:00–17:00 window compressed into 448px. */
const wednesday = new Date(2026, 9, 14);
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

function calendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "1|evt",
    cacheId: 9,
    eventId: "evt",
    recurringEventId: null,
    accountId: 1,
    accountEmail: "me@example.com",
    accountColor: "#5b9cff",
    calendarId: "primary",
    calendarName: "Personal",
    title: "Standup",
    start: at(15),
    end: at(16),
    allDay: false,
    color: null,
    hasCustomColor: false,
    isLocal: false,
    isWork: false,
    workSource: null,
    ...overrides,
  };
}

function focusBlock(overrides: Partial<FocusBlock> = {}): FocusBlock {
  return { id: 11, title: "Deep work", start: at(15), end: at(16), ...overrides };
}

/** A mailbox, so an event menu can offer its default category. */
function calendarAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 1,
    provider: "google",
    email: "me@example.com",
    color: "#5b9cff",
    defaultWork: false,
    ...overrides,
  };
}

const noop = () => {};

function renderView(props: Partial<Parameters<typeof CalendarView>[0]> = {}) {
  return render(
    <CalendarView
      firstDay={wednesday}
      dayCount={1}
      now={now}
      settings={settings}
      events={[]}
      focusBlocks={[]}
      tasks={[]}
      categories={[]}
      placingId={null}
      sessions={[]}
      todaySlots={[]}
      density="work"
      onToggleWork={noop}
      onResetWork={noop}
      onDeleteEvent={noop}
      onDuplicateEvent={noop}
      onSetEventColor={noop}
      onSetEventCategory={noop}
      onEditEvent={noop}
      onCreateEvent={noop}
      onDeleteFocus={noop}
      onSetFocusCategory={noop}
      onStartFocus={noop}
      onDeleteSession={noop}
      onPlaceTask={noop}
      onScheduleTask={noop}
      onMoveFocus={noop}
      onMoveEvent={noop}
      onCompleteTask={noop}
      onDeleteTask={noop}
      onUnplaceTask={noop}
      onMoveTask={noop}
      onCancelPlacing={noop}
      {...props}
    />,
  );
}

function dayColumn(index = 0): HTMLElement {
  return document.querySelectorAll("[data-day]")[index] as HTMLElement;
}

function dayHeader(index = 0): HTMLElement {
  return document.querySelectorAll("[data-day-header]")[index] as HTMLElement;
}

/**
 * jsdom has no `DragEvent`, so RTL's `fireEvent.drop` drops `clientY` on the
 * floor. Build the native event by hand instead, carrying both the payload and
 * the pointer position the handler reads.
 */
function dropEvent(taskId: string, clientY: number): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: taskId ? [SIDE_TASK_DRAG_TYPE] : [],
      getData: (type: string) => (type === SIDE_TASK_DRAG_TYPE ? taskId : ""),
      dropEffect: "",
    },
  });
  return event;
}

/**
 * happy-dom has no `PointerEvent`, so build the native one by hand. React's
 * pointer handlers read `clientX`/`clientY`/`button` off it.
 */
function pointerEvent(type: string, clientY: number, clientX = 100): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "button", { value: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

// The 09:00–17:00 window is 448px tall, so 56px is one hour and the hour of a
// `clientY` is 9 + clientY / 56. Grabbing a block at its top and releasing at
// 224px should land it at 13:00.
const BLOCK_TOP_15 = 6 * 56; // 15:00
const DROP_13 = 4 * 56; // 13:00

describe("CalendarView side tasks", () => {
  it("draws a placed task as an amber block labelled with its estimate", () => {
    renderView({ tasks: [task({ start: at(15), end: at(16) })] });

    const block = screen.getByTitle(/Clean the room/);
    expect(block).toBeInTheDocument();
    expect(block.getAttribute("title")).toContain("30m");
    expect(block.getAttribute("title")).toContain("blocks work");
  });

  it("does not draw an unplaced task", () => {
    renderView({ tasks: [task()] });

    expect(screen.queryByTitle(/Clean the room/)).not.toBeInTheDocument();
  });

  it("strikes through a task whose slot has passed", () => {
    renderView({ tasks: [task({ id: 1, start: at(9), end: at(10) })] });

    const label = screen.getByText("Clean the room");
    expect(label).toHaveStyle({ textDecoration: "line-through" });
  });

  it("ticks a task off from the grid", () => {
    const onCompleteTask = vi.fn();
    renderView({ tasks: [task({ start: at(15), end: at(16) })], onCompleteTask });

    fireEvent.click(screen.getByTitle("Mark done now"));

    expect(onCompleteTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), true);
  });

  it("offers an undo only once a task was ticked off by hand", () => {
    const onCompleteTask = vi.fn();
    renderView({
      tasks: [task({ start: at(15), end: at(16), completedAt: at(15) })],
      onCompleteTask,
    });

    // The slot is shortened to the moment it actually finished.
    expect(screen.getByTitle(/Clean the room/).getAttribute("title")).toContain("finished");

    fireEvent.click(screen.getByTitle(/Undo/));

    expect(onCompleteTask).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false);
  });

  it("arms a task for moving when its Move control is clicked", () => {
    const onMoveTask = vi.fn();
    renderView({ tasks: [task({ id: 5, start: at(15), end: at(16) })], onMoveTask });

    fireEvent.click(screen.getByTitle("Move this task"));

    expect(onMoveTask).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it("asks the page to delete a task", () => {
    const onDeleteTask = vi.fn();
    renderView({ tasks: [task({ id: 3, start: at(15), end: at(16) })], onDeleteTask });

    fireEvent.click(screen.getByTitle("Delete task"));

    expect(onDeleteTask).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("places a task dropped onto a day at the dropped time", () => {
    const onPlaceTask = vi.fn();
    renderView({ tasks: [task({ id: 7 })], onPlaceTask });

    // 224px into the 448px column lands on 13:00.
    fireEvent(dayColumn(), dropEvent("7", 224));

    expect(onPlaceTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      new Date(2026, 9, 14, 13, 0),
    );
  });

  it("ignores a drop that carries no side task", () => {
    const onPlaceTask = vi.fn();
    renderView({ onPlaceTask });

    fireEvent(dayColumn(), dropEvent("", 224));

    expect(onPlaceTask).not.toHaveBeenCalled();
  });

  it("places an armed task on the slot the user clicks", () => {
    const onPlaceTask = vi.fn();
    renderView({ tasks: [task({ id: 2 })], placingId: 2, onPlaceTask });

    const column = dayColumn();
    fireEvent.mouseDown(column, { clientY: 224 });
    fireEvent.mouseUp(column, { clientY: 224 });

    expect(onPlaceTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
      new Date(2026, 9, 14, 13, 0),
    );
  });

  it("opens the event dialog instead of placing when no task is armed", () => {
    const onCreateEvent = vi.fn();
    renderView({ onCreateEvent });

    const column = dayColumn();
    // Drag from 09:00 down to 12:00.
    fireEvent.mouseDown(column, { clientY: 0 });
    fireEvent.mouseMove(column, { clientY: 168 });
    fireEvent.mouseUp(column, { clientY: 168 });

    expect(onCreateEvent).toHaveBeenCalledWith(new Date(2026, 9, 14, 9, 0), new Date(2026, 9, 14, 12, 0));
  });

  it("shows a hint while a task is armed, and leaves on Esc", () => {
    const onCancelPlacing = vi.fn();
    renderView({ tasks: [task({ id: 4 })], placingId: 4, onCancelPlacing });

    expect(screen.getByText(/Click a time to place/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancelPlacing).toHaveBeenCalled();
  });
});

describe("CalendarView drag and drop", () => {
  it("moves a placed task to another time within the day", () => {
    const onScheduleTask = vi.fn();
    renderView({ tasks: [task({ id: 7, start: at(15), end: at(16) })], onScheduleTask });

    fireEvent(screen.getByTitle(/Clean the room/), pointerEvent("pointerdown", BLOCK_TOP_15));
    fireEvent(dayColumn(), pointerEvent("pointerup", DROP_13));

    expect(onScheduleTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      new Date(2026, 9, 14, 13, 0),
      new Date(2026, 9, 14, 14, 0),
    );
  });

  it("moves a task across days, keeping its length", () => {
    const onScheduleTask = vi.fn();
    renderView({ dayCount: 2, tasks: [task({ id: 7, start: at(15), end: at(16) })], onScheduleTask });

    fireEvent(screen.getByTitle(/Clean the room/), pointerEvent("pointerdown", BLOCK_TOP_15));
    fireEvent(dayColumn(1), pointerEvent("pointerup", DROP_13));

    expect(onScheduleTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      new Date(2026, 9, 15, 13, 0),
      new Date(2026, 9, 15, 14, 0),
    );
  });

  it("moves a Google event without changing its length", () => {
    const onMoveEvent = vi.fn();
    renderView({ events: [calendarEvent()], onMoveEvent });

    fireEvent(screen.getByTitle(/Standup/), pointerEvent("pointerdown", BLOCK_TOP_15));
    fireEvent(dayColumn(), pointerEvent("pointerup", DROP_13));

    expect(onMoveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1|evt" }),
      new Date(2026, 9, 14, 13, 0),
      new Date(2026, 9, 14, 14, 0),
    );
  });

  it("still toggles work when an event is merely clicked", () => {
    const onToggleWork = vi.fn();
    renderView({ events: [calendarEvent()], onToggleWork });

    fireEvent.click(screen.getByTitle(/Standup/));

    expect(onToggleWork).toHaveBeenCalledWith(expect.objectContaining({ id: "1|evt" }));
  });

  it("stretches a focus block by dragging its end edge", () => {
    const onMoveFocus = vi.fn();
    renderView({ focusBlocks: [focusBlock()], onMoveFocus });

    fireEvent(screen.getByTitle("Drag to change the end time"), pointerEvent("pointerdown", BLOCK_TOP_15 + 56));
    fireEvent(dayColumn(), pointerEvent("pointerup", 8 * 56));

    expect(onMoveFocus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11 }),
      new Date(2026, 9, 14, 15, 0),
      new Date(2026, 9, 14, 17, 0),
    );
  });

  it("moves an all-day event to the next day header", () => {
    const onMoveEvent = vi.fn();
    renderView({
      dayCount: 2,
      events: [calendarEvent({ id: "2|all", allDay: true, title: "Conference", start: "2026-10-14", end: "2026-10-15" })],
      onMoveEvent,
    });

    fireEvent(screen.getByTitle(/Conference/), pointerEvent("pointerdown", 10, 20));
    fireEvent(dayHeader(1), pointerEvent("pointerup", 10, 300));

    expect(onMoveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "2|all" }),
      new Date("2026-10-15T00:00:00Z"),
      new Date("2026-10-16T00:00:00Z"),
    );
  });
});

describe("CalendarView event actions", () => {
  it("duplicates an event from its actions menu", async () => {
    const user = userEvent.setup();
    const onDuplicateEvent = vi.fn();
    renderView({ events: [calendarEvent()], onDuplicateEvent });

    await user.click(screen.getByRole("button", { name: "Event actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /Duplicate/ }));

    expect(onDuplicateEvent).toHaveBeenCalledWith(expect.objectContaining({ cacheId: 9, eventId: "evt" }));
  });

  it("recolors an event without toggling its work state", async () => {
    const user = userEvent.setup();
    const onSetEventColor = vi.fn();
    const onToggleWork = vi.fn();
    renderView({ events: [calendarEvent()], onSetEventColor, onToggleWork });

    await user.click(screen.getByRole("button", { name: "Event actions" }));
    await user.click(await screen.findByRole("button", { name: "Green" }));

    expect(onSetEventColor).toHaveBeenCalledWith(expect.objectContaining({ cacheId: 9 }), "#34d399");
    expect(onToggleWork).not.toHaveBeenCalled();
  });

  it("draws an event in the color the user picked, even when it is work", () => {
    renderView({ events: [calendarEvent({ isWork: true, color: "#34d399", hasCustomColor: true })] });

    expect(screen.getByTitle(/Standup/)).toHaveStyle({ borderLeft: "3px solid #34d399" });
  });

  it("paints an event with its category theme and icon", () => {
    const category: Category = { id: 2, name: "Deep work", color: "#a78bfa", icon: "Briefcase", style: "solid" };
    renderView({ categories: [category], events: [calendarEvent({ isWork: true, category })] });

    const block = screen.getByTitle(/Standup/);
    expect(block).toHaveStyle({ borderLeft: "3px solid #a78bfa" });
    expect(block.getAttribute("title")).toContain("Deep work");
  });

  it("lists the user's categories in an event's menu", async () => {
    const user = userEvent.setup();
    const category: Category = { id: 2, name: "Deep work", color: "#a78bfa", icon: "Briefcase", style: "solid" };
    renderView({ categories: [category], events: [calendarEvent()] });

    await user.click(screen.getByRole("button", { name: "Event actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /No category/ }));

    expect(await screen.findByRole("menuitem", { name: /Deep work/ })).toBeInTheDocument();
  });

  it("marks a copied event as local", () => {
    renderView({ events: [calendarEvent({ isLocal: true })] });

    expect(screen.getByText(/copy/)).toBeInTheDocument();
  });

  it("offers the mailbox default so an event can go back to it", async () => {
    const user = userEvent.setup();
    const category: Category = { id: 2, name: "Work", color: "#a78bfa", icon: "Briefcase", style: "solid" };
    const onSetEventCategory = vi.fn();
    renderView({
      accounts: [calendarAccount({ defaultCategory: category })],
      categories: [category],
      events: [calendarEvent({ category, categorySource: "account", isWork: true })],
      onSetEventCategory,
    });

    await user.click(screen.getByRole("button", { name: "Event actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Work/ }));
    // Radix's submenu items only select on a plain click under the test DOM.
    fireEvent.click(await screen.findByRole("menuitem", { name: /Mailbox default/ }));

    expect(onSetEventCategory).toHaveBeenCalledWith(expect.objectContaining({ cacheId: 9 }), null, true);
  });

  it("hides the mailbox default when the mailbox does not set one", async () => {
    const user = userEvent.setup();
    renderView({ accounts: [calendarAccount()], events: [calendarEvent()] });

    await user.click(screen.getByRole("button", { name: "Event actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /No category/ }));

    expect(screen.queryByRole("menuitem", { name: /Mailbox default/ })).not.toBeInTheDocument();
  });
});
