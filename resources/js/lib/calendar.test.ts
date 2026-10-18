import { describe, expect, it } from "vitest";

import {
  blockingTaskIntervals,
  buildCoachContext,
  computeDayBudget,
  computeDayInsights,
  computeWorkableTimeLeft,
  freeIntervals,
  isRequiredDay,
  isSideTaskDone,
  isStaleSuggestion,
  isWorkDay,
  mergeIntervals,
  monthGrid,
  relativeTime,
  sameDay,
  sessionBands,
  sessionWorkIntervals,
  sideTaskEnd,
  sideTaskStatus,
  sortSideTasks,
  startOfWeek,
  staleSuggestionNote,
  subtractIntervals,
  summarizeDay,
  trackedMsOf,
  workWindow,
  type CalendarEvent,
  type CalendarSession,
  type CalendarSettings,
  type Interval,
  type SideTask,
} from "@/lib/calendar";
import type { Segment } from "@/lib/tracker";
import type { ApiMonthStats, ApiStats } from "@/lib/api";

const settings: CalendarSettings = {
  workStart: "09:00",
  workEnd: "17:00",
  workKeywords: [],
  workDays: [1, 2, 3, 4, 5],
  requiredDays: [1, 2, 3, 4, 5],
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
    cacheId: overrides.cacheId ?? 1,
    eventId: overrides.eventId ?? "event-1",
    recurringEventId: overrides.recurringEventId ?? null,
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

function makeTask(overrides: Partial<SideTask> = {}): SideTask {
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

describe("isRequiredDay", () => {
  it("marks configured required weekdays", () => {
    expect(isRequiredDay(wednesday, settings)).toBe(true);
    expect(isRequiredDay(saturday, settings)).toBe(false);
  });

  it("does not require a day that is only workable", () => {
    const optionalWeekend: CalendarSettings = { ...settings, workDays: [0, 1, 2, 3, 4, 5, 6] };
    expect(isWorkDay(saturday, optionalWeekend)).toBe(true);
    expect(isRequiredDay(saturday, optionalWeekend)).toBe(false);
  });

  it("falls back to Monday–Friday when no required days are set", () => {
    const empty: CalendarSettings = { ...settings, requiredDays: [] };
    expect(isRequiredDay(wednesday, empty)).toBe(true);
    expect(isRequiredDay(saturday, empty)).toBe(false);
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
    expect(budget.isRequiredDay).toBe(false);
    expect(budget.goalMs).toBe(0);
    expect(budget.remainingMs).toBe(0);
  });

  it("owes nothing on a workable-but-optional day, yet still credits tracked time", () => {
    const optionalWeekend: CalendarSettings = { ...settings, workDays: [0, 6] };
    const tracked = [{ start: new Date(at(saturday, 9)).getTime(), end: new Date(at(saturday, 10)).getTime() }];
    const budget = computeDayBudget({
      day: saturday,
      now: noon,
      events: [],
      focusBlocks: [],
      settings: optionalWeekend,
      trackedIntervals: tracked,
    });

    expect(budget.isWorkDay).toBe(true);
    expect(budget.isRequiredDay).toBe(false);
    expect(budget.goalMs).toBe(0);
    expect(budget.remainingMs).toBe(0);
    expect(budget.trackedMs).toBe(3_600_000);
  });

  it("suggests free gaps large enough to fit the remaining hours", () => {
    const budget = computeDayBudget({ day: wednesday, now: noon, events: [], focusBlocks: [], settings });
    // Noon to 17:00 is free, so the remaining target should be suggested there.
    expect(budget.remainingMs).toBe(8 * 3_600_000);
    expect(budget.slots.some((s) => s.suggested)).toBe(true);
  });

  it("shrinks the free gaps by a placed blocking task without touching the goal", () => {
    const window = { start: new Date(at(wednesday, 12)).getTime(), end: new Date(at(wednesday, 17)).getTime() };
    const extraBusy = blockingTaskIntervals([makeTask({ start: at(wednesday, 14), end: at(wednesday, 15) })], window);

    const budget = computeDayBudget({ day: wednesday, now: noon, events: [], focusBlocks: [], settings, extraBusy });

    // A task is not work, so what you still owe is unchanged…
    expect(budget.remainingMs).toBe(8 * 3_600_000);
    // …but it does eat an hour of the five still free today.
    expect(budget.freeLeftMs).toBe(4 * 3_600_000);
    expect(budget.overbooked).toBe(true);
  });
});

describe("computeWorkableTimeLeft", () => {
  const noon = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 12, 0).getTime();

  it("counts the whole window when nothing is on the calendar", () => {
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [], settings });
    // Noon → 17:00.
    expect(workable.windowMs).toBe(5 * 3_600_000);
    expect(workable.busyMs).toBe(0);
    expect(workable.remainingMs).toBe(5 * 3_600_000);
  });

  it("subtracts a non-work event that falls inside the window", () => {
    const event = makeEvent({ start: at(wednesday, 13), end: at(wednesday, 15) });
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [event], settings });
    expect(workable.busyMs).toBe(2 * 3_600_000);
    expect(workable.remainingMs).toBe(3 * 3_600_000);
  });

  it("clips an event that started before now", () => {
    const event = makeEvent({ start: at(wednesday, 11), end: at(wednesday, 13) });
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [event], settings });
    expect(workable.busyMs).toBe(3_600_000);
    expect(workable.remainingMs).toBe(4 * 3_600_000);
  });

  it("clips an event that runs past the end of the working day", () => {
    const event = makeEvent({ start: at(wednesday, 16), end: at(wednesday, 19) });
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [event], settings });
    expect(workable.busyMs).toBe(3_600_000);
    expect(workable.remainingMs).toBe(4 * 3_600_000);
  });

  it("does not double count overlapping events", () => {
    const events = [
      makeEvent({ start: at(wednesday, 13), end: at(wednesday, 14, 30) }),
      makeEvent({ start: at(wednesday, 14), end: at(wednesday, 15) }),
    ];
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events, settings });
    expect(workable.busyMs).toBe(2 * 3_600_000);
    expect(workable.remainingMs).toBe(3 * 3_600_000);
  });

  it("ignores work events and all-day events", () => {
    const events = [
      makeEvent({ isWork: true, start: at(wednesday, 13), end: at(wednesday, 15) }),
      makeEvent({ allDay: true, start: at(wednesday, 0), end: at(wednesday, 23) }),
    ];
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events, settings });
    expect(workable.busyMs).toBe(0);
    expect(workable.remainingMs).toBe(5 * 3_600_000);
  });

  it("clamps to zero when events fill the rest of the day", () => {
    const event = makeEvent({ start: at(wednesday, 12), end: at(wednesday, 17) });
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [event], settings });
    expect(workable.remainingMs).toBe(0);
  });

  it("starts the countdown at the work-start when it is still early", () => {
    const early = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 7).getTime();
    const workable = computeWorkableTimeLeft({ day: wednesday, now: early, events: [], settings });
    expect(workable.windowStartMs).toBe(new Date(at(wednesday, 9)).getTime());
    expect(workable.windowMs).toBe(8 * 3_600_000);
  });

  it("returns an empty window once the working day is over", () => {
    const late = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 18).getTime();
    const workable = computeWorkableTimeLeft({ day: wednesday, now: late, events: [], settings });
    expect(workable.windowMs).toBe(0);
    expect(workable.remainingMs).toBe(0);
  });

  it("flags non-working days", () => {
    const workable = computeWorkableTimeLeft({ day: saturday, now: noon, events: [], settings });
    expect(workable.isWorkDay).toBe(false);
    expect(workable.isRequiredDay).toBe(false);
  });

  it("counts a placed blocking task as busy time", () => {
    const window = { start: new Date(at(wednesday, 12)).getTime(), end: new Date(at(wednesday, 17)).getTime() };
    const extraBusy = blockingTaskIntervals(
      [makeTask({ start: at(wednesday, 14), end: at(wednesday, 15, 30) })],
      window,
    );

    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [], settings, extraBusy });

    expect(workable.busyMs).toBe(90 * 60_000);
    expect(workable.remainingMs).toBe(5 * 3_600_000 - 90 * 60_000);
  });
});

