"use client";

import { useEffect, useRef, useState } from "react";
import { seaAudio } from "@/lib/therapy/sea-audio";
import { useWakeLock } from "@/lib/therapy/ios";
import { BackButton, Icon, useCanvasLoop, useFullscreen } from "./shared";
import { ElementDial } from "@/app/ElementDial";
import { useElementActive } from "@/lib/elements/fx";

// Anxious / deep-sleep mode: a sunken stepped temple glowing under the sea,
// with drifting plankton and rising bubbles. Ocean swells and a slow lullaby
// each have their own volume. Optional 4-4-4-4 box breathing guide, and a
// sleep timer that dims the screen and fades the sound out.

type Bubble = { x: number; y: number; r: number; speed: number; wobble: number; amp: number; phase: number; alpha: number };
type Speck = { x: number; y: number; size: number; alpha: number; pulse: number; color: string; vx: number; vy: number };

const TIMERS = [
  { value: 0, label: "Off" },
  { value: 60, label: "1 min (test)" },
  { value: 15 * 60, label: "15 min" },
  { value: 30 * 60, label: "30 min" },
  { value: 60 * 60, label: "60 min" },
];
const FADE_SECONDS = 8;
const DIM_SECONDS = 30;
const PHASES = ["Inhale", "Hold", "Exhale", "Rest"] as const;

