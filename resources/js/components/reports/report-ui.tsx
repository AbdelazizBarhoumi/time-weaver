import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ReportConfig } from "@/lib/reports";

export type SetReportConfig = Dispatch<SetStateAction<ReportConfig>>;

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="font-mono text-[10px] uppercase tracking-wide text-mut">{label}</Label>
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-mut">{hint}</p>}
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-void/40 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-mut">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5 shrink-0" />
    </div>
  );
}

export function CheckRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-void/40 px-3 py-2.5 transition-colors hover:border-line/80 hover:bg-panel">
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-snug text-mut">{description}</span>}
      </span>
    </label>
  );
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors",
        active
          ? "border-neon/50 bg-neon/15 text-neon"
          : "border-line bg-void/50 text-mut hover:border-line hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function NativeSelect({
  value,
  onChange,
  children,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-9 w-full rounded-md border border-line bg-void px-2.5 text-sm text-ink outline-none transition-colors focus:border-neon/50",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Group({
  title,
  description,
  children,
  open = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-2 px-3.5 py-3">
        <span>
          <span className="block text-sm font-medium text-ink">{title}</span>
          {description && <span className="mt-0.5 block text-[11px] leading-snug text-mut">{description}</span>}
        </span>
        <span className="mt-1 font-mono text-[10px] text-mut transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-2.5 border-t border-line px-3.5 pb-3.5 pt-3">{children}</div>
    </details>
  );
}
