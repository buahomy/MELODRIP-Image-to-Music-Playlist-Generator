// Web Audio engine for the deep-sleep mode, ported from SoundPal.
// Two layers with their own volume: synthesised ocean swells, and a slow
// D-minor lullaby (a breathy whistle voice over soft choir-like pad chords).
// The melody is an original tune; everything is synthesised in the browser.

import { resumeOnReturn, setPlaybackAudioSession } from "./ios";

type Ctx = AudioContext;

function newContext(): Ctx {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AC();
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

// [frequency in Hz (0 = rest), duration in seconds]
const MELODY: [number, number][] = [
  // Phrase 1: settle onto the root
  [293.66, 1.6], [349.23, 1.2], [440.0, 2.8], [392.0, 1.2], [349.23, 1.4], [329.63, 1.2], [293.66, 3.6], [0, 1.6],
  // Phrase 2: dip low and lift
  [220.0, 1.2], [261.63, 1.2], [293.66, 1.6], [349.23, 1.4], [329.63, 3.2], [0, 1.4],
  // Phrase 3: the high point
  [392.0, 1.4], [440.0, 1.4], [523.25, 2.6], [440.0, 1.4], [392.0, 1.4], [349.23, 3.4], [0, 1.6],
  // Phrase 4: resolve home, then let the waves breathe before it loops
  [329.63, 1.4], [349.23, 1.2], [293.66, 1.4], [261.63, 1.4], [293.66, 5.6], [0, 3.0],
];

// Dm, Bbmaj7, F, C — 14 s each.
const CHORDS = [
  [146.83, 220.0, 293.66, 349.23],
  [116.54, 233.08, 293.66, 349.23],
  [174.61, 261.63, 349.23, 440.0],
  [130.81, 196.0, 261.63, 329.63],
];
const CHORD_SECONDS = 14;

class SeaAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private ocean: GainNode | null = null;
  private music: GainNode | null = null;
  private running = false;
  private sources = new Set<AudioScheduledSourceNode>();
  private timers = new Set<number>();

  private async init() {
    if (this.ctx && this.ctx.state !== "closed") {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    setPlaybackAudioSession(); // play even with the iPhone on silent
    const ctx = (this.ctx = newContext());
    resumeOnReturn(() => this.ctx);
    if (ctx.state === "suspended") await ctx.resume();
    const t = ctx.currentTime;

    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-14, t);
    limiter.knee.setValueAtTime(10, t);
    limiter.ratio.setValueAtTime(4, t);
    limiter.attack.setValueAtTime(0.02, t);
    limiter.release.setValueAtTime(0.3, t);
    this.master.connect(limiter).connect(ctx.destination);

    this.ocean = ctx.createGain();
    this.ocean.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
  }

  get isRunning() {
    return this.running;
  }

  async start(oceanVolume: number, musicVolume: number, masterVolume = 1) {
    await this.init();
    if (this.running) return;
    this.running = true;
    // Reset the master level: a previous fade-out leaves it at zero.
    this.setMasterVolume(masterVolume);
    this.setOceanVolume(oceanVolume);
    this.setMusicVolume(musicVolume);
    this.startOcean();
    this.startPads();
    this.later(1500, () => this.playMelody(0));
  }

  private track<T extends AudioScheduledSourceNode>(node: T): T {
    this.sources.add(node);
    node.addEventListener("ended", () => this.sources.delete(node));
    return node;
  }

  private later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.running) fn();
    }, ms);
    this.timers.add(id);
  }

  // Layer 1: brown-ish stereo noise through a low-pass whose cutoff and level
  // swell on a ~9 s cycle, plus a constant deep sub rumble.
  private startOcean() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const length = ctx.sampleRate * 6;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = (b0 + 0.02 * white) / 1.02;
        b1 = (b1 + 0.04 * white) / 1.04;
        b2 = 0.99 * b2 + white * 0.05;
        data[i] = (b0 * 2.5 + b1 * 1.5 + b2 * 0.5) * 1.8;
      }
    }
    const noise = this.track(ctx.createBufferSource());
    noise.buffer = buffer;
    noise.loop = true;

    const wave = ctx.createBiquadFilter();
    wave.type = "lowpass";
    wave.frequency.setValueAtTime(280, t);
    wave.Q.setValueAtTime(2, t);

    const swell = this.track(ctx.createOscillator());
    swell.frequency.setValueAtTime(0.11, t);
    const cutoffDepth = ctx.createGain();
    cutoffDepth.gain.setValueAtTime(220, t);
    swell.connect(cutoffDepth).connect(wave.frequency);

    const waveLevel = ctx.createGain();
    waveLevel.gain.setValueAtTime(0.4, t);
    const levelDepth = ctx.createGain();
    levelDepth.gain.setValueAtTime(0.3, t);
    swell.connect(levelDepth).connect(waveLevel.gain);

    noise.connect(wave).connect(waveLevel).connect(this.ocean!);

    const sub = ctx.createBiquadFilter();
    sub.type = "lowpass";
    sub.frequency.setValueAtTime(95, t);
    const subLevel = ctx.createGain();
    subLevel.gain.setValueAtTime(0.4, t);
    noise.connect(sub).connect(subLevel).connect(this.ocean!);

    noise.start(t);
    swell.start(t);
  }

  // Layer 2a: filtered sawtooth chords with a vocal "aah" formant, cross-faded.
  private startPads(index = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const freq of CHORDS[index]) {
      const osc = this.track(ctx.createOscillator());
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime((Math.random() - 0.5) * 8, t);

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(480, t);
      lp.Q.setValueAtTime(1.2, t);

      const formant = ctx.createBiquadFilter();
      formant.type = "peaking";
      formant.frequency.setValueAtTime(760, t);
      formant.Q.setValueAtTime(3, t);
      formant.gain.setValueAtTime(5, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 4);
      g.gain.setValueAtTime(0.045, t + CHORD_SECONDS - 3.5);
      g.gain.linearRampToValueAtTime(0.0001, t + CHORD_SECONDS);

      osc.connect(lp).connect(formant).connect(g).connect(this.music!);
      osc.start(t);
      osc.stop(t + CHORD_SECONDS + 0.5);
    }
    this.later((CHORD_SECONDS - 2.5) * 1000, () => this.startPads((index + 1) % CHORDS.length));
  }

  // Layer 2b: the melody, one note at a time.
  private playMelody(index: number) {
    const [freq, seconds] = MELODY[index];
    if (freq > 0) this.whistle(freq, seconds);
    this.later(seconds * 1000, () => this.playMelody((index + 1) % MELODY.length));
  }

  // Breathy whistle: sine + a little triangle, delayed vibrato, vocal formant, warm low-pass.
  private whistle(freq: number, seconds: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const sine = this.track(ctx.createOscillator());
    const tri = this.track(ctx.createOscillator());
    sine.frequency.setValueAtTime(freq, t);
    tri.type = "triangle";
    tri.frequency.setValueAtTime(freq, t);

    const vib = this.track(ctx.createOscillator());
    const vibDepth = ctx.createGain();
    vib.frequency.setValueAtTime(4.6, t);
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.setValueAtTime(0, t + 0.35);
    vibDepth.gain.linearRampToValueAtTime(3.2, t + 1.1);
    vib.connect(vibDepth);
    vibDepth.connect(sine.frequency);
    vibDepth.connect(tri.frequency);

    const env = ctx.createGain();
    const attack = Math.min(0.35, seconds * 0.2);
    const release = Math.min(0.7, seconds * 0.3);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.2, t + attack);
    env.gain.setValueAtTime(0.2, t + seconds - release);
    env.gain.linearRampToValueAtTime(0.0001, t + seconds);

    const triMix = ctx.createGain();
    triMix.gain.setValueAtTime(0.22, t);

    const formant = ctx.createBiquadFilter();
    formant.type = "peaking";
    formant.frequency.setValueAtTime(780, t);
    formant.Q.setValueAtTime(2.5, t);
    formant.gain.setValueAtTime(4, t);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1500, t);

    sine.connect(env);
    tri.connect(triMix).connect(env);
    env.connect(formant).connect(lp).connect(this.music!);

    for (const o of [sine, tri, vib]) {
      o.start(t);
      o.stop(t + seconds + 0.6);
    }
  }

  private setLevel(node: GainNode | null, value: number) {
    if (!this.ctx || !node) return;
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(clamp(value), t, 0.05);
  }

  setOceanVolume(v: number) {
    this.setLevel(this.ocean, v);
  }
  setMusicVolume(v: number) {
    this.setLevel(this.music, v);
  }
  setMasterVolume(v: number) {
    this.setLevel(this.master, v);
  }

  /** Ramp everything to silence over `seconds`, then stop. */
  fadeOutAndStop(seconds: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.running) return this.stop();
    const t = ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.0001, t + seconds);
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      this.stop();
    }, seconds * 1000 + 100);
    this.timers.add(id);
  }

  stop() {
    this.running = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
  }
}

export const seaAudio = new SeaAudio();
