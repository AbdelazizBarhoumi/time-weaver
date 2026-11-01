import { describe, expect, it } from "vitest";
import { Briefcase, Star } from "lucide-react";

import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_STYLES,
  categoryIcon,
  categoryTheme,
  type Category,
} from "@/lib/categories";

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 1,
    name: "Deep work",
    color: "#5b9cff",
    icon: "Briefcase",
    style: "solid",
    ...overrides,
  };
}

describe("category themes", () => {
  it("offers every registered icon through a stable key", () => {
    expect(CATEGORY_ICONS.map((entry) => entry.key)).toContain("Briefcase");
    expect(CATEGORY_ICONS.find((entry) => entry.key === "Briefcase")?.Icon).toBe(Briefcase);
    expect(CATEGORY_COLORS.length).toBeGreaterThan(1);
    expect(CATEGORY_STYLES.map((style) => style.value)).toEqual(["solid", "outline", "stripe"]);
  });

  it("falls back to a star for an unknown icon", () => {
    expect(categoryIcon("Skull")).toBe(Star);
    expect(categoryIcon(null)).toBe(Star);
  });

  it("paints a solid accent as a light fill with a strong edge", () => {
    const theme = categoryTheme(category({ style: "solid" }), "#000000");

    expect(theme.accent).toBe("#5b9cff");
    expect(theme.background).toBe("#5b9cff2e");
    expect(theme.borderLeft).toBe("3px solid #5b9cff");
    expect(theme.boxShadow).toBeUndefined();
  });

  it("leaves an outline empty inside but rings it in the accent", () => {
    const theme = categoryTheme(category({ style: "outline", color: "#f87171" }), "#000000");

    expect(theme.accent).toBe("#f87171");
    expect(theme.background).toBe("transparent");
    expect(theme.borderLeft).toBe("3px solid #f87171");
    expect(theme.boxShadow).toContain("#f87171");
  });

  it("draws a stripe as diagonal bands", () => {
    const theme = categoryTheme(category({ style: "stripe" }), "#000000");

    expect(theme.background).toContain("repeating-linear-gradient");
    expect(theme.background).toContain("#5b9cff");
    expect(theme.borderLeft).toBe("3px solid #5b9cff");
  });

  it("uses the fallback color and a solid fill when there is no category", () => {
    const theme = categoryTheme(null, "#34d399");

    expect(theme.accent).toBe("#34d399");
    expect(theme.background).toBe("#34d3992e");
    expect(theme.borderLeft).toBe("3px solid #34d399");
  });
});