describe("side task helpers", () => {
  const noon = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 12, 0).getTime();

  it("treats a placed task whose slot has passed as done", () => {
    const task = makeTask({ start: at(wednesday, 9), end: at(wednesday, 11) });
    expect(isSideTaskDone(task, noon)).toBe(true);
  });

  it("leaves a placed task whose slot is still ahead live", () => {
    const task = makeTask({ start: at(wednesday, 15), end: at(wednesday, 16) });
    expect(isSideTaskDone(task, noon)).toBe(false);
  });

  it("marks a hand-ticked task done even before its slot starts", () => {
    const task = makeTask({ start: at(wednesday, 15), end: at(wednesday, 16), completedAt: at(wednesday, 12) });
    expect(isSideTaskDone(task, noon)).toBe(true);
  });

  it("never marks an unplaced task done just because time passes", () => {
    expect(isSideTaskDone(makeTask(), noon)).toBe(false);
  });

  it("names the three states", () => {
    expect(sideTaskStatus(makeTask(), noon)).toBe("unscheduled");
    expect(sideTaskStatus(makeTask({ start: at(wednesday, 15), end: at(wednesday, 16) }), noon)).toBe("scheduled");
    expect(sideTaskStatus(makeTask({ start: at(wednesday, 9), end: at(wednesday, 10) }), noon)).toBe("done");
  });

  it("reports the slot end only for a placed task", () => {
    expect(sideTaskEnd(makeTask())).toBeNull();
    expect(sideTaskEnd(makeTask({ end: at(wednesday, 11) }))).toBe(new Date(at(wednesday, 11)).getTime());
  });

  it("lists the unplaced tasks first, then the day's schedule", () => {
    const sorted = sortSideTasks([
      makeTask({ id: 3, start: at(wednesday, 15) }),
      makeTask({ id: 1 }),
      makeTask({ id: 2, start: at(wednesday, 9) }),
      makeTask({ id: 4 }),
    ]);

    expect(sorted.map((task) => task.id)).toEqual([1, 4, 2, 3]);
  });

  it("turns blocking, placed tasks into busy intervals clipped to the window", () => {
    const window = { start: new Date(at(wednesday, 12)).getTime(), end: new Date(at(wednesday, 17)).getTime() };
    const intervals = blockingTaskIntervals(
      [
        // Starts before the window: clipped at the front.
        makeTask({ id: 1, start: at(wednesday, 11), end: at(wednesday, 13) }),
        // Unplaced: ignored.
        makeTask({ id: 2 }),
        // Flexible: ignored.
        makeTask({ id: 3, blocksWork: false, start: at(wednesday, 14), end: at(wednesday, 15) }),
        // Entirely outside the window: dropped.
        makeTask({ id: 4, start: at(saturday, 9), end: at(saturday, 10) }),
        // Fully inside: kept whole.
        makeTask({ id: 5, start: at(wednesday, 15), end: at(wednesday, 16) }),
      ],
      window,
    );

    expect(intervals).toEqual([
      { start: new Date(at(wednesday, 12)).getTime(), end: new Date(at(wednesday, 13)).getTime() },
      { start: new Date(at(wednesday, 15)).getTime(), end: new Date(at(wednesday, 16)).getTime() },
    ]);
  });
});

