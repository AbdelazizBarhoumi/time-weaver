"use client";

import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { TimeRangeDial, type TimeRange } from "@/components/ui/time-range-dial";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string | undefined;
  type?: "date" | "time" | "datetime" | "timerange" | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  min?: string | undefined;
  max?: string | undefined;
  /** Dial snap size in hours (1, 0.5, 0.25 ...). Minutes can always be typed exactly. */
  step?: number | undefined;
}

/* ---------- helpers ---------- */

const mod = (n: number, m: number) => ((n % m) + m) % m;
const pad = (n: number) => String(n).padStart(2, "0");

/** hours (e.g. 9.5) -> "09:30" */
function hoursToHM(h: number): string {
  const total = mod(Math.round(h * 60), 1440);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "9", "9:30", "09:30" -> hours, or NaN when it isn't a valid time. */
function parseHM(s: string): number {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return NaN;
  return h + min / 60;
}

const DEFAULT_RANGE: TimeRange = { start: 9, end: 17 };

/** "09:00 - 17:30" -> { start, end }. Falls back to the default on anything unparseable. */
function parseTimeRange(value?: string): TimeRange {
  if (!value) return DEFAULT_RANGE;
  const [a, b] = value.split("-");
  const start = parseHM(a ?? "");
  const end = parseHM(b ?? "");
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : DEFAULT_RANGE;
}

function formatTimeRange(range: TimeRange): string {
  return `${hoursToHM(range.start)} - ${hoursToHM(range.end)}`;
}

/** "YYYY-MM-DD" -> local Date (new Date("YYYY-MM-DD") would be parsed as UTC). */
function parseLocalDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Local Date -> "YYYY-MM-DD" (toISOString() would shift the day for non-UTC timezones). */
function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ---------- icons ---------- */

const iconProps = {
  className: "ml-2 h-4 w-4 opacity-50",
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/* ---------- HH : MM entry ---------- */

function TwoDigitInput({
  value,
  max,
  label,
  onCommit,
  disabled,
}: {
  value: number;
  max: number;
  label: string;
  onCommit: (n: number) => void;
  disabled?: boolean | undefined;
}) {
  const [text, setText] = React.useState(pad(value));
  const [focused, setFocused] = React.useState(false);

  // Follow outside changes (dial drags) unless the user is typing here.
  React.useEffect(() => {
    if (!focused) setText(pad(value));
  }, [value, focused]);

  return (
    <input
      inputMode="numeric"
      aria-label={label}
      value={text}
      maxLength={2}
      disabled={disabled}
      onFocus={(e) => {
        setFocused(true);
        e.target.select();
      }}
      onBlur={() => {
        setFocused(false);
        setText(pad(value));
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
        if (digits === "") {
          setText("");
          return;
        }
        const n = Math.min(Number(digits), max);
        setText(Number(digits) > max ? pad(n) : digits);
        onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const next = mod(value + (e.key === "ArrowUp" ? 1 : -1), max + 1);
        setText(pad(next));
        onCommit(next);
      }}
      className="w-11 rounded-md bg-void px-2 py-1.5 text-center font-mono text-sm text-ink ring-1 ring-line outline-none transition focus:ring-neon/60 disabled:opacity-50"
    />
  );
}

function TimeField({
  label,
  hours,
  onChange,
  disabled,
}: {
  label: string;
  hours: number;
  onChange: (hours: number) => void;
  disabled?: boolean | undefined;
}) {
  const total = mod(Math.round(hours * 60), 1440);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] tracking-[0.15em] text-mut">{label}</div>
      <div className="flex items-center gap-1">
        <TwoDigitInput
          label={`${label} hours`}
          value={hh}
          max={23}
          onCommit={(n) => onChange(n + mm / 60)}
          disabled={disabled}
        />
        <span className="font-mono text-mut">:</span>
        <TwoDigitInput
          label={`${label} minutes`}
          value={mm}
          max={59}
          onCommit={(n) => onChange(hh + n / 60)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

/* ---------- popover contents ---------- */

function TimeRangeContent({
  value,
  onChange,
  step,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  step: number;
  disabled?: boolean | undefined;
}) {
  const range = React.useMemo(() => parseTimeRange(value), [value]);
  const update = (next: TimeRange) => onChange(formatTimeRange(next));

  return (
    <div className="w-[296px] p-3">
      <div className="mb-2 px-1 font-mono text-[10px] tracking-[0.2em] text-mut">SELECT TIME RANGE</div>
      <div className="flex justify-center">
        <TimeRangeDial value={range} onChange={update} step={step} disabled={disabled} size={272} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 px-1">
        <TimeField
          label="START"
          hours={range.start}
          onChange={(h) => update({ ...range, start: h })}
          disabled={disabled}
        />
        <TimeField
          label="END"
          hours={range.end}
          onChange={(h) => update({ ...range, end: h })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function SingleTimeContent({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
}) {
  const parsed = parseHM(value);
  const hours = Number.isFinite(parsed) ? parsed : 9;
  return (
    <div className="p-3">
      <TimeField label="TIME" hours={hours} onChange={(h) => onChange(hoursToHM(h))} disabled={disabled} />
    </div>
  );
}

/* ---------- main component ---------- */

export function DateTimePicker({
  value,
  onChange,
  label,
  type = "date",
  placeholder,
  className,
  disabled,
  min,
  max,
  step = 1,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const isTimeType = type === "time" || type === "timerange";
  const fallbackText =
    type === "timerange" ? "Select time range" : type === "time" ? "Select time" : "Select date";

  const selectedDate = isTimeType ? undefined : parseLocalDate(value);
  const minDate = parseLocalDate(min);
  const maxDate = parseLocalDate(max);

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label className="mb-1 block font-mono text-[10px] tracking-[0.15em] text-mut">{label}</label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("w-full justify-between font-mono text-sm", !value && "text-mut")}
            disabled={disabled}
          >
            <span>{value || placeholder || fallbackText}</span>
            {isTimeType ? <ClockIcon /> : <CalendarIcon />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
          {type === "timerange" ? (
            <TimeRangeContent value={value} onChange={onChange} step={step} disabled={disabled} />
          ) : type === "time" ? (
            <SingleTimeContent value={value} onChange={onChange} disabled={disabled} />
          ) : (
            <Calendar
              mode="single"
              {...(selectedDate ? { selected: selectedDate, defaultMonth: selectedDate } : {})}
              onSelect={(date) => {
                if (date) {
                  onChange(toLocalISO(date));
                  setOpen(false);
                }
              }}
              disabled={(date) => Boolean((minDate && date < minDate) || (maxDate && date > maxDate))}
              autoFocus
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}