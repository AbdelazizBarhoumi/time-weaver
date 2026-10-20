import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileDown, Image as ImageIcon, Loader2, Printer, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrompt } from "@/components/ConfirmDialog";
import { ReportSetupPanel } from "@/components/reports/ReportSetupPanel";
import { ReportContentPanel } from "@/components/reports/ReportContentPanel";
import { ReportBrandPanel, type SaveBrandingInput } from "@/components/reports/ReportBrandPanel";
import { ReportSavedPanel } from "@/components/reports/ReportSavedPanel";
import { ReportPreview } from "@/components/reports/ReportPreview";
import {
  applyWorkOnlyConstraints,
  createDefaultReportConfig,
  formatReportDate,
  useCreateReportPreset,
  useDebouncedValue,
  useGenerateReport,
  useReportPreview,
  useReportSettings,
  useReportSourceData,
  useSaveReportSettings,
  validateReportRange,
  type ReportConfig,
  type ReportPreset,
} from "@/lib/reports";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Report studio - ShiftGrid" },
      { name: "description", content: "Build a branded work report from your tracked sessions and calendar events." },
      { property: "og:title", content: "Report studio - ShiftGrid" },
      { property: "og:description", content: "Build a branded work report from your tracked sessions and calendar events." },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

type BuilderTab = "setup" | "content" | "brand" | "saved";

const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;


function errorMessage(error: unknown): string {
  const candidate = error as {
    response?: { data?: { message?: string; errors?: Record<string, string[]> } };
    message?: string;
  };
  const firstValidationError = candidate.response?.data?.errors
    ? Object.values(candidate.response.data.errors)[0]?.[0]
    : undefined;
  return firstValidationError ?? candidate.response?.data?.message ?? candidate.message ?? "Something went wrong.";
}

