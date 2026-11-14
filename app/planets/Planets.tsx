"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NOTES, PLANET_LOOKS, PRESETS, PlanetEngine, SOUNDS, type Planet, type SoundId } from "@/lib/planets/engine";
import { useWakeLock } from "@/lib/therapy/ios";
import { ElementDial } from "@/app/ElementDial";
import { useElementActive } from "@/lib/elements/fx";

// Sound Planets: eight animal planets orbit a smiling sun. Each one sings its
// note whenever it crosses the glowing music line at the top. Slow and fast
// orbits drift in and out of step, so kids can see a polyrhythm happen.

const STORE = "melodrip-planets-v1";
const TAU = Math.PI * 2;

type Fx = { x: number; y: number; color: string; life: number; kind: "ring" | "spark"; vx?: number; vy?: number };

export default function Planets() {
  const engine = useMemo(() => new PlanetEngine(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((n) => n + 1), []);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(2);
  const [bpm, setBpmState] = useState(100);
  const [recState, setRecState] = useState<"idle" | "rec" | "saving">("idle");
  const [recSeconds, setRecSeconds] = useState(0);
  const [toast, setToast] = useState("");
  const [canRecord, setCanRecord] = useState(false); // browser-only, so decide after mount
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useWakeLock(playing); // iOS stops web audio when the phone auto-locks
  useElementActive("planets", playing); // nature sounds around the planets

  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? "" : t)), 2600);
  }, []);

  const save = useCallback(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ planets: engine.planets, bpm: engine.bpm }));
    } catch {}
  }, [engine]);

  const update = useCallback(
    (i: number, patch: Partial<Planet>) => {
      Object.assign(engine.planets[i], patch);
      bump();
      save();
    },
    [bump, engine, save]
  );

  // restore
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as { planets: Planet[]; bpm: number } | null;
      if (s?.planets?.length === 8) {
        engine.planets = s.planets.map((p, i) => ({ ...PLANET_LOOKS[i], ...p }));
        engine.setBpm(s.bpm ?? 100);
        setBpmState(engine.bpm);
        bump();
      }
    } catch {}
    setCanRecord(engine.recordingSupported);
    return () => engine.dispose();
  }, [bump, engine]);

  const togglePlay = useCallback(() => {
    engine.setPlaying(!engine.playing);
    setPlaying(engine.playing);
  }, [engine]);

  const toggleAwake = useCallback(
    (i: number) => {
      const on = !engine.planets[i].on;
      update(i, { on });
      if (on) engine.preview(i);
      say(on ? `${engine.planets[i].emoji} woke up!` : `${engine.planets[i].emoji} is sleeping 💤`);
    },
    [engine, say, update]
  );

  // keys 1–8 wake or sleep a planet, space plays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea") || e.metaKey || e.ctrlKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 8) toggleAwake(n - 1);
      else if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleAwake, togglePlay]);

  // ---- the orbit canvas ----
  const fx = useRef<Fx[]>([]);
  const squish = useRef<number[]>(Array(8).fill(0));
  const lineFlash = useRef(0);
  const stars = useRef<{ x: number; y: number; r: number; p: number }[]>([]);
  const geom = useRef({ cx: 0, cy: 0, R: 0, ringR: (i: number) => i, size: 0 });

  const planetXY = useCallback(
    (i: number, beat: number) => {
      const pl = engine.planets[i];
      const g = geom.current;
      const phase = ((((beat - pl.offset) / pl.interval) % 1) + 1) % 1;
      const a = phase * TAU - Math.PI / 2; // phase 0 = top, on the music line
      const r = g.ringR(i);
      return { x: g.cx + Math.cos(a) * r, y: g.cy + Math.sin(a) * r };
    },
    [engine]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let w = 0;
    let frame = 0;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const R = w / 2;
      const inner = R * 0.3;
      const outer = R * 0.9;
      geom.current = { cx: R, cy: R, R, size: Math.max(11, R * 0.075), ringR: (i) => inner + ((outer - inner) * i) / 7 };
      stars.current = Array.from({ length: 50 }, () => ({ x: Math.random() * w, y: Math.random() * w, r: Math.random() * 1.3 + 0.3, p: Math.random() * TAU }));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = geom.current;
      const beat = engine.nowBeat();
      const ac = engine.ctx;

      // planets that just sang: ripple, sparkles, squish, flash the music line
      if (ac) {
        while (engine.sung.length && engine.sung[0].t <= ac.currentTime) {
          const s = engine.sung.shift()!;
          const pl = engine.planets[s.planet];
          const pos = planetXY(s.planet, engine.beatAt(s.t));
          const color = NOTES[pl.note].color;
          fx.current.push({ ...pos, color, life: 1, kind: "ring" });
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * TAU;
            const sp = 30 + Math.random() * 50;
            fx.current.push({ ...pos, color, life: 1, kind: "spark", vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20 });
          }
          squish.current[s.planet] = 1;
          lineFlash.current = 1;
        }
      }

      ctx.clearRect(0, 0, w, w);
      // night sky disc
      const bg = ctx.createRadialGradient(g.cx, g.cy, 10, g.cx, g.cy, g.R);
      bg.addColorStop(0, "#3a1f88");
      bg.addColorStop(0.55, "#1e1058");
      bg.addColorStop(1, "#120a3a");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.R, 0, TAU);
      ctx.fill();
      for (const s of stars.current) {
        ctx.fillStyle = `rgba(255, 240, 255, ${0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.002 + s.p))})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }

      // the music line: planets sing as they cross it
      lineFlash.current = Math.max(0, lineFlash.current - dt * 3);
      const lf = lineFlash.current;
      const lineGrad = ctx.createLinearGradient(g.cx, g.cy, g.cx, g.cy - g.R);
      lineGrad.addColorStop(0, "rgba(255, 220, 245, 0)");
      lineGrad.addColorStop(1, `rgba(255, 220, 245, ${0.35 + lf * 0.6})`);
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 3 + lf * 3;
      ctx.shadowColor = "#ff8fd8";
      ctx.shadowBlur = 10 + lf * 20;
      ctx.beginPath();
      ctx.moveTo(g.cx, g.cy - g.ringR(0) + g.size);
      ctx.lineTo(g.cx, g.cy - g.R * 0.97);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `${g.R * 0.075 + lf * 6}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⭐", g.cx, g.cy - g.R * 0.955);

      // orbits
      engine.planets.forEach((pl, i) => {
        ctx.strokeStyle = pl.on ? `${pl.color}66` : "rgba(200, 190, 255, 0.12)";
        ctx.lineWidth = i === selectedRef.current ? 2.5 : 1.5;
        ctx.setLineDash(pl.on ? [] : [3, 6]);
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.ringR(i), 0, TAU);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // ripples and sparkles
      fx.current = fx.current.filter((f) => f.life > 0);
      for (const f of fx.current) {
        if (f.kind === "ring") {
          f.life -= dt * 1.6;
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = Math.max(0, f.life);
          ctx.lineWidth = 3 * f.life;
          ctx.beginPath();
          ctx.arc(f.x, f.y, g.size * (1 + (1 - f.life) * 2.6), 0, TAU);
          ctx.stroke();
        } else {
          f.life -= dt * 1.4;
          f.x += f.vx! * dt;
          f.y += f.vy! * dt;
          f.vy! += 60 * dt;
          ctx.fillStyle = f.color;
          ctx.globalAlpha = Math.max(0, f.life);
          ctx.beginPath();
          ctx.arc(f.x, f.y, 2.6 * f.life + 0.5, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // planets
      engine.planets.forEach((pl, i) => {
        const { x, y } = planetXY(i, beat);
        squish.current[i] = Math.max(0, squish.current[i] - dt * 3.5);
        const sq = squish.current[i];
        const size = g.size * (pl.on ? 1 : 0.8) * (1 + sq * 0.45);
        if (pl.on) {
          const halo = ctx.createRadialGradient(x, y, size * 0.4, x, y, size * 2.2);
          halo.addColorStop(0, `${NOTES[pl.note].color}${sq > 0.1 ? "cc" : "55"}`);
          halo.addColorStop(1, `${NOTES[pl.note].color}00`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, size * 2.2, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = pl.on ? pl.color : "rgba(120, 110, 170, 0.6)";
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
        if (i === selectedRef.current) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(x, y, size + 5, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = pl.on ? 1 : 0.55;
        ctx.font = `${size * 1.3}px system-ui`;
        ctx.fillText(pl.emoji, x, y + size * 0.06);
        if (!pl.on) {
          ctx.font = `${size * 0.8}px system-ui`;
          ctx.fillText("💤", x + size * 0.9, y - size * 0.9);
        }
        ctx.globalAlpha = 1;
      });

      // the sun: tap to play; it sings along with the music
      const lvl = engine.level();
      const sunR = g.ringR(0) * 0.62 * (1 + lvl * 0.4);
      const sun = ctx.createRadialGradient(g.cx - sunR * 0.3, g.cy - sunR * 0.3, sunR * 0.1, g.cx, g.cy, sunR * 1.6);
      sun.addColorStop(0, "#fff6c2");
      sun.addColorStop(0.45, "#ffc27a");
      sun.addColorStop(0.75, "#ff8fd8");
      sun.addColorStop(1, "rgba(255, 143, 216, 0)");
      ctx.fillStyle = sun;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, sunR * 1.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#4a2470";
      const eye = sunR * 0.13;
      const blink = Math.sin(now * 0.0011) > 0.985 ? 0.2 : 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(g.cx + s * sunR * 0.32, g.cy - sunR * 0.18, eye, eye * blink, 0, 0, TAU);
        ctx.fill();
      }
      if (engine.playing) {
        // singing mouth opens with the sound
        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy + sunR * 0.28, sunR * 0.22, sunR * (0.06 + lvl * 0.9), 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.lineWidth = sunR * 0.09;
        ctx.strokeStyle = "#4a2470";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(g.cx, g.cy + sunR * 0.12, sunR * 0.3, 0.2 * Math.PI, 0.8 * Math.PI);
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [engine, planetXY]);

  // tap the sun to play, tap a planet to wake it up or put it to sleep
  function onCanvasTap(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const g = geom.current;
    if (Math.hypot(x - g.cx, y - g.cy) < g.ringR(0) * 0.75) return togglePlay();
    const beat = engine.nowBeat();
    let best = -1;
    let bestD = g.size * 2.4;
    engine.planets.forEach((_, i) => {
      const p = planetXY(i, beat);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      setSelected(best);
      toggleAwake(best);
    }
  }

  function surprise() {
    const awake = new Set<number>();
    while (awake.size < 4) awake.add(Math.floor(Math.random() * 8));
    engine.planets.forEach((_, i) => {
      const interval = 1 + Math.floor(Math.random() * 8);
      Object.assign(engine.planets[i], {
        on: awake.has(i),
        note: Math.floor(Math.random() * NOTES.length),
        sound: SOUNDS[Math.floor(Math.random() * SOUNDS.length)].id as SoundId,
        interval,
        offset: Math.floor(Math.random() * interval),
      });
    });
    bump();
    save();
    say("🎲 A brand new song!");
  }

  function loadPreset(k: number) {
    const pr = PRESETS[k];
    engine.planets = pr.planets.map((x) => ({ ...x }));
    engine.setBpm(pr.bpm);
    setBpmState(pr.bpm);
    bump();
    save();
    say(`${pr.emoji} ${pr.name}`);
  }

  function sleepAll() {
    engine.planets.forEach((pl) => (pl.on = false));
    bump();
    save();
    say("Everyone is sleeping 💤 Tap a planet to wake it!");
  }

  async function record() {
    if (recState === "rec") {
      engine.stopRecording();
      return;
    }
    if (!engine.playing) togglePlay();
    setRecState("rec");
    setRecSeconds(0);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setRecSeconds(s);
      if (s >= 60) engine.stopRecording(); // one minute is plenty
    }, 250);
    const blob = await engine.startRecording();
    clearInterval(tick);
    setRecState("saving");
    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    const file = new File([blob], `my-planet-song.${ext}`, { type: blob.type });
    try {
      // iPhone: the share sheet lets you save to Files or send it
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "My planet song" });
      else {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      say("🎉 Song saved!");
    } catch {
      say("Song not saved");
    }
    setRecState("idle");
  }

  const pl = engine.planets[selected];

  return (
    <main className="sp screen">
      <header className="sp-top">
        <Link href="/" className="sp-back">‹ Melodrip</Link>
        <div className="sp-titlerow">
          <h1>
            Sound <span className="serif glow-text">planets</span>
          </h1>
          <ElementDial audioId="planets" label="Sound Planets" size={40} />
        </div>
        <p>Tap a planet to wake it up. It sings when it passes the ⭐ line!</p>
      </header>

      <div className="sp-stage">
        <canvas ref={canvasRef} className="sp-canvas" onPointerDown={onCanvasTap}
          aria-label="Orbit of sound planets. Tap the sun to play, tap a planet to wake it up." />
        {!playing && <span className="sp-tapsun" aria-hidden>tap the sun ☀️</span>}
        {toast && <p className="sp-toast" role="status">{toast}</p>}
      </div>

      <div className="sp-transport">
        <button className={`sp-big sp-play${playing ? " on" : ""}`} onClick={togglePlay}>
          <span>{playing ? "⏸" : "▶️"}</span>
          {playing ? "Stop" : "Play"}
        </button>
        <button className="sp-big" onClick={surprise}><span>🎲</span>Surprise</button>
        <button className="sp-big" onClick={sleepAll}><span>💤</span>Sleep all</button>
        {canRecord && (
          <button className={`sp-big sp-rec${recState === "rec" ? " on" : ""}`} onClick={record} disabled={recState === "saving"}>
            <span>{recState === "rec" ? "⏹" : "🔴"}</span>
            {recState === "rec" ? `0:${String(recSeconds).padStart(2, "0")}` : "Record"}
          </button>
        )}
      </div>

      <label className="sp-tempo">
        <span aria-hidden>🐢</span>
        <input type="range" min={60} max={160} step={1} value={bpm} aria-label="How fast"
          onChange={(e) => { const v = Number(e.target.value); engine.setBpm(v); setBpmState(v); save(); }} />
        <span aria-hidden>🐇</span>
      </label>

      <h2 className="group-title">Pick a planet</h2>
      <div className="sp-chips" role="tablist" aria-label="Planets">
        {engine.planets.map((p, i) => (
          <button key={i} role="tab" aria-selected={i === selected} className={`sp-chip${p.on ? " on" : ""}`}
            style={{ "--pc": p.color } as React.CSSProperties} onClick={() => { setSelected(i); engine.preview(i); }}>
            <span>{p.emoji}</span>
            <small>{i + 1}</small>
          </button>
        ))}
      </div>

      <section className="sp-card" style={{ "--pc": pl.color } as React.CSSProperties} aria-label={`Planet ${selected + 1}`}>
        <div className="sp-card-head">
          <span className="sp-card-emoji">{pl.emoji}</span>
          <button className={`sp-switch${pl.on ? " on" : ""}`} onClick={() => toggleAwake(selected)} aria-pressed={pl.on}>
            {pl.on ? "Awake 🎵" : "Sleeping 💤"}
          </button>
        </div>

        <p className="sp-label">Sound</p>
        <div className="sp-sounds">
          {SOUNDS.map((s) => (
            <button key={s.id} className={`sp-pill${pl.sound === s.id ? " on" : ""}`}
              onClick={() => { update(selected, { sound: s.id }); engine.preview(selected); }}>
              <span>{s.emoji}</span>{s.label}
            </button>
          ))}
        </div>

        <p className="sp-label">Note</p>
        <div className="sp-notes" aria-label="Note">
          {NOTES.map((n, k) => (
            <button key={k} className={`sp-bar${pl.note === k ? " on" : ""}`} aria-label={`${n.name} ${k < 5 ? "low" : "high"}`}
              style={{ "--nc": n.color, height: `${78 - k * 4.5}px` } as React.CSSProperties}
              onClick={() => { update(selected, { note: k }); engine.preview(selected); }}>
              {n.name}
            </button>
          ))}
        </div>

        <p className="sp-label">Speed <small>sings every {pl.interval} {pl.interval === 1 ? "beat" : "beats"}</small></p>
        <div className="sp-speed">
          <span aria-hidden>🐇</span>
          {Array.from({ length: 8 }, (_, k) => (
            <button key={k} className={`sp-dot${pl.interval === k + 1 ? " on" : ""}`} aria-label={`Every ${k + 1} beats`}
              onClick={() => update(selected, { interval: k + 1, offset: Math.min(pl.offset, k) })}>
              {k + 1}
            </button>
          ))}
          <span aria-hidden>🐢</span>
        </div>

        <p className="sp-label">Start later <small>move it around its orbit</small></p>
        <div className="sp-speed">
          {Array.from({ length: pl.interval }, (_, k) => (
            <button key={k} className={`sp-dot${Math.round(pl.offset) === k ? " on" : ""}`} aria-label={`Start ${k} beats later`}
              onClick={() => update(selected, { offset: k })}>
              {k}
            </button>
          ))}
        </div>

        <div className="sp-extras">
          <label className="sp-slider">
            <span>🔊 Loud</span>
            <input type="range" min={0.1} max={1} step={0.05} value={pl.volume}
              onChange={(e) => update(selected, { volume: Number(e.target.value) })} />
          </label>
          <label className="sp-slider">
            <span>🎲 Sings</span>
            <input type="range" min={0.2} max={1} step={0.05} value={pl.chance}
              onChange={(e) => update(selected, { chance: Number(e.target.value) })} />
            <output>{pl.chance >= 0.99 ? "always" : `${Math.round(pl.chance * 100)}%`}</output>
          </label>
          <button className={`sp-pill${pl.wiggle ? " on" : ""}`} onClick={() => update(selected, { wiggle: !pl.wiggle })}>
            <span>✨</span>Wiggle
          </button>
        </div>
      </section>

      <h2 className="group-title">Songs to try</h2>
      <div className="sp-presets">
        {PRESETS.map((pr, k) => (
          <button key={pr.name} className="sp-pill sp-preset" onClick={() => loadPreset(k)}>
            <span>{pr.emoji}</span>{pr.name}
          </button>
        ))}
      </div>
      <p className="group-footer">Grown-ups: each planet is a looping note. Different speeds make polyrhythms. Keys 1–8 wake planets, space plays.</p>
    </main>
  );
}
