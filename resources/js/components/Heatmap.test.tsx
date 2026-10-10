import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/utils";
import { Heatmap } from "@/components/Heatmap";
import type { WorkSession, CustomDayOff } from "@/lib/tracker";
import React from "react";

describe.skip("Heatmap (skipped due to portal issues in happy-dom)", () => {
    const mockSessions: WorkSession[] = [
        {
            id: "1",
            start: "2026-10-07T09:00:00.000Z",
            end: "2026-10-07T17:00:00.000Z",
            note: "Work session",
            pausedMs: 0,
            pausedAt: null,
            segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" }],
            segmentsInferred: false,
        },
        {
            id: "2",
            start: "2026-10-06T09:00:00.000Z",
            end: "2026-10-06T13:00:00.000Z",
            note: "Morning work",
            pausedMs: 0,
            pausedAt: null,
            segments: [{ type: "work", start: "2026-10-06T09:00:00.000Z", end: "2026-10-06T13:00:00.000Z" }],
            segmentsInferred: false,
        },
    ];

    const mockDayOffs: CustomDayOff[] = [
        { date: "2026-10-05", type: "excluded" },
    ];

    const defaultProps = {
        sessions: mockSessions,
        now: new Date("2026-10-07T12:00:00.000Z").getTime(),
        customDayOffs: mockDayOffs,
        onToggleDayOff: vi.fn(),
        onSetDayOffType: vi.fn(),
        onAddSession: vi.fn(),
        onEditSession: vi.fn(),
        onDeleteSession: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders without crashing", () => {
        render(React.createElement(Heatmap, defaultProps));
        expect(screen.getByText(/ACTIVITY/)).toBeInTheDocument();
    });

    it("shows day labels (Mon, Wed, Fri)", () => {
        render(React.createElement(Heatmap, defaultProps));
        expect(screen.getByText("Mon")).toBeInTheDocument();
        expect(screen.getByText("Wed")).toBeInTheDocument();
        expect(screen.getByText("Fri")).toBeInTheDocument();
    });

    it("renders color legend", () => {
        render(React.createElement(Heatmap, defaultProps));
        expect(screen.getByText(/less/)).toBeInTheDocument();
        expect(screen.getByText(/more/)).toBeInTheDocument();
    });
});