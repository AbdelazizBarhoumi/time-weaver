import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CategoryPicker } from "@/components/CategoryPicker";
import type { Category } from "@/lib/categories";

export type EventDraftMode = "event" | "focus";

/** The dialog's controlled state: one shape serves new and edited items. */
export interface EventDraft {
  mode: EventDraftMode;
  /** Set when editing an event saved in Time Weaver. */
  cacheId?: number;
  title: string;
  /** ISO datetime, or a `YYYY-MM-DD` date for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
  categoryId: number | null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO instant → the `datetime-local` value the browser's own timezone expects. */
function toDateTimeValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `YYYY-MM-DD` or an ISO instant → the date-only input value, in local time. */
function toDateValue(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A `datetime-local` value → UTC ISO. */
function fromDateTimeValue(value: string): string {
  return new Date(value).toISOString();
}

/** The day after a `YYYY-MM-DD`, for an all-day end (which is exclusive). */
function nextDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The dialog behind "drag empty space": create or edit a local event, or switch
 * the same slot to a focus block. Focus blocks still have their own path, so a
 * calendar with no connected mailbox can still be planned.
 */
export function EventDialog({
  draft,
  categories,
  hasAccount,
  saving = false,
  onManageCategories,
  onChange,
  onClose,
  onSwitchMode,
  onSave,
}: {
  draft: EventDraft | null;
  categories: Category[];
  /** Without a mailbox an event cannot be saved; a focus block still can. */
  hasAccount: boolean;
  saving?: boolean;
  onManageCategories?: () => void;
  onChange: (patch: Partial<EventDraft>) => void;
  onClose: () => void;
  onSwitchMode: () => void;
  onSave: () => void;
}) {
  const open = draft !== null;
  const mode = draft?.mode ?? "event";
  const editing = draft?.cacheId !== undefined;
  const eventBlocked = mode === "event" && !hasAccount;
  const canSave = draft !== null && !saving && !eventBlocked && draft.title.trim() !== "" && draft.start !== "" && draft.end !== "";

  const title = editing ? "Edit event" : mode === "event" ? "New event" : "New focus block";

  const setAllDay = (allDay: boolean) => {
    if (!draft) return;
    if (allDay) {
      const start = toDateValue(draft.start);
      onChange({ allDay, start, end: toDateValue(draft.end) === start ? nextDate(start) : toDateValue(draft.end) });
    } else {
      const start = toDateValue(draft.start);
      const end = toDateValue(draft.end);
      onChange({
        allDay,
        start: fromDateTimeValue(`${start}T09:00`),
        end: fromDateTimeValue(`${end}T10:00`),
      });
    }
  };

  const setStart = (start: string) => {
    if (!draft) return;
    if (draft.allDay) {
      // Keep the end after the start by moving it along when needed.
      const end = toDateValue(draft.end) <= start ? nextDate(start) : draft.end;
      onChange({ start, end });
    } else {
      onChange({ start });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="border-line bg-panel text-ink">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-mut">
            {mode === "event"
              ? "Saved in Time Weaver only — Google is never written to."
              : "Reserve a stretch of time for focused work."}
          </DialogDescription>
        </DialogHeader>

        {draft && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-dialog-title">Title</Label>
              <Input
                id="event-dialog-title"
                autoFocus
                value={draft.title}
                maxLength={512}
                placeholder={mode === "event" ? "Dentist appointment" : "Focus block"}
                onChange={(event) => onChange({ title: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canSave) {
                    event.preventDefault();
                    onSave();
                  }
                }}
                className="border-line bg-void text-ink"
              />
            </div>

            {mode === "event" && (
              <label className="flex items-center gap-2 text-xs text-mut">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                />
                All day
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-dialog-start">{draft.allDay ? "Start date" : "Starts"}</Label>
                <Input
                  id="event-dialog-start"
                  type={draft.allDay ? "date" : "datetime-local"}
                  value={draft.allDay ? toDateValue(draft.start) : toDateTimeValue(draft.start)}
                  onChange={(event) => setStart(draft.allDay ? event.target.value : fromDateTimeValue(event.target.value))}
                  className="border-line bg-void text-ink"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-dialog-end">{draft.allDay ? "End date (exclusive)" : "Ends"}</Label>
                <Input
                  id="event-dialog-end"
                  type={draft.allDay ? "date" : "datetime-local"}
                  value={draft.allDay ? toDateValue(draft.end) : toDateTimeValue(draft.end)}
                  onChange={(event) =>
                    onChange({ end: draft.allDay ? event.target.value : fromDateTimeValue(event.target.value) })
                  }
                  className="border-line bg-void text-ink"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <Label>Category</Label>
                <div>
                  <CategoryPicker
                    categories={categories}
                    value={draft.categoryId}
                    onChange={(categoryId) => onChange({ categoryId })}
                    onManage={onManageCategories}
                    title="No category"
                  />
                </div>
              </div>
            </div>

            {eventBlocked && (
              <p className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-300">
                Connect a Google account to save events here. You can still create a focus block without one.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {!editing && (
            <Button type="button" variant="ghost" size="sm" className="mr-auto text-mut" onClick={onSwitchMode}>
              {mode === "event" ? "Create a focus block instead" : "Create an event instead"}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={!canSave}>
            {saving ? "Saving…" : editing ? "Save changes" : mode === "event" ? "Create event" : "Create block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
