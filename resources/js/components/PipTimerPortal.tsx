import { DAILY_GOAL_HOURS, formatHMS, hoursForDay, dayKey, sessionDurationMs, workSessionsOnly, type WorkSession } from "@/lib/tracker";

interface PipTimerPortalProps {
  sessions: WorkSession[];
  now: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onClose: () => void;
}

/**
 * Everything is sized with container queries against the PiP window itself, so the
 * layout follows whatever size the user drags the window to:
 *  - normal / tall window  -> ring on top, stats + buttons underneath
 *  - wide window           -> ring on the left, stats + buttons on the right
 *  - short window          -> stats hidden, ring + buttons only
 *  - narrow window         -> brand text and button labels hidden
 *
 * The CSS lives in a plain <style> tag inside the portal because a PiP window does not
 * inherit styles from the main page (and `<style jsx>` only works in Next.js).
 */
const CSS = `
html,body{margin:0;background:var(--void,#0a0f1a)}

.sgp{position:fixed;inset:0;container:sgp/size;display:flex;flex-direction:column;overflow:hidden;
  background:var(--void,#0a0f1a);color:var(--ink,#e5e7eb);
  font-family:'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,monospace;
  -webkit-user-select:none;user-select:none}
.sgp *{box-sizing:border-box}
.sgp button{font-family:inherit}

/* header */
.sgp-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;
  background:var(--panel,#111827);border-bottom:1px solid var(--line,#1f2937)}
.sgp-brand{display:flex;align-items:center;gap:8px;min-width:0}
.sgp-logo{color:var(--neon,#00ff88);font-size:18px;line-height:1}
.sgp-brand-text{font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sgp-right{display:flex;align-items:center;gap:6px;flex:none}
.sgp-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:9999px;font-size:10px;font-weight:600;letter-spacing:.08em;color:var(--void,#0a0f1a)}
.sgp-chip i{width:6px;height:6px;border-radius:50%;background:currentColor}
.sgp-chip--running{background:var(--neon,#00ff88)}
.sgp-chip--running i{animation:sgp-pulse 1.5s ease-in-out infinite}
.sgp-chip--paused{background:#f59e0b}
.sgp-chip--idle{background:var(--mut,#6b7280)}
.sgp-close{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;
  color:var(--mut,#6b7280);cursor:pointer;transition:color .2s,background .2s}
.sgp-close:hover{color:var(--ink,#e5e7eb);background:var(--line,#1f2937)}

/* body */
.sgp-body{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;
  gap:clamp(8px,3cqh,18px);padding:clamp(10px,3.5cqmin,22px)}
.sgp-ringwrap{container:sgpw/size;flex:1 1 0;min-height:0;min-width:0;width:100%;display:grid;place-items:center}

/* clock: same look as the TimerCard (conic progress ring + panel disc) */
.sgp-ring{container:sgpr/inline-size;width:min(100cqw,100cqh,340px);aspect-ratio:1;border-radius:50%;
  display:grid;place-items:center}
.sgp-ring--live{animation:sgp-glow 2.4s ease-in-out infinite}
.sgp-disc{width:80%;aspect-ratio:1;border-radius:50%;background:var(--panel,#111827);display:grid;place-items:center}
.sgp-center{text-align:center}
.sgp-time{font-size:15cqw;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;white-space:nowrap;color:var(--ink,#e5e7eb)}
.sgp-sub{margin-top:1.5cqw;font-size:max(8px,5cqw);letter-spacing:.2em;text-transform:uppercase;color:var(--mut,#6b7280);white-space:nowrap}

/* stats + actions */
.sgp-side{flex:none;width:100%;max-width:420px;display:flex;flex-direction:column;gap:clamp(8px,2.5cqh,14px)}
.sgp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sgp-stat{min-width:0;padding:8px 10px;border-radius:8px;background:var(--panel,#111827);border:1px solid var(--line,#1f2937)}
.sgp-stat-label{display:block;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut,#6b7280)}
.sgp-stat-value{display:block;margin-top:2px;font-size:clamp(13px,4.4cqmin,18px);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.sgp-stat-value--neon{color:var(--neon,#00ff88)}

.sgp-actions{display:flex;gap:8px}
.sgp-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:clamp(38px,9cqh,50px);padding:0 14px;
  border-radius:8px;border:1px solid transparent;font-size:13px;font-weight:600;cursor:pointer;
  transition:filter .2s,background .2s,border-color .2s,transform .1s}
.sgp-btn:active:not(:disabled){transform:scale(.98)}
.sgp-btn:focus-visible,.sgp-close:focus-visible{outline:2px solid var(--neon,#00ff88);outline-offset:2px}
.sgp-btn--primary{background:var(--neon,#00ff88);color:var(--void,#0a0f1a)}
.sgp-btn--primary:hover{filter:brightness(1.1)}
.sgp-btn--stop{background:var(--panel,#111827);color:#ef4444;border-color:var(--line,#1f2937)}
.sgp-btn--stop:hover:not(:disabled){border-color:#ef4444;background:#ef444422}
.sgp-btn:disabled{opacity:.4;cursor:not-allowed}

/* wide window: ring left, controls right */
@container sgp (min-aspect-ratio: 5/4){
  .sgp-body{flex-direction:row;gap:clamp(12px,4cqw,32px)}
  .sgp-ringwrap{align-self:stretch;width:auto}
  .sgp-side{flex:1 1 0;min-width:0;max-width:none}
}
/* short window: drop the stats */
@container sgp (max-height: 340px){
  .sgp-stats{display:none}
  .sgp-head{padding:6px 12px}
}
/* narrow window: icons only */
@container sgp (max-width: 280px){
  .sgp-brand-text{display:none}
}
@container sgp (max-width: 230px){
  .sgp-btn span{display:none}
}

@keyframes sgp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes sgp-glow{
  0%,100%{box-shadow:0 0 14px color-mix(in srgb,var(--neon,#00ff88) 22%,transparent)}
  50%{box-shadow:0 0 30px color-mix(in srgb,var(--neon,#00ff88) 45%,transparent)}
}
@media (prefers-reduced-motion:reduce){.sgp *{animation:none!important;transition:none!important}}
`;

