import { useMemo, useState } from "react";
import { Briefcase, CalendarRange, CheckSquare, Eye, EyeOff, Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  REPORT_SECTIONS,
  SECTION_HINTS,
  SECTION_LABELS,
  WORK_ONLY_SECTIONS,
  formatReportDate,
  type ReportConfig,
  type ReportEventWorkFilter,
  type ReportSection,
  type ReportSessionSource,
  type ReportSessionType,
  type ReportSourceData,
  type ReportTaskFilter,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Chip, Field, Group, NativeSelect, SwitchRow, type SetReportConfig } from "./report-ui";

export function ReportContentPanel({
  config,
  setConfig,
  sourceData,
  sourceLoading,
  sourceError,
}: {
  config: ReportConfig;
  setConfig: SetReportConfig;
  sourceData: ReportSourceData | undefined;
  sourceLoading: boolean;
  sourceError: string | null;
}) {
  const workOnly = config.template === "work";
  const availableSections: readonly ReportSection[] = workOnly ? WORK_ONLY_SECTIONS : REPORT_SECTIONS;
  const selectedSections = config.sections.filter((section) => availableSections.includes(section));
  const allSelected = selectedSections.length === availableSections.length;

  function toggleSection(section: ReportSection) {
    setConfig((current) => {
      const has = current.sections.includes(section);
      const sections = has ? current.sections.filter((item) => item !== section) : [...current.sections, section];
      return { ...current, sections };
    });
  }

  function toggleArrayValue<T extends string | number>(values: T[], value: T): T[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  function patchCalendar(patch: Partial<ReportConfig["filters"]["calendar"]>) {
    setConfig((current) => ({
      ...current,
      filters: { ...current.filters, calendar: { ...current.filters.calendar, ...patch } },
    }));
  }

  function patchFilters(patch: Partial<ReportConfig["filters"]>) {
    setConfig((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  }

  return (
    <div className="space-y-3.5">
      {workOnly && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-100">
          <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <p>
            <span className="font-medium">Employer mode.</span> Only work sessions, work calendar events, and work
            tasks are included. Study, personal events, side tasks, focus blocks, and days off are excluded from both
            the preview and the PDF.
          </p>
        </div>
      )}

      <Group
        title="Sections"
        description={`${selectedSections.length} of ${availableSections.length} sections included`}
        open
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setConfig((current) => ({ ...current, sections: [...availableSections] }))}
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase",
              allSelected ? "border-neon/50 bg-neon/15 text-neon" : "border-line text-mut hover:text-ink",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setConfig((current) => ({ ...current, sections: [] }))}
            className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase text-mut hover:text-ink"
          >
            Clear
          </button>
          <span className="ml-auto text-[10px] text-mut">Click to include or hide</span>
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
          {availableSections.map((section) => {
            const checked = config.sections.includes(section);
            return (
              <button
                key={section}
                type="button"
                onClick={() => toggleSection(section)}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  checked ? "border-neon/30 bg-neon/5" : "border-line bg-void/30 hover:bg-panel",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]",
                    checked ? "border-neon bg-neon text-void" : "border-line text-transparent",
                  )}
                >
                  ✓
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-ink">{SECTION_LABELS[section]}</span>
                  <span className="block text-[10px] leading-snug text-mut">
                    {workOnly && section === "trend" ? "Work over time" : SECTION_HINTS[section]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {config.sections.length === 0 && (
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
            Choose at least one section to render a report.
          </p>
        )}
      </Group>

      <Group title="Tracked sessions" description="Filter the time entries and task attribution" open>
        <Field
          label="Session types"
          {...(workOnly ? { hint: "Study sessions are excluded from employer reports." } : {})}
        >
          <div className="flex flex-wrap gap-1.5">
            {(workOnly ? (["work"] as ReportSessionType[]) : (["work", "study"] as ReportSessionType[])).map((type) => (
              <Chip
                key={type}
                active={config.filters.sessionTypes.includes(type)}
                onClick={() =>
                  patchFilters({
                    sessionTypes: workOnly
                      ? ["work"]
                      : toggleArrayValue<ReportSessionType>(config.filters.sessionTypes, type),
                  })
                }
              >
                {type}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Sources">
          <div className="flex flex-wrap gap-1.5">
            {(["manual", "calendar"] as ReportSessionSource[]).map((source) => (
              <Chip
                key={source}
                active={config.filters.sessionSources.includes(source)}
                onClick={() =>
                  patchFilters({
                    sessionSources: toggleArrayValue<ReportSessionSource>(config.filters.sessionSources, source),
                  })
                }
              >
                {source === "manual" ? "timer / manual" : "calendar"}
              </Chip>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Task status">
            <NativeSelect
              value={config.filters.taskFilter}
              onChange={(value) => patchFilters({ taskFilter: value as ReportTaskFilter })}
              ariaLabel="Task status filter"
            >
              <option value="all">All tasks</option>
              <option value="open">Open only</option>
              <option value="done">Done only</option>
            </NativeSelect>
          </Field>
          <Field label="Note search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-mut" />
              <Input
                value={config.filters.search}
                onChange={(event) => patchFilters({ search: event.target.value })}
                placeholder="Find in notes"
                className="h-9 pl-8"
              />
            </div>
          </Field>
        </div>

        {sourceData && sourceData.tasks.length > 0 && (
          <Field label="Only these tasks" hint="Leave empty to include every task. This also narrows the session log.">
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line bg-void/40 p-2">
              {sourceData.tasks.map((task) => {
                const checked = config.filters.workTaskIds.includes(task.id);
                return (
                  <label key={task.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-ink hover:bg-panel">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        patchFilters({ workTaskIds: toggleArrayValue<number>(config.filters.workTaskIds, task.id) })
                      }
                      className="h-3.5 w-3.5 accent-emerald-400"
                    />
                    <span className={cn("truncate", task.status === "done" && "text-mut line-through")}>{task.title}</span>
                  </label>
                );
              })}
            </div>
          </Field>
        )}

        <SwitchRow
          label="Include session notes"
          description="Show each session's note in the session log."
          checked={config.filters.includeSessionNotes}
          onCheckedChange={(checked) => patchFilters({ includeSessionNotes: checked })}
        />
      </Group>

      <Group title="Calendar events" description="Choose exactly which events reach the report" open>
        <SwitchRow
          label="Include calendar events"
          description="Turn this off to leave every calendar section empty."
          checked={config.filters.calendar.include}
          onCheckedChange={(checked) => patchCalendar({ include: checked })}
        />

        {config.filters.calendar.include && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Field
                label="Work classification"
                {...(workOnly ? { hint: "Employer reports always use work events only." } : {})}
              >
                {workOnly ? (
                  <div className="flex h-9 items-center rounded-md border border-line bg-void/60 px-2.5 text-sm text-ink">
                    Work only
                  </div>
                ) : (
                  <NativeSelect
                    value={config.filters.calendar.workFilter}
                    onChange={(value) => patchCalendar({ workFilter: value as ReportEventWorkFilter })}
                    ariaLabel="Event work filter"
                  >
                    <option value="all">All events</option>
                    <option value="work">Work only</option>
                    <option value="personal">Personal only</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Event mode">
                <NativeSelect
                  value={config.filters.calendar.eventMode}
                  onChange={(value) => patchCalendar({ eventMode: value as "all" | "selected" })}
                  ariaLabel="Event selection mode"
                >
                  <option value="all">All matching</option>
                  <option value="selected">Only selected</option>
                </NativeSelect>
              </Field>
            </div>

            <Field label="Search events">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-mut" />
                <Input
                  value={config.filters.calendar.search}
                  onChange={(event) => patchCalendar({ search: event.target.value })}
                  placeholder="Title, calendar, or account"
                  className="h-9 pl-8"
                />
              </div>
            </Field>

            {sourceLoading && <p className="text-[11px] text-mut">Loading calendars and events…</p>}
            {sourceError && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">{sourceError}</p>}

            {sourceData && (
              <>
                {sourceData.truncated && (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                    Showing the first 1,000 of {sourceData.eventCount} events. Narrow the date range to pick the rest.
                  </p>
                )}

                <Field label="Accounts" hint="No selection means every connected account.">
                  <div className="flex flex-wrap gap-1.5">
                    {sourceData.accounts.length === 0 && <span className="text-[11px] text-mut">No calendar accounts connected.</span>}
                    {sourceData.accounts.map((account) => (
                      <Chip
                        key={account.id}
                        active={config.filters.calendar.accountIds.includes(account.id)}
                        title={account.email}
                        onClick={() =>
                          patchCalendar({
                            accountIds: toggleArrayValue<number>(config.filters.calendar.accountIds, account.id),
                          })
                        }
                      >
                        <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: account.color }} />
                        {account.email.split("@")[0]}
                        {account.disconnected ? " (off)" : ""}
                      </Chip>
                    ))}
                  </div>
                </Field>

                <Field label="Calendars" hint="No selection means every calendar in the account filter.">
                  <div className="flex flex-wrap gap-1.5">
                    {sourceData.calendars.length === 0 && <span className="text-[11px] text-mut">No calendars in this period.</span>}
                    {sourceData.calendars.map((calendar) => (
                      <Chip
                        key={calendar.id}
                        active={config.filters.calendar.calendarIds.includes(calendar.id)}
                        title={`${calendar.name} · ${calendar.accountEmail}`}
                        onClick={() =>
                          patchCalendar({
                            calendarIds: toggleArrayValue<string>(config.filters.calendar.calendarIds, calendar.id),
                          })
                        }
                      >
                        {calendar.name}
                      </Chip>
                    ))}
                  </div>
                </Field>

                {workOnly ? (
                  <p className="rounded-lg border border-line bg-void/40 px-2.5 py-2 text-[11px] text-mut">
                    All-day and personal events are excluded from employer reports.
                  </p>
                ) : (
                  <SwitchRow
                    label="Include all-day events"
                    description="All-day entries are shown as context, but never counted as work."
                    checked={config.filters.calendar.includeAllDay}
                    onCheckedChange={(checked) => patchCalendar({ includeAllDay: checked })}
                  />
                )}

                {config.filters.calendar.eventMode === "selected" && (
                  <EventPicker
                    config={config}
                    events={sourceData.events}
                    onClear={() => patchCalendar({ eventIds: [] })}
                    onSelectVisible={(ids) =>
                      patchCalendar({
                        eventIds: [...new Set([...config.filters.calendar.eventIds, ...ids])],
                      })
                    }
                    onToggle={(id) =>
                      patchCalendar({
                        eventIds: toggleArrayValue<string>(config.filters.calendar.eventIds, id),
                      })
                    }
                  />
                )}
              </>
            )}
          </>
        )}
      </Group>

      <Group
        title={workOnly ? "Report notes" : "Other context"}
        description={workOnly ? "Comments for this employer report" : "Side tasks, focus blocks, days off, and notes"}
      >
        {!workOnly && (
          <>
            <SwitchRow
              label="Side tasks"
              description="Personal tasks scheduled or completed in the period."
              checked={config.filters.includeSideTasks}
              onCheckedChange={(checked) => patchFilters({ includeSideTasks: checked })}
            />
            <SwitchRow
              label="Focus blocks"
              description="Protected focus time that overlaps the period."
              checked={config.filters.includeFocusBlocks}
              onCheckedChange={(checked) => patchFilters({ includeFocusBlocks: checked })}
            />
            <SwitchRow
              label="Days off"
              description="Include the days-off table and use them when calculating targets."
              checked={config.filters.includeDayOffs}
              onCheckedChange={(checked) => patchFilters({ includeDayOffs: checked })}
            />
          </>
        )}

        <Field label="Report notes" hint="Appears in the Notes section and in the PDF.">
          <Textarea
            value={config.notes}
            onChange={(event) => setConfig((current) => ({ ...current, notes: event.target.value }))}
            placeholder="Add context, wins, blockers, or anything the numbers cannot say…"
            rows={4}
            className="resize-y"
          />
        </Field>
      </Group>

      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-[11px] text-mut">
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-neon" />
        <span>
          {workOnly
            ? "Employer mode applies work-only filters to both the preview and the generated PDF."
            : "Filters apply to both the preview and the generated PDF."}
        </span>
      </div>
    </div>
  );
}

function EventPicker({
  config,
  events,
  onToggle,
  onSelectVisible,
  onClear,
}: {
  config: ReportConfig;
  events: ReportSourceData["events"];
  onToggle: (id: string) => void;
  onSelectVisible: (ids: string[]) => void;
  onClear: () => void;
}) {
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const selected = new Set(config.filters.calendar.eventIds);
  const calendar = config.filters.calendar;

  const visible = useMemo(() => {
    const search = calendar.search.toLowerCase();
    return events.filter((event) => {
      if (!calendar.includeAllDay && event.allDay) return false;
      if (calendar.workFilter === "work" && !event.isWork) return false;
      if (calendar.workFilter === "personal" && event.isWork) return false;
      if (calendar.accountIds.length > 0 && !calendar.accountIds.includes(event.accountId)) return false;
      if (calendar.calendarIds.length > 0 && !calendar.calendarIds.includes(event.calendarId)) return false;
      if (search) {
        const haystack = `${event.title} ${event.calendarName} ${event.accountEmail}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (showOnlySelected && !selected.has(event.id)) return false;
      return true;
    });
  }, [events, calendar, showOnlySelected, selected]);

  return (
    <div className="rounded-xl border border-line bg-void/30 p-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-mut">
          {config.filters.calendar.eventIds.length} selected
        </span>
        <button
          type="button"
          onClick={() => setShowOnlySelected((current) => !current)}
          className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-mut hover:text-ink"
        >
          {showOnlySelected ? <EyeOff className="mr-1 inline h-3 w-3" /> : <Eye className="mr-1 inline h-3 w-3" />}
          {showOnlySelected ? "Show all" : "Selected only"}
        </button>
        <button
          type="button"
          onClick={() => onSelectVisible(visible.map((event) => event.id))}
          disabled={visible.length === 0}
          className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-mut hover:text-ink disabled:opacity-40"
        >
          <CheckSquare className="mr-1 inline h-3 w-3" /> Select visible
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={selected.size === 0}
          className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-mut hover:text-ink disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {visible.length === 0 && (
          <div className="px-2 py-6 text-center text-[11px] text-mut">
            No events match the current filters.
          </div>
        )}
        {visible.map((event) => {
          const checked = selected.has(event.id);
          return (
            <label
              key={event.id}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                checked ? "border-neon/30 bg-neon/5" : "border-transparent hover:border-line hover:bg-panel",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(event.id)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-400"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-xs text-ink">{event.title}</span>
                  {event.isWork && <span className="shrink-0 rounded bg-emerald-400/15 px-1 py-0.5 font-mono text-[8px] text-emerald-300">work</span>}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-mut">
                  <CalendarRange className="h-3 w-3" />
                  {event.allDay ? "All day" : formatEventTime(event.start, event.end, config.timezone)}
                  <span>·</span>
                  <span className="truncate">{event.calendarName}</span>
                  <span className="truncate">· {event.accountEmail}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {visible.length > 0 && (
        <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-[10px] text-mut">
          <span>
            {visible.length} visible · {selected.size} selected
          </span>
          <span>{formatReportDate(config.from)} → {formatReportDate(config.to)}</span>
        </div>
      )}
    </div>
  );
}

function formatEventTime(start: string, end: string, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${formatter.format(new Date(start))} → ${formatter.format(new Date(end))}`;
  } catch {
    return start;
  }
}