describe("computeDayInsights", () => {
  const noon = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 12, 0).getTime();
  const base = { day: wednesday, now: noon, focusBlocks: [], settings };

  it("flags a day that is fully booked", () => {
    // Non-work events covering noon → 17:00 leave no free time.
    const events = [makeEvent({ start: at(wednesday, 12), end: at(wednesday, 17) })];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [] });
    expect(intel.insights.map((i) => i.id)).toContain("fully-booked");
  });

  it("flags a tight day where meetings dominate the window", () => {
    // 4h of meetings in the 5h remaining window = 80%.
    const events = [makeEvent({ start: at(wednesday, 13), end: at(wednesday, 17) })];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [] });
    expect(intel.insights.map((i) => i.id)).toContain("tight");
  });

  it("suggests a deep-work window when a long free gap exists", () => {
    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [] });
    const deep = intel.insights.find((i) => i.id === "deep-work");
    expect(deep).toBeDefined();
    expect(intel.longestGapMs).toBeGreaterThanOrEqual(90 * 60_000);
  });

  it("reports free time when the calendar is clear", () => {
    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [] });
    expect(intel.insights.map((i) => i.id)).toContain("free-time");
    expect(intel.facts.freeMs).toBe(5 * 3_600_000);
  });

  it("counts planned work as time left to work, not as busy time", () => {
    // A focus block fills the rest of the window: nothing is unbooked, but it is
    // work, so the pacing read-out must not claim the day is out of time.
    const focusBlocks = [{ id: 1, title: "Working", start: at(wednesday, 12), end: at(wednesday, 17) }];
    const intel = computeDayInsights({
      ...base,
      events: [],
      focusBlocks,
      trackedIntervals: [],
      perDayNeededHours: 4,
    });

    expect(intel.facts.freeMs).toBe(0);
    expect(intel.facts.workableMs).toBe(5 * 3_600_000);

    const monthly = intel.insights.find((i) => i.id === "monthly");
    expect(monthly?.tone).toBe("info");
    expect(monthly?.detail).toContain("5h left to work covers it");
  });

  it("warns when the time left to work falls short of the monthly pace", () => {
    const events = [makeEvent({ start: at(wednesday, 12), end: at(wednesday, 15) })];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [], perDayNeededHours: 4 });

    expect(intel.facts.workableMs).toBe(2 * 3_600_000);

    const monthly = intel.insights.find((i) => i.id === "monthly");
    expect(monthly?.tone).toBe("warn");
    expect(monthly?.detail).toContain("only 2h is left to work today");
  });

  it("subtracts meetings, blocking tasks and study from the time left to work", () => {
    const events = [makeEvent({ start: at(wednesday, 12), end: at(wednesday, 14) })];
    const extraBusy = blockingTaskIntervals(
      [makeTask({ start: at(wednesday, 14), end: at(wednesday, 15) })],
      workWindow(wednesday, settings),
    );
    const studyIntervals: Interval[] = [
      { start: new Date(at(wednesday, 15)).getTime(), end: new Date(at(wednesday, 16)).getTime() },
    ];

    const intel = computeDayInsights({ ...base, events, trackedIntervals: [], extraBusy, studyIntervals });

    expect(intel.facts.busyMs).toBe(4 * 3_600_000);
    expect(intel.facts.workableMs).toBe(3_600_000);
  });

  it("covers the backlog out of the workable time, not the unbooked gaps", () => {
    const focusBlocks = [{ id: 1, title: "Working", start: at(wednesday, 12), end: at(wednesday, 15) }];
    const intel = computeDayInsights({ ...base, events: [], focusBlocks, trackedIntervals: [], backlogHours: 2 });

    // Only 2h are unbooked, but the 3h focus block is work: 5h can absorb a 2h backlog.
    expect(intel.facts.freeMs).toBe(2 * 3_600_000);

    const backlog = intel.insights.find((i) => i.id === "backlog");
    expect(backlog?.detail).toContain("covers all of it");
  });

  it("says how much of the backlog today can absorb when work time is short", () => {
    const events = [makeEvent({ start: at(wednesday, 12), end: at(wednesday, 14) })];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [], backlogHours: 4 });

    expect(intel.facts.workableMs).toBe(3 * 3_600_000);

    const backlog = intel.insights.find((i) => i.id === "backlog");
    expect(backlog?.detail).toContain("Only 3h of work time is left today");
  });

  it("flags back-to-back meetings", () => {
    const events = [
      makeEvent({ start: at(wednesday, 13), end: at(wednesday, 14) }),
      makeEvent({ start: at(wednesday, 14), end: at(wednesday, 15) }),
      makeEvent({ start: at(wednesday, 15), end: at(wednesday, 16) }),
    ];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [] });
    expect(intel.insights.map((i) => i.id)).toContain("back-to-back");
  });

  it("flags an optional day as good", () => {
    const sunday = new Date(2026, 9, 18);
    const sundayNoon = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 12).getTime();
    const intel = computeDayInsights({
      day: sunday,
      now: sundayNoon,
      events: [],
      focusBlocks: [],
      trackedIntervals: [],
      settings: { ...settings, workDays: [0, 3, 4, 5, 6], requiredDays: [3, 4, 5] },
    });
    expect(intel.insights.map((i) => i.id)).toContain("optional-day");
  });

  it("warns when working on a day off", () => {
    const events = [makeEvent({ start: at(saturday, 13), end: at(saturday, 14) })];
    const satNoon = new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate(), 12).getTime();
    const intel = computeDayInsights({
      day: saturday,
      now: satNoon,
      events,
      focusBlocks: [],
      trackedIntervals: [],
      settings,
    });
    const dayOff = intel.insights.find((i) => i.id === "day-off");
    expect(dayOff?.tone).toBe("warn");
  });

  it("flags an overbooked required day as critical", () => {
    // A work event plus focus block cover the whole window, but the goal is still unmet.
    const events = [makeEvent({ isWork: true, start: at(wednesday, 12), end: at(wednesday, 17) })];
    const focus = [{ id: 1, title: "Focus", start: at(wednesday, 12), end: at(wednesday, 17) }];
    const intel = computeDayInsights({
      day: wednesday,
      now: noon,
      events,
      focusBlocks: focus,
      trackedIntervals: [],
      settings,
    });
    expect(intel.insights.some((i) => i.id === "overbooked" && i.tone === "critical")).toBe(true);
  });

  it("sorts worst tone first", () => {
    const events = [makeEvent({ start: at(wednesday, 12), end: at(wednesday, 17) })];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [] });
    const rank: Record<string, number> = { critical: 0, warn: 1, info: 2, good: 3 };
    for (let i = 1; i < intel.insights.length; i++) {
      const prev = intel.insights[i - 1];
      const curr = intel.insights[i];
      if (prev && curr) {
        expect(rank[prev.tone] ?? 99).toBeLessThanOrEqual(rank[curr.tone] ?? 99);
      }
    }
  });

  it("builds a facts payload for the coach", () => {
    const events = [makeEvent({ title: "Client sync", start: at(wednesday, 13), end: at(wednesday, 14) })];
    const intel = computeDayInsights({ ...base, events, trackedIntervals: [], backlogHours: 3.5, perDayNeededHours: 4 });
    expect(intel.facts.dayKey).toBe("2026-10-14");
    expect(intel.facts.meetings.length).toBe(1);
    expect(intel.facts.eventTitles).toContain("Client sync");
    expect(intel.facts.backlogHours).toBe(3.5);
    expect(intel.facts.perDayNeededHours).toBe(4);
  });

  it("counts a placed blocking task towards a fully booked day", () => {
    const window = { start: new Date(at(wednesday, 12)).getTime(), end: new Date(at(wednesday, 17)).getTime() };
    const extraBusy = blockingTaskIntervals([makeTask({ start: at(wednesday, 12), end: at(wednesday, 17) })], window);

    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [], extraBusy });

    expect(intel.insights.map((i) => i.id)).toContain("fully-booked");
    expect(intel.facts.freeMs).toBe(0);
    // Tasks are not meetings, so the coach's meeting list stays empty.
    expect(intel.facts.meetings).toEqual([]);
  });

  it("reports study time and never lets it touch the goal", () => {
    const studyIntervals: Interval[] = [
      { start: new Date(at(wednesday, 13)).getTime(), end: new Date(at(wednesday, 15)).getTime() },
    ];

    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [], studyIntervals });

    expect(intel.insights.map((i) => i.id)).toContain("study-planned");
    // Two studied hours are busy but never owed…
    expect(intel.facts.studyMs).toBe(2 * 3_600_000);
    expect(intel.facts.studyTodayMs).toBe(2 * 3_600_000);
    expect(intel.facts.busyMs).toBe(2 * 3_600_000);
    // …so the goal is untouched and only the free time shrinks.
    expect(intel.facts.goalMs).toBe(8 * 3_600_000);
    expect(intel.facts.freeMs).toBe(3 * 3_600_000);
  });

  it("counts only the study still ahead in studyMs, but the whole day in studyTodayMs", () => {
    const studyIntervals: Interval[] = [
      // Already finished before noon.
      { start: new Date(at(wednesday, 9)).getTime(), end: new Date(at(wednesday, 10)).getTime() },
      // Still to come.
      { start: new Date(at(wednesday, 15)).getTime(), end: new Date(at(wednesday, 16)).getTime() },
    ];

    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [], studyIntervals });

    expect(intel.facts.studyMs).toBe(1 * 3_600_000);
    expect(intel.facts.studyTodayMs).toBe(2 * 3_600_000);
  });

  it("names the day's study blocks for the coach", () => {
    const studyBlocks = [
      { title: "German grammar", start: at(wednesday, 13), end: at(wednesday, 15) },
    ];

    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [], studyBlocks });

    expect(intel.facts.studySessions).toEqual([
      { title: "German grammar", start: at(wednesday, 13), end: at(wednesday, 15) },
    ]);
    // Study blocks are not meetings.
    expect(intel.facts.meetings).toEqual([]);
  });

  it("warns when study has eaten the day's only focus gap", () => {
    // The whole noon–17:00 window would be one 5h gap, until 2h of study splits it.
    const studyIntervals: Interval[] = [
      { start: new Date(at(wednesday, 12, 30)).getTime(), end: new Date(at(wednesday, 14, 30)).getTime() },
    ];

    const intel = computeDayInsights({ ...base, events: [], trackedIntervals: [], studyIntervals });

    expect(intel.insights.map((i) => i.id)).toContain("study-eats-gap");
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
    expect(summary.isRequiredDay).toBe(false);
    expect(summary.goalMs).toBe(0);
    expect(summary.remainingMs).toBe(0);
  });

  it("counts weekend work on an optional day without a goal", () => {
    const optionalWeekend: CalendarSettings = { ...settings, workDays: [0, 6] };
    const summary = summarizeDay({
      day: saturday,
      events: [],
      focusBlocks: [],
      trackedIntervals: [
        { start: new Date(at(saturday, 9)).getTime(), end: new Date(at(saturday, 11)).getTime() },
      ],
      settings: optionalWeekend,
    });

    expect(summary.isWorkDay).toBe(true);
    expect(summary.isRequiredDay).toBe(false);
    expect(summary.goalMs).toBe(0);
    expect(summary.doneMs).toBe(2 * 3_600_000);
    expect(summary.remainingMs).toBe(0);
    expect(summary.progress).toBe(0);
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

function session(overrides: Partial<CalendarSession> = {}): CalendarSession {
  const start = overrides.start ?? at(wednesday, 9);
  const end = overrides.end === undefined ? at(wednesday, 10) : overrides.end;

  return {
    id: 1,
    note: "Tracked",
    source: "manual",
    segmentsInferred: false,
    ...overrides,
    start,
    end,
    segments: overrides.segments ?? [{ type: "work", start, end }],
  };
}

/** 09–11 work, 11–12 pause, 12–13 work. */
function pausedSession(): CalendarSession {
  const segments: Segment[] = [
    { type: "work", start: at(wednesday, 9), end: at(wednesday, 11) },
    { type: "pause", start: at(wednesday, 11), end: at(wednesday, 12) },
    { type: "work", start: at(wednesday, 12), end: at(wednesday, 13) },
  ];

  return session({ end: at(wednesday, 13), segments });
}

describe("sessionBands", () => {
  it("clips a session to one day", () => {
    const start = new Date(at(wednesday, 15)).getTime();
    const end = new Date(at(wednesday, 17)).getTime();
    const band = { id: 1, start: at(wednesday, 15), end: at(wednesday, 17), note: "Deep work", source: "manual" as const };

    const bands = sessionBands([session({ ...band })], wednesday, new Date(at(wednesday, 18)).getTime());
    expect(bands).toHaveLength(1);
    expect(bands[0]!.start).toBe(start);
    expect(bands[0]!.end).toBe(end);
  });

  it("extends a running session up to now", () => {
    const now = new Date(at(wednesday, 15, 30)).getTime();
    const bands = sessionBands([session({ id: 2, start: at(wednesday, 14), end: null })], wednesday, now);

    expect(bands).toHaveLength(1);
    expect(bands[0]!.start).toBe(new Date(at(wednesday, 14)).getTime());
    expect(bands[0]!.end).toBe(now);
  });

  it("ignores sessions that fall on other days", () => {
    const bands = sessionBands([session({ id: 3, start: at(saturday, 9), end: at(saturday, 10) })], wednesday, Date.now());
    expect(bands).toHaveLength(0);
  });

  it("splits a paused session into one band per work segment", () => {
    const bands = sessionBands([pausedSession()], wednesday, new Date(at(wednesday, 18)).getTime());

    expect(bands).toHaveLength(2);
    expect(bands[0]!.start).toBe(new Date(at(wednesday, 9)).getTime());
    expect(bands[0]!.end).toBe(new Date(at(wednesday, 11)).getTime());
    expect(bands[1]!.start).toBe(new Date(at(wednesday, 12)).getTime());
    expect(bands[1]!.end).toBe(new Date(at(wednesday, 13)).getTime());
  });

  it("still draws a session that has no breakdown", () => {
    const bands = sessionBands([session({ segments: [] })], wednesday, new Date(at(wednesday, 18)).getTime());

    expect(bands).toHaveLength(1);
    expect(bands[0]!.start).toBe(new Date(at(wednesday, 9)).getTime());
    expect(bands[0]!.end).toBe(new Date(at(wednesday, 10)).getTime());
  });
});

describe("sessionWorkIntervals", () => {
  it("returns only the work segments, excluding pauses", () => {
    const intervals = sessionWorkIntervals(pausedSession(), new Date(at(wednesday, 18)).getTime());

    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toEqual({ start: new Date(at(wednesday, 9)).getTime(), end: new Date(at(wednesday, 11)).getTime() });
    expect(intervals[1]).toEqual({ start: new Date(at(wednesday, 12)).getTime(), end: new Date(at(wednesday, 13)).getTime() });
  });

  it("grows an open work segment up to now", () => {
    const now = new Date(at(wednesday, 15, 30)).getTime();
    const running = session({ end: null, segments: [{ type: "work", start: at(wednesday, 14), end: null }] });

    expect(sessionWorkIntervals(running, now)).toEqual([{ start: new Date(at(wednesday, 14)).getTime(), end: now }]);
  });
});

describe("trackedMsOf", () => {
  it("sums work segments, ignoring paused time", () => {
    expect(trackedMsOf(pausedSession(), new Date(at(wednesday, 18)).getTime())).toBe(3 * 3_600_000);
  });

  it("falls back to start–end when no breakdown exists", () => {
    expect(trackedMsOf(session({ segments: [] }), Date.now())).toBe(3_600_000);
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 9, 14, 12, 0, 0).getTime();

  it("formats recent, minute, hour and day distances", () => {
    expect(relativeTime(new Date(now - 20_000).toISOString(), now)).toBe("just now");
    expect(relativeTime(new Date(now - 12 * 60_000).toISOString(), now)).toBe("12m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d ago");
  });
});

describe("buildCoachContext", () => {
  const noon = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 12, 0).getTime();
  const intel = computeDayInsights({ day: wednesday, now: noon, focusBlocks: [], settings, events: [], trackedIntervals: [] });
  const stats: ApiStats = {
    streak: 4,
    weekHours: 16,
    bestDayHours: 9,
    avgPerActiveDay: 7,
    totalHours: 120,
    backlogHours: 2.5,
    studyWeekHours: 0,
    studyTotalHours: 0,
    studyBestDayHours: 0,
  };
  const month: ApiMonthStats = {
    key: "2026-10",
    label: "October 2026",
    doneHours: 60,
    targetHours: 176,
    remainingHours: 116,
    daysLeft: 12,
    perDayNeeded: 9.7,
    paceDeltaHours: -4,
    progress: 0.34,
    isCurrent: true,
  };

  it("carries today's facts and the local now", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon, stats, month });

    expect(ctx.now).toBe(new Date(noon).toISOString());
    expect(ctx.today).toEqual(intel.facts);
    expect(ctx.dailyGoalHours).toBe(8);
  });

  it("names the browser timezone so the coach can convert UTC instants", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon, stats, month });

    expect(ctx.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    expect(ctx.utcOffsetMinutes).toBe(-new Date(noon).getTimezoneOffset());
  });

  it("derives the week target from the required weekdays", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon, stats, month });

    const { days, ...week } = ctx.week!;
    expect(week).toEqual({
      startDayKey: "2026-10-12",
      requiredDays: [1, 2, 3, 4, 5],
      targetHours: 40,
      doneHours: 16,
      remainingHours: 24,
    });
    // Every day of the week is described so the coach never has to guess a slot.
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.dayKey)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });

  it("scales the week target to a shorter required week", () => {
    const ctx = buildCoachContext({
      intel,
      settings: { ...settings, requiredDays: [1, 2, 3] },
      now: noon,
      stats: { ...stats, weekHours: 30 },
    });

    expect(ctx.week?.targetHours).toBe(24);
    expect(ctx.week?.remainingHours).toBe(0);
  });

  it("describes every day of the week so the coach never invents a slot", () => {
    // Wed 14 Oct 2026, noon. Mon–Fri are work days, the weekend is off.
    const days = buildCoachContext({ intel, settings, now: noon, stats, month }).week!.days;

    // Today: free time is what is left from noon to the 17:00 window end.
    const today = days.find((d) => d.isToday)!;
    expect(today.dayKey).toBe("2026-10-14");
    expect(today.weekday).toBe("Wednesday");
    expect(today.windowStart).toBe("09:00");
    expect(today.windowEnd).toBe("17:00");
    expect(today.freeHours).toBe(5);

    // Past days are already spent, so they offer nothing.
    expect(days.find((d) => d.dayKey === "2026-10-12")!.freeHours).toBe(0);

    // A future work day keeps its whole window.
    expect(days.find((d) => d.dayKey === "2026-10-15")!.freeHours).toBe(8);

    // The weekend is not a work day, so it has no window at all.
    const saturdayRow = days.find((d) => d.dayKey === "2026-10-17")!;
    expect(saturdayRow.isWorkDay).toBe(false);
    expect(saturdayRow.windowStart).toBeNull();
    expect(saturdayRow.windowEnd).toBeNull();
  });

  it("counts a blocking side task as busy on the day it is placed", () => {
    const placed = makeTask({ id: 4, start: at(wednesday, 10), end: at(wednesday, 12), blocksWork: true });
    const days = buildCoachContext({ intel, settings, now: noon, stats, month, tasks: [placed] }).week!.days;

    const today = days.find((d) => d.isToday)!;
    expect(today.busyHours).toBe(2);
    // 12:00→17:00 is 5h free, all of it after the 2h task.
    expect(today.freeHours).toBe(5);
  });

  it("subtracts a busy calendar event from the free time it offers", () => {
    const meeting = makeEvent({ title: "Sync", start: at(wednesday, 13), end: at(wednesday, 15) });
    const days = buildCoachContext({ intel, settings, now: noon, stats, month, events: [meeting] }).week!.days;

    const today = days.find((d) => d.isToday)!;
    expect(today.busyHours).toBe(2);
    expect(today.freeHours).toBe(3);
  });

  it("passes the month figures through and nulls them out when absent", () => {
    const withMonth = buildCoachContext({ intel, settings, now: noon, stats, month });
    expect(withMonth.month?.perDayNeeded).toBe(9.7);
    expect(withMonth.month?.daysLeft).toBe(12);

    const withoutMonth = buildCoachContext({ intel, settings, now: noon, stats });
    expect(withoutMonth.month).toBeNull();
  });

  it("nulls the stats-derived fields when stats are missing", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon });

    expect(ctx.backlogHours).toBeNull();
    expect(ctx.streak).toBeNull();
    expect(ctx.week?.doneHours).toBe(0);
  });

  it("sends no tasks when there are none", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon });

    expect(ctx.tasks).toEqual([]);
    expect(ctx.tasksSummary).toEqual({
      total: 0,
      unplaced: 0,
      scheduled: 0,
      done: 0,
      unplacedEstimateHours: 0,
      blockingHoursToday: 0,
    });
  });

  it("sends the live tasks plus the ones already finished today", () => {
    const ctx = buildCoachContext({
      intel,
      settings,
      now: noon,
      tasks: [
        // Unplaced, still to do.
        makeTask({ id: 1, title: "Clean the room" }),
        // Placed later today.
        makeTask({ id: 2, start: at(wednesday, 15), end: at(wednesday, 16) }),
        // Finished today — worth telling the coach so it does not re-suggest it.
        makeTask({ id: 3, start: at(wednesday, 9), end: at(wednesday, 10), completedAt: at(wednesday, 10) }),
        // Finished on an earlier day — the coach does not need it.
        makeTask({ id: 4, start: at(saturday, 9), end: at(saturday, 10), completedAt: at(saturday, 10) }),
      ],
    });

    expect(ctx.tasks.map((task) => task.id)).toEqual([1, 2, 3]);
    expect(ctx.tasks.find((task) => task.id === 3)?.done).toBe(true);
    expect(ctx.tasksSummary).toEqual({
      total: 4,
      unplaced: 1,
      scheduled: 1,
      done: 2,
      unplacedEstimateHours: 0.5,
      blockingHoursToday: 1,
    });
  });

  it("measures the blocking task time still ahead today", () => {
    const ctx = buildCoachContext({
      intel,
      settings,
      now: noon,
      tasks: [
        // Already over by noon: contributes nothing to the hours still ahead.
        makeTask({ id: 1, start: at(wednesday, 9), end: at(wednesday, 11) }),
        // Flexible: never blocks work.
        makeTask({ id: 2, blocksWork: false, start: at(wednesday, 13), end: at(wednesday, 14) }),
        // 14:00 → 15:30 still ahead of us.
        makeTask({ id: 3, start: at(wednesday, 14), end: at(wednesday, 15, 30) }),
      ],
    });

    expect(ctx.tasksSummary.blockingHoursToday).toBe(1.5);
  });

  it("caps how many tasks it sends to keep the prompt bounded", () => {
    const many = Array.from({ length: 45 }, (_, i) => makeTask({ id: i + 1, title: `Task ${i + 1}` }));
    const ctx = buildCoachContext({ intel, settings, now: noon, tasks: many });

    expect(ctx.tasks).toHaveLength(40);
    expect(ctx.tasksSummary.total).toBe(45);
    expect(ctx.tasksSummary.unplaced).toBe(45);
  });

  it("echoes the working settings so the coach never has to ask for them", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon });

    expect(ctx.settings).toEqual(settings);
  });

  it("describes a rolling two-week horizon starting today", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon });

    expect(ctx.horizon.from).toBe(new Date(2026, 9, 14).toISOString());
    expect(ctx.horizon.to).toBe(new Date(2026, 9, 28).toISOString());
    expect(ctx.horizon.days).toHaveLength(14);
    expect(ctx.horizon.days[0]!.dayKey).toBe("2026-10-14");
    expect(ctx.horizon.days[13]!.dayKey).toBe("2026-10-27");
  });

  it("keeps tomorrow in the horizon even when it falls in the next week", () => {
    // Sunday: the Monday-start week stops today, so tomorrow is outside week.days.
    const sunday = new Date(2026, 9, 18, 12, 0, 0);
    const sundayIntel = computeDayInsights({
      day: sunday,
      now: sunday.getTime(),
      focusBlocks: [],
      settings,
      events: [],
      trackedIntervals: [],
    });
    const ctx = buildCoachContext({ intel: sundayIntel, settings, now: sunday.getTime(), stats, month });

    expect(ctx.week!.days.map((d) => d.dayKey)).not.toContain("2026-10-19");

    // …but the horizon always reaches it, with its window and required flag, so
    // the coach can answer "when must I work tomorrow" without any events.
    const tomorrow = ctx.horizon.days[1]!;
    expect(tomorrow.dayKey).toBe("2026-10-19");
    expect(tomorrow.weekday).toBe("Monday");
    expect(tomorrow.isRequired).toBe(true);
    expect(tomorrow.windowStart).toBe("09:00");
    expect(tomorrow.windowEnd).toBe("17:00");
    expect(tomorrow.freeHours).toBe(8);
    expect(tomorrow.isPast).toBe(false);
  });

  it("flags horizon days the loaded range does not cover", () => {
    const ctx = buildCoachContext({
      intel,
      settings,
      now: noon,
      coverage: { from: new Date(2026, 9, 14).toISOString(), to: new Date(2026, 9, 16).toISOString() },
    });

    expect(ctx.horizon.days[0]!.dataCovered).toBe(true);
    expect(ctx.horizon.days[1]!.dataCovered).toBe(true);
    // The range ends at midnight on the 16th, so that whole day is not covered.
    expect(ctx.horizon.days[2]!.dataCovered).toBe(false);
    expect(ctx.horizon.days[3]!.dataCovered).toBe(false);
  });

  it("treats every day as uncovered until an event range is loaded", () => {
    const ctx = buildCoachContext({ intel, settings, now: noon });

    expect(ctx.coverage).toBeNull();
    expect(ctx.horizon.days.every((day) => !day.dataCovered)).toBe(true);
  });
});

