// Plays one Present soundscape at a time: builds its layers, gives each its own
// level, fades in and out, can slowly "drift" the mix so it never feels static,
// and has a sleep timer. iPhone-safe (silent switch, resume after interruption).

import { resumeOnReturn, setPlaybackAudioSession } from "@/lib/therapy/ios";
import type { Sound } from "./library";
import { NoiseBank, type Stop } from "./synth";

type Running = { sound: Sound; tune: number; gains: GainNode[]; stops: Stop[]; bus: GainNode };

export class PresentPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bank: NoiseBank | null = null;
  private running: Running | null = null;
  levels: number[] = [];
  volume = 0.8;
  drift = false;
  private driftTimer = 0;
  private sleepTimer = 0;

  get current() {
    return this.running?.sound ?? null;
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    setPlaybackAudioSession(); // play even with the iPhone on silent
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC());
    resumeOnReturn(() => this.ctx);
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(c.destination);
    this.bank = new NoiseBank(c);
    return c;
  }

  /** Start a sound (stopping any other). `levels` restores a saved mix. */
  play(sound: Sound, tune?: number, levels?: number[]) {
    const c = this.ensure();
    void c.resume();
    this.fadeOutCurrent(0.6);
    const t = tune ?? sound.tune?.value ?? 0;
    const defs = sound.build(t);
    this.levels = levels && levels.length === defs.length ? [...levels] : defs.map((d) => d.level);
    const bus = c.createGain();
    bus.gain.setValueAtTime(0.0001, c.currentTime);
    bus.gain.exponentialRampToValueAtTime(1, c.currentTime + 1.5);
    bus.connect(this.master!);
    const gains: GainNode[] = [];
    const stops: Stop[] = [];
    defs.forEach((d, i) => {
      const g = c.createGain();
      g.gain.value = this.levels[i] ** 2; // squared: sliders feel even to the ear
      g.connect(bus);
      gains.push(g);
      stops.push(d.layer(c, g, this.bank!));
    });
    this.running = { sound, tune: t, gains, stops, bus };
    if (this.drift) this.startDrift();
  }

  /** Change the sound's one adjustable setting (rebuilds it, keeping the mix). */
  retune(value: number) {
    if (this.running) this.play(this.running.sound, value, this.levels);
  }

  setLevel(i: number, v: number) {
    this.levels[i] = v;
    const g = this.running?.gains[i];
    if (g && this.ctx) g.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.08);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Slowly wander each layer around where you set it, like a living soundscape. */
  setDrift(on: boolean) {
    this.drift = on;
    if (on) this.startDrift();
    else {
      clearInterval(this.driftTimer);
      this.running?.gains.forEach((g, i) => this.ctx && g.gain.setTargetAtTime(this.levels[i] ** 2, this.ctx.currentTime, 1.5));
    }
  }
  private startDrift() {
    clearInterval(this.driftTimer);
    const wander = () => {
      if (!this.running || !this.ctx) return;
      this.running.gains.forEach((g, i) => {
        const base = this.levels[i];
        if (base <= 0.01) return;
        const v = Math.min(1, Math.max(0, base * (0.55 + Math.random() * 0.75)));
        g.gain.setTargetAtTime(v * v, this.ctx!.currentTime, 2.5);
      });
    };
    wander();
    this.driftTimer = window.setInterval(wander, 6000);
  }

  /** Fade out and stop after `minutes` (0 cancels). */
  setSleepTimer(minutes: number, onDone: () => void) {
    clearTimeout(this.sleepTimer);
    if (minutes > 0) this.sleepTimer = window.setTimeout(() => { this.stop(12); onDone(); }, minutes * 60_000);
  }

  private fadeOutCurrent(seconds: number) {
    const r = this.running;
    if (!r || !this.ctx) return;
    this.running = null;
    const now = this.ctx.currentTime;
    r.bus.gain.cancelScheduledValues(now);
    r.bus.gain.setValueAtTime(Math.max(0.0001, r.bus.gain.value), now);
    r.bus.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    window.setTimeout(() => {
      r.stops.forEach((s) => { try { s(); } catch {} });
      r.bus.disconnect();
    }, seconds * 1000 + 100);
  }

  stop(fadeSeconds = 0.8) {
    clearInterval(this.driftTimer);
    clearTimeout(this.sleepTimer);
    this.fadeOutCurrent(fadeSeconds);
  }

  get playing() {
    return this.running !== null;
  }
}
