import { useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CATEGORY_STYLES,
  categoryIcon,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type Category,
  type CategoryStyle,
} from "@/lib/categories";

const DEFAULT_COLOR = CATEGORY_COLORS[0]!.value;
const DEFAULT_ICON = "Star";
const DEFAULT_STYLE: CategoryStyle = "solid";

interface FormState {
  name: string;
  color: string;
  icon: string;
  style: CategoryStyle;
}

function blankForm(): FormState {
  return { name: "", color: DEFAULT_COLOR, icon: DEFAULT_ICON, style: DEFAULT_STYLE };
}

/**
 * Create, edit and delete the user's categories. A category is always a whole
 * theme — name, color, icon and accent style — so items never differ by color
 * alone.
 */
export function CategoriesDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
}) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const confirm = useConfirm();

  const busy = create.isPending || update.isPending || remove.isPending;

  const reset = () => {
    setForm(blankForm());
    setEditingId(null);
  };

  const beginEdit = (category: Category) => {
    setEditingId(category.id);
    setForm({
      name: category.name,
      color: category.color,
      icon: category.icon,
      style: category.style,
    });
  };

  const save = () => {
    const name = form.name.trim();
    if (name === "") {
      toast.error("Give the category a name.");
      return;
    }

    const input = { name, color: form.color, icon: form.icon, style: form.style };

    if (editingId === null) {
      create.mutate(input, {
        onSuccess: () => {
          toast.success(`Created "${name}"`);
          reset();
        },
        onError: () => toast.error("Could not create that category."),
      });
    } else {
      update.mutate(
        { id: editingId, input },
        {
          onSuccess: () => {
            toast.success(`Updated "${name}"`);
            reset();
          },
          onError: () => toast.error("Could not update that category."),
        },
      );
    }
  };

  const destroy = async (category: Category) => {
    const confirmed = await confirm({
      title: "Delete this category?",
      description: `Delete "${category.name}". Tasks, events and focus blocks that use it keep their place but lose the category.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

    remove.mutate(category.id, {
      onSuccess: () => {
        if (editingId === category.id) reset();
        toast.success("Category deleted");
      },
      onError: () => toast.error("Could not delete that category."),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto border-line bg-panel text-ink">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription className="text-mut">
            Give tasks, events and focus blocks a color, an icon and an accent style.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            value={form.name}
            placeholder="Deep work"
            maxLength={60}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
            className="border-line bg-void text-ink"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                title={color.name}
                aria-label={color.name}
                aria-pressed={form.color === color.value}
                onClick={() => setForm((current) => ({ ...current, color: color.value }))}
                className={cn(
                  "h-6 w-6 rounded-full ring-1 ring-inset ring-black/30 transition hover:scale-110",
                  form.color === color.value && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
                )}
                style={{ background: color.value }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Icon</Label>
          <div className="grid grid-cols-8 gap-1">
            {CATEGORY_ICONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={form.icon === key}
                onClick={() => setForm((current) => ({ ...current, icon: key }))}
                className={cn(
                  "flex h-8 items-center justify-center rounded border border-line text-mut transition hover:text-ink",
                  form.icon === key && "border-neon bg-neon/10 text-neon",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Accent style</Label>
          <div className="grid grid-cols-3 gap-1">
            {CATEGORY_STYLES.map((style) => (
              <button
                key={style.value}
                type="button"
                title={style.hint}
                aria-pressed={form.style === style.value}
                onClick={() => setForm((current) => ({ ...current, style: style.value }))}
                className={cn(
                  "rounded border border-line px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-mut transition hover:text-ink",
                  form.style === style.value && "border-neon text-neon",
                )}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={busy || form.name.trim() === ""}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            {editingId === null ? "Add category" : "Save changes"}
          </Button>
          {editingId !== null && (
            <Button type="button" variant="ghost" size="sm" className="text-mut" onClick={reset} disabled={busy}>
              <X className="mr-1 h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>

        <div className="border-t border-line pt-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-mut">
            Your categories {categories.length > 0 && `(${categories.length})`}
          </div>
          {categories.length === 0 ? (
            <p className="text-xs text-mut">
              None yet. Add one above, then pick it on a task, event or focus block.
            </p>
          ) : (
            <ul className="space-y-1">
              {categories.map((category) => {
                const Icon = categoryIcon(category.icon);
                return (
                  <li
                    key={category.id}
                    className={cn(
                      "flex items-center gap-2 rounded border border-line bg-void/40 px-2 py-1.5",
                      editingId === category.id && "border-neon/60",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: category.color }} />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: category.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-mut">{category.style}</span>
                    {typeof category.usageCount === "number" && category.usageCount > 0 && (
                      <span className="font-mono text-[10px] text-mut">{category.usageCount}</span>
                    )}
                    <button
                      type="button"
                      title="Edit category"
                      onClick={() => beginEdit(category)}
                      className="shrink-0 text-mut transition hover:text-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete category"
                      onClick={() => destroy(category)}
                      className="shrink-0 text-mut transition hover:text-destructive"
                    >
                      {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                    {editingId === category.id && <Check className="h-3.5 w-3.5 shrink-0 text-neon" />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
