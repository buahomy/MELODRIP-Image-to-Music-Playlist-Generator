// Web Audio engine for the singing-bowl (headache) mode, ported from SoundPal.
// A warm harmonic drone with a slow "breathing" swell, plus a bell strike that
// the view triggers on every full turn of the wheel. Everything is synthesised;
// no audio files are loaded.

import { resumeOnReturn, setPlaybackAudioSession } from "./ios";

type Ctx = AudioContext;

function newContext(): Ctx {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new AC();
}

// Pink noise for the wand-on-rim friction texture.
function pinkNoise(ctx: Ctx, seconds: number, level: number): AudioBuffer {
  const length = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * level;
    b6 = white * 0.115926;
  }
  return buffer;
}

class BowlAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private drone: { gain: GainNode; sources: AudioScheduledSourceNode[] } | null = null;

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
    this.master.gain.setValueAtTime(0.7, t);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-18, t);
    comp.knee.setValueAtTime(12, t);
    comp.ratio.setValueAtTime(4, t);
    comp.attack.setValueAtTime(0.01, t);
    comp.release.setValueAtTime(0.25, t);
    this.master.connect(comp);
    comp.connect(ctx.destination);
  }

  async startDrone() {
    await this.init();
    const ctx = this.ctx!;
    if (this.drone) return;
    const t = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.45, t + 2.5);
    gain.connect(this.master!);
    const sources: AudioScheduledSourceNode[] = [];

    // Bowl partials on a 108 Hz root. 216 and 217.2 Hz beat against each other,
    // which gives the slow pulse a real bowl has.
    const partials = [
      { freq: 108, level: 0.35, detune: 0 },
      { freq: 216, level: 0.45, detune: -1.2 },
      { freq: 217.2, level: 0.42, detune: 1.5 },
      { freq: 540, level: 0.22, detune: 0.8 },
      { freq: 864, level: 0.12, detune: -0.6 },
      { freq: 1296, level: 0.05, detune: 1.1 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(p.freq, t);
      osc.detune.setValueAtTime(p.detune, t);
      g.gain.setValueAtTime(p.level, t);
      osc.connect(g).connect(gain);
      osc.start(t);
      sources.push(osc);
    }

    // Friction texture: pink noise through a resonant band-pass at the fundamental.
    const noise = ctx.createBufferSource();
    noise.buffer = pinkNoise(ctx, 2, 0.04);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(216, t);
    band.Q.setValueAtTime(6, t);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, t);
    noise.connect(band).connect(noiseGain).connect(gain);
    noise.start(t);
    sources.push(noise);

    // ~7 s swell, roughly the pace of slow diaphragmatic breathing.
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.14, t);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.08, t);
    lfo.connect(lfoDepth).connect(gain.gain);
    lfo.start(t);
    sources.push(lfo);

    this.drone = { gain, sources };
  }

  /** A struck-bowl bell: soft mallet thump plus inharmonic ringing partials. */
  strike() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;

    const mallet = ctx.createOscillator();
    const malletGain = ctx.createGain();
    mallet.type = "triangle";
    mallet.frequency.setValueAtTime(140, t);
    mallet.frequency.exponentialRampToValueAtTime(40, t + 0.06);
    malletGain.gain.setValueAtTime(0.25, t);
    malletGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    mallet.connect(malletGain).connect(this.master);
    mallet.start(t);
    mallet.stop(t + 0.08);

    const f = 324;
    const partials = [
      { ratio: 1, level: 0.5, decay: 5.5 },
      { ratio: 2.76, level: 0.35, decay: 4.5 },
      { ratio: 5.42, level: 0.22, decay: 3.5 },
      { ratio: 8.91, level: 0.14, decay: 2.2 },
      { ratio: 13.2, level: 0.08, decay: 1.4 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(f * p.ratio, t);

      const vib = ctx.createOscillator();
      const vibDepth = ctx.createGain();
      vib.frequency.setValueAtTime(3.8, t);
      vibDepth.gain.setValueAtTime(1.8, t);
      vib.connect(vibDepth).connect(osc.frequency);
      vib.start(t);
      vib.stop(t + p.decay);

      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(p.level, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + p.decay + 0.1);
    }
  }

  setVolume(value: number) {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.ctx.currentTime, 0.05);
  }

  /** Fade the drone out over a second. Safe to call startDrone() again straight away. */
  stop() {
    const ctx = this.ctx;
    const drone = this.drone;
    if (!ctx || !drone) return;
    this.drone = null;
    const t = ctx.currentTime;
    drone.gain.gain.cancelScheduledValues(t);
    drone.gain.gain.setValueAtTime(drone.gain.gain.value, t);
    drone.gain.gain.linearRampToValueAtTime(0.0001, t + 1);
    for (const s of drone.sources) {
      try {
        s.stop(t + 1.1);
      } catch {}
    }
    setTimeout(() => drone.gain.disconnect(), 1200);
  }
}

export const bowlAudio = new BowlAudio();
