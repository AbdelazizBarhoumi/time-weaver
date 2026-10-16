import { describe, expect, it } from "vitest";

import {
  computeDayBudget,
  freeIntervals,
  isWorkDay,
  mergeIntervals,
  monthGrid,
  sameDay,
  startOfWeek,
  subtractIntervals,
  summarizeDay,
  workWindow,
  type CalendarEvent,
  type CalendarSettings,
  type Interval,
} from "@/lib/calendar";

const settings: CalendarSettings = {
  workStart: "09:00",
  workEnd: "17:00",
  workKeywords: [],
  workDays: [1, 2, 3, 4, 5],
};

/** Wednesday */
const wednesday = new Date(2026, 9, 14, 0, 0, 0, 0);
/** Saturday */
const saturday = new Date(2026, 9, 17, 0, 0, 0, 0);

function at(day: Date, hour: number, minute = 0): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString();
}

function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: overrides.id ?? overrides.eventId ?? "event-1",
    eventId: overrides.eventId ?? "event-1",
    accountId: 1,
    accountEmail: "me@example.com",
    accountColor: "#5b9cff",
    calendarId: "primary",
    calendarName: "Primary",
    title: "Event",
    start: at(wednesday, 9, 0),
    end: at(wednesday, 10, 0),
    allDay: false,
    isWork: false,
    workSource: null,
    ...overrides,
  };
}

describe("isWorkDay", () => {
  it("marks configured weekdays as working days", () => {
    expect(isWorkDay(wednesday, settings)).toBe(true);
  });

  it("marks days outside the working week as off", () => {
    expect(isWorkDay(saturday, settings)).toBe(false);
  });

  it("honours a custom working week", () => {
    const weekendOnly: CalendarSettings = { ...settings, workDays: [0, 6] };
    expect(isWorkDay(saturday, weekendOnly)).toBe(true);
    expect(isWorkDay(wednesday, weekendOnly)).toBe(false);
  });

  it("falls back to Monday–Friday when no working days are set", () => {
    const empty: CalendarSettings = { ...settings, workDays: [] };
    expect(isWorkDay(wednesday, empty)).toBe(true);
    expect(isWorkDay(saturday, empty)).toBe(false);
  });
});

describe("workWindow", () => {
  it("maps the configured clock times to a day interval", () => {
    const win = workWindow(wednesday, settings);
    expect(new Date(win.start).getHours()).toBe(9);
    expect(new Date(win.end).getHours()).toBe(17);
    expect(win.end - win.start).toBe(8 * 3_600_000);
  });
});

describe("interval maths", () => {
  it("merges overlapping intervals", () => {
    const merged = mergeIntervals([
      { start: 0, end: 10 },
      { start: 5, end: 15 },
      { start: 30, end: 40 },
    ]);
    expect(merged).toEqual([
      { start: 0, end: 15 },
      { start: 30, end: 40 },
    ]);
  });

  it("subtracts an overlapping interval and splits the remainder", () => {
    const result = subtractIntervals([{ start: 0, end: 60 }], [{ start: 20, end: 40 }]);
    expect(result).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 60 },
    ]);
  });

  it("drops fully covered intervals", () => {
    expect(subtractIntervals([{ start: 10, end: 20 }], [{ start: 0, end: 30 }])).toEqual([]);
  });

  it("finds the free gaps in a window", () => {
    const free = freeIntervals({ start: 0, end: 100 }, [{ start: 20, end: 40 }]);
    expect(free).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 100 },
    ]);
  });
});

