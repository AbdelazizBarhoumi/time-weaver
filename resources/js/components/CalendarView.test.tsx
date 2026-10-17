import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/utils";
import { CalendarView } from "@/components/CalendarView";
import { SIDE_TASK_DRAG_TYPE, type CalendarSettings, type SideTask } from "@/lib/calendar";

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
      placingId={null}
      sessions={[]}
      todaySlots={[]}
      density="work"
      onToggleWork={noop}
      onResetWork={noop}
      onDeleteEvent={noop}
      onCreateFocus={noop}
      onDeleteFocus={noop}
      onStartFocus={noop}
      onDeleteSession={noop}
      onPlaceTask={noop}
      onCompleteTask={noop}
      onDeleteTask={noop}
      onMoveTask={noop}
      onCancelPlacing={noop}
      {...props}
    />,
  );
}

function dayColumn(): HTMLElement {
  return document.querySelector("[data-day]") as HTMLElement;
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

  it("starts a focus block instead of placing when no task is armed", () => {
    const onCreateFocus = vi.fn();
    renderView({ onCreateFocus });

    const column = dayColumn();
    // Drag from 09:00 down to 12:00.
    fireEvent.mouseDown(column, { clientY: 0 });
    fireEvent.mouseMove(column, { clientY: 168 });
    fireEvent.mouseUp(column, { clientY: 168 });

    expect(onCreateFocus).toHaveBeenCalledWith(new Date(2026, 9, 14, 9, 0), new Date(2026, 9, 14, 12, 0));
  });

  it("shows a hint while a task is armed, and leaves on Esc", () => {
    const onCancelPlacing = vi.fn();
    renderView({ tasks: [task({ id: 4 })], placingId: 4, onCancelPlacing });

    expect(screen.getByText(/Click a time to place/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancelPlacing).toHaveBeenCalled();
  });
});
