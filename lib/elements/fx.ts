// Element textures (Earth, Water, Wind, Fire) that layer on top of any audio in
// Melodrip, like effects. Each audio remembers its own mix; when that audio
// plays, its elements fade in with it, and fade out when it stops.
// Runs in its own AudioContext so it works alongside every feature's engine.

import { useEffect, useState } from "react";
import { combine, drops, fire, NoiseBank, soil, stream, wind, type Layer, type Stop } from "@/lib/present/synth";
import { resumeOnReturn, setPlaybackAudioSession } from "@/lib/therapy/ios";

export type ElementId = "earth" | "water" | "wind" | "fire";
export type ElementMix = Record<ElementId, number>; // 0 off, 0.5 soft, 1 strong

export const ELEMENTS: { id: ElementId; name: string; emoji: string; color: string; layer: Layer }[] = [
  { id: "earth", name: "Earth", emoji: "🪨", color: "#c99a6b", layer: soil },
  { id: "water", name: "Water", emoji: "💧", color: "#6ad0ff", layer: combine(stream, drops(14)) },
  { id: "wind", name: "Wind", emoji: "🌬️", color: "#cfe0ff", layer: wind(480) },
  { id: "fire", name: "Fire", emoji: "🔥", color: "#ff8a4c", layer: fire },
];

const STORE = "melodrip-elements-v1";
const EMPTY: ElementMix = { earth: 0, water: 0, wind: 0, fire: 0 };

class ElementFx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bank: NoiseBank | null = null;
  private live = new Map<ElementId, { gain: GainNode; stop: Stop; preview?: number }>();
  private prefs: Record<string, ElementMix> = {};
  private loaded = false;
  active: string | null = null;
  private listeners = new Set<() => void>();

  private load() {
    if (this.loaded || typeof window === "undefined") return;
    this.loaded = true;
    try {
      this.prefs = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    } catch {}
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    setPlaybackAudioSession();
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC());
    resumeOnReturn(() => this.ctx);
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(c.destination);
    this.bank = new NoiseBank(c);
    return c;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  mix(audioId: string): ElementMix {
    this.load();
    return { ...EMPTY, ...this.prefs[audioId] };
  }

  /** Tap cycle: off → soft → strong → off. */
  cycle(audioId: string, el: ElementId) {
    const cur = this.mix(audioId)[el];
    const next = cur === 0 ? 0.5 : cur === 0.5 ? 1 : 0;
    this.set(audioId, el, next);
    return next;
  }

  set(audioId: string, el: ElementId, level: number) {
    const m = this.mix(audioId);
    m[el] = level;
    this.prefs[audioId] = m;
    try {
      localStorage.setItem(STORE, JSON.stringify(this.prefs));
    } catch {}
    if (this.active === audioId) {
      if (level > 0) this.ensure(); // first element added mid-play: start the element layer now
      this.apply();
    } else if (level > 0) this.preview(el, level); // let them hear it even if the audio isn't playing
    this.emit();
  }

  /** Call when an audio starts (its id) or stops (null). */
  setActive(audioId: string | null) {
    if (audioId === this.active) return;
    this.active = audioId;
    if (audioId && Object.values(this.mix(audioId)).some((v) => v > 0)) this.ensure();
    this.apply();
    this.emit();
  }

  private target(el: ElementId) {
    return this.active ? this.mix(this.active)[el] : 0;
  }

  private apply(fade = 1.2) {
    if (!this.ctx) return;
    void this.ctx.resume();
    for (const e of ELEMENTS) this.level(e.id, this.target(e.id), fade);
  }

  private level(el: ElementId, level: number, fade: number) {
    const c = this.ctx!;
    let node = this.live.get(el);
    if (level > 0 && !node) {
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      gain.connect(this.master!);
      const stop = ELEMENTS.find((e) => e.id === el)!.layer(c, gain, this.bank!);
      node = { gain, stop };
      this.live.set(el, node);
    }
    if (!node) return;
    clearTimeout(node.preview);
    const v = Math.max(0.0001, level * level * 0.45); // texture under the audio, never over it
    node.gain.gain.cancelScheduledValues(c.currentTime);
    node.gain.gain.setTargetAtTime(v, c.currentTime, fade / 3);
    if (level === 0) {
      const n = node;
      n.preview = window.setTimeout(() => {
        n.stop();
        n.gain.disconnect();
        if (this.live.get(el) === n) this.live.delete(el);
      }, fade * 1000 + 400);
    }
  }

  private preview(el: ElementId, level: number) {
    this.ensure();
    void this.ctx!.resume();
    this.level(el, level, 0.3);
    const node = this.live.get(el)!;
    node.preview = window.setTimeout(() => this.level(el, this.target(el), 1), 2600);
  }

  /** Fade every element out (e.g. when a sleep timer ends). */
  fadeAll(seconds = 8) {
    this.active = null;
    if (this.ctx) for (const e of ELEMENTS) this.level(e.id, 0, seconds);
    this.emit();
  }
}

export const elementFx = new ElementFx();

/** React: the element mix for one audio, kept in sync. */
export function useElementMix(audioId: string) {
  const [mix, setMix] = useState<ElementMix>(EMPTY);
  useEffect(() => {
    const update = () => setMix(elementFx.mix(audioId));
    update();
    return elementFx.subscribe(update);
  }, [audioId]);
  return mix;
}

/** React: tell the element layer that this audio is playing (or not). */
export function useElementActive(audioId: string, playing: boolean) {
  useEffect(() => {
    if (playing) elementFx.setActive(audioId);
    else if (elementFx.active === audioId) elementFx.setActive(null);
  }, [audioId, playing]);
  useEffect(() => () => {
    if (elementFx.active === audioId) elementFx.setActive(null);
  }, [audioId]);
}
