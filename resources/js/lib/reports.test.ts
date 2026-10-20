import { describe, expect, it } from "vitest";
import {
  REPORT_TEMPLATES,
  WORK_ONLY_SECTIONS,
  applyWorkOnlyConstraints,
  createDefaultReportConfig,
  type ReportSection,
} from "@/lib/reports";

function workConfig(sections: ReportSection[]) {
  const base = createDefaultReportConfig({
    from: "2026-10-01",
    to: "2026-10-31",
    timezone: "UTC",
  });

  return {
    ...base,
    template: "work" as const,
    sections,
    filters: {
      ...base.filters,
      sessionTypes: ["study"] as ("work" | "study")[],
      calendar: {
        ...base.filters.calendar,
        workFilter: "personal" as const,
        includeAllDay: true,
      },
      includeSideTasks: true,
      includeFocusBlocks: true,
      includeDayOffs: true,
    },
  };
}

describe("employer report constraints", () => {
  it("removes study, personal, and day-off content from the builder config", () => {
    const constrained = applyWorkOnlyConstraints(
      workConfig(["cover", "study", "sessions", "sideTasks", "dayOffs", "notes"]),
    );

    expect(constrained.sections).toEqual(["cover", "sessions", "notes"]);
    expect(constrained.filters.sessionTypes).toEqual(["work"]);
    expect(constrained.filters.calendar.workFilter).toBe("work");
    expect(constrained.filters.calendar.includeAllDay).toBe(false);
    expect(constrained.filters.includeSideTasks).toBe(false);
    expect(constrained.filters.includeFocusBlocks).toBe(false);
    expect(constrained.filters.includeDayOffs).toBe(false);
  });

  it("falls back to the employer template when no work-safe sections remain", () => {
    const constrained = applyWorkOnlyConstraints(workConfig(["study", "sideTasks"]));

    expect(constrained.sections).toEqual(REPORT_TEMPLATES.work.sections);
    expect(constrained.sections.every((section) => WORK_ONLY_SECTIONS.includes(section))).toBe(true);
  });

  it("leaves non-work templates untouched", () => {
    const config = createDefaultReportConfig({
      from: "2026-10-01",
      to: "2026-10-31",
      timezone: "UTC",
    });

    expect(applyWorkOnlyConstraints(config)).toBe(config);
  });
});
