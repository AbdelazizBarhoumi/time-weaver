import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/utils";
import { SegmentBreakdown } from "@/components/SegmentBreakdown";
import { createMockSession } from "@/test/utils/factories";
import React from "react";

describe("SegmentBreakdown", () => {
    const now = new Date("2026-10-07T17:00:00.000Z").getTime();

    it("renders a row per segment with its duration and the totals", () => {
        const session = createMockSession({
            start: "2026-10-07T09:00:00.000Z",
            end: "2026-10-07T17:00:00.000Z",
            segments: [
                { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
                { type: "pause", start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T12:30:00.000Z" },
                { type: "work", start: "2026-10-07T12:30:00.000Z", end: "2026-10-07T17:00:00.000Z" },
            ],
        });

        render(<SegmentBreakdown session={session} now={now} />);

        expect(screen.getByText("BREAKDOWN")).toBeInTheDocument();
        expect(screen.getByText("3h")).toBeInTheDocument();
        expect(screen.getByText("30m")).toBeInTheDocument();
        expect(screen.getByText("4h 30m")).toBeInTheDocument();
        expect(screen.getByText("7h 30m")).toBeInTheDocument();
    });

    it("flags a server-synthesized breakdown as estimated", () => {
        const session = createMockSession({
            segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" }],
            segmentsInferred: true,
        });

        render(<SegmentBreakdown session={session} now={now} />);

        expect(screen.getByText("(estimated)")).toBeInTheDocument();
    });

    it("does not flag a stored breakdown", () => {
        const session = createMockSession({
            segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" }],
            segmentsInferred: false,
        });

        render(<SegmentBreakdown session={session} now={now} />);

        expect(screen.queryByText("(estimated)")).not.toBeInTheDocument();
    });

    it("shows a fallback when no segments are recorded", () => {
        const session = createMockSession({ segments: [] });

        render(<SegmentBreakdown session={session} now={now} />);

        expect(screen.getByText(/No breakdown recorded/)).toBeInTheDocument();
    });
});
