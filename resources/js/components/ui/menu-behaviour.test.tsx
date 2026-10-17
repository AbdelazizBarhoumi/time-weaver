import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@/test/utils";
import userEvent from "@testing-library/user-event";
import React from "react";

import { useConfirm } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";

/**
 * Regression tests for the "page freezes after deleting an event" bug.
 *
 * Radix marks modal layers by writing `pointer-events: none` onto `document.body`
 * and only clearing it once its internal layer set empties. Opening a modal dialog
 * from a modal menu made those two passes race, which could leave the page stuck at
 * `pointer-events: none` — everything looked frozen until a reload. The menu
 * primitives are non-modal so a menu never takes that lock in the first place.
 */
function DropdownHarness() {
  const confirm = useConfirm();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => void confirm({ title: "Permanently delete?", confirmLabel: "Delete" })}>
          Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContextHarness() {
  return (
    <ContextMenu>
      <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Context action</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

describe("menu modality", () => {
  it("does not lock the page's pointer events while a dropdown menu is open", async () => {
    const user = userEvent.setup();
    render(React.createElement(DropdownHarness));

    await user.click(screen.getByText("Open menu"));
    await waitFor(() => expect(screen.getByText("Delete permanently")).toBeInTheDocument());

    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("does not lock the page's pointer events while a context menu is open", async () => {
    render(React.createElement(ContextHarness));

    fireEvent.contextMenu(screen.getByText("Right-click me"));
    await waitFor(() => expect(screen.getByText("Context action")).toBeInTheDocument());

    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("keeps the dialog opened from a menu item interactive and clears the lock afterwards", async () => {
    const user = userEvent.setup();
    render(React.createElement(DropdownHarness));

    await user.click(screen.getByText("Open menu"));
    await user.click(screen.getByText("Delete permanently"));

    const dialog = await screen.findByRole("alertdialog");
    // The dialog — not the closing menu — must own pointer events.
    expect((dialog.getAttribute("style") ?? "").replace(/\s/g, "")).toContain("pointer-events:auto");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.body.style.pointerEvents).toBe(""));
  });
});

/**
 * Menus portal their content to `<body>`, but React still bubbles synthetic events
 * up the React tree. A menu nested inside a clickable row (as the calendar's event
 * block is) therefore used to fire the row's `onClick` when an item was selected —
 * clicking "Delete" also marked the event as work.
 */
describe("menu inside a clickable row", () => {
  const renderInRow = () => {
    const onRowClick = vi.fn();
    const onRowKeyDown = vi.fn();
    const user = userEvent.setup();

    render(
      <div role="button" onClick={onRowClick} onKeyDown={onRowKeyDown}>
        <DropdownMenu>
          <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Delete permanently</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
    );

    return { onRowClick, onRowKeyDown, user };
  };

  it("does not fire the ancestor's click handler when an item is selected", async () => {
    const { onRowClick, user } = renderInRow();

    await user.click(screen.getByText("Open menu"));
    await waitFor(() => expect(screen.getByText("Delete permanently")).toBeInTheDocument());
    onRowClick.mockClear();

    await user.click(screen.getByText("Delete permanently"));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("does not fire the ancestor's key handler when navigating the menu", async () => {
    const { onRowKeyDown, user } = renderInRow();

    await user.click(screen.getByText("Open menu"));
    await waitFor(() => expect(screen.getByText("Delete permanently")).toBeInTheDocument());
    onRowKeyDown.mockClear();

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onRowKeyDown).not.toHaveBeenCalled();
  });
});
