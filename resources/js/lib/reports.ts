import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, API_BASE_URL } from "./api";

export const REPORT_SECTIONS = [
  "cover",
  "summary",
  "kpis",
  "trend",
  "heatmap",
  "daily",
  "sessions",
  "calendar",
  "tasks",
  "study",
  "monthly",
  "comparison",
  "sideTasks",
  "focusBlocks",
  "dayOffs",
  "notes",
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** Sections that can appear in an employer-facing, work-only report. */
export const WORK_ONLY_SECTIONS: readonly ReportSection[] = [
  "cover",
  "summary",
  "kpis",
  "trend",
  "heatmap",
  "daily",
  "sessions",
  "calendar",
  "tasks",
  "monthly",
  "comparison",
  "notes",
];

export const SECTION_LABELS: Record<ReportSection, string> = {
  cover: "Cover page",
  summary: "Executive summary",
  kpis: "Key numbers",
  trend: "Activity trend",
  heatmap: "Consistency heatmap",
  daily: "Daily breakdown",
  sessions: "Tracked sessions",
  calendar: "Calendar agenda",
  tasks: "Work tasks",
  study: "Study focus",
  monthly: "Monthly goals",
  comparison: "Period comparison",
  sideTasks: "Side tasks",
  focusBlocks: "Focus blocks",
  dayOffs: "Days off",
  notes: "Notes",
};

export const SECTION_HINTS: Record<ReportSection, string> = {
  cover: "Branded title page with the reporting period",
  summary: "The short story of the period plus highlights",
  kpis: "A compact grid of the most important figures",
  trend: "Work and study over time",
  heatmap: "A month-by-month consistency grid",
  daily: "Every active day in a table",
  sessions: "The full tracked-session log",
  calendar: "The calendar events you chose to include",
  tasks: "Task status, tracked time, and deadlines",
  study: "Study totals, averages, and share",
  monthly: "Monthly targets and pace",
  comparison: "This period against the previous one",
  sideTasks: "Personal tasks scheduled in the period",
  focusBlocks: "Protected focus time",
  dayOffs: "Included and excluded days off",
  notes: "Your own commentary for the report",
};

export const REPORT_TEMPLATES = {
  work: {
    label: "Employer report",
    description: "Work only — no study or personal items",
    sections: [
      "cover",
      "summary",
      "kpis",
      "trend",
      "daily",
      "sessions",
      "calendar",
      "tasks",
      "comparison",
      "notes",
    ] as ReportSection[],
  },
  full: {
    label: "Full report",
    description: "Everything, including calendar and tasks",
    sections: [...REPORT_SECTIONS],
  },
  time: {
    label: "Time focused",
    description: "Tracked time, trends, study, and goals",
    sections: ["cover", "summary", "kpis", "trend", "heatmap", "daily", "sessions", "study", "monthly", "notes"] as ReportSection[],
  },
  calendar: {
    label: "Calendar focused",
    description: "Agenda, work events, and the period story",
    sections: ["cover", "summary", "kpis", "trend", "calendar", "daily", "comparison", "notes"] as ReportSection[],
  },
  tasks: {
    label: "Tasks focused",
    description: "Task progress, side tasks, and focus time",
    sections: ["cover", "summary", "kpis", "tasks", "sideTasks", "focusBlocks", "comparison", "notes"] as ReportSection[],
  },
} satisfies Record<string, { label: string; description: string; sections: ReportSection[] }>;

export type ReportTemplate = keyof typeof REPORT_TEMPLATES;

export type ReportComparison = "none" | "previous_period" | "previous_year";
export type ReportGrouping = "day" | "week" | "month";
export type ReportPaper = "a4" | "letter";
export type ReportOrientation = "portrait" | "landscape";
export type ReportSessionType = "work" | "study";
export type ReportSessionSource = "manual" | "calendar";
export type ReportTaskFilter = "all" | "open" | "done";
export type ReportEventWorkFilter = "all" | "work" | "personal";
export type ReportEventMode = "all" | "selected";

export interface ReportCalendarFilters {
  include: boolean;
  accountIds: number[];
  calendarIds: string[];
  eventIds: string[];
  eventMode: ReportEventMode;
  workFilter: ReportEventWorkFilter;
  search: string;
  includeAllDay: boolean;
}

export interface ReportFilters {
  sessionTypes: ReportSessionType[];
  sessionSources: ReportSessionSource[];
  workTaskIds: number[];
  taskFilter: ReportTaskFilter;
  search: string;
  includeSessionNotes: boolean;
  calendar: ReportCalendarFilters;
  includeSideTasks: boolean;
  includeFocusBlocks: boolean;
  includeDayOffs: boolean;
}

export interface ReportConfig {
  template: ReportTemplate;
  title: string;
  subtitle: string;
  company: string;
  preparedFor: string;
  preparedBy: string;
  accentColor: string;
  footerText: string;
  showPageNumbers: boolean;
  notes: string;
  from: string;
  to: string;
  timezone: string;
  comparison: ReportComparison;
  groupBy: ReportGrouping;
  paper: ReportPaper;
  orientation: ReportOrientation;
  sections: ReportSection[];
  filters: ReportFilters;
}

export interface ReportSettings {
  companyName: string | null;
  preparedBy: string | null;
  footerText: string | null;
  accentColor: string;
  logoDataUri: string | null;
}

export interface ReportPreset {
  id: number;
  name: string;
  config: Partial<ReportConfig>;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface ReportHistoryItem {
  id: number;
  title: string;
  fileName: string;
  fileSize: number;
  format: "pdf";
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  generatedAt: string | null;
  presetId: number | null;
  downloadUrl: string;
}

export interface ReportPreviewResponse {
  html: string;
  config: ReportConfig;
  meta: {
    title: string;
    periodLabel: string;
    paperLabel: string;
    sections: ReportSection[];
    generatedAt: string;
  };
  counts: {
    sessions: number;
    events: number;
    tasks: number;
    sideTasks: number;
    focusBlocks: number;
    dayOffs: number;
    days: number;
  };
  warnings: string[];
}

export interface ReportSourceAccount {
  id: number;
  email: string;
  color: string;
  defaultWork: boolean;
  disconnected: boolean;
}

export interface ReportSourceCalendar {
  id: string;
  name: string;
  accountEmail: string;
}

export interface ReportSourceTask {
  id: number;
  title: string;
  status: "open" | "done";
}

export interface ReportSourceEvent {
  id: string;
  eventId: string;
  accountId: number;
  calendarId: string;
  calendarName: string;
  accountEmail: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  isWork: boolean;
  workSource: "manual" | "rule" | "account" | null;
  color: string | null;
}

export interface ReportSourceData {
  from: string;
  to: string;
  timezone: string;
  accounts: ReportSourceAccount[];
  calendars: ReportSourceCalendar[];
  tasks: ReportSourceTask[];
  events: ReportSourceEvent[];
  dayOffs: { date: string; type: "included" | "excluded" }[];
  eventCount: number;
  truncated: boolean;
}

/* --------------------------------------------------------------- dates */

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function dateInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values: Record<string, string> = {};
    for (const part of parts) {
      values[part.type] = part.value;
    }
    return `${values["year"]}-${values["month"]}-${values["day"]}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDateDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function startOfMonthDate(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonthDate(value: string): string {
  const [yearPart, monthPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

export function rangeDayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function validateReportRange(from: string, to: string): string | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return "Choose a valid start and end date.";
  }
  if (from > to) {
    return "The start date must be on or before the end date.";
  }
  if (rangeDayCount(from, to) > 731) {
    return "Reports can cover at most two years at a time.";
  }
  return null;
}

export function formatReportDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00Z`));
  } catch {
    return value;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const FALLBACK_TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "America/Argentina/Buenos_Aires",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Pacific/Auckland",
];

