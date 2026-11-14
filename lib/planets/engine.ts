// Sound Planets engine: eight looping one-note voices (a circular take on a
// polyrhythm loop machine). Each planet sings every `interval` beats, shifted
// by `offset` beats; different intervals drift in and out of phase. Notes come
// from a pentatonic scale, so any combination sounds good. All synthesised.

import { resumeOnReturn, setPlaybackAudioSession } from "@/lib/therapy/ios";

export const NOTES = [
  { name: "C", freq: 261.63, color: "#ff6b8b" },
  { name: "D", freq: 293.66, color: "#ff9f5a" },
  { name: "E", freq: 329.63, color: "#ffd25a" },
  { name: "G", freq: 392.0, color: "#7ee08a" },
  { name: "A", freq: 440.0, color: "#5ad2c8" },
  { name: "C", freq: 523.25, color: "#6aa8ff" },
  { name: "D", freq: 587.33, color: "#8d94ff" },
  { name: "E", freq: 659.25, color: "#b388ff" },
  { name: "G", freq: 783.99, color: "#e07bff" },
  { name: "A", freq: 880.0, color: "#ff8fd8" },
];

export const SOUNDS = [
  { id: "bell", emoji: "🔔", label: "Bell" },
  { id: "flute", emoji: "🪈", label: "Flute" },
  { id: "beep", emoji: "🤖", label: "Beep" },
  { id: "pluck", emoji: "🪕", label: "Pluck" },
  { id: "drum", emoji: "🥁", label: "Drum" },
  { id: "shaker", emoji: "🧂", label: "Shaker" },
] as const;
export type SoundId = (typeof SOUNDS)[number]["id"];

export type Planet = {
  emoji: string;
  color: string;
  on: boolean;
  note: number; // index into NOTES
  sound: SoundId;
  interval: number; // beats per lap, 1 (fast) .. 8 (slow)
  offset: number; // beats, 0 .. interval
  volume: number; // 0..1
  chance: number; // 0..1 probability it sings each lap ("surprise")
  wiggle: boolean; // humanise timing and loudness a little
};

export const PLANET_LOOKS = [
  { emoji: "🐻", color: "#ff9f5a" },
  { emoji: "🐰", color: "#ffd25a" },
  { emoji: "🐱", color: "#ff8fd8" },
  { emoji: "🐸", color: "#7ee08a" },
  { emoji: "🐧", color: "#6aa8ff" },
  { emoji: "🐳", color: "#5ad2c8" },
  { emoji: "🦄", color: "#c070ff" },
  { emoji: "🐝", color: "#ffc27a" },
];

const p = (i: number, on: boolean, sound: SoundId, note: number, interval: number, offset = 0): Planet => ({
  ...PLANET_LOOKS[i], on, sound, note, interval, offset, volume: 0.8, chance: 1, wiggle: false,
});

export const PRESETS: { name: string; emoji: string; planets: Planet[]; bpm: number }[] = [
  {
    name: "Twinkle", emoji: "⭐", bpm: 100,
    planets: [p(0, true, "drum", 0, 4), p(1, true, "shaker", 0, 2, 1), p(2, true, "bell", 5, 3), p(3, true, "pluck", 2, 4, 2),
      p(4, false, "flute", 3, 6), p(5, false, "beep", 4, 5), p(6, false, "bell", 7, 8, 4), p(7, false, "pluck", 8, 7)],
  },
  {
    name: "Raindrops", emoji: "🌧️", bpm: 84,
    planets: [p(0, false, "drum", 0, 8), p(1, true, "bell", 9, 3), p(2, true, "bell", 7, 4, 1), p(3, true, "bell", 5, 5, 2),
      p(4, true, "flute", 3, 7), p(5, true, "bell", 4, 6, 3), p(6, false, "bell", 8, 8), p(7, false, "pluck", 2, 2)],
  },
  {
    name: "Dance party", emoji: "🪩", bpm: 124,
    planets: [p(0, true, "drum", 0, 2), p(1, true, "shaker", 0, 1), p(2, true, "beep", 4, 3), p(3, true, "pluck", 0, 4, 3),
      p(4, true, "pluck", 2, 6, 1), p(5, false, "beep", 6, 5), p(6, true, "bell", 9, 8, 6), p(7, false, "flute", 3, 7)],
  },
];

export const freshPlanets = () => PRESETS[0].planets.map((x) => ({ ...x }));

export type SingEvent = { planet: number; t: number };

