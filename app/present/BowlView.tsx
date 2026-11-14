"use client";

import { useEffect, useRef, useState } from "react";
import { bowlAudio } from "@/lib/therapy/bowl-audio";
import { useWakeLock } from "@/lib/therapy/ios";
import { BackButton, Icon, useCanvasLoop, useFullscreen } from "./shared";
import { ElementDial } from "@/app/ElementDial";
import { useElementActive } from "@/lib/elements/fx";

// Headache / migraine mode: a golden eight-spoked wheel turns once every 7 s
// over a meditating figure in a starfield. Each full turn strikes the bowl and
// sends a ring of light outward, while a warm bowl drone plays underneath.

const TURN_MS = 7000;
const TAU = Math.PI * 2;

type Star = { x: number; y: number; size: number; alpha: number; speed: number; phase: number; vx: number; vy: number };
type Ring = { r: number; max: number; alpha: number };

export function BowlView({ onBack }: { onBack: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.75);
  const [turns, setTurns] = useState(0);
  const [progress, setProgress] = useState(0);

  const stars = useRef<Star[]>([]);
  const rings = useRef<Ring[]>([]);
  const angle = useRef(0);
  const lastTime = useRef(0);
  const lastProgress = useRef(-1);
  const live = useRef(false); // count turns and chime only once the session has started

  // Keep the iPhone awake while playing; iOS stops web audio when the screen locks.
  useWakeLock(started);
  useElementActive("scene-bowl", started); // Earth/Water/Wind/Fire layered on top

  useEffect(() => () => bowlAudio.stop(), []);

  function chime(w: number, h: number) {
    if (!live.current) return;
    bowlAudio.strike();
    setTurns((n) => n + 1);
    rings.current.push({ r: 0, max: Math.max(w, h) * 0.65, alpha: 0.95 });
  }

  const canvasRef = useCanvasLoop(
    (w, h) => {
      const count = Math.min(180, Math.floor((w * h) / 6000));
      stars.current = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 2.2 + 0.6,
        alpha: Math.random() * 0.6 + 0.25,
        speed: Math.random() * 1.5 + 0.5,
        phase: Math.random() * TAU,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -Math.random() * 0.2 - 0.05,
      }));
    },
    (ctx, w, h, time) => {
      // Cap dt so a backgrounded tab doesn't fire a burst of chimes on return.
      const dt = Math.min(100, lastTime.current ? time - lastTime.current : 0);
      lastTime.current = time;
      const prev = angle.current;
      angle.current = (angle.current + (dt / TURN_MS) * TAU) % TAU;
      if (angle.current < prev) chime(w, h);
      const pct = Math.floor((angle.current / TAU) * 100);
      if (pct !== lastProgress.current) {
        lastProgress.current = pct;
        setProgress(pct);
      }

      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.22;

      // 1. Deep-space background and drifting blue nebulae
      const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.85);
      bg.addColorStop(0, "#1d0f4a");
      bg.addColorStop(0.35, "#130a38");
      bg.addColorStop(0.7, "#0b0626");
      bg.addColorStop(1, "#06031a");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const nt = time * 0.0004;
      const nebulae: [number, number, number, string][] = [
        [cx + Math.sin(nt) * 80, cy - 60 + Math.cos(nt * 0.8) * 50, R * 3.2, "111, 90, 255, 0.24"],
        [cx - 120 + Math.cos(nt * 0.7) * 70, cy + 80 + Math.sin(nt) * 60, R * 2.8, "255, 120, 210, 0.14"],
        [cx + 140 + Math.sin(nt * 0.5) * 60, cy + 100 + Math.cos(nt * 0.6) * 70, R * 2.5, "192, 112, 255, 0.18"],
        [cx, cy, R * 2.2, "141, 148, 255, 0.18"],
      ];
      for (const [x, y, r, rgba] of nebulae) {
        const g = ctx.createRadialGradient(x, y, 10, x, y, r);
        g.addColorStop(0, `rgba(${rgba})`);
        g.addColorStop(0.6, `rgba(${rgba.replace(/[\d.]+$/, "0.06")})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }

      // 2. Twinkling stardust
      for (const s of stars.current) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.y < 0) s.y = h;
        if (s.x < 0) s.x = w;
        if (s.x > w) s.x = 0;
        const a = Math.max(0.1, s.alpha + Math.sin(time * 0.002 * s.speed + s.phase) * 0.35);
        ctx.fillStyle = `rgba(240, 220, 255, ${a})`;
        ctx.shadowColor = "rgba(255, 160, 230, 0.8)";
        ctx.shadowBlur = s.size * 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, TAU);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // 3. Meditating silhouette with aura and halo
      ctx.save();
      const k = R * 0.0125;
      const by = cy + 18;
      const pulse = Math.sin(time * 0.0018) * 0.08 + 0.92;
      const aura = ctx.createRadialGradient(cx, by - 70 * k, 15, cx, by - 40 * k, R * 1.8 * pulse);
      aura.addColorStop(0, "rgba(220, 170, 255, 0.35)");
      aura.addColorStop(0.3, "rgba(160, 100, 255, 0.22)");
      aura.addColorStop(0.7, "rgba(80, 40, 160, 0.12)");
      aura.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, by - 40 * k, R * 1.8 * pulse, 0, TAU);
      ctx.fill();

      ctx.translate(cx, by);
      ctx.scale(k, k);
      const halo = ctx.createRadialGradient(0, -95, 5, 0, -95, 45);
      halo.addColorStop(0, "rgba(254, 240, 138, 0.4)");
      halo.addColorStop(0.5, "rgba(200, 140, 255, 0.25)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, -95, 45, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "rgba(22, 10, 60, 0.72)";
      ctx.strokeStyle = "rgba(230, 180, 255, 0.55)";
      ctx.lineWidth = 2.2;
      ctx.shadowColor = "rgba(200, 130, 255, 0.6)";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, -112, 6, 0, TAU);
      ctx.moveTo(14, -95);
      ctx.arc(0, -95, 14, 0, TAU);
      ctx.moveTo(-10, -82);
      ctx.quadraticCurveTo(-26, -75, -45, -60);
      ctx.quadraticCurveTo(-52, -35, -46, -10);
      ctx.quadraticCurveTo(-38, 10, -22, 18);
      ctx.quadraticCurveTo(-50, 24, -68, 38);
      ctx.quadraticCurveTo(-65, 52, -30, 52);
      ctx.lineTo(30, 52);
      ctx.quadraticCurveTo(65, 52, 68, 38);
      ctx.quadraticCurveTo(50, 24, 22, 18);
      ctx.quadraticCurveTo(38, 10, 46, -10);
      ctx.quadraticCurveTo(52, -35, 45, -60);
      ctx.quadraticCurveTo(26, -75, 10, -82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(0, 22, 14, 7, 0, 0, TAU);
      ctx.fillStyle = "rgba(240, 210, 255, 0.45)";
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(254, 240, 138, 0.9)";
      ctx.shadowColor = "rgba(254, 240, 138, 1)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, -97, 2, 0, TAU);
      ctx.arc(0, -42, 2.5, 0, TAU);
      ctx.fill();
      ctx.restore();

      // 4. Light rings from each chime
      rings.current = rings.current.filter((ring) => ring.alpha >= 0.02);
      for (const ring of rings.current) {
        ring.r += (ring.max - ring.r) * 0.035 + 1.2;
        ring.alpha *= 0.965;
        ctx.save();
        ctx.shadowColor = "rgba(250, 204, 21, 0.9)";
        ctx.shadowBlur = 20;
        ctx.strokeStyle = `rgba(253, 224, 71, ${ring.alpha * 0.8})`;
        ctx.lineWidth = 3.5 * ring.alpha;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 143, 216, ${ring.alpha * 0.5})`;
        ctx.lineWidth = 1.8 * ring.alpha;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r * 0.88, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // 5. Lotus petals at the base, gently bobbing
      ctx.save();
      ctx.translate(cx, cy + R * 0.96 + Math.sin(time * 0.0015) * 4);
      const ps = R * 0.0075;
      ctx.scale(ps, ps);
      const petals: [number, number, string][] = [
        [-0.7, 45, "234, 179, 8, 0.75"], [-0.45, 52, "250, 204, 21, 0.85"], [-0.22, 58, "254, 240, 138, 0.9"],
        [0, 62, "255, 255, 255, 0.95"],
        [0.22, 58, "254, 240, 138, 0.9"], [0.45, 52, "250, 204, 21, 0.85"], [0.7, 45, "234, 179, 8, 0.75"],
      ];
      for (const [rot, len, rgba] of petals) {
        ctx.save();
        ctx.rotate(rot);
        ctx.fillStyle = `rgba(${rgba})`;
        ctx.shadowColor = "rgba(253, 224, 71, 0.5)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-14, -len * 0.5, 0, -len);
        ctx.quadraticCurveTo(14, -len * 0.5, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(254, 240, 138, 0.8)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      // 6. The golden eight-spoked wheel
      ctx.save();
      ctx.translate(cx, cy);
      const glow = ctx.createRadialGradient(0, 0, R * 0.65, 0, 0, R * 1.3);
      glow.addColorStop(0, "rgba(250, 204, 21, 0.35)");
      glow.addColorStop(0.5, "rgba(234, 179, 8, 0.18)");
      glow.addColorStop(1, "rgba(250, 204, 21, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.3, 0, TAU);
      ctx.fill();

      ctx.rotate(angle.current);
      const outer = R;
      const inner = R * 0.84;
      const hub = R * 0.26;
      ctx.shadowColor = "rgba(250, 204, 21, 0.75)";
      ctx.shadowBlur = 18;

      const rim = ctx.createLinearGradient(-outer, -outer, outer, outer);
      rim.addColorStop(0, "#fef08a");
      rim.addColorStop(0.3, "#eab308");
      rim.addColorStop(0.6, "#ca8a04");
      rim.addColorStop(0.85, "#fde047");
      rim.addColorStop(1, "#a16207");
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, TAU);
      ctx.arc(0, 0, inner, 0, TAU, true);
      ctx.fillStyle = rim;
      ctx.fill();
      ctx.strokeStyle = "#fef08a";
      ctx.lineWidth = 2.5;
      for (const r of [outer, inner]) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.stroke();
      }

      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8;
        const sr = (outer + inner) / 2;
        const sx = Math.cos(a) * sr;
        const sy = Math.sin(a) * sr;
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sx, sy, R * 0.032, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#eab308";
        ctx.beginPath();
        ctx.arc(sx, sy, R * 0.018, 0, TAU);
        ctx.fill();
      }

      ctx.shadowBlur = 14;
      const mid = (hub + inner) * 0.5;
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((i * TAU) / 8);
        const sg = ctx.createLinearGradient(0, hub, 0, inner);
        sg.addColorStop(0, "#eab308");
        sg.addColorStop(0.5, "#fef08a");
        sg.addColorStop(1, "#ca8a04");
        ctx.fillStyle = sg;
        ctx.strokeStyle = "#fef08a";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-R * 0.038, hub);
        ctx.lineTo(-R * 0.07, mid);
        ctx.lineTo(-R * 0.034, inner);
        ctx.lineTo(R * 0.034, inner);
        ctx.lineTo(R * 0.07, mid);
        ctx.lineTo(R * 0.038, hub);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, hub + 4);
        ctx.lineTo(0, inner - 4);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      const hg = ctx.createRadialGradient(0, 0, 4, 0, 0, hub);
      hg.addColorStop(0, "#fef9c3");
      hg.addColorStop(0.4, "#eab308");
      hg.addColorStop(0.8, "#a16207");
      hg.addColorStop(1, "#713f12");
      ctx.beginPath();
      ctx.arc(0, 0, hub, 0, TAU);
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = "#fef08a";
      ctx.lineWidth = 2.8;
      ctx.stroke();

      const spiral = hub * 0.65;
      ["#8d94ff", "#ffc27a", "#ff8fd8"].forEach((color, s) => {
        ctx.save();
        ctx.rotate((s * TAU) / 3);
        ctx.beginPath();
        ctx.arc(0, spiral * 0.35, spiral * 0.45, -Math.PI / 2, Math.PI / 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();
      });
      ctx.restore();
    }
  );

  async function begin() {
    await bowlAudio.startDrone();
    bowlAudio.setVolume(volume);
    bowlAudio.strike();
    live.current = true;
    setStarted(true);
  }

  function toggleMute() {
    bowlAudio.setVolume(muted ? volume : 0);
    setMuted(!muted);
  }

  function changeVolume(v: number) {
    setVolume(v);
    if (muted) setMuted(false);
    bowlAudio.setVolume(v);
  }

  return (
    <div ref={rootRef} className="rx-scene">
      <canvas ref={canvasRef} className="rx-canvas" />

      <header className="rx-header">
        <BackButton onBack={onBack} tone="gold" />
        <div className="rx-title rx-gold">
          <h1>Singing <span className="serif">bowl</span></h1>
          <p><Icon name="sparkle" size={12} /> 108 Hz bowl drone · chime every turn</p>
        </div>
        <div className="rx-tools">
          <ElementDial audioId="scene-bowl" label="Singing bowl" size={40} />
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

      <footer className="rx-panel rx-panel-gold">
        <label className="rx-slider">
          <span>Volume</span>
          <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume}
            onChange={(e) => changeVolume(parseFloat(e.target.value))} />
          <span className="rx-num">{Math.round((muted ? 0 : volume) * 100)}%</span>
        </label>
        <div className="rx-stat">
          <Icon name="bell" size={14} />
          <span>Next chime</span>
          <span className="rx-bar"><span style={{ width: `${progress}%` }} /></span>
        </div>
        <div className="rx-stat">
          <span>Turns</span>
          <span className="rx-badge">{turns}</span>
        </div>
      </footer>

      {!started && (
        <div className="rx-overlay">
          <div className="rx-card rx-card-gold">
            <div className="rx-card-icon"><Icon name="sparkle" size={30} /></div>
            <h2>Cosmic <span className="serif glow-text">meditation</span></h2>
            <p>
              Ease headaches and tension with the warm, slow harmonics of a singing bowl. A bell rings each time the
              golden wheel completes a turn: breathe out with it.
            </p>
            <button className="rx-start" onClick={begin}>Start Meditation</button>
            <p className="rx-small">Best with headphones · relax your jaw and temples</p>
          </div>
        </div>
      )}
    </div>
  );
}
