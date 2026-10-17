import type { ComponentPropsWithoutRef } from "react";

type MenuContentGuards = Pick<
  ComponentPropsWithoutRef<"div">,
  "onClick" | "onPointerDown" | "onContextMenu" | "onKeyDown"
>;

/**
 * Handlers that stop events raised inside a menu from reaching the element the menu
 * happens to be nested in.
 *
 * Radix renders menu content into a portal at the end of `<body>`, so the DOM no
 * longer nests it inside its trigger — but React still bubbles synthetic events up
 * the *React* tree, which is why a menu inside a clickable row leaks its clicks into
 * that row. Without these guards, selecting "Delete" in the calendar's event menu
 * also fired the event block's `onClick` and marked the event as work.
 *
 * Only `stopPropagation`, never `preventDefault`: Radix composes its own
 * `onPointerDown`/`onKeyDown` onto the content and skips them when the default is
 * prevented, which would break the menu itself.
 */
export const menuContentGuards: MenuContentGuards = {
  onClick: (event) => event.stopPropagation(),
  onPointerDown: (event) => event.stopPropagation(),
  onContextMenu: (event) => event.stopPropagation(),
  onKeyDown: (event) => event.stopPropagation(),
};
