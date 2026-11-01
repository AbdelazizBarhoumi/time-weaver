import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Briefcase,
  Code,
  Coffee,
  Dumbbell,
  Heart,
  Home,
  Music,
  Palette,
  Phone,
  Plane,
  ShoppingCart,
  Star,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";

/** How a category paints its accent; never color alone. */
export type CategoryStyle = "solid" | "outline" | "stripe";

export interface Category {
  id: number;
  name: string;
  /** Hex accent, e.g. "#5b9cff". */
  color: string;
  icon: string;
  style: CategoryStyle;
  /** How many tasks, focus blocks and events currently use it. */
  usageCount?: number;
}

export interface CategoryInput {
  name: string;
  color: string;
  icon: string;
  style: CategoryStyle;
}

/**
 * Icons the API accepts. The keys are stored in the database, so they must stay
 * stable even if the component behind one changes.
 */
export const CATEGORY_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "Briefcase", label: "Work", Icon: Briefcase },
  { key: "BookOpen", label: "Study", Icon: BookOpen },
  { key: "Home", label: "Home", Icon: Home },
  { key: "Cart", label: "Errands", Icon: ShoppingCart },
  { key: "Dumbbell", label: "Fitness", Icon: Dumbbell },
  { key: "Heart", label: "Health", Icon: Heart },
  { key: "Music", label: "Music", Icon: Music },
  { key: "Plane", label: "Travel", Icon: Plane },
  { key: "Code", label: "Code", Icon: Code },
  { key: "Phone", label: "Calls", Icon: Phone },
  { key: "Coffee", label: "Break", Icon: Coffee },
  { key: "Users", label: "People", Icon: Users },
  { key: "Wallet", label: "Money", Icon: Wallet },
  { key: "Wrench", label: "Admin", Icon: Wrench },
  { key: "Palette", label: "Creative", Icon: Palette },
  { key: "Star", label: "Star", Icon: Star },
];

/** The registered icon for a stored key, falling back to a star. */
export function categoryIcon(key: string | null | undefined): LucideIcon {
  return CATEGORY_ICONS.find((entry) => entry.key === key)?.Icon ?? Star;
}

export const CATEGORY_COLORS = [
  { name: "Blue", value: "#5b9cff" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Pink", value: "#f472b6" },
  { name: "Red", value: "#f87171" },
  { name: "Amber", value: "#fcd34d" },
  { name: "Green", value: "#34d399" },
  { name: "Teal", value: "#22d3ee" },
  { name: "Slate", value: "#94a3b8" },
] as const;

export const CATEGORY_STYLES: { value: CategoryStyle; label: string; hint: string }[] = [
  { value: "solid", label: "Solid", hint: "Filled with a light wash of the accent" },
  { value: "outline", label: "Outline", hint: "Transparent with a colored edge" },
  { value: "stripe", label: "Stripe", hint: "Diagonal accents across the block" },
];

export interface CategoryTheme {
  accent: string;
  background: string;
  borderLeft: string;
  boxShadow?: string;
}

/**
 * The inline styles for an item wearing a category theme. A null category (or
 * a plain color override) renders as a solid accent in the fallback color.
 */
export function categoryTheme(category: Category | null | undefined, fallback: string): CategoryTheme {
  const accent = category?.color ?? fallback;
  const style = category?.style ?? "solid";

  if (style === "outline") {
    return {
      accent,
      background: "transparent",
      borderLeft: `3px solid ${accent}`,
      boxShadow: `inset 0 0 0 1px ${accent}`,
    };
  }

  if (style === "stripe") {
    return {
      accent,
      background: `repeating-linear-gradient(135deg, ${accent}2e 0 6px, transparent 6px 12px)`,
      borderLeft: `3px solid ${accent}`,
    };
  }

  return {
    accent,
    background: `${accent}2e`,
    borderLeft: `3px solid ${accent}`,
  };
}

export const categoryApi = {
  list: () => api.get<Category[]>("/categories").then((r) => r.data),
  create: (input: CategoryInput) => api.post<Category>("/categories", input).then((r) => r.data),
  update: (id: number, input: Partial<CategoryInput>) =>
    api.put<Category>(`/categories/${id}`, input).then((r) => r.data),
  delete: (id: number) => api.delete(`/categories/${id}`),
};

export function useCategories() {
  return useQuery({ queryKey: ["calendar", "categories"], queryFn: categoryApi.list });
}

function useCategoryMutation<TArg, TResult>(fn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

export const useCreateCategory = () => useCategoryMutation((input: CategoryInput) => categoryApi.create(input));
export const useUpdateCategory = () =>
  useCategoryMutation((args: { id: number; input: Partial<CategoryInput> }) =>
    categoryApi.update(args.id, args.input),
  );
export const useDeleteCategory = () => useCategoryMutation((id: number) => categoryApi.delete(id));