const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

function PauseIcon() {
  return (
    <svg {...iconProps}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg {...iconProps}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function PipTimerPortal({ sessions, now, onPause, onResume, onStop, onClose }: PipTimerPortalProps) {
  const active = sessions.find((s) => !s.end);
  const state: "running" | "paused" | "idle" = !active ? "idle" : active.pausedAt ? "paused" : "running";

  const sessionMs = active ? sessionDurationMs(active, now) : 0;
  const isStudying = !!active && active.type === "study";
  // Goal progress is work-only; the study ring timer still ticks normally.
  const todayHours = hoursForDay(workSessionsOnly(sessions), dayKey(new Date(now)), now);
  const progress = Math.min(1, todayHours / DAILY_GOAL_HOURS);
  const leftHours = Math.max(0, DAILY_GOAL_HOURS - todayHours);
  const deg = Math.round(progress * 360);

  const chipLabel = state === "running" ? "REC" : state === "paused" ? "PAUSED" : "IDLE";

  return (
    <div className="sgp">
      <style>{CSS}</style>

      <header className="sgp-head">
        <div className="sgp-brand">
          <span className="sgp-logo">◈</span>
          <span className="sgp-brand-text">ShiftGrid</span>
        </div>
        <div className="sgp-right">
          <span className={`sgp-chip sgp-chip--${state}`}>
            <i />
            {chipLabel}
          </span>
          <button className="sgp-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      <div className="sgp-body">
        <div className="sgp-ringwrap">
          <div
            className={`sgp-ring${state === "running" ? " sgp-ring--live" : ""}`}
            style={{
              background: `conic-gradient(var(--neon,#00ff88) 0deg ${deg}deg, var(--line,#1f2937) ${deg}deg 360deg)`,
            }}
          >
            <div className="sgp-disc">
              <div className="sgp-center">
                <div className="sgp-time">{formatHMS(sessionMs)}</div>
                <div className="sgp-sub">{active ? (isStudying ? "Study session" : "Current session") : "No session"}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="sgp-side">
          <div className="sgp-stats">
            <div className="sgp-stat">
              <span className="sgp-stat-label">Today</span>
              <span className="sgp-stat-value">{todayHours.toFixed(1)}h</span>
            </div>
            <div className="sgp-stat">
              <span className="sgp-stat-label">Left</span>
              <span className="sgp-stat-value">{leftHours.toFixed(1)}h</span>
            </div>
            <div className="sgp-stat">
              <span className="sgp-stat-label">Goal {DAILY_GOAL_HOURS}h</span>
              <span className="sgp-stat-value sgp-stat-value--neon">{Math.round(progress * 100)}%</span>
            </div>
          </div>

          <div className="sgp-actions">
            {state === "running" && (
              <button className="sgp-btn sgp-btn--primary" onClick={onPause}>
                <PauseIcon />
                <span>Pause</span>
              </button>
            )}
            {state === "paused" && (
              <button className="sgp-btn sgp-btn--primary" onClick={onResume}>
                <PlayIcon />
                <span>Resume</span>
              </button>
            )}
            <button className="sgp-btn sgp-btn--stop" onClick={onStop} disabled={state === "idle"}>
              <StopIcon />
              <span>Stop</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}