describe("computeDayBudget", () => {
  const noon = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 12, 0).getTime();

  it("does not double count a work event that is also tracked", () => {
    const event = makeEvent({ isWork: true, start: at(wednesday, 9), end: at(wednesday, 10) });
    const tracked: Interval[] = [
      { start: new Date(at(wednesday, 9)).getTime(), end: new Date(at(wednesday, 10)).getTime() },
    ];

    const budget = computeDayBudget({
      day: wednesday,
      now: noon,
      events: [event],
      focusBlocks: [],
      settings,
      trackedIntervals: tracked,
    });

    expect(budget.trackedMs).toBe(3_600_000);
    expect(budget.workEventsDoneMs).toBe(0);
    expect(budget.remainingMs).toBe(7 * 3_600_000);
  });

  it("counts an untracked past work event as done", () => {
    const event = makeEvent({ isWork: true, start: at(wednesday, 9), end: at(wednesday, 10) });
    const budget = computeDayBudget({ day: wednesday, now: noon, events: [event], focusBlocks: [], settings });
    expect(budget.workEventsDoneMs).toBe(3_600_000);
    expect(budget.remainingMs).toBe(7 * 3_600_000);
  });

  it("counts future work events and focus blocks as planned", () => {
    const event = makeEvent({ isWork: true, start: at(wednesday, 14), end: at(wednesday, 15) });
    const focus = { id: 1, title: "Focus", start: at(wednesday, 15), end: at(wednesday, 16) };
    const budget = computeDayBudget({
      day: wednesday,
      now: noon,
      events: [event],
      focusBlocks: [focus],
      settings,
    });
    expect(budget.plannedMs).toBe(2 * 3_600_000);
    expect(budget.remainingMs).toBe(6 * 3_600_000);
  });

  it("has a zero goal and nothing remaining on a non-working day", () => {
    const budget = computeDayBudget({ day: saturday, now: noon, events: [], focusBlocks: [], settings });
    expect(budget.isWorkDay).toBe(false);
    expect(budget.goalMs).toBe(0);
    expect(budget.remainingMs).toBe(0);
  });

  it("suggests free gaps large enough to fit the remaining hours", () => {
    const budget = computeDayBudget({ day: wednesday, now: noon, events: [], focusBlocks: [], settings });
    // Noon to 17:00 is free, so the remaining target should be suggested there.
    expect(budget.remainingMs).toBe(8 * 3_600_000);
    expect(budget.slots.some((s) => s.suggested)).toBe(true);
  });
});

describe("summarizeDay", () => {
  it("deduplicates tracked time and work events", () => {
    const event = makeEvent({ isWork: true, start: at(wednesday, 9), end: at(wednesday, 10) });
    const summary = summarizeDay({
      day: wednesday,
      events: [event],
      focusBlocks: [],
      trackedIntervals: [
        { start: new Date(at(wednesday, 9)).getTime(), end: new Date(at(wednesday, 10)).getTime() },
      ],
      settings,
    });

    expect(summary.doneMs).toBe(3_600_000);
    expect(summary.trackedMs).toBe(3_600_000);
    expect(summary.remainingMs).toBe(7 * 3_600_000);
  });

  it("gives a full goal on a working day, ignoring all-day events", () => {
    const summary = summarizeDay({
      day: wednesday,
      events: [makeEvent({ allDay: true })],
      focusBlocks: [],
      trackedIntervals: [],
      settings,
    });
    expect(summary.goalMs).toBe(8 * 3_600_000);
    expect(summary.doneMs).toBe(0);
  });

  it("gives no goal on a day off", () => {
    const summary = summarizeDay({ day: saturday, events: [], focusBlocks: [], trackedIntervals: [], settings });
    expect(summary.isWorkDay).toBe(false);
    expect(summary.goalMs).toBe(0);
    expect(summary.remainingMs).toBe(0);
  });
});

describe("monthGrid", () => {
  it("returns whole weeks that cover the month", () => {
    const cells = monthGrid(new Date(2026, 9, 14));
    expect(cells.length % 7).toBe(0);
    expect(sameDay(cells[0]!, startOfWeek(new Date(2026, 9, 1)))).toBe(true);
    expect(cells.some((c) => c.getMonth() === 9 && c.getDate() === 31)).toBe(true);
  });
});
