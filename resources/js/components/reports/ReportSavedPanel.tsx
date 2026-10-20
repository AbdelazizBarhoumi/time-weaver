import { Bookmark, Clock3, Download, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  formatFileSize,
  useDeleteReport,
  useDeleteReportPreset,
  useReportHistory,
  useReportPresets,
  useUpdateReportPreset,
  type ReportPreset,
} from "@/lib/reports";
import { cn } from "@/lib/utils";
import { Group } from "./report-ui";

export function ReportSavedPanel({
  activePresetId,
  onLoadPreset,
  onSavePreset,
  savingPreset,
}: {
  activePresetId: number | null;
  onLoadPreset: (preset: ReportPreset) => void;
  onSavePreset: () => Promise<void>;
  savingPreset: boolean;
}) {
  const confirm = useConfirm();
  const presets = useReportPresets();
  const history = useReportHistory();
  const updatePreset = useUpdateReportPreset();
  const deletePreset = useDeleteReportPreset();
  const deleteReport = useDeleteReport();

  async function removePreset(preset: ReportPreset) {
    if (!(await confirm({ title: `Delete “${preset.name}”?`, description: "This only removes the saved preset, not any generated reports.", destructive: true, confirmLabel: "Delete preset" }))) return;
    try {
      await deletePreset.mutateAsync(preset.id);
      toast.success("Preset deleted.");
    } catch {
      toast.error("Could not delete that preset.");
    }
  }

  async function makeDefault(preset: ReportPreset) {
    try {
      await updatePreset.mutateAsync({ id: preset.id, input: { isDefault: true } });
      toast.success(`“${preset.name}” is now the default preset.`);
    } catch {
      toast.error("Could not update the default preset.");
    }
  }

  async function removeReport(id: number) {
    if (!(await confirm({ title: "Delete this report?", description: "The saved PDF will be removed from your history.", destructive: true, confirmLabel: "Delete report" }))) return;
    try {
      await deleteReport.mutateAsync(id);
      toast.success("Report removed from history.");
    } catch {
      toast.error("Could not delete that report.");
    }
  }

  return (
    <div className="space-y-3.5">
      <Group title="Report presets" description="Reusable setups for sections, filters, and branding" open>
        <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => void onSavePreset()} disabled={savingPreset}>
          <Plus className="h-3.5 w-3.5" />
          {savingPreset ? "Saving preset…" : "Save current setup as preset"}
        </Button>

        {presets.isLoading && <p className="text-[11px] text-mut">Loading presets…</p>}
        {presets.isError && <p className="text-[11px] text-red-300">Could not load presets.</p>}
        {presets.data?.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-mut">
            No presets yet. Build a report you like and save it here.
          </div>
        )}

        <div className="space-y-1.5">
          {presets.data?.map((preset) => (
            <div
              key={preset.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                activePresetId === preset.id ? "border-neon/30 bg-neon/5" : "border-line bg-void/30",
              )}
            >
              <Bookmark className={cn("h-3.5 w-3.5 shrink-0", activePresetId === preset.id ? "text-neon" : "text-mut")} />
              <button type="button" onClick={() => onLoadPreset(preset)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs text-ink">{preset.name}</span>
                <span className="block text-[10px] text-mut">
                  {preset.isDefault ? "Default · " : ""}
                  {preset.config.sections?.length ?? 0} sections
                </span>
              </button>
              <button
                type="button"
                onClick={() => void makeDefault(preset)}
                title={preset.isDefault ? "Default preset" : "Make default"}
                className={cn("rounded p-1 hover:bg-panel", preset.isDefault ? "text-amber-300" : "text-mut hover:text-ink")}
              >
                <Star className="h-3.5 w-3.5" fill={preset.isDefault ? "currentColor" : "none"} />
              </button>
              <button
                type="button"
                onClick={() => void removePreset(preset)}
                title="Delete preset"
                className="rounded p-1 text-mut hover:bg-panel hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Group>

      <Group title="Report history" description="Generated PDFs saved to your account" open>
        {history.isLoading && <p className="text-[11px] text-mut">Loading history…</p>}
        {history.isError && <p className="text-[11px] text-red-300">Could not load report history.</p>}
        {history.data?.reports.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-mut">
            No saved reports yet. Use “Save PDF” to add one.
          </div>
        )}

        <div className="space-y-1.5">
          {history.data?.reports.map((report) => (
            <div key={report.id} className="rounded-lg border border-line bg-void/30 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mut" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{report.title}</p>
                  <p className="mt-0.5 text-[10px] text-mut">
                    {report.periodLabel} · {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : "—"}
                  </p>
                  <p className="text-[10px] text-mut">{formatFileSize(report.fileSize)}</p>
                </div>
                <a
                  href={report.downloadUrl}
                  className="rounded p-1 text-mut hover:bg-panel hover:text-neon"
                  title="Download PDF"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => void removeReport(report.id)}
                  className="rounded p-1 text-mut hover:bg-panel hover:text-red-300"
                  title="Delete report"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Group>
    </div>
  );
}
