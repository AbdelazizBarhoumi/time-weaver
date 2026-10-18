import { describe, it, expect } from "vitest";
import {
  allDayKeyMs,
  dayKeyStartMs,
  localDayKey,
  localDayKeyOfMs,
  movedBounds,
  msToAllDayKey,
  previewBounds,
  resizedBounds,
  snapMinute,
  type DragEntity,
} from "@/lib/blockDrag";
import type { SideTask } from "@/lib/calendar";

const payload: SideTask = {
  id: 1,
  title: "Task",
  estimateMinutes: 60,
  blocksWork: true,
  start: null,
  end: null,
  completedAt: null,
  done: false,
};

function at(hour: number, minute = 0): number {
  return new Date(2026, 9, 14, hour, minute).getTime();
}

function entity(overrides: Partial<DragEntity> = {}): DragEntity {
  return { kind: "task", key: "t-1", allDay: false, start: at(15), end: at(16), payload, ...overrides };
}

describe("block drag geometry", () => {
  it("snaps minutes to the nearest quarter hour", () => {
    expect(snapMinute(781)).toBe(780);
    expect(snapMinute(788)).toBe(795);
    expect(snapMinute(60, 30)).toBe(60);
  });

  it("round-trips local day keys", () => {
    expect(localDayKey(new Date(2026, 9, 14))).toBe("2026-10-14");
    expect(localDayKeyOfMs(at(23, 59))).toBe("2026-10-14");
    expect(dayKeyStartMs("2026-10-14")).toBe(new Date(2026, 9, 14).getTime());
  });

  it("anchors all-day keys to UTC midnight", () => {
    expect(allDayKeyMs("2026-10-14")).toBe(Date.parse("2026-10-14T00:00:00Z"));
    expect(msToAllDayKey(allDayKeyMs("2026-10-14"))).toBe("2026-10-14");
  });

  it("moves a timed block keeping its grab point and length", () => {
    const bounds = movedBounds(entity(), "2026-10-15", 13 * 60, 0);

    expect(bounds.start).toBe(new Date(2026, 9, 15, 13, 0).getTime());
    expect(bounds.end).toBe(new Date(2026, 9, 15, 14, 0).getTime());
  });

  it("honours the grab offset when the block is grabbed mid-way", () => {
    // Grabbed 30 minutes in; the pointer at 13:30 lands the block at 13:00.
    const bounds = movedBounds(entity(), "2026-10-14", 13 * 60 + 30, 30);

    expect(bounds.start).toBe(new Date(2026, 9, 14, 13, 0).getTime());
  });

  it("shifts an all-day event by whole days and ignores the minute", () => {
    const allDay = entity({
      allDay: true,
      start: allDayKeyMs("2026-10-14"),
      end: allDayKeyMs("2026-10-15"),
    });

    const bounds = movedBounds(allDay, "2026-10-17", 5 * 60, 0);

    expect(msToAllDayKey(bounds.start)).toBe("2026-10-17");
    expect(msToAllDayKey(bounds.end)).toBe("2026-10-18");
  });

  it("stretches the end edge without moving the start", () => {
    const bounds = resizedBounds(entity(), 17 * 60, "resize-end");

    expect(bounds.start).toBe(at(15));
    expect(bounds.end).toBe(at(17));
  });

  it("stretches the start edge without moving the end", () => {
    const bounds = resizedBounds(entity(), 14 * 60, "resize-start");

    expect(bounds.start).toBe(at(14));
    expect(bounds.end).toBe(at(16));
  });

  it("never shrinks a block past the minimum duration", () => {
    expect(resizedBounds(entity(), 20 * 60, "resize-start").start).toBe(at(15, 45));
    expect(resizedBounds(entity(), 9 * 60, "resize-end").end).toBe(at(15, 15));
  });

  it("dispatches to the right gesture", () => {
    expect(previewBounds(entity(), "move", "2026-10-14", 13 * 60, 0).start).toBe(at(13));
    expect(previewBounds(entity(), "resize-end", "2026-10-14", 17 * 60, 0).end).toBe(at(17));
  });
});
