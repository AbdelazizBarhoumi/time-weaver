import { describe, it, expect } from "vitest";
import { render, screen } from "@/test/utils";
import { StudyCard } from "@/components/CalendarSidebar";

/** Wednesday, midday. */
const at = (hour: number, minute = 0): string => new Date(2026, 9, 14, hour, minute).toISOString();

describe("StudyCard", () => {
  it("reports today's and this week's study time apart from work", () => {
    render(
      <StudyCard
        todayMs={2 * 3_600_000}
        weekMs={5 * 3_600_000}
        blocks={[{ title: "German grammar", start: at(13), end: at(15) }]}
      />,
    );

    expect(screen.getByText("Study today")).toBeInTheDocument();
    expect(screen.getByText("2h")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
  });

  it("lists the day's study blocks with their subject and times", () => {
    render(
      <StudyCard
        todayMs={3_600_000}
        weekMs={3_600_000}
        blocks={[{ title: "Algorithms", start: at(9), end: at(10) }]}
      />,
    );

    expect(screen.getByText("Algorithms")).toBeInTheDocument();
    expect(screen.getByText(/9:00 AM/)).toBeInTheDocument();
  });

  it("invites the user to start study when nothing is planned", () => {
    render(<StudyCard todayMs={0} weekMs={0} blocks={[]} />);

    expect(screen.getByText(/No study planned today/)).toBeInTheDocument();
  });

  it("makes clear study never counts toward the work goal", () => {
    render(<StudyCard todayMs={3_600_000} weekMs={3_600_000} blocks={[]} />);

    expect(screen.getByText(/never count toward the 8h goal/)).toBeInTheDocument();
  });
});
