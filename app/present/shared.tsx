"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// Small inline icon set (replaces SoundPal's lucide-react dependency).
const PATHS = {
  back: "M15 5l-7 7 7 7",
  volume: "M4 9v6h4l5 4V5L8 9H4zm12.5-1.5a5 5 0 010 9M19 5a8.5 8.5 0 010 14",
  mute: "M4 9v6h4l5 4V5L8 9H4zm12 1l5 5m0-5l-5 5",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  wind: "M3 8h11a3 3 0 10-3-3M3 12h15a3 3 0 11-3 3M3 16h7",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  bell: "M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zm4 4a2 2 0 004 0",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
  clock: "M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Fullscreen toggle for an element. `supported` is false on iPhone Safari, which has no element fullscreen. */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(Boolean(document.fullscreenEnabled));
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void ref.current?.requestFullscreen().catch(() => {});
  };
  return { active, supported, toggle };
}

/**
 * Runs a full-window canvas animation. `setup(w, h)` runs on mount and on every
 * resize; `draw(ctx, w, h, time)` runs every frame. Both read the latest
 * closures through refs, so the loop never restarts.
 */
export function useCanvasLoop(
  setup: (w: number, h: number) => void,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => void
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const setupRef = useRef(setup);
  const drawRef = useRef(draw);
  setupRef.current = setup;
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let w = 0;
    let h = 0;
    let frame = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupRef.current(w, h);
    };
    const loop = (time: number) => {
      drawRef.current(ctx, w, h, time);
      frame = requestAnimationFrame(loop);
    };
    resize();
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return canvasRef;
}

export function BackButton({ onBack, tone }: { onBack: () => void; tone: "gold" | "sea" }) {
  return (
    <button className={`rx-pill rx-back rx-${tone}`} onClick={onBack} aria-label="Back to Present">
      <Icon name="back" size={16} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.jpg" alt="" className="rx-back-logo" />
      <span>Present</span>
    </button>
  );
}
