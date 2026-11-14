"use client";

import { useEffect } from "react";

// iPhone-specific audio behaviour. Melodrip is used as an iOS home-screen app,
// so these matter more than desktop browsers.

/**
 * Ask Safari to treat our Web Audio as media playback. Without this, iOS mutes
 * Web Audio whenever the ring/silent switch is set to silent (Safari 16.4+;
 * a no-op elsewhere). Call it from the tap that starts the sound.
 */
export function setPlaybackAudioSession() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = "playback";
    } catch {}
  }
}

/**
 * Resume an AudioContext that iOS suspended or "interrupted" (a call, Siri,
 * switching apps) once the page is visible again.
 */
export function resumeOnReturn(getContext: () => AudioContext | null) {
  const resume = () => {
    const ctx = getContext();
    if (document.visibilityState === "visible" && ctx && ctx.state !== "running" && ctx.state !== "closed") {
      void ctx.resume().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", resume);
}

/**
 * Keep the screen on while `active`. iOS stops a web app's audio when the phone
 * auto-locks, so the scenes hold a wake lock while they play (iOS 16.4+ in
 * Safari, 18.4+ for home-screen apps). Re-acquired after the app returns to the foreground.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    if (!active || !nav.wakeLock) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const l = await nav.wakeLock!.request("screen");
        if (cancelled) void l.release();
        else lock = l;
      } catch {}
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
