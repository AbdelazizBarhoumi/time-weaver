import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Circular 24h time-range picker (one range).
 *
 * - Drag the start / end handles to change them (they can't cross each other).
 * - Drag the arc itself to move the whole range, wrapping past midnight.
 * - Click the empty track to move the nearest handle there.
 * - Keyboard: focus a handle, then use arrow keys.
 *
 * `start` and `end` are hours in [0, 24). A range with start > end wraps past midnight (e.g. 22 -> 6).
 */

export interface TimeRange {
  start: number;
  end: number;
}

interface TimeRangeDialProps {
  value?: TimeRange | undefined;
  defaultValue?: TimeRange | undefined;
  onChange?: ((range: TimeRange) => void) | undefined;
  /** Snap size in hours. Should divide 24 evenly: 1, 0.5, 0.25 ... */
  step?: number | undefined;
  /** Width/height in px. */
  size?: number | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
}

// Swap these to retheme the dial.
const STYLE = {
  track: "stroke-line",
  arc: "stroke-neon",
  handle: "fill-neon",
  labelIn: "fill-void",
  labelOut: "fill-mut",
  handleText: "fill-void",
};

// Geometry in a 400 x 400 viewBox.
const VB = 400;
const C = VB / 2;
const R = 156; // radius of the ring centre line
const STROKE = 52;
const HANDLE_R = 28;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Mode = "start" | "end" | "move";

const mod = (n: number, m: number) => ((n % m) + m) % m;
/** Signed shortest distance from a to b on the 24h circle, in (-12, 12]. */
const signedDiff = (a: number, b: number) => {
  const d = mod(b - a, 24);
  return d > 12 ? d - 24 : d;
};

const FALLBACK: TimeRange = { start: 6, end: 13 };

function sanitize(r: TimeRange | undefined, fallback: TimeRange): TimeRange {
  if (!r || !Number.isFinite(r.start) || !Number.isFinite(r.end)) return fallback;
  const start = mod(r.start, 24);
  let end = mod(r.end, 24);
  if (end === start) end = mod(start + 1, 24);
  return { start, end };
}

const point = (hour: number, radius = R): [number, number] => {
  const a = (hour / 24) * Math.PI * 2;
  return [C + radius * Math.sin(a), C - radius * Math.cos(a)];
};

function minutesOf(h: number): number {
  return mod(Math.round(h * 60), 1440);
}

/** "9" for whole hours, "9:30" otherwise. */
function fmt(h: number): string {
  const total = minutesOf(h);
  const whole = Math.floor(total / 60);
  const mins = total % 60;
  return mins === 0 ? String(whole) : `${whole}:${String(mins).padStart(2, "0")}`;
}

/** "09:30" */
function fmtHM(h: number): string {
  const total = minutesOf(h);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Time({ h, minutes }: { h: number; minutes: boolean }) {
  if (minutes) return <span>{fmtHM(h)}</span>;
  return (
    <span>
      {Math.floor(minutesOf(h) / 60)}
      <span className="ml-0.5 text-[0.45em] text-mut">h</span>
    </span>
  );
}

export function TimeRangeDial({
  value,
  defaultValue = { start: 6, end: 13 },
  onChange,
  step = 1,
  size = 320,
  className = "",
  disabled = false,
}: TimeRangeDialProps) {
  const [inner, setInner] = useState<TimeRange>(() => sanitize(defaultValue, FALLBACK));
  // Never render NaN / out-of-range values, even if the parent passes something bad.
  const range = sanitize(value ?? inner, FALLBACK);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: Mode; last: number; acc: number; base: TimeRange } | null>(null);
  const shadowId = `dial-shadow-${useId().replace(/:/g, "")}`;

  const commit = (next: TimeRange) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  const snap = (h: number) => mod(Math.round(h / step) * step, 24);

  const pointerHour = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    return mod(((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2)) * 24, 24);
  };

  /** Stops a handle from jumping over the other one. */
  const clampAgainst = (from: number, to: number, other: number) => {
    const d = signedDiff(from, to);
    const o = signedDiff(from, other);
    if (d > 0 && o > 0 && o <= d) return mod(other - step, 24);
    if (d < 0 && o < 0 && o >= d) return mod(other + step, 24);
    return to;
  };

  const applyHandle = (which: "start" | "end", target: number) => {
    const current = range[which];
    const other = which === "start" ? range.end : range.start;
    if (target === current) return;
    const next = clampAgainst(current, target, other);
    if (next === current) return;
    commit({ ...range, [which]: next });
  };

  const begin = (e: PointerEvent<SVGElement>, mode: Mode | "track") => {
    const svg = svgRef.current;
    if (!svg || disabled) return;
    svg.setPointerCapture(e.pointerId);
    const h = pointerHour(e.clientX, e.clientY);
    let resolved: Mode;
    if (mode === "track") {
      resolved =
        Math.abs(signedDiff(range.start, h)) <= Math.abs(signedDiff(range.end, h)) ? "start" : "end";
      applyHandle(resolved, snap(h));
    } else {
      resolved = mode;
    }
    drag.current = { mode: resolved, last: h, acc: 0, base: range };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const h = pointerHour(e.clientX, e.clientY);
    if (d.mode === "move") {
      d.acc += signedDiff(d.last, h);
      d.last = h;
      const span = mod(d.base.end - d.base.start, 24);
      const start = snap(d.base.start + d.acc);
      if (start !== range.start) commit({ start, end: mod(start + span, 24) });
    } else {
      applyHandle(d.mode, snap(h));
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  const onKey = (which: "start" | "end") => (e: KeyboardEvent<SVGGElement>) => {
    let dir = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") dir = 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") dir = -1;
    if (!dir || disabled) return;
    e.preventDefault();
    applyHandle(which, mod(range[which] + dir * step, 24));
  };

  const span = mod(range.end - range.start, 24);
  const showMinutes = minutesOf(range.start) % 60 !== 0 || minutesOf(range.end) % 60 !== 0;
  const spanMin = Math.round(span * 60);
  const duration = `${Math.floor(spanMin / 60)}H${spanMin % 60 ? ` ${spanMin % 60}M` : ""}`;
  const [sx, sy] = point(range.start);
  const [ex, ey] = point(range.end);
  const arcPath = `M ${sx} ${sy} A ${R} ${R} 0 ${span > 12 ? 1 : 0} 1 ${ex} ${ey}`;
  const inRange = (h: number) => mod(h - range.start, 24) <= span;

  const handles: { which: "start" | "end"; label: string }[] = [
    { which: "start", label: "Start time" },
    { which: "end", label: "End time" },
  ];

  return (
    <div
      className={`relative select-none ${disabled ? "pointer-events-none opacity-50" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB} ${VB}`}
        className="h-full w-full touch-none"
        role="group"
        aria-label="Time range"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Track */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className={`${STYLE.track} cursor-pointer`}
          onPointerDown={(e) => begin(e, "track")}
        />

        {/* Selected arc (drag to move the whole range) */}
        <path
          d={arcPath}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className={`${STYLE.arc} cursor-grab active:cursor-grabbing`}
          onPointerDown={(e) => begin(e, "move")}
        />

        {/* Hour labels */}
        {HOURS.map((h) => {
          const [x, y] = point(h);
          return (
            <text
              key={h}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={15}
              className={`pointer-events-none ${inRange(h) ? STYLE.labelIn : STYLE.labelOut}`}
            >
              {h}
            </text>
          );
        })}

        {/* Handles */}
        {handles.map(({ which, label }) => {
          const [x, y] = point(range[which]);
          return (
            <g
              key={which}
              transform={`translate(${x} ${y})`}
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-disabled={disabled}
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={24}
              aria-valuenow={range[which]}
              aria-valuetext={`${fmt(range[which])}h`}
              className="cursor-grab outline-none active:cursor-grabbing [&:focus-visible>circle]:stroke-ink [&:focus-visible>circle]:stroke-[3]"
              onPointerDown={(e) => begin(e, which)}
              onKeyDown={onKey(which)}
            >
              <circle r={HANDLE_R} className={STYLE.handle} filter={`url(#${shadowId})`} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fmt(range[which]).length > 2 ? 12 : 16}
                fontWeight={600}
                className={`pointer-events-none ${STYLE.handleText}`}
              >
                {fmt(range[which])}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Centre readout */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div
          className="flex items-baseline gap-3 font-medium text-ink"
          style={{ fontSize: size * (showMinutes ? 0.078 : 0.11) }}
        >
          <Time h={range.start} minutes={showMinutes} />
          <span className="text-neon" style={{ fontSize: size * 0.05 }}>
            to
          </span>
          <Time h={range.end} minutes={showMinutes} />
        </div>
        <div className="mt-2 font-mono text-[11px] tracking-[0.2em] text-mut">{duration} SELECTED</div>
      </div>
    </div>
  );
}