export class PlanetEngine {
  planets: Planet[] = freshPlanets();
  bpm = 100;
  volume = 0.8;
  playing = false;

  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wave = new Uint8Array(256);
  private noise: AudioBuffer | null = null;
  private timer = 0;
  // beat clock: beat(t) = beat0 + (t - time0) * bpm / 60 * 2   (beats are eighth notes)
  private time0 = 0;
  private beat0 = 0;
  private scheduledTo = 0; // beat up to which events are scheduled
  readonly sung: SingEvent[] = []; // scheduled songs for the visuals
  private recorder: MediaRecorder | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    setPlaybackAudioSession(); // play even with the iPhone on silent
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = (this.ctx = new AC());
    resumeOnReturn(() => this.ctx);
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3.5;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 256;
    this.master.connect(comp).connect(this.analyser).connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return c;
  }

  private beatsPerSec() {
    return (this.bpm / 60) * 2;
  }
  beatAt(t: number) {
    return this.beat0 + (t - this.time0) * this.beatsPerSec();
  }
  private timeAt(beat: number) {
    return this.time0 + (beat - this.beat0) / this.beatsPerSec();
  }
  /** Current beat position for drawing (keeps turning slowly-free when stopped). */
  nowBeat() {
    return this.ctx && this.playing ? this.beatAt(this.ctx.currentTime) : this.beat0;
  }

  setBpm(bpm: number) {
    if (this.ctx && this.playing) {
      // re-anchor so the planets keep their place and just change speed
      const now = this.ctx.currentTime;
      this.beat0 = this.beatAt(now);
      this.time0 = now;
      this.scheduledTo = Math.min(this.scheduledTo, this.beatAt(now + 0.03));
      this.sung.length = 0;
    }
    this.bpm = bpm;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  private schedule = () => {
    const c = this.ctx!;
    const until = this.beatAt(c.currentTime + 0.12);
    const from = this.scheduledTo;
    this.planets.forEach((pl, i) => {
      if (!pl.on) return;
      // song beats are offset + k*interval; find the ones in (from, until]
      let k = Math.floor((from - pl.offset) / pl.interval) + 1;
      for (let b = pl.offset + k * pl.interval; b <= until; k++, b = pl.offset + k * pl.interval) {
        if (b <= from) continue;
        if (Math.random() > pl.chance) continue;
        let t = this.timeAt(b);
        let vel = pl.volume;
        if (pl.wiggle) {
          t += (Math.random() - 0.5) * 0.03;
          vel *= 0.8 + Math.random() * 0.3;
        }
        t = Math.max(t, c.currentTime + 0.005);
        this.voice(pl, t, vel);
        this.sung.push({ planet: i, t });
      }
    });
    this.scheduledTo = until;
  };

  setPlaying(on: boolean) {
    if (on === this.playing) return;
    if (on) {
      const c = this.ensure();
      void c.resume();
      this.time0 = c.currentTime + 0.05;
      // keep the planets where they were when stopped
      this.scheduledTo = this.beat0 - 0.0001;
      this.playing = true;
      this.schedule();
      this.timer = window.setInterval(this.schedule, 25);
    } else {
      if (this.ctx) this.beat0 = this.beatAt(this.ctx.currentTime);
      this.playing = false;
      clearInterval(this.timer);
      this.sung.length = 0;
    }
  }

  /** Play one planet's sound right now (when it's tapped). */
  preview(i: number) {
    const c = this.ensure();
    void c.resume();
    this.voice(this.planets[i], c.currentTime + 0.01, this.planets[i].volume);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private voice(pl: Planet, t: number, vel: number) {
    const c = this.ctx!;
    const out = this.master!;
    const f = NOTES[pl.note].freq;
    const g = c.createGain();
    g.connect(out);
    switch (pl.sound) {
      case "bell": {
        // two sines, one bright inharmonic partial, long ring
        for (const [ratio, lvl] of [[1, 0.5], [2, 0.18], [2.76, 0.12]] as const) {
          const o = c.createOscillator();
          const og = c.createGain();
          o.frequency.value = f * ratio;
          og.gain.value = lvl;
          o.connect(og).connect(g);
          o.start(t);
          o.stop(t + 1.6);
        }
        this.env(g, t, vel * 0.9, 0.005, 1.4);
        break;
      }
      case "flute": {
        const o = c.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const vib = c.createOscillator();
        const vd = c.createGain();
        vib.frequency.value = 5;
        vd.gain.value = f * 0.006;
        vib.connect(vd).connect(o.frequency);
        o.connect(g);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.06);
        g.gain.setValueAtTime(vel * 0.5, t + 0.32);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        for (const n of [o, vib]) {
          n.start(t);
          n.stop(t + 0.65);
        }
        break;
      }
      case "beep": {
        const o = c.createOscillator();
        o.type = "square";
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 2200;
        o.connect(lp).connect(g);
        this.env(g, t, vel * 0.22, 0.004, 0.18);
        o.start(t);
        o.stop(t + 0.25);
        break;
      }
      case "pluck": {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f / 2;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.Q.value = 4;
        lp.frequency.setValueAtTime(3000, t);
        lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
        o.connect(lp).connect(g);
        this.env(g, t, vel * 0.45, 0.003, 0.4);
        o.start(t);
        o.stop(t + 0.45);
        break;
      }
      case "drum": {
        // a round kick, tuned a little by the note so kids hear the change
        const o = c.createOscillator();
        o.frequency.setValueAtTime(110 + pl.note * 6, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        o.connect(g);
        this.env(g, t, vel, 0.004, 0.38);
        o.start(t);
        o.stop(t + 0.42);
        break;
      }
      case "shaker": {
        const src = c.createBufferSource();
        src.buffer = this.noise;
        const hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 5000 + pl.note * 300;
        src.connect(hp).connect(g);
        this.env(g, t, vel * 0.32, 0.01, 0.07);
        src.start(t, Math.random() * 0.5);
        src.stop(t + 0.1);
        break;
      }
    }
  }

  /** Output level 0..~0.5, for the singing sun. */
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

  // ---- recording: capture the mix to an audio file ----
  get recordingSupported() {
    return typeof window !== "undefined" && "MediaRecorder" in window;
  }
  get recording() {
    return this.recorder?.state === "recording";
  }

  startRecording() {
    const c = this.ensure();
    if (!this.recDest) {
      this.recDest = c.createMediaStreamDestination();
      this.analyser!.connect(this.recDest);
    }
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.recDest.stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    this.recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((resolve) => {
      this.recorder!.onstop = () => resolve(new Blob(chunks, { type: this.recorder?.mimeType || type || "audio/webm" }));
    });
    this.recorder.start();
    return done;
  }

  stopRecording() {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  dispose() {
    this.stopRecording();
    this.setPlaying(false);
  }
}
