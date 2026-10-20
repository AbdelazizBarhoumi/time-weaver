import { Briefcase, CalendarDays, FileText, Gauge, LayoutTemplate, Rows3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  REPORT_TEMPLATES,
  addDateDays,
  applyWorkOnlyConstraints,
  dateInTimeZone,
  endOfMonthDate,
  startOfMonthDate,
  timezoneOptions,
  type ReportComparison,
  type ReportConfig,
  type ReportGrouping,
  type ReportOrientation,
  type ReportPaper,
  type ReportTemplate,
} from "@/lib/reports";
import { Field, Group, NativeSelect, type SetReportConfig } from "./report-ui";
import { cn } from "@/lib/utils";

const TEMPLATE_ICONS: Record<ReportTemplate, typeof LayoutTemplate> = {
  work: Briefcase,
  full: LayoutTemplate,
  time: Gauge,
  calendar: CalendarDays,
  tasks: Rows3,
};

const GROUPINGS: { value: ReportGrouping; label: string }[] = [
  { value: "day", label: "Day by day" },
  { value: "week", label: "Week by week" },
  { value: "month", label: "Month by month" },
];

const COMPARISONS: { value: ReportComparison; label: string }[] = [
  { value: "none", label: "No comparison" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_year", label: "Same period last year" },
];

const PAPERS: { value: ReportPaper; label: string }[] = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "US Letter" },
];

