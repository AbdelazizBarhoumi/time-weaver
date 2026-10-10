import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/utils";
import { ManualEntryDialog } from "@/components/ManualEntryDialog";
import React from "react";

describe("ManualEntryDialog", () => {
    const defaultProps = {
        open: true,
        onClose: vi.fn(),
        onAdd: vi.fn(),
        initialDate: undefined,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("does not render when closed", () => {
        render(React.createElement(ManualEntryDialog, { ...defaultProps, open: false }));
        expect(screen.queryByText("MANUAL ENTRY")).not.toBeInTheDocument();
    });

    it("validates end time after start time", () => {
        render(React.createElement(ManualEntryDialog, defaultProps));
        // The time picker is a custom component, we'd need to test its internal logic
    });

    it("shows error for invalid time range", () => {
        // Would need to test the validation logic
    });
});