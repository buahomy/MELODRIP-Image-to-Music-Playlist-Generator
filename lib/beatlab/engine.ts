// Beat Lab audio: a synthesised five-piece drum kit and a look-ahead Web Audio
// scheduler, plus the shared pattern state that the 3D ring and the React
// controls both read. No samples are loaded.

import { resumeOnReturn, setPlaybackAudioSession } from "@/lib/therapy/ios";
import { CORPUS, N, STEPS, VOICES } from "./patterns";

type Hit = { v: number; s: number; t: number };
type Tick = { s: number; t: number };
export type EngineEvent = "grid" | "step" | "play" | "ghosts" | "settings";

class Kit {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wave = new Uint8Array(512);
  private noise: AudioBuffer | null = null;
  private open: GainNode | null = null;

  ensure(volume: number): AudioContext {
    if (this.ctx) return this.ctx;
    setPlaybackAudioSession(); // play even with the iPhone on silent
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC());
    resumeOnReturn(() => this.ctx);
    this.master = c.createGain();
    this.master.gain.value = volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(comp).connect(this.analyser).connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return c;
  }

  private env(g: GainNode, t: number, peak: number, decay: number, attack = 0.002) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  private noiseThrough(t: number, dur: number, type: BiquadFilterType, freq: number, q = 0.7) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur);
    return g;
  }

  play(v: number, t: number) {
    const c = this.ctx;
    if (!c || !this.master) return;
    if (v === 0) {
      // kick: pitch-dropping sine plus a short click
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(155, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      o.connect(g).connect(this.master);
      this.env(g, t, 1, 0.42, 0.004);
      o.start(t);
      o.stop(t + 0.45);
      this.env(this.noiseThrough(t, 0.03, "highpass", 3200), t, 0.22, 0.015);
    } else if (v === 1) {
      // snare: noise body and a tuned tone
      this.env(this.noiseThrough(t, 0.25, "highpass", 1300), t, 0.55, 0.2);
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      o.connect(g).connect(this.master);
      this.env(g, t, 0.45, 0.1);
      o.start(t);
      o.stop(t + 0.12);
    } else if (v === 2) {
      // clap: three quick bursts and a tail
      const g = this.noiseThrough(t, 0.4, "bandpass", 1150, 0.9);
      g.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 3; k++) {
        const tk = t + k * 0.012;
        g.gain.setValueAtTime(0.75, tk);
        g.gain.exponentialRampToValueAtTime(0.06, tk + 0.01);
      }
      g.gain.setValueAtTime(0.65, t + 0.036);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    } else if (v === 3) {
      // open hat
      this.open = this.noiseThrough(t, 0.45, "highpass", 7400);
      this.env(this.open, t, 0.32, 0.38);
    } else {
      // closed hat, which chokes a ringing open hat
      if (this.open) {
        this.open.gain.cancelScheduledValues(t);
        this.open.gain.setTargetAtTime(0.0001, t, 0.008);
        this.open = null;
      }
      this.env(this.noiseThrough(t, 0.08, "highpass", 8200), t, 0.26, 0.05);
    }
  }

  /** RMS output level, 0..~0.5, for the glowing core. */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.wave);
    let sum = 0;
    for (const x of this.wave) {
      const y = (x - 128) / 128;
      sum += y * y;
    }
    return Math.sqrt(sum / this.wave.length);
  }
}

export class BeatEngine {
  grid: Float32Array<ArrayBufferLike> = Float32Array.from(CORPUS[1].cells);
  ghosts: Float32Array<ArrayBufferLike> = new Float32Array(N);
  bpm = 124;
  swing = 0.12;
  volume = 0.8;
  mute = VOICES.map(() => false);
  solo = VOICES.map(() => false);
  showGhosts = true;
  playing = false;
  step = 0;

  readonly kit = new Kit();
  readonly hits: Hit[] = []; // scheduled hits, consumed by the visuals
  readonly ticks: Tick[] = []; // scheduled step boundaries
  private timer = 0;
  private nextTime = 0;
  private nextStep = 0;
  private listeners = new Set<(e: EngineEvent) => void>();

  on(fn: (e: EngineEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: EngineEvent) {
    for (const fn of this.listeners) fn(e);
  }

  stepDur() {
    return 60 / this.bpm / 4;
  }
  audible(v: number) {
    return !this.mute[v] && (!this.solo.some(Boolean) || this.solo[v]);
  }

  private schedule = () => {
    const c = this.kit.ctx!;
    while (this.nextTime < c.currentTime + 0.12) {
      const s = this.nextStep;
      const base = this.nextTime;
      const t = base + (s % 2 === 1 ? this.stepDur() * this.swing : 0);
      for (let v = 0; v < VOICES.length; v++) {
        if (this.grid[v * STEPS + s] && this.audible(v)) {
          this.kit.play(v, t);
          this.hits.push({ v, s, t });
        }
      }
      this.ticks.push({ s, t: base });
      this.nextTime += this.stepDur();
      this.nextStep = (s + 1) % STEPS;
    }
  };

  setPlaying(on: boolean) {
    if (on === this.playing) return;
    this.playing = on;
    if (on) {
      const c = this.kit.ensure(this.volume);
      void c.resume();
      this.nextTime = c.currentTime + 0.06;
      this.nextStep = 0;
      this.schedule();
      this.timer = window.setInterval(this.schedule, 25);
    } else {
      clearInterval(this.timer);
      this.hits.length = 0;
      this.ticks.length = 0;
    }
    this.emit("play");
  }

  /** Called by the render loop as the audio clock passes each step. */
  setStep(s: number) {
    if (s === this.step) return;
    this.step = s;
    this.emit("step");
  }

  toggle(i: number) {
    this.grid[i] = this.grid[i] ? 0 : 1;
    if (this.grid[i] && !this.playing) {
      // audition the sound you just added
      const c = this.kit.ensure(this.volume);
      void c.resume();
      this.kit.play(Math.floor(i / STEPS), c.currentTime + 0.005);
    }
    this.emit("grid");
  }

  setGrid(cells: Float32Array<ArrayBufferLike>) {
    this.grid = cells;
    this.emit("grid");
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.kit.master) this.kit.master.gain.value = v;
    this.emit("settings");
  }

  dispose() {
    this.setPlaying(false);
    this.listeners.clear();
  }
}