export function timezoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    zones = supported ?? [];
  } catch {
    zones = [];
  }

  return [...new Set([current, ...(zones.length > 0 ? zones : FALLBACK_TIMEZONES), "UTC"])].sort();
}

export function createDefaultReportConfig(overrides: Partial<ReportConfig> = {}): ReportConfig {
  const timezone = overrides.timezone ?? browserTimeZone();
  const today = dateInTimeZone(new Date(), timezone);
  const from = overrides.from ?? startOfMonthDate(today);
  const to = overrides.to ?? today;
  const baseFilters: ReportFilters = {
    sessionTypes: ["work", "study"],
    sessionSources: ["manual", "calendar"],
    workTaskIds: [],
    taskFilter: "all",
    search: "",
    includeSessionNotes: true,
    calendar: {
      include: true,
      accountIds: [],
      calendarIds: [],
      eventIds: [],
      eventMode: "all",
      workFilter: "all",
      search: "",
      includeAllDay: true,
    },
    includeSideTasks: true,
    includeFocusBlocks: true,
    includeDayOffs: true,
  };

  return {
    template: "full",
    title: "Time & Work Report",
    subtitle: "",
    company: "",
    preparedFor: "",
    preparedBy: "",
    accentColor: "#0f766e",
    footerText: "Generated with ShiftGrid",
    showPageNumbers: true,
    notes: "",
    from,
    to,
    timezone,
    comparison: "previous_period",
    groupBy: rangeDayCount(from, to) <= 31 ? "day" : rangeDayCount(from, to) <= 120 ? "week" : "month",
    paper: "a4",
    orientation: "portrait",
    sections: [...REPORT_TEMPLATES.full.sections],
    ...overrides,
    filters: {
      ...baseFilters,
      ...(overrides.filters ?? {}),
      calendar: {
        ...baseFilters.calendar,
        ...(overrides.filters?.calendar ?? {}),
      },
    },
  };
}

/**
 * The employer template is enforced again by the API, but keeping the client
 * config clean means the builder never shows personal filters that the server
 * would quietly discard.
 */