function ReportsPage() {
  const prompt = usePrompt();
  const [config, setConfig] = useState<ReportConfig>(() => createDefaultReportConfig());
  const [tab, setTab] = useState<BuilderTab>("setup");
  const [activePresetId, setActivePresetId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<"png" | "jpeg" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const brandingApplied = useRef(false);

  const settings = useReportSettings();
  const saveSettings = useSaveReportSettings();
  const createPreset = useCreateReportPreset();
  const generate = useGenerateReport();

  const rangeError = validateReportRange(config.from, config.to);
  const accentError = ACCENT_PATTERN.test(config.accentColor) ? null : "Accent color must be a six-digit hex value, like #0f766e.";
  const sectionsError = config.sections.length === 0 ? "Choose at least one report section." : null;
  const ready = !rangeError && !accentError && !sectionsError;

  const debouncedConfig = useDebouncedValue(config, 420);
  const preview = useReportPreview(debouncedConfig, ready);
  const sourceData = useReportSourceData(config.from, config.to, config.timezone, !rangeError);

  // Apply the saved account branding once, without stomping on anything the
  // user has already edited in the builder.
  useEffect(() => {
    if (!settings.data || brandingApplied.current) return;
    brandingApplied.current = true;
    setConfig((current) => ({
      ...current,
      company: current.company || settings.data.companyName || "",
      preparedBy: current.preparedBy || settings.data.preparedBy || "",
      footerText: current.footerText || settings.data.footerText || current.footerText,
      accentColor: current.accentColor === "#0f766e" ? settings.data.accentColor : current.accentColor,
    }));
  }, [settings.data]);

  // Drop event selections that left the current date range, so a stale pick
  // never silently disappears from the calendar section.
  useEffect(() => {
    if (!sourceData.data) return;
    const available = new Set(sourceData.data.events.map((event) => event.id));
    setConfig((current) => {
      const next = current.filters.calendar.eventIds.filter((id) => available.has(id));
      if (next.length === current.filters.calendar.eventIds.length) return current;
      return {
        ...current,
        filters: {
          ...current.filters,
          calendar: { ...current.filters.calendar, eventIds: next },
        },
      };
    });
  }, [sourceData.data]);

  const previewHtml = preview.data?.html ?? null;
  const warnings = preview.data?.warnings ?? [];
  const paperLabel = preview.data?.meta.paperLabel ?? `${config.paper.toUpperCase()} · ${config.orientation}`;

  const periodCaption = useMemo(
    () => `${formatReportDate(config.from)} → ${formatReportDate(config.to)}`,
    [config.from, config.to],
  );

  function fileName(extension: string): string {
    const slug = config.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "time-work-report";
    return `${slug}-${config.from}-to-${config.to}.${extension}`;
  }

async function exportImage(format: "png" | "jpeg") {
  const frame = iframeRef.current;
  const reportElement = frame?.contentDocument?.querySelector(".report") as HTMLElement | null;

  if (!reportElement) {
    toast.error("The preview is still rendering. Try again in a moment.");
    return;
  }

  setExporting(format);
  reportElement.classList.add("is-exporting");

  try {
    await frame?.contentDocument?.fonts?.ready;
    const { toJpeg, toPng } = await import("html-to-image");

    // Padding is part of the element now, so no manual margin maths.
    const width = Math.ceil(reportElement.offsetWidth);
    const height = Math.ceil(reportElement.scrollHeight);

    if (height > 30000) {
      toast.error("This report is too tall for one image. Save it as a PDF or hide a few sections.");
      return;
    }

    const options = {
      cacheBust: true,
      pixelRatio: height > 7000 ? 1 : 2,
      backgroundColor: "#ffffff",
      width,
      height,
    };

    const dataUrl =
      format === "png"
        ? await toPng(reportElement, options)
        : await toJpeg(reportElement, { ...options, quality: 0.95 });

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName(format === "png" ? "png" : "jpg");
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success(`Report exported as ${format.toUpperCase()}.`);
  } catch (error) {
    toast.error(errorMessage(error));
  } finally {
    reportElement.classList.remove("is-exporting");
    setExporting(null);
  }
}

  async function generatePdf() {
    if (!ready) {
      toast.error(rangeError ?? accentError ?? sectionsError ?? "Finish the report setup first.");
      return;
    }

    setGenerating(true);
    try {
      const result = await generate.mutateAsync({ config, presetId: activePresetId });
      toast.success("PDF generated and saved to your report history.");
      const link = document.createElement("a");
      link.href = result.downloadUrl;
      link.download = result.report.fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveBranding(input: SaveBrandingInput) {
    try {
      const saved = await saveSettings.mutateAsync(input);
      setConfig((current) => ({
        ...current,
        company: saved.companyName ?? input.companyName,
        preparedBy: saved.preparedBy ?? input.preparedBy,
        footerText: saved.footerText ?? input.footerText,
        accentColor: saved.accentColor || input.accentColor,
      }));
      toast.success("Branding saved to your account.");
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  async function handleSavePreset() {
    const name = await prompt({
      title: "Save report preset",
      description: "Presets keep the sections, filters, and branding you chose. Dates are always taken from the builder when you load it.",
      label: "Preset name",
      placeholder: "e.g. Monthly client review",
      required: true,
      confirmLabel: "Save preset",
    });
    if (!name || name.trim() === "") return;

    setSavingPreset(true);
    try {
      const preset = await createPreset.mutateAsync({
        name: name.trim(),
        config: { ...config },
        isDefault: false,
      });
      setActivePresetId(preset.id);
      toast.success(`Preset “${preset.name}” saved.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSavingPreset(false);
    }
  }

  function handleLoadPreset(preset: ReportPreset) {
    const presetConfig = preset.config;
    setConfig((current) =>
      applyWorkOnlyConstraints({
        ...current,
        ...presetConfig,
        from: current.from,
        to: current.to,
        timezone: current.timezone,
        filters: {
          ...current.filters,
          ...(presetConfig.filters ?? {}),
          calendar: {
            ...current.filters.calendar,
            ...(presetConfig.filters?.calendar ?? {}),
          },
        },
      }),
    );
    setActivePresetId(preset.id);
    toast.success(`Loaded preset “${preset.name}”.`);
  }

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-void/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center gap-3 px-3 py-3 sm:px-5">
          <Link to="/" className="font-mono text-xs text-mut transition-colors hover:text-neon">
            ← ShiftGrid
          </Link>
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-neon" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">Report studio</h1>
              <p className="hidden font-mono text-[10px] text-mut sm:block">{periodCaption}</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportImage("png")}
              disabled={!previewHtml || preview.isFetching || exporting !== null}
              title="Download the report as a PNG image"
            >
              {exporting === "png" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportImage("jpeg")}
              disabled={!previewHtml || preview.isFetching || exporting !== null}
              title="Download the report as a JPEG image"
            >
              {exporting === "jpeg" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
              JPEG
            </Button>
            <Button size="sm" onClick={() => void generatePdf()} disabled={generating || !ready}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              Save PDF
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1700px] gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-[69px] lg:max-h-[calc(100vh-85px)] lg:overflow-y-auto lg:pb-6 lg:pr-1">
          <Tabs value={tab} onValueChange={(value) => setTab(value as BuilderTab)}>
            <TabsList className="grid h-10 w-full grid-cols-4 bg-panel p-1 ring-1 ring-line">
              <TabsTrigger value="setup" className="font-mono text-[10px] uppercase data-[state=active]:bg-void data-[state=active]:text-neon">
                Setup
              </TabsTrigger>
              <TabsTrigger value="content" className="font-mono text-[10px] uppercase data-[state=active]:bg-void data-[state=active]:text-neon">
                Content
              </TabsTrigger>
              <TabsTrigger value="brand" className="font-mono text-[10px] uppercase data-[state=active]:bg-void data-[state=active]:text-neon">
                Brand
              </TabsTrigger>
              <TabsTrigger value="saved" className="font-mono text-[10px] uppercase data-[state=active]:bg-void data-[state=active]:text-neon">
                Saved
              </TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="mt-3">
              <ReportSetupPanel config={config} setConfig={setConfig} rangeError={rangeError} />
            </TabsContent>

            <TabsContent value="content" className="mt-3">
              <ReportContentPanel
                config={config}
                setConfig={setConfig}
                sourceData={sourceData.data}
                sourceLoading={sourceData.isFetching}
                sourceError={sourceData.isError ? errorMessage(sourceData.error) : null}
              />
            </TabsContent>

            <TabsContent value="brand" className="mt-3">
              <ReportBrandPanel
                config={config}
                setConfig={setConfig}
                settings={settings.data}
                onSave={handleSaveBranding}
                saving={saveSettings.isPending}
              />
              {accentError && (
                <p className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
                  {accentError}
                </p>
              )}
            </TabsContent>

            <TabsContent value="saved" className="mt-3">
              <ReportSavedPanel
                activePresetId={activePresetId}
                onLoadPreset={handleLoadPreset}
                onSavePreset={handleSavePreset}
                savingPreset={savingPreset}
              />
            </TabsContent>
          </Tabs>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-wide text-mut">Previewing</p>
              <h2 className="truncate text-base font-semibold">{config.title || "Untitled report"}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-mut">
              <span className={cn("rounded-full px-2 py-1 ring-1", ready ? "bg-neon/10 text-neon ring-neon/30" : "bg-amber-400/10 text-amber-300 ring-amber-400/30")}>
                {ready ? "ready" : "needs attention"}
              </span>
              <span className="rounded-full bg-panel px-2 py-1 ring-1 ring-line">{periodCaption}</span>
              {preview.data && (
                <span className="rounded-full bg-panel px-2 py-1 ring-1 ring-line">
                  {preview.data.counts.sessions} sessions · {preview.data.counts.events} events · {preview.data.counts.days} days
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 font-mono text-[10px] text-mut"
                onClick={() => void preview.refetch()}
                disabled={preview.isFetching || !ready}
                title="Refresh preview"
              >
                <RefreshCw className={cn("h-3 w-3", preview.isFetching && "animate-spin")} />
                refresh
              </Button>
            </div>
          </div>

          {(rangeError || sectionsError) && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              <Wand2 className="h-3.5 w-3.5 shrink-0" />
              {rangeError ?? sectionsError}
            </div>
          )}

          <ReportPreview
            iframeRef={iframeRef}
            html={previewHtml}
            loading={preview.isFetching}
            error={preview.isError ? errorMessage(preview.error) : null}
            warnings={warnings}
            paperLabel={paperLabel}
          />
        </section>
      </main>
    </div>
  );
}
