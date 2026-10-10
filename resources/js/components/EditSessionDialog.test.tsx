import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/utils";
import { EditSessionDialog } from "@/components/EditSessionDialog";
import type { WorkSession } from "@/lib/tracker";
import React from "react";

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock("@/lib/queries", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/queries")>();
    return { ...actual, useUpdateSession: () => ({ mutate: mutateMock }) };
});

describe("EditSessionDialog", () => {
    const mockSession: WorkSession = {
        id: "1",
        start: "2026-10-07T09:00:00.000Z",
        end: "2026-10-07T17:00:00.000Z",
        note: "Test session",
        pausedMs: 0,
        pausedAt: null,
        segments: [{ type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T17:00:00.000Z" }],
        segmentsInferred: false,
    };

    const segmentedSession: WorkSession = {
        ...mockSession,
        segments: [
            { type: "work", start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T12:00:00.000Z" },
            { type: "pause", start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T12:30:00.000Z" },
            { type: "work", start: "2026-10-07T12:30:00.000Z", end: "2026-10-07T17:00:00.000Z" },
        ],
    };

    const activeStart = new Date(Date.now() - 10 * 60_000);
    const activeSession: WorkSession = {
        id: "7",
        start: activeStart.toISOString(),
        end: null,
        note: "",
        pausedMs: 0,
        pausedAt: null,
        segments: [{ type: "work", start: activeStart.toISOString(), end: null }],
        segmentsInferred: false,
    };

    const defaultProps = {
        open: true,
        session: mockSession,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does not render when closed", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, open: false }));
        expect(screen.queryByText("EDIT SESSION")).not.toBeInTheDocument();
    });

    it("does not render when session is null", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: null }));
        expect(screen.queryByText("EDIT SESSION")).not.toBeInTheDocument();
    });

    it("renders one row per segment", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: segmentedSession }));

        expect(screen.getByText("SEGMENTS")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "WORK" })).toHaveLength(2);
        expect(screen.getByRole("button", { name: "PAUSE" })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Remove segment" })).toHaveLength(3);
    });

    it("omits the end input for the open segment of an active session", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: activeSession }));

        expect(screen.getByLabelText("Segment 1 start")).toBeInTheDocument();
        expect(screen.queryByLabelText("Segment 1 end")).not.toBeInTheDocument();
    });

    it("removes a segment when its remove button is clicked", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: segmentedSession }));

        const removeButtons = screen.getAllByRole("button", { name: "Remove segment" });
        expect(removeButtons).toHaveLength(3);
        fireEvent.click(removeButtons[0]!);

        expect(screen.getAllByRole("button", { name: "Remove segment" })).toHaveLength(2);
        expect(screen.getAllByRole("button", { name: "WORK" })).toHaveLength(1);
    });

    it("adds a pause by splitting the longest work block", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: mockSession }));

        fireEvent.click(screen.getByRole("button", { name: "+ PAUSE" }));

        expect(screen.getAllByRole("button", { name: "Remove segment" })).toHaveLength(3);
        expect(screen.getAllByRole("button", { name: "WORK" })).toHaveLength(2);
        expect(screen.getByRole("button", { name: "PAUSE" })).toBeInTheDocument();
    });

    it("saves a completed session with its segments and end time", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: segmentedSession }));

        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

        expect(mutateMock).toHaveBeenCalledTimes(1);
        const call = mutateMock.mock.calls[0]?.[0];
        expect(call?.id).toBe(1);
        expect(call?.data.end).toEqual(expect.any(String));
        expect(call?.data.segments).toHaveLength(3);
        expect(call?.data.note).toBe("Test session");
    });

    it("keeps an active session active when the end time is untouched", () => {
        render(React.createElement(EditSessionDialog, { ...defaultProps, session: activeSession }));

        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

        expect(mutateMock).toHaveBeenCalledTimes(1);
        const call = mutateMock.mock.calls[0]?.[0];
        expect(call?.id).toBe(7);
        expect(call?.data).not.toHaveProperty("end");
        expect(call?.data.segments).toHaveLength(1);
        expect(call?.data.segments[0]?.end).toBeNull();
    });

    it("shows error for invalid time range (end before start)", () => {
        // Would need to interact with time picker
    });

    it("calls onSuccess and onClose on valid submit", async () => {
        render(React.createElement(EditSessionDialog, defaultProps));
        // Fill form and submit - complex due to DateTimePicker
    });

    it("shows loading state while saving", () => {
        // Would need to test the isSubmitting state
    });
});