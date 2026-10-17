import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCoachStatus, useDayCoach, type DayIntelligence, type InsightTone } from "@/lib/calendar";

const TONE_STYLES: Record<InsightTone, { dot: string; text: string; Icon: typeof Info }> = {
  good: { dot: "bg-neon", text: "text-neon", Icon: CheckCircle2 },
  info: { dot: "bg-l3", text: "text-ink", Icon: Info },
  warn: { dot: "bg-amber-400", text: "text-amber-400", Icon: AlertTriangle },
  critical: { dot: "bg-destructive", text: "text-destructive", Icon: XCircle },
};

const TONE_LABEL: Record<InsightTone, string> = {
  good: "All clear",
  info: "Heads up",
  warn: "Heads up",
  critical: "Watch out",
};

const MAX_VISIBLE = 5;

export function DayIntelligenceCard({ intel }: { intel: DayIntelligence }) {
  const [expanded, setExpanded] = useState(false);
  const [coachText, setCoachText] = useState<string | null>(null);
  const [coachError, setCoachError] = useState<string | null>(null);

  const coachStatus = useCoachStatus();
  const dayCoach = useDayCoach();

  const visible = expanded ? intel.insights : intel.insights.slice(0, MAX_VISIBLE);
  const hidden = intel.insights.length - visible.length;
  const headerStyle = TONE_STYLES[intel.tone] ?? TONE_STYLES.info;

  const runCoach = () => {
    setCoachError(null);
    dayCoach.mutate(intel.facts, {
      onSuccess: (res) => {
        if (res.text) setCoachText(res.text);
        else setCoachError(res.message ?? "The AI coach had nothing to say.");
      },
      onError: (err) => {
        const response = (err as { response?: { data?: { message?: string } } }).response;
        setCoachError(response?.data?.message ?? "The AI coach could not be reached.");
      },
    });
  };

  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", headerStyle.dot)} />
        <div className="font-mono text-[11px] uppercase tracking-widest text-mut">Day intelligence</div>
        <span className={cn("ml-auto font-mono text-[10px] uppercase tracking-wider", headerStyle.text)}>
          {TONE_LABEL[intel.tone]}
        </span>
      </div>

      {intel.insights.length === 0 ? (
        <p className="mt-3 text-xs text-mut">Nothing to flag. Your day looks balanced.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {visible.map((insight) => {
            const { Icon, text } = TONE_STYLES[insight.tone] ?? TONE_STYLES.info;
            return (
              <li key={insight.id} className="flex gap-2">
                <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", text)} />
                <div className="min-w-0">
                  <div className={cn("text-xs font-semibold", text)}>{insight.title}</div>
                  <div className="mt-0.5 text-xs text-mut">{insight.detail}</div>
                  {insight.hint && <div className="mt-0.5 text-[11px] text-l3">↳ {insight.hint}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 font-mono text-[11px] text-mut underline-offset-2 hover:text-ink hover:underline"
        >
          Show {hidden} more
        </button>
      )}
      {expanded && intel.insights.length > MAX_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-3 font-mono text-[11px] text-mut underline-offset-2 hover:text-ink hover:underline"
        >
          Show less
        </button>
      )}

      <div className="mt-4 border-t border-line pt-3">
        {coachText ? (
          <div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-neon">
              <Sparkles className="h-3 w-3" /> Coach
            </div>
            <div className="mt-2 whitespace-pre-line text-xs text-ink">{coachText}</div>
            <button
              type="button"
              onClick={runCoach}
              disabled={dayCoach.isPending}
              className="mt-2 font-mono text-[11px] text-mut underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={runCoach}
            disabled={dayCoach.isPending || coachStatus.data?.available === false}
            title={
              coachStatus.data?.available === false
                ? "Add a GEMINI_API_KEY to enable AI coaching"
                : "Ask Gemini for a short read-out of your day"
            }
            className="flex w-full items-center justify-center gap-2 rounded-md bg-neon/10 px-3 py-2 font-mono text-xs text-neon ring-1 ring-neon/40 hover:bg-neon/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {dayCoach.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Coaching…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" /> Coach my day
              </>
            )}
          </button>
        )}

        {coachError && <div className="mt-2 text-[11px] text-amber-400">{coachError}</div>}
        {coachStatus.data?.available === false && !coachText && (
          <div className="mt-2 text-[11px] text-mut">Add a GEMINI_API_KEY to enable AI coaching.</div>
        )}
      </div>
    </div>
  );
}
