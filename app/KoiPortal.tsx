"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Koi } from "@/lib/koi/scene";

// "Dive deeper": a glowing lotus pond with a crystal koi hovering over the
// water. Pick a destination and the koi dives in, the pond ripples, and you
// land in Present, Beat Lab or Sound Planets. Nothing heavy loads until the card is on screen.

const POND_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261104_160514_d8369d6e-d8ba-4532-9751-b32e0c8aaf75.mp4";
const POND_STILL =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20261104_151305_25ef1f45-0886-491c-a7a8-81e296402d5a.png&w=1200&q=85";

type Ripple = { id: number; x: number; y: number; big?: boolean };

const DESTINATIONS = [
  { href: "/present", tag: "Feel", title: "Present", sub: "Sound therapy" },
  { href: "/beats", tag: "Make", title: "Beat Lab", sub: "AI drum ring" },
  { href: "/planets", tag: "Play", title: "Planets", sub: "For kids" },
] as const;

export function KoiPortal() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const koi = useRef<Koi | null>(null);
  const [near, setNear] = useState(false); // scrolled close enough to start loading
  const [koiReady, setKoiReady] = useState(false);
  const [diving, setDiving] = useState<string | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);

  // Load lazily, and pause the koi and the video whenever the card is off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
        koi.current?.setVisible(entry.isIntersecting);
        const v = videoRef.current;
        if (v) {
          if (entry.isIntersecting) void v.play().catch(() => {});
          else v.pause();
        }
      },
      { rootMargin: "200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !canvasRef.current) return;
    let cancelled = false;
    void import("@/lib/koi/scene").then(async ({ createKoi }) => {
      if (cancelled || !canvasRef.current) return;
      const k = await createKoi(canvasRef.current, () => !cancelled && setKoiReady(true));
      if (cancelled) k?.dispose();
      else koi.current = k;
    });
    return () => {
      cancelled = true;
      koi.current?.dispose();
      koi.current = null;
    };
  }, [near]);

  function ripple(x: number, y: number, big = false) {
    const id = ++rippleId.current;
    setRipples((r) => [...r, { id, x, y, big }]);
    setTimeout(() => setRipples((r) => r.filter((p) => p.id !== id)), big ? 1400 : 1100);
  }

  function onTapPond(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("a, button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    ripple(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
    koi.current?.flick();
  }

  async function dive(e: React.MouseEvent, href: string) {
    // let new-tab / modifier clicks behave like normal links
    if (e.metaKey || e.ctrlKey || e.shiftKey || diving) return;
    e.preventDefault();
    setDiving(href);
    router.prefetch(href);
    const under = koi.current?.dive() ?? new Promise((r) => setTimeout(r, 500));
    setTimeout(() => ripple(56, 74, true), 380); // the splash where it enters the water
    await under;
    await new Promise((r) => setTimeout(r, 260));
    router.push(href);
  }

  return (
    <section
      ref={rootRef}
      className={`koi${koiReady ? " koi-ready" : ""}${diving ? " koi-diving" : ""}`}
      aria-label="Dive deeper into Melodrip"
      onPointerDown={onTapPond}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="koi-still" src={POND_STILL} alt="" loading="lazy" decoding="async" />
      {near && (
        <video ref={videoRef} className="koi-video" src={POND_VIDEO} poster={POND_STILL} muted loop playsInline autoPlay
          preload="auto" aria-hidden onPlaying={(e) => e.currentTarget.classList.add("on")} />
      )}
      <div className="koi-tint" aria-hidden />
      <canvas ref={canvasRef} className="koi-canvas" aria-hidden />
      <div className="koi-ripples" aria-hidden>
        {ripples.map((r) => (
          <span key={r.id} className={r.big ? "big" : undefined} style={{ left: `${r.x}%`, top: `${r.y}%` }} />
        ))}
      </div>

      <p className="koi-hint" aria-hidden>
        <span className="koi-dot" /> tap the water
      </p>

      <div className="koi-copy">
        <p className="eyebrow">More in Melodrip</p>
        <h2>
          Dive <span className="serif glow-text">deeper.</span>
        </h2>
        <p className="koi-sub">Follow the koi to sound therapy, the beat lab, or the kids&apos; planets.</p>
        <div className="koi-doors">
          {DESTINATIONS.map((d) => (
            <a key={d.href} href={d.href} className={`koi-door${diving === d.href ? " active" : ""}`}
              onClick={(e) => dive(e, d.href)}>
              <span className="koi-door-tag">{d.tag}</span>
              <span className="koi-door-title">{d.title}</span>
              <span className="koi-door-sub">{d.sub}</span>
              <svg className="koi-door-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
        </div>
      </div>
      <div className="koi-veil" aria-hidden />
    </section>
  );
}
