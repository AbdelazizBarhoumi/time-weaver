import { Ban, Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { categoryIcon, type Category } from "@/lib/categories";

/**
 * A picker for one category. It opens a popover listing the user's categories
 * with their themes, plus a "no category" choice. Used by the todo card, the
 * focus-block actions and the event dialog.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  onManage,
  compact = false,
  align = "start",
  className,
  disabled = false,
  title = "Category",
}: {
  categories: Category[];
  value: number | null;
  onChange: (categoryId: number | null) => void;
  /** Optional "Manage categories" action at the bottom of the list. */
  onManage?: (() => void) | undefined;
  /** Show only the category icon instead of icon + name. */
  compact?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const selected = value === null ? null : categories.find((category) => category.id === value) ?? null;
  const SelectedIcon = categoryIcon(selected?.icon);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={selected ? `Category: ${selected.name}` : title}
          aria-label={selected ? `Category: ${selected.name}` : title}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1.5 rounded border border-line bg-void/60 px-1.5 py-1 text-left text-[10px] text-mut transition hover:text-ink disabled:opacity-50",
            selected && "text-ink",
            className,
          )}
        >
          {selected ? (
            <>
              <SelectedIcon className="h-3 w-3 shrink-0" style={{ color: selected.color }} />
              {!compact && <span className="truncate">{selected.name}</span>}
            </>
          ) : (
            <>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-line"
                aria-hidden
              />
              {!compact && <span className="truncate">{title}</span>}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-56 border-line bg-popover p-1"
        // The picker often lives inside a draggable block or a menu row; keep
        // its own clicks from reaching the parent's handlers.
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-accent",
            value === null && "bg-accent/60",
          )}
        >
          <Ban className="h-3.5 w-3.5 text-mut" />
          <span className="flex-1">No category</span>
          {value === null && <Check className="h-3.5 w-3.5" />}
        </button>

        {categories.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-mut">
            No categories yet. Create one to give items a color, icon and style.
          </p>
        )}

        {categories.map((category) => {
          const Icon = categoryIcon(category.icon);
          const active = category.id === value;
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onChange(category.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-accent",
                active && "bg-accent/60",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: category.color }} />
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: category.color }}
                aria-hidden
              />
              <span className="flex-1 truncate">{category.name}</span>
              {active && <Check className="h-3.5 w-3.5" />}
            </button>
          );
        })}

        {onManage && (
          <>
            <div className="my-1 h-px bg-line" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start px-2 text-[11px] text-mut hover:text-ink"
              onClick={onManage}
            >
              <Settings2 className="mr-1 h-3.5 w-3.5" />
              Manage categories
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
