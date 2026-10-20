import { useEffect, useRef, useState } from "react";
import { ImagePlus, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReportConfig, ReportSettings } from "@/lib/reports";
import { Field, Group, type SetReportConfig } from "./report-ui";

export interface SaveBrandingInput {
  companyName: string;
  preparedBy: string;
  footerText: string;
  accentColor: string;
  logo?: File | null;
  removeLogo?: boolean;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    image.src = url;
  });
}

async function pngToJpeg(file: File, image: HTMLImageElement): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is unavailable");
  }

  // Flatten transparency onto white so the logo prints correctly in the PDF.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  const blob = await canvasToJpeg(canvas);
  const name = file.name.replace(/\.png$/i, "") || "logo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.92, 0.86, 0.8, 0.72]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

    if (blob && blob.size <= 2 * 1024 * 1024) {
      return blob;
    }
  }

  throw new Error("Could not compress image below 2 MB");
}

export function ReportBrandPanel({
  config,
  setConfig,
  settings,
  onSave,
  saving,
}: {
  config: ReportConfig;
  setConfig: SetReportConfig;
  settings: ReportSettings | undefined;
  onSave: (input: SaveBrandingInput) => Promise<void>;
  saving: boolean;
}) {
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  function pickLogo(file: File | null) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Use a PNG or JPEG logo.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logos must be 2 MB or smaller.");
      return;
    }

    void prepareLogo(file);
  }

  async function prepareLogo(file: File) {
    try {
      const image = await loadImage(file);

      if (image.naturalWidth > 2000 || image.naturalHeight > 2000) {
        toast.error("Logos must be at most 2000 × 2000 pixels.");
        return;
      }

      // Dompdf needs GD to embed PNGs, which is not available on every host.
      // Converting in the browser keeps transparent PNG uploads working as PDFs.
      const normalized = file.type === "image/png" ? await pngToJpeg(file, image) : file;
      setLogoFile(normalized);
      setRemoveLogo(false);
    } catch {
      toast.error("That image could not be read. Try another PNG or JPEG.");
    }
  }

  const shownLogo = logoPreview ?? (removeLogo ? null : settings?.logoDataUri ?? null);

  async function save() {
    try {
      await onSave({
        companyName: config.company,
        preparedBy: config.preparedBy,
        footerText: config.footerText,
        accentColor: config.accentColor,
        logo: logoFile,
        removeLogo,
      });
      setLogoFile(null);
      setRemoveLogo(false);
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      // The page surfaces the error toast; keep the chosen file so the user can retry.
    }
  }

  return (
    <div className="space-y-3.5">
      <Group title="Report identity" description="The title and subtitle printed on the cover" open>
        <Field label="Report title">
          <Input value={config.title} onChange={(event) => setConfig((current) => ({ ...current, title: event.target.value }))} maxLength={160} />
        </Field>
        <Field label="Subtitle" hint="Defaults to the reporting period when left empty.">
          <Input
            value={config.subtitle}
            onChange={(event) => setConfig((current) => ({ ...current, subtitle: event.target.value }))}
            placeholder="e.g. Monthly work and study review"
            maxLength={200}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Prepared by">
            <Input value={config.preparedBy} onChange={(event) => setConfig((current) => ({ ...current, preparedBy: event.target.value }))} maxLength={160} />
          </Field>
          <Field label="Prepared for">
            <Input
              value={config.preparedFor}
              onChange={(event) => setConfig((current) => ({ ...current, preparedFor: event.target.value }))}
              placeholder="Optional"
              maxLength={160}
            />
          </Field>
        </div>
        <Field label="Company / team" hint="Saved to your report branding and reused next time.">
          <Input value={config.company} onChange={(event) => setConfig((current) => ({ ...current, company: event.target.value }))} maxLength={160} />
        </Field>
      </Group>

      <Group title="Logo and accent" description="Brand the preview and every export" open>
        <div className="flex items-center gap-3">
          <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white/95">
            {shownLogo ? (
              <img src={shownLogo} alt="Report logo" className="max-h-14 max-w-20 object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-[9px] text-slate-400">
                <ImagePlus className="h-5 w-5" />
                no logo
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = "";
                pickLogo(file);
              }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              Choose logo
            </Button>
            <p className="text-[10px] leading-snug text-mut">PNG or JPEG, up to 2 MB and 2000×2000. PNG logos are flattened to JPEG for PDFs.</p>
          </div>
        </div>

        {(shownLogo || logoFile) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-mut hover:text-red-300"
            onClick={() => {
              setLogoFile(null);
              setRemoveLogo(true);
              if (fileInput.current) fileInput.current.value = "";
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove logo
          </Button>
        )}

        <Field label="Accent color" hint="Used for rules, bars, and the cover band.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.accentColor}
              onChange={(event) => setConfig((current) => ({ ...current, accentColor: event.target.value }))}
              className="h-9 w-12 cursor-pointer rounded border border-line bg-void p-1"
              aria-label="Accent color picker"
            />
            <Input
              value={config.accentColor}
              onChange={(event) => setConfig((current) => ({ ...current, accentColor: event.target.value }))}
              pattern="#[0-9a-fA-F]{6}"
              maxLength={7}
              className="font-mono uppercase"
            />
          </div>
        </Field>
      </Group>

      <Group title="Footer" description="Printed at the bottom of PDF pages and the document">
        <Field label="Footer text">
          <Textarea
            value={config.footerText}
            onChange={(event) => setConfig((current) => ({ ...current, footerText: event.target.value }))}
            rows={2}
            maxLength={500}
            className="resize-y"
          />
        </Field>
        <p className="text-[10px] leading-snug text-mut">
          Page numbers are added by the PDF renderer. The footer and logo are saved to your account; the rest of the
          report stays per export.
        </p>
      </Group>

      <Button type="button" className="w-full" onClick={() => void save()} disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? "Saving branding…" : "Save branding to account"}
      </Button>
    </div>
  );
}
