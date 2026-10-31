import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/utils";
import { MonthlyCard } from "@/components/MonthlyCard";
import type { ApiMonthStats } from "@/lib/api";

const current: ApiMonthStats = {
    key: "2026-10",
    label: "October 2026",
    doneHours: 162.6,
    targetHours: 160,
    remainingHours: 0,
    daysLeft: 0,
    perDayNeeded: 0,
    paceDeltaHours: 2.6,
    progress: 1,
    isCurrent: true,
    customDaysOff: 2,
};

describe("MonthlyCard", () => {
    it("renders the server-computed month totals verbatim", () => {
        render(<MonthlyCard months={[current]} />);

        expect(screen.getByText("162.6")).toBeInTheDocument();
        expect(screen.getByText("160")).toBeInTheDocument();
        expect(screen.getByText("100%")).toBeInTheDocument();
        expect(screen.getByText(/Monthly target cleared/)).toBeInTheDocument();
        expect(screen.getByText(/2 custom days off/)).toBeInTheDocument();
        expect(screen.getByText(/\+2\.6h ahead/)).toBeInTheDocument();
    });

    it("shows the remaining gap for an unfinished month", () => {
        render(
            <MonthlyCard
                months={[{ ...current, doneHours: 140.3, remainingHours: 19.7, perDayNeeded: 3.3, paceDeltaHours: -19.7, progress: 0.877, daysLeft: 6 }]}
            />,
        );

        expect(screen.getByText("140.3")).toBeInTheDocument();
        expect(screen.getByText("19.7")).toBeInTheDocument();
        expect(screen.getByText("3.3")).toBeInTheDocument();
        expect(screen.getByText(/Behind pace/)).toBeInTheDocument();
    });

    it("renders nothing until the monthly stats arrive", () => {
        const { container } = render(<MonthlyCard months={[]} />);

        expect(container).toBeEmptyDOMElement();
    });
});
