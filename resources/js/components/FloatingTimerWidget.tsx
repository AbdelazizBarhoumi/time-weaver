import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { DAILY_GOAL_HOURS, formatHMS, hoursForDay, dayKey, sessionDurationMs, type WorkSession, savePipState, loadPipState, clearPipState, generatePipWindowId, type PersistedSessionState } from "@/lib/tracker";
import { PipTimerPortal } from "@/components/PipTimerPortal";

interface Props {
  sessions: WorkSession[];
  now: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const PIP_CHANNEL_NAME = "shiftgrid-pip-sync";
const PIP_WIDTH = 360;
const PIP_HEIGHT = 420;

export function FloatingTimerWidget({ sessions, now, onPause, onResume, onStop }: Props) {
  const pipWindowRef = useRef<Window | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const portalContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPipSupported, setIsPipSupported] = useState(false);
  const [isPipOpen, setIsPipOpen] = useState(false);
  const pipWindowIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const openPipRef = useRef<() => Promise<void>>();
  const closePipRef = useRef<() => void>();

  const active = sessions.find((s) => !s.end);
  const isRunning = !!active && !active.pausedAt;
  const isPaused = !!active && !!active.pausedAt;

  const buildState = useCallback((): PersistedSessionState => {
    if (!active) {
      return {
        sessionId: null,
        startTime: new Date().toISOString(),
        pausedAt: null,
        pausedMs: 0,
        isRunning: false,
        pipWindowId: pipWindowIdRef.current,
      };
    }
    return {
      sessionId: active.id,
      startTime: active.start,
      pausedAt: active.pausedAt,
      pausedMs: active.pausedMs,
      isRunning,
      pipWindowId: pipWindowIdRef.current,
    };
  }, [active, isRunning]);

  const syncStateToPip = useCallback(() => {
    const state = buildState();
    savePipState(state);
    broadcastChannelRef.current?.postMessage({
      type: "STATE_UPDATE",
      payload: state,
    });
  }, [buildState]);

  const closePip = useCallback(() => {
    console.log("[FloatingTimerWidget] Closing PiP window");
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
    }
    pipWindowRef.current = null;
    portalContainerRef.current = null;
    setIsPipOpen(false);
  }, []);

  closePipRef.current = closePip;

  const openPip = useCallback(async () => {
    console.log("[FloatingTimerWidget] Opening PiP window...");
    
    if (!("documentPictureInPicture" in window)) {
      console.log("[FloatingTimerWidget] Document PiP not supported");
      return;
    }

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      console.log("[FloatingTimerWidget] PiP window already open, focusing");
      pipWindowRef.current.focus();
      return;
    }

    try {
      console.log("[FloatingTimerWidget] Calling documentPictureInPicture.requestWindow...");
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
        copyStyleSheets: true,
        disallowReturnToOpener: false,
      });

      console.log("[FloatingTimerWidget] PiP window created:", pipWindow);
      pipWindowRef.current = pipWindow;
      pipWindowIdRef.current = generatePipWindowId();

      const state = buildState();
      state.pipWindowId = pipWindowIdRef.current;
      savePipState(state);

      const container = pipWindow.document.createElement("div");
      container.id = "pip-timer-root";
      pipWindow.document.body.appendChild(container);
      portalContainerRef.current = container;

      pipWindow.addEventListener("pagehide", () => {
        console.log("[FloatingTimerWidget] PiP window pagehide");
        if (isMountedRef.current) {
          setIsPipOpen(false);
          pipWindowRef.current = null;
          portalContainerRef.current = null;
        }
      });

      pipWindow.addEventListener("unload", () => {
        console.log("[FloatingTimerWidget] PiP window unload");
        if (isMountedRef.current) {
          setIsPipOpen(false);
          pipWindowRef.current = null;
          portalContainerRef.current = null;
        }
      });

      if ("documentPictureInPicture" in window && (window as any).documentPictureInPicture) {
        (window as any).documentPictureInPicture.addEventListener("enter", (event: any) => {
          console.log("[FloatingTimerWidget] PiP enter event:", event.window);
        });
      }

      setIsPipOpen(true);
      console.log("[FloatingTimerWidget] PiP window opened successfully");
    } catch (error) {
      console.error("[FloatingTimerWidget] Failed to open PiP window:", error);
      throw error;
    }
  }, [buildState]);

  openPipRef.current = openPip;

  useEffect(() => {
    isMountedRef.current = true;
    const supported = "documentPictureInPicture" in window;
    setIsPipSupported(supported);

    broadcastChannelRef.current = new BroadcastChannel(PIP_CHANNEL_NAME);
    broadcastChannelRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      switch (type) {
        case "PIP_PAUSE":
          onPause();
          break;
        case "PIP_RESUME":
          onResume();
          break;
        case "PIP_STOP":
          onStop();
          break;
        case "PIP_CLOSE":
          closePipRef.current?.();
          break;
        case "PIP_REQUEST_SYNC":
          syncStateToPip();
          break;
      }
    };

    const savedState = loadPipState();
    if (savedState?.pipWindowId) {
      pipWindowIdRef.current = savedState.pipWindowId;
    }

    // Auto-open PiP when page is hidden (minimized/tab switched)
    // Note: Requires user gesture - will be blocked by browser on minimize
    const handleVisibilityChange = () => {
      if (!isPipSupported) return;
      
      const hasActiveRunningSession = active && isRunning;
      
      if (document.hidden && hasActiveRunningSession) {
        console.log("[FloatingTimerWidget] Page hidden, attempting auto-open PiP...");
        openPipRef.current?.().catch((error) => {
          console.log("[FloatingTimerWidget] Auto PiP blocked (no user gesture)");
        });
      } else if (!document.hidden && isPipOpen) {
        console.log("[FloatingTimerWidget] Page visible again, closing PiP...");
        closePipRef.current?.();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      broadcastChannelRef.current?.close();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onPause, onResume, onStop, isPipSupported, isPipOpen, active, isRunning, syncStateToPip]);

  useEffect(() => {
    if (active) {
      syncStateToPip();
    } else {
      clearPipState();
    }
  }, [active, now, syncStateToPip]);

  useEffect(() => {
    const interval = setInterval(() => {
      syncStateToPip();
    }, 1000);
    return () => clearInterval(interval);
  }, [syncStateToPip]);

  const pipPortal = (isPipOpen && portalContainerRef.current && active) ? createPortal(
    <PipTimerPortal
      sessions={sessions}
      now={now}
      onPause={onPause}
      onResume={onResume}
      onStop={onStop}
      onClose={closePip}
    />,
    portalContainerRef.current
  ) : null;

  if (!isPipSupported) {
    return null;
  }

  return (
    <>
      {pipPortal}
    </>
  );
}