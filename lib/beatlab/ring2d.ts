// The pop-it ring in 2D: five rings of glowing bubbles (one per drum voice,
// 16 steps around), a core that pulses with the sound, a light wedge that
// sweeps with the playhead, and ripples on every hit.
//
// Built to stay smooth on a phone in real time: the glow comes from glow
// sprites drawn once per colour and stamped with additive blending (no
// per-frame blur), the plate and tracks are cached on their own canvas, and
// when nothing is moving it redraws at a low rate.

import { STEPS, VOICES } from "./patterns";
import type { BeatEngine } from "./engine";

export type Ring = { popAt: (i: number) => void; dispose: () => void };

const TAU = Math.PI * 2;
const angleOf = (s: number) => -Math.PI / 2 + (s / STEPS) * TAU;

type Bubble = { v: number; s: number; i: number; x: number; y: number; r: number; k: number; pulse: number; pop: number; hover: number };
type Ripple = { x: number; y: number; r: number; color: string; life: number };

function glowSprite(color: string, size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color + "aa");
  grad.addColorStop(0.6, color + "33");
  grad.addColorStop(1, color + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export async function createRing(
  host: HTMLElement,
  tip: HTMLElement,
  engine: BeatEngine,
  actions: { toggle: (i: number) => void; togglePlay: () => void }
): Promise<Ring | null> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.style.touchAction = "manipulation"; // taps only, so the page can still scroll on a phone
  host.appendChild(canvas);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const plate = document.createElement("canvas"); // cached background + tracks
  const glows = VOICES.map((v) => glowSprite(v.color, 128));
  const coreGlow = glowSprite("#ff8fd8", 256);
  const wedgeGlow = glowSprite("#ffe6fa", 256);

  let w = 0, h = 0, dpr = 1, cx = 0, cy = 0, R = 0, coreR = 0;
  const bubbles: Bubble[] = [];
  for (let v = 0; v < VOICES.length; v++)
    for (let s = 0; s < STEPS; s++) {
      const i = v * STEPS + s;
      bubbles.push({ v, s, i, x: 0, y: 0, r: 0, k: engine.grid[i], pulse: 0, pop: 0, hover: 0 });
    }
  const ripples: Ripple[] = [];
  const ringR = (v: number) => R * (0.32 + v * 0.145);

  const layout = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = host.clientWidth;
    h = host.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    cx = w / 2;
    cy = h / 2;
    R = Math.min(w, h) * 0.47;
    coreR = R * 0.17;
    for (const b of bubbles) {
      const a = angleOf(b.s);
      const rr = ringR(b.v);
      b.x = cx + Math.cos(a) * rr;
      b.y = cy + Math.sin(a) * rr;
      b.r = R * (0.042 + b.v * 0.005);
    }
    // plate: a soft disc and faint tracks, drawn once
    plate.width = canvas.width;
    plate.height = canvas.height;
    const p = plate.getContext("2d")!;
    p.setTransform(dpr, 0, 0, dpr, 0, 0);
    const disc = p.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.08);
    disc.addColorStop(0, "#2a1670");
    disc.addColorStop(0.7, "#1a1150");
    disc.addColorStop(1, "rgba(13, 8, 48, 0)");
    p.fillStyle = disc;
    p.beginPath();
    p.arc(cx, cy, R * 1.08, 0, TAU);
    p.fill();
    VOICES.forEach((voice, v) => {
      p.strokeStyle = voice.color + "40";
      p.lineWidth = 1;
      p.beginPath();
      p.arc(cx, cy, ringR(v), 0, TAU);
      p.stroke();
    });
    // a tick every beat (4 steps) so the bar is easy to read
    p.strokeStyle = "rgba(255, 230, 250, 0.18)";
    p.lineWidth = 1.5;
    for (let s = 0; s < STEPS; s += 4) {
      const a = angleOf(s);
      p.beginPath();
      p.moveTo(cx + Math.cos(a) * ringR(0) * 0.78, cy + Math.sin(a) * ringR(0) * 0.78);
      p.lineTo(cx + Math.cos(a) * ringR(4) * 1.08, cy + Math.sin(a) * ringR(4) * 1.08);
      p.stroke();
    }
  };
  const observer = new ResizeObserver(layout);
  observer.observe(host);
  layout();

  // ---- input: tap a bubble to toggle it, tap the core to play ----
  let down: { x: number; y: number; t: number } | null = null;
  let hovered: Bubble | null = null;
  let mouse: { x: number; y: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pick = (x: number, y: number): Bubble | "core" | null => {
    if (Math.hypot(x - cx, y - cy) < coreR * 1.15) return "core";
    let best: Bubble | null = null;
    let bestD = Infinity;
    for (const b of bubbles) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < b.r * 1.7 && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  };
  const onDown = (e: PointerEvent) => {
    down = { ...local(e), t: performance.now() };
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const p = local(e);
    const quick = performance.now() - down.t < 600 && Math.hypot(p.x - down.x, p.y - down.y) < 10;
    down = null;
    if (!quick) return;
    const hit = pick(p.x, p.y);
    if (hit === "core") actions.togglePlay();
    else if (hit) actions.toggle(hit.i);
    wake();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return; // hover tips only for a real mouse
    mouse = local(e);
    wake();
  };
  const onLeave = () => {
    mouse = null;
    hovered = null;
    tip.hidden = true;
    canvas.style.cursor = "";
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  // ---- drawing ----
  let frame = 0;
  let last = performance.now();
  let idleSkip = 0;
  let awakeUntil = 0;
  const wake = () => {
    awakeUntil = performance.now() + 1500;
  };

  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    const busy = engine.playing || now < awakeUntil || ripples.length > 0;
    // nothing moving: redraw ~10 times a second (enough for AI suggestions to appear)
    if (!busy && ++idleSkip % 6 !== 0) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // hover
    if (mouse) {
      const hit = pick(mouse.x, mouse.y);
      hovered = hit && hit !== "core" ? hit : null;
      canvas.style.cursor = hit ? "pointer" : "";
      if (hit) {
        tip.textContent =
          hit === "core"
            ? engine.playing ? "Stop" : "Play"
            : `${VOICES[hit.v].name} · step ${hit.s + 1}` +
              (!engine.grid[hit.i] && engine.showGhosts && engine.ghosts[hit.i] > 0.3 ? ` · AI ${Math.round(engine.ghosts[hit.i] * 100)}%` : "");
        tip.style.left = `${mouse.x}px`;
        tip.style.top = `${mouse.y}px`;
      }
      tip.hidden = !hit;
    }

    // hits and the playhead follow the audio clock
    let kick = 0;
    let headAngle: number | null = null;
    const ac = engine.kit.ctx;
    if (engine.playing && ac) {
      const t = ac.currentTime;
      while (engine.hits.length && engine.hits[0].t <= t) {
        const hit = engine.hits.shift()!;
        const b = bubbles[hit.v * STEPS + hit.s];
        b.pulse = 1;
        if (!reducedMotion && ripples.length < 24) ripples.push({ x: b.x, y: b.y, r: b.r, color: VOICES[b.v].color, life: 1 });
        if (hit.v === 0) kick = 1;
      }
      while (engine.ticks.length > 1 && engine.ticks[1].t <= t) engine.ticks.shift();
      if (engine.ticks.length && engine.ticks[0].t <= t) {
        const cur = engine.ticks[0];
        const frac = Math.min(1, (t - cur.t) / engine.stepDur());
        headAngle = angleOf(cur.s + frac);
        engine.setStep(cur.s);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(plate, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";

    // playhead: a soft wedge of light
    if (headAngle !== null) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R * 1.0, headAngle - TAU / 32, headAngle + TAU / 32);
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = 0.22;
      ctx.drawImage(wedgeGlow, cx - R * 1.05, cy - R * 1.05, R * 2.1, R * 2.1);
      ctx.restore();
    }

    // bubbles: glow first (additive), then the bubble itself
    const ease = Math.min(1, dt * 14);
    for (const b of bubbles) {
      const on = engine.grid[b.i];
      b.k += (on - b.k) * ease;
      b.pulse = Math.max(0, b.pulse - dt * 3.2);
      b.pop = Math.max(0, b.pop - dt * 2.6);
      b.hover += ((b === hovered ? 1 : 0) - b.hover) * ease;
      const ghost = engine.showGhosts ? engine.ghosts[b.i] * (1 - b.k) : 0;
      const glow = b.k * 0.55 + b.pulse * 1.1 + ghost * 0.6 + b.hover * 0.25;
      const scale = 1 + (reducedMotion ? 0 : b.pulse * 0.35 + b.pop * 0.3) + b.hover * 0.12;
      if (glow > 0.02) {
        const gs = b.r * (4.2 + b.pulse * 2.5) * scale;
        ctx.globalAlpha = Math.min(1, glow);
        ctx.drawImage(glows[b.v], b.x - gs / 2, b.y - gs / 2, gs, gs);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    for (const b of bubbles) {
      const color = VOICES[b.v].color;
      const scale = 1 + (reducedMotion ? 0 : b.pulse * 0.35 + b.pop * 0.3) + b.hover * 0.12;
      const r = b.r * scale;
      // ring outline for every bubble, filled when it's on
      ctx.globalAlpha = 0.45 + b.hover * 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = b.s % 4 === 0 ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.stroke();
      if (b.k > 0.02) {
        ctx.globalAlpha = Math.min(1, b.k);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * (0.78 + 0.22 * b.k), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = Math.min(1, b.k) * 0.7; // glossy highlight
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.28, 0, TAU);
        ctx.fill();
      }
    }

    // ripples
    ctx.globalCompositeOperation = "lighter";
    for (let k = ripples.length - 1; k >= 0; k--) {
      const rp = ripples[k];
      rp.life -= dt * 2;
      if (rp.life <= 0) {
        ripples.splice(k, 1);
        continue;
      }
      ctx.globalAlpha = rp.life * 0.7;
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 2 * rp.life;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r * (1 + (1 - rp.life) * 2.4), 0, TAU);
      ctx.stroke();
    }

    // core: glows with the output level and kicks
    const lvl = engine.kit.level();
    const coreGlowSize = coreR * (4 + lvl * 9 + kick * 2);
    ctx.globalAlpha = Math.min(1, 0.45 + lvl * 2 + kick * 0.5);
    ctx.drawImage(coreGlow, cx - coreGlowSize / 2, cy - coreGlowSize / 2, coreGlowSize, coreGlowSize);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const cr = coreR * (1 + (reducedMotion ? 0 : lvl * 0.4));
    const body = ctx.createRadialGradient(cx - cr * 0.35, cy - cr * 0.35, cr * 0.1, cx, cy, cr);
    body.addColorStop(0, "#fff0fa");
    body.addColorStop(0.45, "#ff9fdc");
    body.addColorStop(1, "#8a3fd8");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, TAU);
    ctx.fill();
    // play / pause mark so it's obvious the core is a button
    ctx.fillStyle = "rgba(42, 14, 90, 0.85)";
    const m = cr * 0.36;
    ctx.beginPath();
    if (engine.playing) {
      ctx.rect(cx - m * 0.75, cy - m, m * 0.5, m * 2);
      ctx.rect(cx + m * 0.25, cy - m, m * 0.5, m * 2);
    } else {
      ctx.moveTo(cx - m * 0.6, cy - m);
      ctx.lineTo(cx + m, cy);
      ctx.lineTo(cx - m * 0.6, cy + m);
      ctx.closePath();
    }
    ctx.fill();
  };
  frame = requestAnimationFrame(draw);

  return {
    popAt: (i) => {
      const b = bubbles[i];
      if (b) {
        b.pop = 1;
        b.pulse = Math.max(b.pulse, 0.6);
        wake();
      }
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.remove();
    },
  };
}
