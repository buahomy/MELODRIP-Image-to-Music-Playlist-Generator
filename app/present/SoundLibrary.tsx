"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SECTIONS, type Section, type Sound } from "@/lib/present/library";
import { PresentPlayer } from "@/lib/present/player";
import { useWakeLock } from "@/lib/therapy/ios";

// The Present sound library: therapy soundscapes by section, each with its own
// mix of layers (a slider per layer), a drift mode, a sleep timer and volume.
// Mixes are remembered per sound on this device.

const STORE = "melodrip-present-v1";
type Saved = { levels: Record<string, number[]>; tunes: Record<string, number>; volume: number };
const TIMERS = [0, 15, 30, 60];

export function SoundLibrary({ onOpenScene }: { onOpenScene: (s: "headache" | "sleep") => void }) {
  const player = useMemo(() => new PresentPlayer(), []);
  const [current, setCurrent] = useState<{ sound: Sound; section: Section } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [tune, setTune] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [drift, setDrift] = useState(false);
  const [timer, setTimer] = useState(0);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Saved>({ levels: {}, tunes: {}, volume: 0.8 });

  useWakeLock(playing); // iOS stops web audio when the phone auto-locks

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Saved | null;
      if (s) {
        setSaved({ levels: s.levels ?? {}, tunes: s.tunes ?? {}, volume: s.volume ?? 0.8 });
        setVolume(s.volume ?? 0.8);
        player.setVolume(s.volume ?? 0.8);
      }
    } catch {}
    return () => player.stop(0.4);
  }, [player]);

  const persist = useCallback((next: Saved) => {
    setSaved(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  }, []);

  function start(sound: Sound, section: Section) {
    if (current?.sound.id === sound.id && playing) {
      player.stop();
      setPlaying(false);
      return;
    }
    const t = saved.tunes[sound.id] ?? sound.tune?.value ?? 0;
    player.play(sound, t, saved.levels[sound.id]);
    setCurrent({ sound, section });
    setLevels([...player.levels]);
    setTune(t);
    setPlaying(true);
  }

  function togglePlay() {
    if (!current) return;
    if (playing) {
      player.stop();
      setPlaying(false);
    } else {
      player.play(current.sound, tune, levels);
      setPlaying(true);
      if (timer) player.setSleepTimer(timer, () => setPlaying(false));
    }
  }

  function changeLevel(i: number, v: number) {
    if (!current) return;
    player.setLevel(i, v);
    const next = [...levels];
    next[i] = v;
    setLevels(next);
    persist({ ...saved, levels: { ...saved.levels, [current.sound.id]: next } });
  }

  function changeTune(v: number) {
    if (!current) return;
    setTune(v);
    persist({ ...saved, tunes: { ...saved.tunes, [current.sound.id]: v } });
  }

  function commitTune() {
    if (playing) player.retune(tune);
  }

  function chooseTimer(m: number) {
    setTimer(m);
    player.setSleepTimer(m, () => setPlaying(false));
  }

  return (
    <div className={`pl${current ? " pl-has-dock" : ""}`}>
      <h2 className="group-title">Sound library</h2>
      <p className="pl-intro">
        Soundscapes for sleep, calm, focus and more, all made live on your phone. Tap one to play, then open the mix to
        shape it.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.id} className="pl-section" aria-labelledby={`pl-${section.id}`}>
          <div className="pl-head">
            <span className="pl-head-emoji" aria-hidden>{section.emoji}</span>
            <div>
              <h3 id={`pl-${section.id}`}>{section.title}</h3>
              <p>{section.blurb}</p>
            </div>
          </div>
          <div className="pl-row">
            {section.sounds.map((sound) => {
              const active = current?.sound.id === sound.id && current.section.id === section.id;
              return (
                <button key={sound.id} className={`pl-tile${active ? " active" : ""}${active && playing ? " playing" : ""}`}
                  onClick={() => start(sound, section)} aria-pressed={active && playing}>
                  <span className="pl-tile-top">
                    <span className="pl-tile-emoji" aria-hidden>{sound.emoji}</span>
                    {active && playing ? <Eq /> : sound.headphones ? <span className="pl-badge" title="Best with headphones">🎧</span> : null}
                  </span>
                  <span className="pl-tile-name">{sound.name}</span>
                  <span className="pl-tile-blurb">{sound.blurb}</span>
                </button>
              );
            })}
            {section.scene && (
              <button className="pl-tile pl-scene" onClick={() => { player.stop(0.3); setPlaying(false); onOpenScene(section.scene!); }}>
                <span className="pl-tile-top"><span className="pl-tile-emoji" aria-hidden>{section.scene === "sleep" ? "🏛️" : "☸️"}</span></span>
                <span className="pl-tile-name">{section.scene === "sleep" ? "Sunken Temple" : "Singing Bowl"}</span>
                <span className="pl-tile-blurb">Open the full-screen scene ›</span>
              </button>
            )}
          </div>
        </section>
      ))}

      {current && (
        <div className={`pl-dock${open ? " open" : ""}`} role="region" aria-label="Now playing">
          <div className="pl-dock-bar">
            <button className="pl-dock-info" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span className="pl-dock-emoji" aria-hidden>{current.sound.emoji}</span>
              <span className="pl-dock-text">
                <span className="pl-dock-name">{current.sound.name}</span>
                <span className="pl-dock-sec">{current.section.title}{current.sound.headphones ? " · 🎧 headphones" : ""}</span>
              </span>
              <span className="pl-dock-mix">{open ? "Done" : "Mix"}</span>
            </button>
            <button className="pl-dock-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              <svg viewBox="0 0 24 24" aria-hidden><path d={playing ? "M6 5h4.5v14H6zm7.5 0H18v14h-4.5z" : "M7 4.5v15l13-7.5z"} /></svg>
            </button>
          </div>

          {open && (
            <div className="pl-mix">
              {current.sound.tune && (
                <label className="pl-slider pl-tune">
                  <span>{current.sound.tune.label}</span>
                  <input type="range" min={current.sound.tune.min} max={current.sound.tune.max} step={current.sound.tune.step}
                    value={tune} onChange={(e) => changeTune(Number(e.target.value))} onPointerUp={commitTune} onKeyUp={commitTune} onTouchEnd={commitTune} />
                  <output>{tune.toLocaleString()} {current.sound.tune.unit}</output>
                </label>
              )}
              {current.sound.build(tune).map((d, i) => (
                <label key={d.name} className="pl-slider">
                  <span>{d.name}</span>
                  <input type="range" min={0} max={1} step={0.01} value={levels[i] ?? d.level}
                    onChange={(e) => changeLevel(i, Number(e.target.value))} />
                  <output>{Math.round((levels[i] ?? d.level) * 100)}</output>
                </label>
              ))}
              <div className="pl-controls">
                <button className={`pl-chip${drift ? " on" : ""}`} onClick={() => { setDrift(!drift); player.setDrift(!drift); }}>
                  ✨ Drift
                </button>
                <span className="pl-timer" role="group" aria-label="Sleep timer">
                  <span aria-hidden>⏱</span>
                  {TIMERS.map((m) => (
                    <button key={m} className={`pl-chip${timer === m ? " on" : ""}`} onClick={() => chooseTimer(m)}>
                      {m ? `${m}m` : "Off"}
                    </button>
                  ))}
                </span>
              </div>
              <label className="pl-slider">
                <span>🔊 Volume</span>
                <input type="range" min={0} max={1} step={0.01} value={volume}
                  onChange={(e) => { const v = Number(e.target.value); setVolume(v); player.setVolume(v); persist({ ...saved, volume: v }); }} />
                <output>{Math.round(volume * 100)}</output>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Eq() {
  return (
    <span className="pl-eq" aria-hidden>
      <i /><i /><i />
    </span>
  );
}
