import { describe, it, expect, vi, beforeEach } from "vitest";

import {
    dayKey,
    hoursForDay,
    sessionDurationMs,
    segmentDurationMs,
    levelFor,
    formatHM,
    formatHMS,
    formatTime,
    startSegments,
    pauseSegments,
    resumeSegments,
    stopSegments,
    prepareSegments,
    validateSegments,
    insertSplitSegment,
    DAILY_GOAL_HOURS,
    computeStats,
} from "@/lib/tracker";
import type { Segment, WorkSession } from "@/lib/tracker";

describe("lib/tracker utilities", () => {
    describe("dayKey", () => {
        it("formats date as YYYY-MM-DD", () => {
            const date = new Date(2026, 9, 7); // Oct 7, 2026
            expect(dayKey(date)).toBe("2026-10-07");
        });

        it("handles string input", () => {
            expect(dayKey("2026-10-07T10:00:00.000Z")).toBe("2026-10-07");
        });

        it("pads month and day", () => {
            const date = new Date(2026, 0, 5); // Jan 5, 2026
            expect(dayKey(date)).toBe("2026-01-05");
        });
    });

    describe("sessionDurationMs", () => {
        it("calculates duration for completed session", () => {
            const session: WorkSession = {
                id: "1",
                start: "2026-10-07T09:00:00.000Z",
                end: "2026-10-07T17:00:00.000Z",
                note: "",
                pausedMs: 0,
                pausedAt: null,
                segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" }],
                segmentsInferred: false,
            };
            const duration = sessionDurationMs(session, new Date("2026-10-07T17:00:00.000Z").getTime());
            expect(duration).toBe(8 * 60 * 60 * 1000); // 8 hours
        });

        it("calculates duration for active session", () => {
            const session: WorkSession = {
                id: "1",
                start: "2026-10-07T09:00:00.000Z",
                end: null,
                note: "",
                pausedMs: 0,
                pausedAt: null,
                segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: null }],
                segmentsInferred: false,
            };
            const now = new Date("2026-10-07T12:00:00.000Z").getTime();
            const duration = sessionDurationMs(session, now);
            expect(duration).toBe(3 * 60 * 60 * 1000); // 3 hours
        });

        it("subtracts paused time", () => {
            const session: WorkSession = {
                id: "1",
                start: "2026-10-07T09:00:00.000Z",
                end: "2026-10-07T17:00:00.000Z",
                note: "",
                pausedMs: 30 * 60 * 1000, // 30 minutes paused
                pausedAt: null,
                segments: [
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T16:30:00.000Z" },
                    { type: "pause", start: "2026-10-07T16:30:00.000Z", end: "2026-10-07T17:00:00.000Z" },
                ],
                segmentsInferred: false,
            };
            const duration = sessionDurationMs(session, new Date("2026-10-07T17:00:00.000Z").getTime());
            expect(duration).toBe(7.5 * 60 * 60 * 1000); // 7.5 hours
        });

        it("handles currently paused session", () => {
            const session: WorkSession = {
                id: "1",
                start: "2026-10-07T09:00:00.000Z",
                end: null,
                note: "",
                pausedMs: 0,
                pausedAt: "2026-10-07T12:00:00.000Z",
                segments: [
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
                    { type: "pause", start: "2026-10-07T12:00:00.000Z", end: null },
                ],
                segmentsInferred: false,
            };
            const now = new Date("2026-10-07T14:00:00.000Z").getTime();
            const duration = sessionDurationMs(session, now);
            // 5 hours worked - 2 hours paused = 3 hours
            expect(duration).toBe(3 * 60 * 60 * 1000);
        });

        it("returns 0 for negative duration", () => {
            const session: WorkSession = {
                id: "1",
                start: "2026-10-07T09:00:00.000Z",
                end: "2026-10-07T08:00:00.000Z", // end before start
                note: "",
                pausedMs: 0,
                pausedAt: null,
                segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T08:00:00.000Z" }],
                segmentsInferred: false,
            };
            const duration = sessionDurationMs(session, new Date("2026-10-07T17:00:00.000Z").getTime());
            expect(duration).toBe(0);
        });
    });

    describe("hoursForDay", () => {
        it("sums sessions for a specific day", () => {
            const sessions: WorkSession[] = [
                {
                    id: "1",
                    start: "2026-10-07T09:00:00.000Z",
                    end: "2026-10-07T12:00:00.000Z",
                    note: "",
                    pausedMs: 0,
                    pausedAt: null,
                    segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" }],
                    segmentsInferred: false,
                },
                {
                    id: "2",
                    start: "2026-10-07T13:00:00.000Z",
                    end: "2026-10-07T17:00:00.000Z",
                    note: "",
                    pausedMs: 0,
                    pausedAt: null,
                    segments: [{ type: "work", start: "2026-10-07T13:00:00.000Z", end: "2026-10-07T17:00:00.000Z" }],
                    segmentsInferred: false,
                },
                {
                    id: "3",
                    start: "2026-10-06T09:00:00.000Z",
                    end: "2026-10-06T17:00:00.000Z",
                    note: "",
                    pausedMs: 0,
                    pausedAt: null,
                    segments: [{ type: "work", start: "2026-10-06T09:00:00.000Z", end: "2026-10-06T17:00:00.000Z" }],
                    segmentsInferred: false,
                },
            ];
            const hours = hoursForDay(sessions, "2026-10-07");
            expect(hours).toBe(7); // 3 + 4 hours
        });

        it("returns 0 for day with no sessions", () => {
            const sessions: WorkSession[] = [
                {
                    id: "1",
                    start: "2026-10-06T09:00:00.000Z",
                    end: "2026-10-06T17:00:00.000Z",
                    note: "",
                    pausedMs: 0,
                    pausedAt: null,
                    segments: [{ type: "work", start: "2026-10-06T09:00:00.000Z", end: "2026-10-06T17:00:00.000Z" }],
                    segmentsInferred: false,
                },
            ];
            const hours = hoursForDay(sessions, "2026-10-07");
            expect(hours).toBe(0);
        });
    });

    describe("levelFor", () => {
        it("returns correct level for hours", () => {
            expect(levelFor(0)).toBe(0);
            expect(levelFor(1)).toBe(1);
            expect(levelFor(2)).toBe(2);
            expect(levelFor(4)).toBe(3);
            expect(levelFor(6)).toBe(4);
            expect(levelFor(8)).toBe(5);
            expect(levelFor(10)).toBe(5);
        });
    });

    describe("formatHM", () => {
        it("formats hours and minutes", () => {
            expect(formatHM(0)).toBe("0m");
            expect(formatHM(30 * 60 * 1000)).toBe("30m");
            expect(formatHM(60 * 60 * 1000)).toBe("1h");
            expect(formatHM(90 * 60 * 1000)).toBe("1h 30m");
            expect(formatHM(8 * 60 * 60 * 1000)).toBe("8h");
        });
    });

    describe("formatHMS", () => {
        it("formats hours, minutes, seconds", () => {
            expect(formatHMS(0)).toBe("00:00:00");
            expect(formatHMS(3661 * 1000)).toBe("01:01:01");
            expect(formatHMS(8 * 60 * 60 * 1000)).toBe("08:00:00");
        });
    });

    describe("formatTime", () => {
        it("formats an ISO string as 12-hour local time", () => {
            // Built from local parts so the assertion holds in any timezone.
            const at = (h: number, m: number) => formatTime(new Date(2026, 9, 7, h, m, 0, 0).toISOString());

            expect(at(9, 30)).toBe("9:30 AM");
            expect(at(17, 5)).toBe("5:05 PM");
            expect(at(0, 5)).toBe("12:05 AM");
            expect(at(12, 0)).toBe("12:00 PM");
            expect(at(23, 59)).toBe("11:59 PM");
        });
    });

    describe("DAILY_GOAL_HOURS", () => {
        it("is 8", () => {
            expect(DAILY_GOAL_HOURS).toBe(8);
        });
    });

    describe("segment helpers", () => {
        const t = (isoStr: string) => new Date(isoStr).getTime();

        describe("startSegments", () => {
            it("returns a single open work segment", () => {
                expect(startSegments(t("2026-10-07T09:00:00.000Z"))).toEqual([
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: null },
                ]);
            });
        });

        describe("pauseSegments", () => {
            it("closes the trailing open work segment and opens a pause", () => {
                const segments = startSegments(t("2026-10-07T09:00:00.000Z"));
                expect(pauseSegments(segments, t("2026-10-07T10:00:00.000Z"))).toEqual([
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T10:00:00.000Z" },
                    { type: "pause", start: "2026-10-07T10:00:00.000Z", end: null },
                ]);
            });

            it("leaves already closed segments untouched", () => {
                const segments: Segment[] = [
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T10:00:00.000Z" },
                    { type: "pause", start: "2026-10-07T10:00:00.000Z", end: "2026-10-07T10:05:00.000Z" },
                    { type: "work", start: "2026-10-07T10:05:00.000Z", end: null },
                ];
                const paused = pauseSegments(segments, t("2026-10-07T11:00:00.000Z"));
                expect(paused[0]).toEqual(segments[0]);
                expect(paused[1]).toEqual(segments[1]);
                expect(paused[2]).toEqual({ type: "work", start: "2026-10-07T10:05:00.000Z", end: "2026-10-07T11:00:00.000Z" });
                expect(paused[3]).toEqual({ type: "pause", start: "2026-10-07T11:00:00.000Z", end: null });
            });
        });

        describe("resumeSegments", () => {
            it("closes the open pause and opens a work segment", () => {
                const segments: Segment[] = [
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T10:00:00.000Z" },
                    { type: "pause", start: "2026-10-07T10:00:00.000Z", end: null },
                ];
                expect(resumeSegments(segments, t("2026-10-07T10:20:00.000Z"))).toEqual([
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T10:00:00.000Z" },
                    { type: "pause", start: "2026-10-07T10:00:00.000Z", end: "2026-10-07T10:20:00.000Z" },
                    { type: "work", start: "2026-10-07T10:20:00.000Z", end: null },
                ]);
            });
        });

        describe("stopSegments", () => {
            it("closes the trailing open segment", () => {
                const segments = startSegments(t("2026-10-07T09:00:00.000Z"));
                expect(stopSegments(segments, t("2026-10-07T12:00:00.000Z"))).toEqual([
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
                ]);
            });

            it("leaves an already closed list unchanged", () => {
                const segments: Segment[] = [
                    { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T10:00:00.000Z" },
                ];
                expect(stopSegments(segments, t("2026-10-07T12:00:00.000Z"))).toEqual(segments);
            });
        });

        describe("segmentDurationMs", () => {
            it("measures a closed segment", () => {
                const seg: Segment = { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T11:30:00.000Z" };
                expect(segmentDurationMs(seg)).toBe(2.5 * 60 * 60 * 1000);
            });

            it("measures an open segment against now", () => {
                const seg: Segment = { type: "work", start: "2026-10-07T09:00:00.000Z", end: null };
                expect(segmentDurationMs(seg, t("2026-10-07T10:00:00.000Z"))).toBe(60 * 60 * 1000);
            });

            it("clamps to zero when the segment ends before it starts", () => {
                const seg: Segment = { type: "work", start: "2026-10-07T11:00:00.000Z", end: "2026-10-07T10:00:00.000Z" };
                expect(segmentDurationMs(seg)).toBe(0);
            });
        });
    });

    describe("prepareSegments", () => {
        const ms = (isoStr: string) => new Date(isoStr).getTime();

        it("sorts segments by start", () => {
            const segments: Segment[] = [
                { type: "pause", start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T12:30:00.000Z" },
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
            ];
            const prepared = prepareSegments(segments, ms("2026-10-07T09:00:00.000Z"), ms("2026-10-07T17:00:00.000Z"), true);
            expect(prepared.map((s) => s.type)).toEqual(["work", "pause"]);
        });

        it("clamps segments to the session bounds", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T08:00:00.000Z", end: "2026-10-07T18:00:00.000Z" },
            ];
            const prepared = prepareSegments(segments, ms("2026-10-07T09:00:00.000Z"), ms("2026-10-07T17:00:00.000Z"), true);
            expect(prepared).toEqual([
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" },
            ]);
        });

        it("drops segments that collapse to zero length", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T06:00:00.000Z", end: "2026-10-07T08:00:00.000Z" },
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
            ];
            const prepared = prepareSegments(segments, ms("2026-10-07T09:00:00.000Z"), ms("2026-10-07T17:00:00.000Z"), true);
            expect(prepared).toHaveLength(1);
            expect(prepared[0]?.start).toBe("2026-10-07T09:00:00.000Z");
        });

        it("closes the open segment when the session is completed", () => {
            const segments: Segment[] = [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: null }];
            const prepared = prepareSegments(segments, ms("2026-10-07T09:00:00.000Z"), ms("2026-10-07T12:00:00.000Z"), true);
            expect(prepared).toEqual([
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
            ]);
        });

        it("keeps the segment open when the session stays active", () => {
            const segments: Segment[] = [{ type: "pause", start: "2026-10-07T11:00:00.000Z", end: null }];
            const prepared = prepareSegments(segments, ms("2026-10-07T09:00:00.000Z"), ms("2026-10-07T12:00:00.000Z"), false);
            expect(prepared).toEqual([
                { type: "pause", start: "2026-10-07T11:00:00.000Z", end: null },
            ]);
        });
    });

    describe("validateSegments", () => {
        it("accepts a valid list", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
                { type: "pause", start: "2026-10-07T12:00:00.000Z", end: null },
            ];
            expect(validateSegments(segments)).toBeNull();
        });

        it("rejects an empty list", () => {
            expect(validateSegments([])).toBe("A session needs at least one segment.");
        });

        it("rejects an open segment that is not last", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: null },
                { type: "pause", start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T12:30:00.000Z" },
            ];
            expect(validateSegments(segments)).toBe("Only the last segment can be left open.");
        });

        it("rejects a segment that ends at or before it starts", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
            ];
            expect(validateSegments(segments)).toBe("Segment 1 must end after it starts.");
        });

        it("rejects overlapping segments", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
                { type: "pause", start: "2026-10-07T11:00:00.000Z", end: "2026-10-07T11:30:00.000Z" },
            ];
            expect(validateSegments(segments)).toBe("Segments must not overlap.");
        });
    });

    describe("insertSplitSegment", () => {
        const ms = (isoStr: string) => new Date(isoStr).getTime();

        it("splits the longest work block when adding a pause", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" },
            ];
            const next = insertSplitSegment(segments, "pause", ms("2026-10-07T17:00:00.000Z"));
            expect(next).not.toBeNull();
            expect(next).toHaveLength(3);
            expect(next?.map((s) => s.type)).toEqual(["work", "pause", "work"]);
            expect(next?.[0]?.start).toBe("2026-10-07T09:00:00.000Z");
            expect(next?.[0]?.end).toBe(next?.[1]?.start);
            expect(next?.[1]?.end).toBe(next?.[2]?.start);
            expect(next?.[2]?.end).toBe("2026-10-07T17:00:00.000Z");
        });

        it("returns null when no opposite-type segment is long enough", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T09:10:00.000Z" },
            ];
            expect(insertSplitSegment(segments, "pause", ms("2026-10-07T17:00:00.000Z"))).toBeNull();
        });

        it("keeps an open target open after splitting", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: null },
            ];
            const next = insertSplitSegment(segments, "pause", ms("2026-10-07T17:00:00.000Z"));
            expect(next).toHaveLength(3);
            expect(next?.[0]?.end).not.toBeNull();
            expect(next?.[1]?.type).toBe("pause");
            expect(next?.[2]).toEqual({ type: "work", start: next?.[1]?.end ?? null, end: null });
        });

        it("does not mutate the input array", () => {
            const segments: Segment[] = [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" },
            ];
            insertSplitSegment(segments, "pause", ms("2026-10-07T17:00:00.000Z"));
            expect(segments).toHaveLength(1);
        });
    });

    describe("computeStats backlogHours", () => {
        const session = (id: string, start: Date, end: Date): WorkSession => ({
            id,
            start: start.toISOString(),
            end: end.toISOString(),
            note: "",
            pausedMs: 0,
            pausedAt: null,
            segments: [{ type: "work", start: start.toISOString(), end: end.toISOString() }],
            segmentsInferred: false,
        });

        it("sums daily shortfalls from the first session through today", () => {
            const now = new Date(2026, 9, 7, 17, 0, 0); // Wed Oct 7 2026
            const sessions = [
                session("1", new Date(2026, 9, 5, 9, 0, 0), new Date(2026, 9, 5, 17, 0, 0)), // Mon 8h
                session("2", new Date(2026, 9, 6, 9, 0, 0), new Date(2026, 9, 6, 15, 0, 0)), // Tue 6h
                session("3", new Date(2026, 9, 7, 9, 0, 0), new Date(2026, 9, 7, 17, 0, 0)), // Wed 8h
            ];
            expect(computeStats(sessions, now.getTime()).backlogHours).toBe(2);
        });

        it("counts missing weekdays but skips weekends", () => {
            const now = new Date(2026, 9, 7, 17, 0, 0); // Wed
            const sessions = [
                session("1", new Date(2026, 9, 5, 9, 0, 0), new Date(2026, 9, 5, 17, 0, 0)), // Mon 8h
            ];
            // Tue (missing) 8h + Wed (today, missing) 8h
            expect(computeStats(sessions, now.getTime()).backlogHours).toBe(16);
        });

        it("reduces the backlog with overtime", () => {
            const now = new Date(2026, 9, 7, 17, 0, 0); // Wed
            const sessions = [
                session("1", new Date(2026, 9, 5, 9, 0, 0), new Date(2026, 9, 5, 18, 0, 0)), // Mon 9h
                session("2", new Date(2026, 9, 6, 9, 0, 0), new Date(2026, 9, 6, 13, 0, 0)), // Tue 4h
                session("3", new Date(2026, 9, 7, 9, 0, 0), new Date(2026, 9, 7, 17, 0, 0)), // Wed 8h
            ];
            // 3 working days × 8h = 24h target, 21h worked
            expect(computeStats(sessions, now.getTime()).backlogHours).toBe(3);
        });

        it("is zero without sessions", () => {
            expect(computeStats([], Date.now()).backlogHours).toBe(0);
        });
    });
});