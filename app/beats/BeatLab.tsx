"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeatEngine } from "@/lib/beatlab/engine";
import { GrooveModel, type Progress } from "@/lib/beatlab/model";
import { CORPUS, GENRES, GENRE_BPM, N, STEPS, VOICES, decodeCode, encodeCode } from "@/lib/beatlab/patterns";
import type { Ring } from "@/lib/beatlab/ring2d";
import { useWakeLock } from "@/lib/therapy/ios";
import { ElementDial } from "@/app/ElementDial";
import { useElementActive } from "@/lib/elements/fx";

// Beat Lab (from SoundPal): a 16-step drum sequencer drawn as a glowing pop-it ring,
// with a small neural network, trained on the phone, that completes, varies or
// dreams up grooves and shows where it expects the next hit.

const STORE = "melodrip-beatlab-v1";
type Saved = { grid: number[]; bpm: number; swing: number; volume: number; style: number; creativity: number };

const PLAY = "M7 4.5v15l13-7.5z";
const STOP = "M6 5h4.5v14H6zm7.5 0H18v14h-4.5z";

export default function BeatLab() {
  const engine = useMemo(() => new BeatEngine(), []);
  const model = useMemo(() => new GrooveModel(), []);
  const ring = useRef<Ring | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const lossRef = useRef<HTMLCanvasElement>(null);

  const [, setVersion] = useState(0);
  const rerender = useCallback(() => setVersion((n) => n + 1), []);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpmState] = useState(124);
  const [swing, setSwing] = useState(0.12);
  const [volume, setVolume] = useState(0.8);
  const [creativity, setCreativity] = useState(0.45);
  const [style, setStyle] = useState(-1);
  const [showGhosts, setShowGhosts] = useState(true);
  const [preset, setPreset] = useState(1);
  const [code, setCode] = useState("");
  const [toast, setToast] = useState("");
  const [noGl, setNoGl] = useState(false);
  const [ai, setAi] = useState<{ state: "loading" | "training" | "ready" | "off"; text: string }>({
    state: "loading",
    text: "Waking up the groove model…",
  });

  useWakeLock(playing); // iOS stops web audio when the phone auto-locks
  useElementActive("beat-lab", playing); // Earth/Water/Wind/Fire under the beat

  // ---- helpers ----
  const toastTimer = useRef(0);
  const say = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const persistTimer = useRef(0);
  const persist = useCallback(() => {
    clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      try {
        const saved: Saved = {
          grid: Array.from(engine.grid), bpm: engine.bpm, swing: engine.swing, volume: engine.volume,
          style: styleRef.current, creativity: creativityRef.current,
        };
        localStorage.setItem(STORE, JSON.stringify(saved));
      } catch {}
    }, 250);
  }, [engine]);

  // refs mirror state for callbacks that outlive a render
  const styleRef = useRef(style);
  const creativityRef = useRef(creativity);
  styleRef.current = style;
  creativityRef.current = creativity;

  const ghostTimer = useRef(0);
  const refreshGhosts = useCallback(() => {
    clearTimeout(ghostTimer.current);
    ghostTimer.current = window.setTimeout(async () => {
      if (!model.ready) return;
      engine.ghosts = await model.suggestions(engine.grid, styleRef.current);
      rerender();
    }, 60);
  }, [engine, model, rerender]);

  const setBpm = useCallback(
    (v: number) => {
      engine.bpm = v;
      setBpmState(v);
      persist();
    },
    [engine, persist]
  );

  const afterGridChange = useCallback(() => {
    setCode(encodeCode(engine.grid, engine.bpm));
    refreshGhosts();
    persist();
  }, [engine, persist, refreshGhosts]);

  const applyPattern = useCallback(
    (cells: Float32Array<ArrayBufferLike>, message: string, newBpm?: number) => {
      const before = engine.grid;
      engine.setGrid(cells);
      if (newBpm) setBpm(newBpm);
      // pop the new bubbles one after another
      let delay = 0;
      for (let i = 0; i < N; i++) {
        if (cells[i] && !before[i]) {
          const k = i;
          setTimeout(() => ring.current?.popAt(k), delay);
          delay += 18;
        }
      }
      afterGridChange();
      say(message);
    },
    [afterGridChange, engine, say, setBpm]
  );

  const toggleCell = useCallback(
    (i: number) => {
      engine.toggle(i);
      if (engine.grid[i]) ring.current?.popAt(i);
      afterGridChange();
    },
    [afterGridChange, engine]
  );

  const togglePlay = useCallback(() => engine.setPlaying(!engine.playing), [engine]);

  // ---- boot: restore, build the ring, start the model ----
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as Saved | null;
      if (saved?.grid?.length === N) {
        engine.grid = Float32Array.from(saved.grid);
        engine.bpm = saved.bpm ?? 124;
        engine.swing = saved.swing ?? 0.12;
        engine.volume = saved.volume ?? 0.8;
        setStyle(saved.style ?? -1);
        setCreativity(saved.creativity ?? 0.45);
      }
    } catch {}
    const fromHash = decodeCode(window.location.hash.slice(1));
    if (fromHash) {
      engine.grid = fromHash.grid;
      engine.bpm = fromHash.bpm;
    }
    setBpmState(engine.bpm);
    setSwing(engine.swing);
    setVolume(engine.volume);
    setCode(encodeCode(engine.grid, engine.bpm));

    const off = engine.on((e) => {
      if (e === "step") setStep(engine.step);
      else if (e === "play") setPlaying(engine.playing);
      else rerender();
    });

    let cancelled = false;
    void import("@/lib/beatlab/ring2d").then(async ({ createRing }) => {
      if (cancelled || !sceneRef.current || !tipRef.current) return;
      const r = await createRing(sceneRef.current, tipRef.current, engine, {
        toggle: (i) => toggleRef.current(i),
        togglePlay: () => engine.setPlaying(!engine.playing),
      });
      if (cancelled) r?.dispose();
      else if (!r) setNoGl(true);
      else ring.current = r;
    });

    void model
      .start((p: Progress) => {
        if (cancelled) return;
        setAi({ state: "training", text: `Learning ${CORPUS.length} grooves · epoch ${p.epoch}/${p.epochs} · loss ${p.loss.toFixed(3)}` });
        drawLoss(lossRef.current, p.losses);
      })
      .then(({ trained, seconds }) => {
        if (cancelled) return;
        setAi({
          state: "ready",
          text: trained
            ? `Ready · trained on ${CORPUS.length} grooves in ${seconds.toFixed(1)} s, right on this device`
            : "Ready · loaded the model this device trained before",
        });
        drawLoss(lossRef.current, model.losses);
        refreshGhosts();
      })
      .catch(() => {
        if (!cancelled) setAi({ state: "off", text: "The groove model couldn't start here. Everything else still works." });
      });

    return () => {
      cancelled = true;
      off();
      engine.dispose();
      model.dispose();
      ring.current?.dispose();
      ring.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRef = useRef(toggleCell);
  toggleRef.current = toggleCell;

  // ---- AI actions ----
  const complete = useCallback(async () => {
    if (model.ready) applyPattern(await model.complete(engine.grid, style, creativity), "Completed your pattern");
  }, [applyPattern, creativity, engine, model, style]);
  const vary = useCallback(async () => {
    if (model.ready) applyPattern(await model.vary(engine.grid, style, creativity), "Made a variation");
  }, [applyPattern, creativity, engine, model, style]);
  const dream = useCallback(async () => {
    if (!model.ready) return;
    const d = await model.dream(style, creativity);
    applyPattern(d.cells, `Dreamed a ${GENRES[d.genre]} groove`, d.bpm);
  }, [applyPattern, creativity, model, style]);
  const clear = useCallback(() => applyPattern(new Float32Array(N), "Cleared the pattern"), [applyPattern]);

  // keyboard shortcuts (iPad / desktop keyboards)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" && !t.closest("button")) {
        e.preventDefault();
        togglePlay();
      } else if (k === "c") complete();
      else if (k === "v") vary();
      else if (k === "d") dream();
      else if (k === "x") clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [clear, complete, dream, togglePlay, vary]);

  const busy = !model.ready;
  const swingPct = Math.round(50 + swing * 50);

  return (
    <div className="bl">
      <header className="bl-top">
        <Link href="/" className="bl-back" aria-label="Back to Melodrip">
          <span aria-hidden>‹</span> Melodrip
        </Link>
        <div className="bl-brand">
          <h1>
            Beat <span className="serif glow-text">lab</span>
          </h1>
          <span className="eyebrow">Pop-it sequencer · on-device AI</span>
        </div>
        <div className="bl-keys" aria-hidden>
          <span><kbd>Space</kbd>play</span>
          <span><kbd>C</kbd>complete</span>
          <span><kbd>V</kbd>vary</span>
          <span><kbd>D</kbd>dream</span>
          <span><kbd>X</kbd>clear</span>
        </div>
      </header>

      <main className="bl-stage" aria-label="Beat ring">
        <div ref={sceneRef} className="bl-scene" />
        <div ref={tipRef} className="bl-tip" hidden />
        {noGl && <div className="bl-nogl">The ring couldn't be drawn here. The step grid still plays every beat.</div>}
        <div className="bl-readout" aria-hidden>
          <span>Step <strong>{String(step + 1).padStart(2, "0")}</strong>/16</span>
          <span><strong>{bpm}</strong> BPM</span>
          <span>Swing <strong>{swingPct}</strong>%</span>
        </div>
        <p className="bl-hint">Tap a bubble to pop it · tap the core to play</p>
      </main>

      <aside className="bl-rail" aria-label="Controls">
        <section className="bl-card bl-transport" aria-label="Transport">
          <button className="bl-play" onClick={togglePlay} aria-label={playing ? "Stop" : "Play"}>
            <svg viewBox="0 0 24 24" aria-hidden><path d={playing ? STOP : PLAY} /></svg>
          </button>
          <span className="bl-elements"><ElementDial audioId="beat-lab" label="Beat Lab" size={34} /></span>
          <div className="bl-dials">
            <Dial label="Tempo" min={60} max={180} step={1} value={bpm} out={String(bpm)}
              onChange={(v) => { setBpm(v); setCode(encodeCode(engine.grid, v)); }} />
            <Dial label="Swing" min={0} max={0.5} step={0.01} value={swing} out={`${swingPct}%`}
              onChange={(v) => { engine.swing = v; setSwing(v); persist(); }} />
            <Dial label="Volume" min={0} max={1} step={0.01} value={volume} out={String(Math.round(volume * 100))}
              onChange={(v) => { engine.setVolume(v); setVolume(v); persist(); }} />
          </div>
        </section>

        <section className="bl-card" aria-label="Pattern">
          <h2 className="bl-h">Pattern <small>16 steps · 1 bar</small></h2>
          <div className="bl-grid">
            {VOICES.map((voice, v) => (
              <div key={voice.id} className="bl-track" style={{ "--c": voice.color } as React.CSSProperties}>
                <span className="bl-track-name"><span className="bl-swatch" />{voice.name}</span>
                <span className="bl-ms">
                  <button aria-pressed={engine.mute[v]} aria-label={`Mute ${voice.name}`}
                    onClick={() => { engine.mute[v] = !engine.mute[v]; rerender(); }}>M</button>
                  <button aria-pressed={engine.solo[v]} aria-label={`Solo ${voice.name}`}
                    onClick={() => { engine.solo[v] = !engine.solo[v]; rerender(); }}>S</button>
                </span>
                <span className="bl-cells">
                  {Array.from({ length: STEPS }, (_, s) => {
                    const i = v * STEPS + s;
                    const on = !!engine.grid[i];
                    const g = showGhosts && !on ? engine.ghosts[i] : 0;
                    return (
                      <button key={s} className={`bl-cell${playing && s === step ? " now" : ""}`} aria-pressed={on}
                        aria-label={`${voice.name} step ${s + 1}${on ? ", on" : ""}`}
                        style={{ "--g": g.toFixed(2) } as React.CSSProperties} onClick={() => toggleCell(i)} />
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="bl-card" aria-label="Groove model">
          <h2 className="bl-h">
            Groove model <small className={`bl-badge bl-badge-${ai.state}`}>{ai.state === "loading" ? "starting" : ai.state}</small>
          </h2>
          <p className="bl-note">
            A small neural network learns 24 classic grooves right here on your phone. It completes your pattern, varies
            it, or dreams up a new one, and lights up the bubbles where it expects the next hit.
          </p>
          <div className="bl-ai">
            <span>{ai.text}</span>
            <canvas ref={lossRef} className="bl-loss" aria-label="Training loss curve" />
          </div>
          <select className="bl-select" value={style} aria-label="Style for the groove model"
            onChange={(e) => { setStyle(Number(e.target.value)); styleRef.current = Number(e.target.value); persist(); refreshGhosts(); }}>
            <option value={-1}>Style: any</option>
            {GENRES.map((g, i) => <option key={g} value={i}>Style: {g}</option>)}
          </select>
          <Dial label="Creativity" min={0} max={1} step={0.01} value={creativity} out={String(Math.round(creativity * 100))}
            onChange={(v) => { setCreativity(v); persist(); }} />
          <div className="bl-row">
            <button className="bl-btn bl-primary" disabled={busy} onClick={complete}>Complete</button>
            <button className="bl-btn" disabled={busy} onClick={vary}>Vary</button>
            <button className="bl-btn" disabled={busy} onClick={dream}>Dream</button>
          </div>
          <label className="bl-check">
            <input type="checkbox" checked={showGhosts}
              onChange={(e) => { setShowGhosts(e.target.checked); engine.showGhosts = e.target.checked; }} />
            Show the model&apos;s suggestions
          </label>
        </section>

        <section className="bl-card" aria-label="Library">
          <h2 className="bl-h">Library</h2>
          <div className="bl-row">
            <select className="bl-select" value={preset} aria-label="Preset groove" onChange={(e) => setPreset(Number(e.target.value))}>
              {GENRES.map((g, gi) => (
                <optgroup key={g} label={`${g} · ${GENRE_BPM[gi]} BPM`}>
                  {CORPUS.map((p, i) => (p.g === gi ? <option key={p.name} value={i}>{p.name}</option> : null))}
                </optgroup>
              ))}
            </select>
            <button className="bl-btn" onClick={() => { const p = CORPUS[preset]; applyPattern(Float32Array.from(p.cells), `Loaded ${p.name}`, GENRE_BPM[p.g]); }}>Load</button>
            <button className="bl-btn" onClick={clear}>Clear</button>
          </div>
          <div className="bl-row">
            <input className="bl-code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Pattern code"
              spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" />
            <button className="bl-btn" onClick={async () => {
              const c = encodeCode(engine.grid, engine.bpm);
              setCode(c);
              try { await navigator.clipboard.writeText(c); say("Copied the pattern code"); } catch { say("Select the code and copy it"); }
            }}>Copy</button>
            <button className="bl-btn" onClick={() => {
              const d = decodeCode(code);
              if (!d) say("That code doesn't look right. Codes start with sp- and have 20 letters and digits.");
              else applyPattern(d.grid, "Opened the pattern code", d.bpm);
            }}>Open</button>
          </div>
          <p className="bl-toast" role="status">{toast}</p>
        </section>
      </aside>
    </div>
  );
}

function Dial(props: { label: string; min: number; max: number; step: number; value: number; out: string; onChange: (v: number) => void }) {
  return (
    <label className="bl-dial">
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))} />
      <output>{props.out}</output>
    </label>
  );
}

function drawLoss(c: HTMLCanvasElement | null, losses: number[]) {
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth || 320;
  const h = c.clientHeight || 40;
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (losses.length < 2) return;
  const hi = Math.max(...losses);
  const lo = Math.min(...losses);
  const span = hi - lo || 1;
  const pts = losses.map((l, i) => [(i / (losses.length - 1)) * (w - 4) + 2, 4 + (1 - (l - lo) / span) * (h - 8)]);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#8d94ff");
  grad.addColorStop(1, "#ff8fd8");
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineTo(pts[pts.length - 1][0], h);
  ctx.lineTo(pts[0][0], h);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 143, 216, 0.12)";
  ctx.fill();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const [ex, ey] = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(ex, ey, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ff8fd8";
  ctx.shadowColor = "#ff8fd8";
  ctx.shadowBlur = 8;
  ctx.fill();
}