export function applyWorkOnlyConstraints(config: ReportConfig): ReportConfig {
  if (config.template !== "work") {
    return config;
  }

  const sections = config.sections.filter((section) => WORK_ONLY_SECTIONS.includes(section));

  return {
    ...config,
    sections: sections.length > 0 ? sections : [...REPORT_TEMPLATES.work.sections],
    filters: {
      ...config.filters,
      sessionTypes: ["work"],
      calendar: {
        ...config.filters.calendar,
        workFilter: "work",
        includeAllDay: false,
      },
      includeSideTasks: false,
      includeFocusBlocks: false,
      includeDayOffs: false,
    },
  };
}

/* ----------------------------------------------------------------- API */

interface ApiErrorPayload {
  message?: string;
  errors?: Record<string, string[]>;
}

function postForm<T>(path: string, body: FormData): Promise<T> {
  const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");

  return fetch(`${API_BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(token ? { "X-CSRF-TOKEN": token } : {}),
    },
    body,
  }).then(async (response) => {
    const payload = (await response.json().catch(() => null)) as (T & ApiErrorPayload) | null;

    if (!response.ok) {
      if (response.status === 401 && !["/login", "/register"].includes(window.location.pathname)) {
        window.location.href = "/login";
      }

      const error = new Error(payload?.message ?? "Could not save branding.") as Error & {
        response?: { data: ApiErrorPayload | null };
      };
      error.response = { data: payload };
      throw error;
    }

    if (payload === null) {
      throw new Error("The server returned an empty response.");
    }

    return payload;
  });
}

export const reportsApi = {
  preview: (config: ReportConfig) => api.post<ReportPreviewResponse>("/reports/preview", config).then((res) => res.data),
  generate: (config: ReportConfig, presetId?: number | null) =>
    api
      .post<{ report: ReportHistoryItem; downloadUrl: string }>("/reports", {
        ...config,
        ...(presetId ? { presetId } : {}),
      })
      .then((res) => res.data),
  history: () => api.get<{ reports: ReportHistoryItem[] }>("/reports").then((res) => res.data),
  deleteReport: (id: number) => api.delete<{ deleted: boolean }>(`/reports/${id}`).then((res) => res.data),
  sourceData: (params: { from: string; to: string; timezone: string }) =>
    api.get<ReportSourceData>("/reports/source-data", { params }).then((res) => res.data),
  presets: () => api.get<ReportPreset[]>("/report-presets").then((res) => res.data),
  createPreset: (input: { name: string; config: Partial<ReportConfig>; isDefault?: boolean }) =>
    api.post<ReportPreset>("/report-presets", input).then((res) => res.data),
  updatePreset: (id: number, input: { name?: string; config?: Partial<ReportConfig>; isDefault?: boolean }) =>
    api.put<ReportPreset>(`/report-presets/${id}`, input).then((res) => res.data),
  deletePreset: (id: number) => api.delete<{ deleted: boolean }>(`/report-presets/${id}`).then((res) => res.data),
  settings: () => api.get<ReportSettings>("/report-settings").then((res) => res.data),
  saveSettings: (input: {
    companyName: string;
    preparedBy: string;
    footerText: string;
    accentColor: string;
    logo?: File | null;
    removeLogo?: boolean;
  }) => {
    const body = new FormData();
    body.append("companyName", input.companyName);
    body.append("preparedBy", input.preparedBy);
    body.append("footerText", input.footerText);
    body.append("accentColor", input.accentColor);
    if (input.logo) body.append("logo", input.logo);
    if (input.removeLogo) body.append("removeLogo", "1");

    return postForm<ReportSettings>("/report-settings", body);
  },
};

/* --------------------------------------------------------------- hooks */

export function useReportSettings() {
  return useQuery({ queryKey: ["reports", "settings"], queryFn: reportsApi.settings, staleTime: 60_000 });
}

export function useSaveReportSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reportsApi.saveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", "settings"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "preview"] });
    },
  });
}

export function useReportPresets() {
  return useQuery({ queryKey: ["reports", "presets"], queryFn: reportsApi.presets });
}

export function useCreateReportPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reportsApi.createPreset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "presets"] }),
  });
}

export function useUpdateReportPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: { name?: string; config?: Partial<ReportConfig>; isDefault?: boolean } }) =>
      reportsApi.updatePreset(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "presets"] }),
  });
}

export function useDeleteReportPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reportsApi.deletePreset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "presets"] }),
  });
}

export function useReportHistory() {
  return useQuery({ queryKey: ["reports", "history"], queryFn: reportsApi.history });
}

export function useGenerateReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ config, presetId }: { config: ReportConfig; presetId?: number | null }) =>
      reportsApi.generate(config, presetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "history"] }),
  });
}

export function useDeleteReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reportsApi.deleteReport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "history"] }),
  });
}

export function useReportSourceData(from: string, to: string, timezone: string, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "source", from, to, timezone],
    queryFn: () => reportsApi.sourceData({ from, to, timezone }),
    enabled,
    staleTime: 60_000,
  });
}

export function useReportPreview(config: ReportConfig, enabled: boolean) {
  return useQuery({
    queryKey: ["reports", "preview", config],
    queryFn: () => reportsApi.preview(config),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: false,
  });
}

/* --------------------------------------------------------------- utils */

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
