"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ElementDial } from "@/app/ElementDial";
import { ELEMENTS, elementFx, useElementActive } from "@/lib/elements/fx";
import {
  ACTIVITIES, FEELINGS, MOOD_COLORS, SECTIONS, STUDY_PLAYLIST, recommend, sectionOf, type Sound,
} from "@/lib/present/library";
import { PresentPlayer } from "@/lib/present/player";
import { useWakeLock } from "@/lib/therapy/ios";

// Present's audio hub: a mood board that points you to the right sound,
// frequencies for activities (with a study playlist), and the sound library.
// One player and one now-playing dock serve all three. Every audio has an
// element orb for layering Earth, Water, Wind or Fire on top.

const STORE = "melodrip-present-v1";
type Saved = { levels: Record<string, number[]>; tunes: Record<string, number>; volume: number };
type Current = { sound: Sound; where: string; key: string };
const TIMERS = [0, 15, 30, 60];

export function SoundLibrary({ onOpenScene }: { onOpenScene: (s: "headache" | "sleep") => void }) {
  const player = useMemo(() => new PresentPlayer(), []);
  const [current, setCurrent] = useState<Current | null>(null);
  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState<number[]>([]);
  const [tune, setTune] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [drift, setDrift] = useState(false);
  const [timer, setTimer] = useState(0);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Saved>({ levels: {}, tunes: {}, volume: 0.8 });
  const [flash, setFlash] = useState<string | null>(null);

  useWakeLock(playing); // iOS stops web audio when the phone auto-locks
  useElementActive(current?.sound.id ?? "none", playing); // elements follow the playing sound

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

  const start = useCallback(
    (sound: Sound, where: string, key: string) => {
      if (current?.key === key && playing) {
        player.stop();
        setPlaying(false);
        return;
      }
      const t = saved.tunes[sound.id] ?? sound.tune?.value ?? 0;
      player.play(sound, t, saved.levels[sound.id]);
      setCurrent({ sound, where, key });
      setLevels([...player.levels]);
      setTune(t);
      setPlaying(true);
      if (timer) player.setSleepTimer(timer, () => { setPlaying(false); elementFx.fadeAll(); });
    },
    [current, playing, player, saved, timer]
  );

  /** Jump to a sound's tile in the library, glow it, and play it. */
  const goTo = useCallback(
    (sound: Sound) => {
      const section = sectionOf(sound.id);
      const key = `${section.id}:${sound.id}`;
      document.getElementById(`tile-${section.id}-${sound.id}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      setFlash(key);
      window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 2400);
      if (!(current?.key === key && playing)) start(sound, section.title, key);
    },
    [current, playing, start]
  );

  function togglePlay() {
    if (!current) return;
    if (playing) {
      player.stop();
      setPlaying(false);
    } else {
      player.play(current.sound, tune, levels);
      setPlaying(true);
      if (timer) player.setSleepTimer(timer, () => { setPlaying(false); elementFx.fadeAll(); });
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

  function chooseTimer(m: number) {
    setTimer(m);
    player.setSleepTimer(m, () => { setPlaying(false); elementFx.fadeAll(); });
  }

  const isOn = (key: string) => current?.key === key && playing;

  return (
    <div className={`pl${current ? " pl-has-dock" : ""}`}>
      <MoodBoard onPick={goTo} playingId={playing ? current?.sound.id : undefined} />

      {/* ---- frequencies for activities ---- */}
      <h2 className="group-title" id="frequencies">Frequencies for what you&apos;re doing</h2>
      <p className="pl-intro">
        Tones and brainwave bands people use to meditate, study, create and sleep. Brainwave beats work best with headphones.
      </p>
      <div className="fq-grid">
        {ACTIVITIES.map((a) => {
          const key = `act:${a.id}`;
          return (
            <div key={a.id} className={`fq-card${isOn(key) ? " playing" : ""}`}>
              <button className="fq-main" onClick={() => start(a.sound, "Frequencies", key)} aria-pressed={isOn(key)}>
                <span className="fq-emoji" aria-hidden>{a.emoji}</span>
                <span className="fq-band">{a.band}</span>
                <span className="fq-title">{a.title}</span>
                <span className="fq-purpose">{a.purpose}</span>
                <span className="fq-play" aria-hidden>{isOn(key) ? <Eq /> : "▶"}</span>
              </button>
              <span className="fq-dial"><ElementDial audioId={a.sound.id} label={a.title} size={26} /></span>
            </div>
          );
        })}
      </div>
      <div className="fq-playlist">
        <div className="fq-playlist-head">
          <span className="eyebrow">Study playlist · Spotify</span>
          <a href={STUDY_PLAYLIST.url} target="_blank" rel="noreferrer">Open in Spotify ›</a>
        </div>
        <iframe title={`${STUDY_PLAYLIST.title} playlist on Spotify`} src={STUDY_PLAYLIST.embed} loading="lazy" height="352"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
      </div>
      <p className="group-footer">
        Frequency effects come from sound-healing traditions and early research and vary from person to person.
      </p>

      {/* ---- library ---- */}
      <h2 className="group-title">Sound library</h2>
      <p className="pl-intro">
        Soundscapes for sleep, calm, focus and more, all made live on your phone. Tap one to play; tap its little orb to add
        Earth, Water, Wind or Fire on top.
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
              const key = `${section.id}:${sound.id}`;
              const active = current?.key === key;
              return (
                <div key={sound.id} id={`tile-${section.id}-${sound.id}`}
                  className={`pl-tile${active ? " active" : ""}${active && playing ? " playing" : ""}${flash === key ? " flash" : ""}`}>
                  <button className="pl-tile-main" onClick={() => start(sound, section.title, key)} aria-pressed={active && playing}>
                    <span className="pl-tile-top">
                      <span className="pl-tile-emoji" aria-hidden>{sound.emoji}</span>
                      {active && playing ? <Eq /> : sound.headphones ? <span className="pl-badge" title="Best with headphones">🎧</span> : null}
                    </span>
                    <span className="pl-tile-name">{sound.name}</span>
                    <span className="pl-tile-blurb">{sound.blurb}</span>
                  </button>
                  <span className="pl-tile-dial"><ElementDial audioId={sound.id} label={sound.name} size={24} /></span>
                </div>
              );
            })}
            {section.scene && (
              <div className="pl-tile pl-scene">
                <button className="pl-tile-main" onClick={() => { player.stop(0.3); setPlaying(false); onOpenScene(section.scene!); }}>
                  <span className="pl-tile-top"><span className="pl-tile-emoji" aria-hidden>{section.scene === "sleep" ? "🏛️" : "☸️"}</span></span>
                  <span className="pl-tile-name">{section.scene === "sleep" ? "Sunken Temple" : "Singing Bowl"}</span>
                  <span className="pl-tile-blurb">Open the full-screen scene ›</span>
                </button>
              </div>
            )}
          </div>
        </section>
      ))}

      {/* ---- now playing ---- */}
      {current && (
        <div className={`pl-dock${open ? " open" : ""}`} role="region" aria-label="Now playing">
          <div className="pl-dock-bar">
            <button className="pl-dock-info" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span className="pl-dock-emoji" aria-hidden>{current.sound.emoji}</span>
              <span className="pl-dock-text">
                <span className="pl-dock-name">{current.sound.name}</span>
                <span className="pl-dock-sec">{current.where}{current.sound.headphones ? " · 🎧 headphones" : ""}</span>
              </span>
              <span className="pl-dock-mix">{open ? "Done" : "Mix"}</span>
            </button>
            <ElementDial audioId={current.sound.id} label={current.sound.name} size={34} />
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
                    value={tune} onChange={(e) => changeTune(Number(e.target.value))}
                    onPointerUp={() => playing && player.retune(tune)} onKeyUp={() => playing && player.retune(tune)}
                    onTouchEnd={() => playing && player.retune(tune)} />
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

// ======================= mood board =======================

const STICKER_SPOTS = [
  [12, 22, -8], [62, 14, 6], [38, 48, -4], [78, 52, 10], [18, 70, 7], [56, 74, -9], [84, 24, -5], [30, 30, 12],
];

function MoodBoard({ onPick, playingId }: { onPick: (s: Sound) => void; playingId?: string }) {
  const [colors, setColors] = useState<string[]>([]);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [energy, setEnergy] = useState(0.5);
  const [shown, setShown] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const picks = useMemo(() => recommend(feelings, colors, energy), [feelings, colors, energy]);
  const chosenColors = MOOD_COLORS.filter((c) => colors.includes(c.id));
  const chosenFeelings = FEELINGS.filter((f) => feelings.includes(f.id));
  const element = ELEMENTS.find((e) => e.id === chosenColors[0]?.element);
  const activity = ACTIVITIES.find((a) => a.id === chosenFeelings.find((f) => f.activity)?.activity);

  const toggle = (list: string[], set: (v: string[]) => void, id: string, max: number) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-max));
    setShown(false);
  };

  const boardBg = chosenColors.length
    ? `radial-gradient(60% 70% at 20% 25%, ${chosenColors[0].hex}cc, transparent 70%),` +
      (chosenColors[1] ? `radial-gradient(60% 70% at 80% 30%, ${chosenColors[1].hex}bb, transparent 70%),` : "") +
      (chosenColors[2] ? `radial-gradient(70% 60% at 50% 90%, ${chosenColors[2].hex}aa, transparent 70%),` : "") +
      "linear-gradient(160deg, #2a1670, #120a3a)"
    : undefined;

  return (
    <section className="mb" aria-labelledby="mb-title">
      <h2 className="group-title" id="mb-title">Mood board</h2>
      <div className="mb-board" style={{ background: boardBg }} aria-hidden>
        {chosenFeelings.length === 0 && chosenColors.length === 0 && (
          <p className="mb-empty">Pick colours and feelings below.<br />Your board fills up as you go.</p>
        )}
        {chosenFeelings.map((f, i) => {
          const [x, y, r] = STICKER_SPOTS[i % STICKER_SPOTS.length];
          return (
            <span key={f.id} className="mb-sticker" style={{ left: `${x}%`, top: `${y}%`, transform: `rotate(${r}deg)` }}>
              <span>{f.emoji}</span>{f.label}
            </span>
          );
        })}
        <span className="mb-energy" style={{ left: `${8 + energy * 84}%` }}>{energy < 0.33 ? "🔋 drained" : energy > 0.66 ? "⚡ wired" : "〰️ steady"}</span>
      </div>

      <p className="mb-label">What colour is your mood? <small>up to 3</small></p>
      <div className="mb-colors">
        {MOOD_COLORS.map((c) => (
          <button key={c.id} className={`mb-swatch${colors.includes(c.id) ? " on" : ""}`} style={{ "--mc": c.hex } as React.CSSProperties}
            aria-pressed={colors.includes(c.id)} aria-label={c.name} onClick={() => toggle(colors, setColors, c.id, 3)} />
        ))}
      </div>

      <p className="mb-label">How do you feel? <small>pick any</small></p>
      <div className="mb-feelings">
        {FEELINGS.map((f) => (
          <button key={f.id} className={`mb-feel${feelings.includes(f.id) ? " on" : ""}`} aria-pressed={feelings.includes(f.id)}
            onClick={() => toggle(feelings, setFeelings, f.id, 4)}>
            <span aria-hidden>{f.emoji}</span>{f.label}
          </button>
        ))}
      </div>

      <label className="mb-energy-slider">
        <span>🔋</span>
        <input type="range" min={0} max={1} step={0.01} value={energy} aria-label="Energy: drained to wired"
          onChange={(e) => { setEnergy(Number(e.target.value)); setShown(false); }} />
        <span>⚡</span>
      </label>

      <button className="primary mb-go" disabled={!feelings.length && !colors.length}
        onClick={() => { setShown(true); requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })); }}>
        Find my sound
      </button>

      {shown && picks.length > 0 && (
        <div ref={resultRef} className="mb-results">
          <p className="mb-label">Made for how you feel</p>
          {picks.map((s, i) => (
            <button key={s.id} className={`mb-pick${playingId === s.id ? " playing" : ""}`} onClick={() => onPick(s)}>
              <span className="mb-pick-rank">{i === 0 ? "Best match" : `#${i + 1}`}</span>
              <span className="mb-pick-emoji" aria-hidden>{s.emoji}</span>
              <span className="mb-pick-text">
                <span className="mb-pick-name">{s.name}</span>
                <span className="mb-pick-sec">{sectionOf(s.id).title} · {s.blurb}</span>
              </span>
              <span className="mb-pick-go" aria-hidden>{playingId === s.id ? <Eq /> : "▶"}</span>
            </button>
          ))}
          {element && picks[0] && (
            <button className="mb-element" style={{ "--ec": element.color } as React.CSSProperties}
              onClick={() => { elementFx.set(picks[0].id, element.id, 0.5); onPick(picks[0]); }}>
              <span aria-hidden>{element.emoji}</span>
              <span className="mb-hint">Your colour feels like <b>{element.name}</b>. Add it to {picks[0].name}</span>
            </button>
          )}
          {activity && (
            <a className="mb-activity" href="#frequencies">
              <span aria-hidden>{activity.emoji}</span>
              <span className="mb-hint">Also try <b>{activity.title}</b> ({activity.band}) in Frequencies ›</span>
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function Eq() {
  return (
    <span className="pl-eq" aria-hidden>
      <i /><i /><i />
    </span>
  );
}
