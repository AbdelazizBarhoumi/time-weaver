import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test/utils";

import { EventDialog, type EventDraft } from "@/components/EventDialog";
import type { Category } from "@/lib/categories";

const noop = () => {};

const categories: Category[] = [
  { id: 3, name: "Deep work", color: "#5b9cff", icon: "Briefcase", style: "solid" },
];

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    mode: "event",
    title: "",
    start: new Date(2026, 9, 14, 9, 0).toISOString(),
    end: new Date(2026, 9, 14, 10, 0).toISOString(),
    allDay: false,
    categoryId: null,
    ...overrides,
  };
}

function renderDialog(props: Partial<Parameters<typeof EventDialog>[0]> = {}) {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onSwitchMode = vi.fn();
  const onClose = vi.fn();

  const result = render(
    <EventDialog
      draft={draft()}
      categories={categories}
      hasAccount
      onChange={onChange}
      onClose={onClose}
      onSwitchMode={onSwitchMode}
      onSave={onSave}
      {...props}
    />,
  );

  return { ...result, onChange, onSave, onSwitchMode, onClose };
}

describe("EventDialog", () => {
  it("opens as a new event that is saved locally", () => {
    renderDialog();

    expect(screen.getByText("New event")).toBeInTheDocument();
    expect(screen.getByText(/Google is never written to/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
  });

  it("will not save without a title", () => {
    const { onSave } = renderDialog();

    const save = screen.getByRole("button", { name: "Create event" });
    expect(save).toBeDisabled();

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("asks the page to switch to a focus block", () => {
    const { onSwitchMode } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /create a focus block instead/i }));

    expect(onSwitchMode).toHaveBeenCalled();
  });

  it("switches to date-only fields when all-day is ticked", () => {
    const { onChange } = renderDialog({ draft: draft({ title: "Dentist" }) });

    fireEvent.click(screen.getByLabelText("All day"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ allDay: true, start: "2026-10-14", end: "2026-10-15" }),
    );
  });

  it("edits a local event instead of creating one", () => {
    renderDialog({ draft: draft({ cacheId: 7, title: "Dentist" }) });

    expect(screen.getByText("Edit event")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("blocks saving an event when no mailbox is connected, but not a focus block", () => {
    const { onSave, rerender } = renderDialog({
      hasAccount: false,
      draft: draft({ title: "Dentist" }),
    });

    expect(screen.getByText(/Connect a Google account/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();

    rerender(
      <EventDialog
        draft={draft({ mode: "focus", title: "Write" })}
        categories={categories}
        hasAccount={false}
        onChange={noop}
        onClose={noop}
        onSwitchMode={noop}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("New focus block")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create block" })).toBeEnabled();
  });

  it("submits the current draft", () => {
    const { onSave } = renderDialog({ draft: draft({ title: "Dentist" }) });

    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(onSave).toHaveBeenCalled();
  });
});
