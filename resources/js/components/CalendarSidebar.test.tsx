import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/utils";
import { AccountsCard, StudyCard } from "@/components/CalendarSidebar";
import type { CalendarAccount } from "@/lib/calendar";

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

/** A mailbox, as the sidebar lists it. */
const mailbox = (overrides: Partial<CalendarAccount> = {}): CalendarAccount => ({
  id: 1,
  provider: "google",
  email: "ada@example.com",
  color: "#5b9cff",
  defaultWork: false,
  lastSyncedAt: null,
  disconnected: false,
  hiddenCount: 0,
  ...overrides,
});

function renderAccountsCard(overrides: Partial<Parameters<typeof AccountsCard>[0]> = {}) {
  const props = {
    accounts: [mailbox()],
    hidden: new Set<number>(),
    syncing: false,
    syncingAccountId: null,
    onToggleVisibility: vi.fn(),
    onToggleDefaultWork: vi.fn(),
    onSync: vi.fn(),
    onPurge: vi.fn(),
    onRestoreHidden: vi.fn(),
    ...overrides,
  };

  render(<AccountsCard {...props} />);

  return props;
}

describe("AccountsCard", () => {
  it("refreshes only the mailbox whose row button was clicked", () => {
    const props = renderAccountsCard({
      accounts: [mailbox(), mailbox({ id: 2, email: "grace@example.com" })],
    });

    fireEvent.click(screen.getAllByTitle("Sync this mailbox now")[1] as HTMLElement);

    expect(props.onSync).toHaveBeenCalledWith(2);
  });

  it("refreshes every mailbox from the card's sync button", () => {
    const props = renderAccountsCard();

    fireEvent.click(screen.getByRole("button", { name: "sync" }));

    expect(props.onSync).toHaveBeenCalledWith();
  });

  it("offers no per-mailbox refresh for a disconnected mailbox", () => {
    renderAccountsCard({ accounts: [mailbox({ disconnected: true })] });

    expect(screen.queryByTitle("Sync this mailbox now")).not.toBeInTheDocument();
  });

  it("disables the per-mailbox refresh while a sync is running", () => {
    renderAccountsCard({ syncing: true, syncingAccountId: 1 });

    expect(screen.getByTitle("Sync this mailbox now")).toBeDisabled();
  });
});