const ORIENTATIONS: { value: ReportOrientation; label: string }[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

export function ReportSetupPanel({
  config,
  setConfig,
  rangeError,
}: {
  config: ReportConfig;
  setConfig: SetReportConfig;
  rangeError: string | null;
}) {
  const today = dateInTimeZone(new Date(), config.timezone);
  const quickRanges = [
    {
      label: "This month",
      apply: () => ({ from: startOfMonthDate(today), to: today }),
    },
    {
      label: "Full month",
      apply: () => ({ from: startOfMonthDate(today), to: endOfMonthDate(today) }),
    },
    {
      label: "Last month",
      apply: () => {
        const last = addDateDays(startOfMonthDate(today), -1);
        return { from: startOfMonthDate(last), to: endOfMonthDate(last) };
      },
    },
    {
      label: "Last 7 days",
      apply: () => ({ from: addDateDays(today, -6), to: today }),
    },
    {
      label: "Last 30 days",
      apply: () => ({ from: addDateDays(today, -29), to: today }),
    },
    {
      label: "This year",
      apply: () => ({ from: `${today.slice(0, 4)}-01-01`, to: today }),
    },
  ];

  function applyTemplate(template: ReportTemplate) {
    const preset = REPORT_TEMPLATES[template];
    setConfig((current) => {
      const next: ReportConfig = {
        ...current,
        template,
        sections: [...preset.sections],
      };

      if (template === "work") {
        next.filters = {
          ...current.filters,
          sessionTypes: ["work"],
          sessionSources: ["manual", "calendar"],
          workTaskIds: [],
          taskFilter: "all",
          search: "",
          includeSessionNotes: true,
          calendar: {
            ...current.filters.calendar,
            include: true,
            accountIds: [],
            calendarIds: [],
            eventIds: [],
            eventMode: "all",
            workFilter: "work",
            search: "",
            includeAllDay: false,
          },
          includeSideTasks: false,
          includeFocusBlocks: false,
          includeDayOffs: false,
        };

        if (!current.title || current.title === "Time & Work Report") {
          next.title = "Work Report";
        }
      } else if (current.template === "work") {
        // Going back to a normal template should not leave employer-only
        // filters silently in place.
        next.filters = {
          ...current.filters,
          sessionTypes: ["work", "study"],
          calendar: {
            ...current.filters.calendar,
            workFilter: "all",
            includeAllDay: true,
          },
          includeSideTasks: true,
          includeFocusBlocks: true,
          includeDayOffs: true,
        };

        if (current.title === "Work Report") {
          next.title = "Time & Work Report";
        }
      }

      return applyWorkOnlyConstraints(next);
    });
  }

  function setDate(key: "from" | "to", value: string) {
    setConfig((current) => {
      if (!value) return current;
      if (key === "from" && value > current.to) {
        return { ...current, from: value, to: value };
      }
      if (key === "to" && value < current.from) {
        return { ...current, from: value, to: value };
      }
      return { ...current, [key]: value };
    });
  }

  return (
    <div className="space-y-3.5">
      <div className="rounded-xl border border-line bg-panel p-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-neon" />
          <h2 className="text-sm font-medium text-ink">Reporting period</h2>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="From">
            <Input
              type="date"
              value={config.from}
              max={config.to}
              onChange={(event) => setDate("from", event.target.value)}
              className="[color-scheme:dark]"
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={config.to}
              min={config.from}
              onChange={(event) => setDate("to", event.target.value)}
              className="[color-scheme:dark]"
            />
          </Field>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {quickRanges.map((range) => {
            const next = range.apply();
            const active = config.from === next.from && config.to === next.to;
            return (
              <button
                key={range.label}
                type="button"
                onClick={() => setConfig((current) => ({ ...current, ...next }))}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors",
                  active
                    ? "border-neon/50 bg-neon/15 text-neon"
                    : "border-line bg-void/40 text-mut hover:text-ink",
                )}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        {rangeError && <p className="mt-2 text-[11px] text-red-400">{rangeError}</p>}

        <Field label="Time zone" className="mt-3.5" hint="All dates, session times, and day boundaries use this zone.">
          <NativeSelect
            value={config.timezone}
            onChange={(value) => setConfig((current) => ({ ...current, timezone: value }))}
            ariaLabel="Report time zone"
          >
            {timezoneOptions(config.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Group title="Report template" description="Start with a curated set of sections" open>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(REPORT_TEMPLATES) as ReportTemplate[]).map((template) => {
            const preset = REPORT_TEMPLATES[template];
            const Icon = TEMPLATE_ICONS[template];
            const active = config.template === template;
            return (
              <button
                key={template}
                type="button"
                onClick={() => applyTemplate(template)}
                className={cn(
                  "rounded-lg border p-2.5 text-left transition-colors",
                  template === "work" && "col-span-2",
                  active ? "border-neon/50 bg-neon/10" : "border-line bg-void/40 hover:border-line/80 hover:bg-panel",
                )}
              >
                <Icon className={cn("mb-1.5 h-4 w-4", active ? "text-neon" : "text-mut")} />
                <span className="block text-xs font-medium text-ink">{preset.label}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-mut">{preset.description}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Layout and analysis" description="Paper, grouping, and comparison options">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Trend grouping">
            <NativeSelect
              value={config.groupBy}
              onChange={(value) => setConfig((current) => ({ ...current, groupBy: value as ReportGrouping }))}
              ariaLabel="Trend grouping"
            >
              {GROUPINGS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Comparison">
            <NativeSelect
              value={config.comparison}
              onChange={(value) => setConfig((current) => ({ ...current, comparison: value as ReportComparison }))}
              ariaLabel="Comparison period"
            >
              {COMPARISONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Paper">
            <NativeSelect
              value={config.paper}
              onChange={(value) => setConfig((current) => ({ ...current, paper: value as ReportPaper }))}
              ariaLabel="Paper size"
            >
              {PAPERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Orientation">
            <NativeSelect
              value={config.orientation}
              onChange={(value) => setConfig((current) => ({ ...current, orientation: value as ReportOrientation }))}
              ariaLabel="Page orientation"
            >
              {ORIENTATIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-void/40 px-3 py-2.5">
          <div>
            <p className="text-sm text-ink">Page numbers</p>
            <p className="text-[11px] text-mut">Show page X of Y in PDF exports.</p>
          </div>
          <Switch
            checked={config.showPageNumbers}
            onCheckedChange={(checked) => setConfig((current) => ({ ...current, showPageNumbers: checked }))}
          />
        </div>
      </Group>

      <div className="flex items-start gap-2 rounded-xl border border-line bg-panel p-3 text-[11px] leading-relaxed text-mut">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-neon" />
        <p>
          The preview and the PDF are rendered from the same template. Use the PDF button for the print-ready file, or
          PNG/JPEG to share the report as an image.
        </p>
      </div>
    </div>
  );
}