describe("isStaleSuggestion", () => {
  const now = new Date(2026, 9, 14, 12, 0, 0).getTime();

  it("flags a slot that has already passed", () => {
    expect(isStaleSuggestion(new Date(2026, 9, 14, 11, 0).toISOString(), now)).toBe(true);
    expect(isStaleSuggestion(new Date(2026, 9, 13, 16, 0).toISOString(), now)).toBe(true);
  });

  it("leaves a future slot alone", () => {
    expect(isStaleSuggestion(new Date(2026, 9, 14, 13, 0).toISOString(), now)).toBe(false);
    expect(isStaleSuggestion(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe(false);
  });
});

describe("staleSuggestionNote", () => {
  const now = new Date(2026, 9, 14, 12, 0, 0).getTime();

  it("returns null for a live slot, so the UI keeps its normal styling", () => {
    expect(staleSuggestionNote(new Date(2026, 9, 14, 14, 0).toISOString(), now)).toBeNull();
  });

  it("names the clock when the slot was earlier today", () => {
    const note = staleSuggestionNote(new Date(2026, 9, 14, 11, 0).toISOString(), now);
    expect(note).toContain("already passed today");
  });

  it("names the weekday when the slot was on an earlier day", () => {
    const note = staleSuggestionNote(new Date(2026, 9, 12, 9, 0).toISOString(), now);
    expect(note).toContain("Monday");
    expect(note).toContain("already passed");
  });
});

describe("study sessions", () => {
  const noon = new Date(wednesday.getFullYear(), wednesday.getMonth(), wednesday.getDate(), 12, 0).getTime();
  /** A study block from 13:00 to 15:00, as the calendar route feeds it — busy time. */
  const studyBusy: Interval[] = [
    { start: new Date(at(wednesday, 13)).getTime(), end: new Date(at(wednesday, 15)).getTime() },
  ];

  it("blocks the remaining work window like a meeting would", () => {
    const workable = computeWorkableTimeLeft({ day: wednesday, now: noon, events: [], settings, extraBusy: studyBusy });

    expect(workable.busyMs).toBe(2 * 3_600_000);
    expect(workable.remainingMs).toBe(3 * 3_600_000);
  });

  it("shrinks the free gaps without touching the daily goal", () => {
    const budget = computeDayBudget({
      day: wednesday,
      now: noon,
      events: [],
      focusBlocks: [],
      settings,
      extraBusy: studyBusy,
    });

    // What you still owe is unchanged…
    expect(budget.remainingMs).toBe(8 * 3_600_000);
    // …but the two studied hours are no longer free to suggest.
    expect(budget.freeLeftMs).toBe(3 * 3_600_000);
  });

  it("is still drawn as working time on the calendar", () => {
    const study = session({ id: 9, start: at(wednesday, 9), end: at(wednesday, 11), type: "study" });
    const now = new Date(at(wednesday, 18)).getTime();

    expect(sessionBands([study], wednesday, now)).toHaveLength(1);
    expect(sessionWorkIntervals(study, now)).toEqual([
      { start: new Date(at(wednesday, 9)).getTime(), end: new Date(at(wednesday, 11)).getTime() },
    ]);
  });

  it("keeps study time out of the day summary goal", () => {
    // The calendar route never passes study intervals as tracked time, so the
    // goal bar moves only for work.
    const summary = summarizeDay({ day: wednesday, events: [], focusBlocks: [], trackedIntervals: [], settings });

    expect(summary.doneMs).toBe(0);
    expect(summary.remainingMs).toBe(8 * 3_600_000);
  });

  it("gives the coach a study block that never counts as work", () => {
    const study = session({ id: 9, start: at(wednesday, 13), end: at(wednesday, 15), type: "study", note: "German grammar" });
    const intel = computeDayInsights({
      day: wednesday,
      now: noon,
      events: [],
      focusBlocks: [],
      trackedIntervals: [],
      settings,
      studyIntervals: [{ start: new Date(at(wednesday, 13)).getTime(), end: new Date(at(wednesday, 15)).getTime() }],
      studyBlocks: [{ title: "German grammar", start: at(wednesday, 13), end: at(wednesday, 15) }],
    });

    const ctx = buildCoachContext({ intel, settings, now: noon, studySessions: [study] });

    expect(ctx.study.todayHours).toBe(2);
    expect(ctx.study.remainingTodayHours).toBe(2);
    expect(ctx.study.weekHours).toBe(2);
    expect(ctx.study.sessions).toEqual([
      { title: "German grammar", start: at(wednesday, 13), end: at(wednesday, 15) },
    ]);
  });

  it("keeps work sessions out of the study block", () => {
    const work = session({ id: 1, start: at(wednesday, 9), end: at(wednesday, 11), type: "work" });
    const intel = computeDayInsights({ day: wednesday, now: noon, events: [], focusBlocks: [], trackedIntervals: [], settings });

    const ctx = buildCoachContext({ intel, settings, now: noon, studySessions: [work] });

    expect(ctx.study.weekHours).toBe(0);
    expect(ctx.study.sessions).toEqual([]);
  });
});