export function SeaView({ onBack }: { onBack: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  const [started, setStarted] = useState(false);
  const [oceanVol, setOceanVol] = useState(0.7);
  const [musicVol, setMusicVol] = useState(0.65);
  const [muted, setMuted] = useState(false);

  // Box breathing: both the HUD and the canvas ring derive from one start time, so they stay in sync.
  const [breathing, setBreathing] = useState(false);
  const breathStart = useRef<number | null>(null);
  const [breath, setBreath] = useState({ phase: 0, left: 4 });

  // Sleep timer
  const [timer, setTimer] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [darkness, setDarkness] = useState(0);
  const timerEnd = useRef<number | null>(null);

  const bubbles = useRef<Bubble[]>([]);
  const specks = useRef<Speck[]>([]);

  // Keep the iPhone awake while playing; iOS stops web audio when the screen locks.
  useWakeLock(started && darkness < 1);
  useElementActive("scene-sea", started && darkness < 1); // elements fade out with the sleep timer

  useEffect(() => () => seaAudio.stop(), []);

  useEffect(() => {
    if (!breathing) {
      breathStart.current = null;
      return;
    }
    breathStart.current = performance.now();
    const tick = () => {
      const s = (performance.now() - breathStart.current!) / 1000;
      setBreath({ phase: Math.floor(s / 4) % 4, left: 4 - Math.floor(s % 4) });
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [breathing]);

  useEffect(() => {
    if (!timer) {
      timerEnd.current = null;
      setRemaining(null);
      setDarkness(0);
      return;
    }
    timerEnd.current = Date.now() + timer * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((timerEnd.current! - Date.now()) / 1000));
      setRemaining(left);
      if (left <= DIM_SECONDS) setDarkness((DIM_SECONDS - left) / DIM_SECONDS);
      if (left === 0) {
        clearInterval(id);
        sleepNow();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timer]);

  function sleepNow() {
    setDarkness(1);
    seaAudio.fadeOutAndStop(FADE_SECONDS);
  }

  async function wake() {
    setTimer(0);
    setDarkness(0);
    seaAudio.stop(); // cancel a fade that may still be running
    await seaAudio.start(oceanVol, musicVol, muted ? 0 : 1);
  }

  async function begin() {
    await seaAudio.start(oceanVol, musicVol, 1);
    setStarted(true);
  }

  function toggleMute() {
    seaAudio.setMasterVolume(muted ? 1 : 0);
    setMuted(!muted);
  }

  const canvasRef = useCanvasLoop(
    (w, h) => {
      bubbles.current = Array.from({ length: Math.min(65, Math.floor((w * h) / 18000)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 4.5 + 1.2,
        speed: Math.random() * 0.7 + 0.35,
        wobble: Math.random() * 1.5 + 0.8,
        amp: Math.random() * 1.2 + 0.3,
        phase: Math.random() * Math.PI * 2,
        alpha: Math.random() * 0.45 + 0.2,
      }));
      const colors = ["255, 143, 216", "155, 140, 255", "255, 194, 122", "127, 214, 255"];
      specks.current = Array.from({ length: Math.min(80, Math.floor((w * h) / 14000)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 2.2 + 0.8,
        alpha: Math.random() * 0.5 + 0.25,
        pulse: Math.random() * 1.8 + 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.15 - 0.08,
      }));
    },
    (ctx, w, h, time) => {
      // 1. Water column and swaying light shafts
      const sea = ctx.createLinearGradient(0, 0, 0, h);
      sea.addColorStop(0, "#1a0d4a");
      sea.addColorStop(0.35, "#120a3a");
      sea.addColorStop(0.7, "#0b0628");
      sea.addColorStop(1, "#05031a");
      ctx.fillStyle = sea;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < 6; i++) {
        const t = time * 0.0004 + i * 1.2;
        const x0 = (w / 7) * (i + 1) + Math.sin(t) * 60;
        const x1 = x0 + Math.sin(t * 0.7) * 140;
        const ray = ctx.createLinearGradient(x0, 0, x1, h * 0.85);
        ray.addColorStop(0, "rgba(190, 150, 255, 0.15)");
        ray.addColorStop(0.4, "rgba(255, 143, 216, 0.06)");
        ray.addColorStop(1, "rgba(18, 10, 58, 0)");
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(x0 - 30, 0);
        ctx.lineTo(x0 + 30, 0);
        ctx.lineTo(x1 + 80, h * 0.85);
        ctx.lineTo(x1 - 80, h * 0.85);
        ctx.closePath();
        ctx.fill();
      }

      // 2. Sunken temple: distant ruins, five glowing tiers, apex light, two pillars
      const base = h * 0.88;
      const cx = w * 0.5;
      ctx.save();
      ctx.fillStyle = "#0d0730";
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, base - 60);
      ctx.lineTo(cx * 0.4, base - 75);
      ctx.lineTo(cx * 0.7, base - 40);
      ctx.lineTo(cx * 1.3, base - 80);
      ctx.lineTo(cx * 1.6, base - 50);
      ctx.lineTo(w, base - 70);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();

      const pw = Math.min(w * 0.75, 540);
      const ph = pw * 0.55;
      const left = cx - pw / 2;
      const top = base - ph;
      const stone = ctx.createLinearGradient(0, top, 0, base);
      stone.addColorStop(0, "#24135a");
      stone.addColorStop(0.5, "#160b40");
      stone.addColorStop(1, "#0a0524");
      for (let t = 0; t < 5; t++) {
        const tw = pw * (1 - t * 0.16);
        const th = ph / 5;
        const tx = cx - tw / 2;
        const ty = base - (t + 1) * th;
        ctx.fillStyle = stone;
        ctx.shadowBlur = 0;
        ctx.fillRect(tx, ty, tw, th + 1);

        const glow = Math.sin(time * 0.0012 + t) * 0.25 + 0.75;
        ctx.strokeStyle = `rgba(255, 143, 216, ${0.5 * glow})`;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = "rgba(255, 143, 216, 0.85)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(tx + 12, ty + 4);
        ctx.lineTo(tx + tw - 12, ty + 4);
        ctx.stroke();
        // Step-fret glyphs along each tier
        for (let g = 0; g < Math.floor(tw / 40); g++) {
          const gx = tx + 18 + g * 38;
          const gy = ty + th * 0.55;
          ctx.beginPath();
          ctx.moveTo(gx, gy + 4);
          ctx.lineTo(gx + 8, gy + 4);
          ctx.lineTo(gx + 8, gy - 6);
          ctx.lineTo(gx + 16, gy - 6);
          ctx.lineTo(gx + 16, gy + 4);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;

      const aw = pw * 0.22;
      const ah = ph * 0.26;
      const ay = top - ah;
      ctx.fillStyle = "#160b40";
      ctx.fillRect(cx - aw / 2, ay, aw, ah);
      const ap = Math.sin(time * 0.002) * 0.2 + 0.8;
      const apex = ctx.createRadialGradient(cx, ay + ah / 2, 4, cx, ay + ah / 2, 60);
      apex.addColorStop(0, `rgba(251, 191, 36, ${0.9 * ap})`);
      apex.addColorStop(0.4, `rgba(192, 112, 255, ${0.65 * ap})`);
      apex.addColorStop(1, "rgba(20, 10, 60, 0)");
      ctx.fillStyle = apex;
      ctx.beginPath();
      ctx.arc(cx, ay + ah / 2, 60, 0, Math.PI * 2);
      ctx.fill();

      for (const px of [left - 45, left + pw + 45]) {
        const pH = ph * 0.85;
        const pY = base - pH;
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#170c45";
        ctx.fillRect(px - 14, pY, 28, pH);
        ctx.strokeStyle = "rgba(155, 140, 255, 0.7)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(155, 140, 255, 0.95)";
        ctx.shadowBlur = 8;
        for (let y = pY + 12; y < base - 8; y += 22) {
          ctx.beginPath();
          ctx.moveTo(px - 11, y);
          ctx.lineTo(px + 11, y);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        const orb = ctx.createRadialGradient(px, pY - 6, 2, px, pY - 6, 18);
        orb.addColorStop(0, "#fef08a");
        orb.addColorStop(0.5, "#ff8fd8");
        orb.addColorStop(1, "rgba(255, 143, 216, 0)");
        ctx.fillStyle = orb;
        ctx.beginPath();
        ctx.arc(px, pY - 6, 18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 3. Glowing plankton and rising bubbles
      for (const p of specks.current) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < 0) p.y = h;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        const a = Math.max(0.12, p.alpha + Math.sin(time * 0.0015 * p.pulse) * 0.28);
        ctx.fillStyle = `rgba(${p.color}, ${a})`;
        ctx.shadowColor = `rgba(${p.color}, 0.9)`;
        ctx.shadowBlur = p.size * 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      for (const b of bubbles.current) {
        b.y -= b.speed;
        b.x += Math.sin(time * 0.002 * b.wobble + b.phase) * b.amp;
        if (b.y < -10) {
          b.y = h + 10;
          b.x = Math.random() * w;
        }
        ctx.strokeStyle = `rgba(230, 210, 255, ${b.alpha})`;
        ctx.lineWidth = 1.2;
        ctx.fillStyle = `rgba(192, 112, 255, ${b.alpha * 0.18})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 255, 255, ${b.alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Breathing ring: grows on inhale, holds, shrinks on exhale, rests
      if (breathStart.current !== null) {
        const s = ((time - breathStart.current) / 1000) % 16;
        const ease = (x: number) => Math.sin((x * Math.PI) / 2);
        const r =
          s < 4 ? 55 + 50 * ease(s / 4)
          : s < 8 ? 105 + Math.sin(time * 0.003) * 2
          : s < 12 ? 105 - 50 * ease((s - 8) / 4)
          : 55 + Math.sin(time * 0.003) * 1.5;
        const bx = w / 2;
        const by = h * 0.43;
        ctx.save();
        const halo = ctx.createRadialGradient(bx, by, 15, bx, by, r * 1.4);
        halo.addColorStop(0, "rgba(255, 143, 216, 0.4)");
        halo.addColorStop(0.6, "rgba(155, 140, 255, 0.16)");
        halo.addColorStop(1, "rgba(111, 120, 255, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(bx, by, r * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 214, 241, 0.9)";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "rgba(255, 143, 216, 0.95)";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  );

  return (
    <div ref={rootRef} className="rx-scene">
      <canvas ref={canvasRef} className="rx-canvas" />

      {darkness > 0 && (
        <div className="rx-dark" style={{ opacity: darkness }} onClick={darkness >= 0.9 ? wake : undefined}>
          {darkness >= 0.9 && (
            <div className="rx-dark-msg">
              <Icon name="moon" size={36} />
              <p className="rx-dark-title">Rest peacefully</p>
              <p>Sound fading out for sleep. Tap anywhere to wake.</p>
            </div>
          )}
        </div>
      )}

      <header className="rx-header">
        <BackButton onBack={onBack} tone="sea" />
        <div className="rx-title rx-sea">
          <h1>Sunken <span className="serif">temple</span></h1>
          <p><Icon name="sparkle" size={12} /> Ocean swells · sea lullaby</p>
        </div>
        <div className="rx-tools">
          <ElementDial audioId="scene-sea" label="Sunken temple" size={40} />
          <button className={`rx-pill rx-breathe${breathing ? " on" : ""}`} onClick={() => setBreathing(!breathing)}
            aria-pressed={breathing} aria-label="Box breathing guide">
            <Icon name="wind" size={15} />
            <span>Breathe</span>
          </button>
          <button className="rx-pill rx-icon" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            <Icon name={muted ? "mute" : "volume"} />
          </button>
          {fullscreen.supported && (
            <button className="rx-pill rx-icon" onClick={fullscreen.toggle} aria-label="Toggle full screen">
              <Icon name={fullscreen.active ? "shrink" : "expand"} />
            </button>
          )}
        </div>
      </header>

      {breathing && (
        <div className="rx-breath-hud" aria-live="polite">
          <div className="rx-breath-phase">
            {PHASES[breath.phase]} <span>{breath.left}s</span>
          </div>
          <p>4s in · 4s hold · 4s out · 4s rest</p>
        </div>
      )}

      <footer className="rx-panel rx-panel-sea">
        <label className="rx-slider">
          <span>Ocean</span>
          <input type="range" min="0" max="1" step="0.01" value={oceanVol}
            onChange={(e) => { const v = parseFloat(e.target.value); setOceanVol(v); seaAudio.setOceanVolume(v); }} />
          <span className="rx-num">{Math.round(oceanVol * 100)}%</span>
        </label>
        <label className="rx-slider">
          <span>Lullaby</span>
          <input type="range" min="0" max="1" step="0.01" value={musicVol}
            onChange={(e) => { const v = parseFloat(e.target.value); setMusicVol(v); seaAudio.setMusicVolume(v); }} />
          <span className="rx-num">{Math.round(musicVol * 100)}%</span>
        </label>
        <div className="rx-stat rx-timer">
          <Icon name="clock" size={14} />
          <select value={timer} onChange={(e) => setTimer(Number(e.target.value))} aria-label="Sleep timer">
            {TIMERS.map((t) => (
              <option key={t.value} value={t.value}>{t.value ? t.label : "Timer off"}</option>
            ))}
          </select>
          {remaining !== null && (
            <span className="rx-badge">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>
          )}
          <button className="rx-pill rx-small-btn" onClick={sleepNow}>Fade out now</button>
        </div>
      </footer>

      {!started && (
        <div className="rx-overlay">
          <div className="rx-card rx-card-sea">
            <div className="rx-card-icon"><Icon name="moon" size={30} /></div>
            <h2>Deep sleep <span className="serif glow-text">sanctuary</span></h2>
            <p>
              Sink into a quiet underwater city. Slow ocean swells and a soft lullaby help your body settle into
              deep, restful sleep.
            </p>
            <button className="rx-start" onClick={begin}>Begin</button>
            <p className="rx-small">Two-layer mix · box breathing · sleep timer</p>
          </div>
        </div>
      )}
    </div>
  );
}
