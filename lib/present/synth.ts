// Building blocks for the Present sound library. Every layer is synthesised
// live with Web Audio (no recordings): noise colours, water, weather, fire,
// creatures, drones, bells and brainwave tones. A layer connects into `out`
// and returns a function that stops it.

export type Stop = () => void;
export type Layer = (ctx: AudioContext, out: AudioNode, bank: NoiseBank) => Stop;

// ---- noise buffers (made once per AudioContext) ----
export type NoiseColor = "white" | "pink" | "brown";
export class NoiseBank {
  private cache = new Map<NoiseColor, AudioBuffer>();
  constructor(private ctx: AudioContext) {}
  get(color: NoiseColor) {
    let b = this.cache.get(color);
    if (b) return b;
    const len = this.ctx.sampleRate * 6;
    b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "white") d[i] = w * 0.5;
      else if (color === "pink") {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    this.cache.set(color, b);
    return b;
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Stereo noise: two decorrelated copies panned left and right for width. */
function stereoNoise(ctx: AudioContext, bank: NoiseBank, color: NoiseColor) {
  const merger = ctx.createChannelMerger(2);
  const srcs = [0, 1].map((ch) => {
    const s = ctx.createBufferSource();
    s.buffer = bank.get(color);
    s.loop = true;
    s.connect(merger, 0, ch);
    s.start(0, rand(0, 5));
    return s;
  });
  return { node: merger as AudioNode, stop: () => srcs.forEach((s) => s.stop()) };
}

function lfo(ctx: AudioContext, rate: number, depth: number, target: AudioParam, type: OscillatorType = "sine") {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(target);
  o.start();
  return o;
}

/** Random events at an average `perSecond`, scheduled a little ahead of time. */
function scatter(ctx: AudioContext, perSecond: number, fire: (t: number) => void): Stop {
  let next = ctx.currentTime + rand(0, 1 / perSecond);
  const id = window.setInterval(() => {
    while (next < ctx.currentTime + 0.2) {
      fire(Math.max(next, ctx.currentTime + 0.01));
      next += -Math.log(1 - Math.random()) / perSecond; // Poisson spacing
    }
  }, 50);
  return () => clearInterval(id);
}

/** Events every `period` seconds (with optional jitter). */
function every(ctx: AudioContext, period: () => number, fire: (t: number) => void, startIn = 0.05): Stop {
  let next = ctx.currentTime + startIn;
  const id = window.setInterval(() => {
    while (next < ctx.currentTime + 0.2) {
      fire(Math.max(next, ctx.currentTime + 0.01));
      next += period();
    }
  }, 40);
  return () => clearInterval(id);
}

function burst(ctx: AudioContext, bank: NoiseBank, out: AudioNode, t: number, o: {
  color?: NoiseColor; type?: BiquadFilterType; freq: number; q?: number; peak: number; attack?: number; decay: number; pan?: number;
}) {
  const s = ctx.createBufferSource();
  s.buffer = bank.get(o.color ?? "white");
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.value = o.freq;
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
  const p = ctx.createStereoPanner();
  p.pan.value = o.pan ?? rand(-0.8, 0.8);
  s.connect(f).connect(g).connect(p).connect(out);
  s.start(t, rand(0, 5));
  s.stop(t + a + o.decay + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, t: number, o: {
  freq: number; type?: OscillatorType; peak: number; attack?: number; decay: number; pan?: number; glide?: number;
}) {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, t + (o.attack ?? 0.005) + o.decay);
  const g = ctx.createGain();
  const a = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.decay);
  const p = ctx.createStereoPanner();
  p.pan.value = o.pan ?? 0;
  osc.connect(g).connect(p).connect(out);
  osc.start(t);
  osc.stop(t + a + o.decay + 0.05);
}

// ======================= textures =======================

/** Coloured noise, optionally shaped by a filter. */
export const noise = (color: NoiseColor, filter?: { type: BiquadFilterType; freq: number; q?: number }, level = 1): Layer =>
  (ctx, out, bank) => {
    const n = stereoNoise(ctx, bank, color);
    const g = ctx.createGain();
    g.gain.value = level;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.q ?? 0.7;
      n.node.connect(f).connect(g);
    } else n.node.connect(g);
    g.connect(out);
    return n.stop;
  };

/** Grey noise: pink noise with the mid-range dipped so it sounds evenly loud to the ear. */
export const greyNoise: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "pink");
  const lo = ctx.createBiquadFilter();
  lo.type = "lowshelf"; lo.frequency.value = 200; lo.gain.value = 6;
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking"; mid.frequency.value = 3500; mid.Q.value = 0.8; mid.gain.value = -8;
  const hi = ctx.createBiquadFilter();
  hi.type = "highshelf"; hi.frequency.value = 9000; hi.gain.value = 4;
  n.node.connect(lo).connect(mid).connect(hi).connect(out);
  return n.stop;
};

/** Noise with a gap (notch) at the listener's tinnitus pitch: "notched sound therapy". */
export const notchedNoise = (freq: number): Layer => (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "pink");
  let node: AudioNode = n.node;
  // a one-octave-wide notch made from three stacked notch filters
  for (const k of [0.84, 1, 1.19]) {
    const f = ctx.createBiquadFilter();
    f.type = "notch"; f.frequency.value = freq * k; f.Q.value = 2.5;
    node.connect(f);
    node = f;
  }
  node.connect(out);
  return n.stop;
};

/** Steady rushing water (waterfall, heavy rain bed). */
export const rush = (freq = 1200, q = 0.4, color: NoiseColor = "pink"): Layer => (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, color);
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 1.4;
  const slow = lfo(ctx, 0.07, 0.12, g.gain);
  n.node.connect(f).connect(g).connect(out);
  return () => { n.stop(); slow.stop(); };
};

/** Ocean swells: low-passed noise that breathes on a ~9 s cycle. */
export const waves = (period = 9): Layer => (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "brown");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 500; f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = 0.32;
  const a = lfo(ctx, 1 / period, 380, f.frequency);
  const b = lfo(ctx, 1 / period, 0.26, g.gain);
  n.node.connect(f).connect(g).connect(out);
  return () => { n.stop(); a.stop(); b.stop(); };
};

/** Gentle lapping at a lake edge: a soft water bed that rocks, plus small splashes. */
export const lapping: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "pink");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 650; f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = 0.32;
  const rock = lfo(ctx, 0.45, 0.26, g.gain);
  const tilt = lfo(ctx, 0.3, 250, f.frequency);
  n.node.connect(f).connect(g).connect(out);
  const splash = scatter(ctx, 1.3, (t) => burst(ctx, bank, out, t, { color: "pink", type: "lowpass", freq: rand(350, 800), q: 1.5, peak: rand(0.5, 1), attack: 0.25, decay: rand(0.7, 1.3) }));
  return () => { n.stop(); rock.stop(); tilt.stop(); splash(); };
};

/** A babbling brook: several narrow bands of noise wobbling quickly. */
export const stream: Layer = (ctx, out, bank) => {
  const stops: Stop[] = [];
  for (const freq of [700, 1300, 2300, 3600]) {
    const n = stereoNoise(ctx, bank, "white");
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 6;
    const g = ctx.createGain();
    g.gain.value = 1.8;
    const w1 = lfo(ctx, rand(5, 11), freq * 0.25, f.frequency, "triangle");
    const w2 = lfo(ctx, rand(0.3, 0.9), 1.2, g.gain);
    n.node.connect(f).connect(g).connect(out);
    stops.push(n.stop, () => { w1.stop(); w2.stop(); });
  }
  // little bubbles
  stops.push(scatter(ctx, 7, (t) => tone(ctx, out, t, { freq: rand(900, 2200), glide: rand(2400, 3800), peak: 0.03, decay: 0.05, pan: rand(-0.7, 0.7) })));
  return () => stops.forEach((s) => s());
};

/** Wind: band-passed noise whose pitch and strength drift. */
export const wind = (base = 500): Layer => (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "pink");
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = base; f.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = 1.1;
  const a = lfo(ctx, 0.05, base * 0.6, f.frequency);
  const b = lfo(ctx, 0.08, 0.6, g.gain);
  n.node.connect(f).connect(g).connect(out);
  return () => { n.stop(); a.stop(); b.stop(); };
};

/** Raindrops: many tiny ticks. `heavy` raises density; `tent` makes them duller and boomier. */
export const drops = (perSecond = 40, tent = false): Layer => (ctx, out, bank) =>
  scatter(ctx, perSecond, (t) =>
    burst(ctx, bank, out, t, tent
      ? { type: "bandpass", freq: rand(250, 700), q: 3, peak: rand(0.3, 0.8), decay: rand(0.04, 0.09) }
      : { type: "bandpass", freq: rand(2500, 7000), q: 2, peak: rand(0.03, 0.14), decay: rand(0.01, 0.03) }));

/** Distant thunder: long, low rumbles every 10–25 s. */
export const thunder: Layer = (ctx, out, bank) =>
  every(ctx, () => rand(10, 25), (t) => {
    burst(ctx, bank, out, t, { color: "brown", type: "lowpass", freq: rand(90, 160), q: 0.8, peak: rand(0.5, 0.9), attack: rand(0.3, 1), decay: rand(3, 6) });
  }, rand(2, 6));

/** Fire: a soft roar plus crackles and pops. */
export const fire: Layer = (ctx, out, bank) => {
  const roar = noise("brown", { type: "lowpass", freq: 400 }, 0.5)(ctx, out, bank);
  const crackle = scatter(ctx, 9, (t) => burst(ctx, bank, out, t, { type: "highpass", freq: rand(1500, 4000), q: 0.7, peak: rand(0.05, 0.35), decay: rand(0.005, 0.02) }));
  const pops = scatter(ctx, 0.6, (t) => burst(ctx, bank, out, t, { type: "bandpass", freq: rand(600, 1200), q: 2, peak: rand(0.3, 0.6), decay: 0.04 }));
  return () => { roar(); crackle(); pops(); };
};

/** A box fan: low steady air with a faint motor hum. */
export const fan: Layer = (ctx, out, bank) => {
  const air = noise("brown", { type: "lowpass", freq: 700 }, 0.6)(ctx, out, bank);
  const hum = ctx.createOscillator();
  hum.frequency.value = 118;
  const hg = ctx.createGain();
  hg.gain.value = 0.03;
  const wob = lfo(ctx, 6, 0.01, hg.gain);
  hum.connect(hg).connect(out);
  hum.start();
  return () => { air(); hum.stop(); wob.stop(); };
};

/** Under water: very low, muffled rumble with slow movement. */
export const underwater: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "brown");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 180; f.Q.value = 3;
  const a = lfo(ctx, 0.11, 70, f.frequency);
  const ug = ctx.createGain();
  ug.gain.value = 0.55;
  n.node.connect(f).connect(ug).connect(out);
  const bub = scatter(ctx, 1.5, (t) => tone(ctx, out, t, { freq: rand(200, 500), glide: rand(600, 900), peak: 0.05, decay: 0.12, pan: rand(-0.6, 0.6) }));
  return () => { n.stop(); a.stop(); bub(); };
};

// ======================= creatures & body =======================

/** A heartbeat, "lub-dub", at `bpm`. */
export const heartbeat = (bpm = 66): Layer => (ctx, out) =>
  every(ctx, () => 60 / bpm, (t) => {
    tone(ctx, out, t, { freq: 62, glide: 40, peak: 0.9, attack: 0.01, decay: 0.16 });
    tone(ctx, out, t + 0.27, { freq: 55, glide: 38, peak: 0.55, attack: 0.01, decay: 0.14 });
  });

/** Womb whoosh: deep filtered noise that swells with the heartbeat. */
export const womb: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "brown");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 260;
  const g = ctx.createGain();
  g.gain.value = 0.8;
  const pulse = lfo(ctx, 66 / 60, 0.25, g.gain);
  n.node.connect(f).connect(g).connect(out);
  return () => { n.stop(); pulse.stop(); };
};

/** A cat's purr: a ~25 Hz rattle that rises and falls with breathing. */
export const purr: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "brown");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 350; f.Q.value = 2;
  const am = ctx.createGain();
  am.gain.value = 0.5;
  const rattle = lfo(ctx, 25, 0.5, am.gain, "triangle");
  const breath = ctx.createGain();
  breath.gain.value = 0.7;
  const br = lfo(ctx, 0.35, 0.45, breath.gain);
  n.node.connect(f).connect(am).connect(breath).connect(out);
  return () => { n.stop(); rattle.stop(); br.stop(); };
};

/** "Shhh… shhh…": the classic baby shusher. */
export const shush: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "pink");
  const f = ctx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = 3200; f.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.value = 0.6;
  const s = lfo(ctx, 0.9, 0.55, g.gain);
  n.node.connect(f).connect(g).connect(out);
  return () => { n.stop(); s.stop(); };
};

/** Summer night crickets: trills of high chirps from all around. */
export const crickets: Layer = (ctx, out) =>
  scatter(ctx, 4, (t) => {
    const freq = rand(4200, 5200);
    const pan = rand(-0.9, 0.9);
    const n = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) tone(ctx, out, t + k * 0.045, { freq, peak: rand(0.14, 0.26), attack: 0.004, decay: 0.03, pan });
  });

/** Birdsong: little swooping whistles. */
export const birds: Layer = (ctx, out) =>
  scatter(ctx, 0.9, (t) => {
    const pan = rand(-0.9, 0.9);
    const base = rand(2200, 3800);
    const n = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const up = Math.random() > 0.5;
      tone(ctx, out, t + k * rand(0.09, 0.16), { freq: up ? base : base * 1.4, glide: up ? base * 1.5 : base * 0.9, peak: rand(0.12, 0.22), attack: 0.01, decay: rand(0.06, 0.12), pan });
    }
  });

/** A bamboo water fountain (shishi-odoshi) knocking every ~12 s. */
export const bambooKnock: Layer = (ctx, out, bank) =>
  every(ctx, () => rand(9, 15), (t) => {
    tone(ctx, out, t, { freq: 380, glide: 300, peak: 0.6, attack: 0.002, decay: 0.18, pan: 0.3 });
    burst(ctx, bank, out, t, { type: "bandpass", freq: 1800, q: 4, peak: 0.25, decay: 0.03, pan: 0.3 });
  }, 3);

// ======================= tonal =======================

/** A singing-bowl drone with beating partials. */
export const bowl = (root = 108): Layer => (ctx, out) => {
  const g = ctx.createGain();
  g.gain.value = 0.2;
  g.connect(out);
  const oscs = [[1, 0.35], [2, 0.45], [2.011, 0.42], [5, 0.2], [8, 0.1], [12, 0.04]].map(([r, l]) => {
    const o = ctx.createOscillator();
    o.frequency.value = root * r;
    const og = ctx.createGain();
    og.gain.value = l;
    o.connect(og).connect(g);
    o.start();
    return o;
  });
  const swell = lfo(ctx, 0.14, 0.05, g.gain);
  return () => { oscs.forEach((o) => o.stop()); swell.stop(); };
};

/** A deep "Om" chant: buzzy voice through vowel formants, with slow vibrato. */
export const chant = (pitch = 98): Layer => (ctx, out) => {
  const g = ctx.createGain();
  g.gain.value = 0.35;
  const vibs: OscillatorNode[] = [];
  const voices = [0, 1].map((k) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = pitch * (k ? 1.5 : 1);
    o.detune.value = rand(-6, 6);
    vibs.push(lfo(ctx, 4.5, 2.5, o.frequency));
    return o;
  });
  const sum = ctx.createGain();
  sum.gain.value = 0.5;
  voices.forEach((o) => { o.connect(sum); o.start(); });
  for (const [f, q, lv] of [[400, 8, 1], [800, 10, 0.5], [2600, 12, 0.12]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
    const bg = ctx.createGain();
    bg.gain.value = lv;
    sum.connect(bp).connect(bg).connect(g);
  }
  const breathe = lfo(ctx, 0.08, 0.15, g.gain);
  g.connect(out);
  return () => { voices.forEach((o) => o.stop()); vibs.forEach((o) => o.stop()); breathe.stop(); };
};

/** A warm, slow pad on a chord (frequencies in Hz). */
export const pad = (chord: number[], bright = 900): Layer => (ctx, out) => {
  const g = ctx.createGain();
  g.gain.value = 0.12;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = bright;
  const oscs = chord.flatMap((f) => [-5, 5].map((d) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.detune.value = d;
    o.connect(lp);
    o.start();
    return o;
  }));
  const sweep = lfo(ctx, 0.05, bright * 0.4, lp.frequency);
  const swell = lfo(ctx, 0.07, 0.04, g.gain);
  lp.connect(g).connect(out);
  return () => { oscs.forEach((o) => o.stop()); sweep.stop(); swell.stop(); };
};

/** Temple bells / wind chimes: random strikes on a pentatonic scale. */
export const bells = (scale: number[], perSecond = 0.35, ring = 4): Layer => (ctx, out) =>
  scatter(ctx, perSecond, (t) => {
    const f = scale[Math.floor(Math.random() * scale.length)];
    const pan = rand(-0.7, 0.7);
    for (const [r, l, d] of [[1, 0.25, ring], [2.76, 0.12, ring * 0.7], [5.4, 0.06, ring * 0.45]]) {
      tone(ctx, out, t, { freq: f * r, peak: l, attack: 0.004, decay: d, pan });
    }
  });

/** Aeolian harp: whistling harmonics that swell with the wind. */
export const aeolian: Layer = (ctx, out) => {
  const g = ctx.createGain();
  g.gain.value = 0.06;
  const swells: OscillatorNode[] = [];
  const oscs = [220, 330, 440, 550, 660].map((f, i) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = 0;
    swells.push(lfo(ctx, rand(0.03, 0.09), 0.5, og.gain));
    o.connect(og).connect(g);
    o.start(ctx.currentTime + i * 0.3);
    return o;
  });
  g.connect(out);
  return () => { oscs.forEach((o) => o.stop()); swells.forEach((o) => o.stop()); };
};

/** A generative marimba playing polyrhythmic patterns on a happy pentatonic scale. */
export const marimba: Layer = (ctx, out) => {
  const scale = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
  const step = 0.21;
  let n = 0;
  return every(ctx, () => step, (t) => {
    // three voices repeating every 3, 4 and 5 steps
    if (n % 3 === 0) tone(ctx, out, t, { freq: scale[(n / 3) % 4 | 0], peak: 0.55, attack: 0.002, decay: 0.5, pan: -0.4 });
    if (n % 4 === 1) tone(ctx, out, t, { freq: scale[3 + ((n >> 2) % 4)], peak: 0.45, attack: 0.002, decay: 0.45, pan: 0.4 });
    if (n % 5 === 2) tone(ctx, out, t, { freq: scale[2 + ((n * 2) % 6)] * 2, peak: 0.22, attack: 0.002, decay: 0.35, pan: 0 });
    n++;
  });
};

// ======================= brainwave & frequency tones =======================

/** Binaural beat: `carrier` Hz in the left ear, carrier + `beat` Hz in the right. Needs headphones. */
export const binaural = (carrier: number, beat: number): Layer => (ctx, out) => {
  const merger = ctx.createChannelMerger(2);
  const oscs = [carrier, carrier + beat].map((f, ch) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    o.connect(g).connect(merger, 0, ch);
    o.start();
    return o;
  });
  merger.connect(out);
  return () => oscs.forEach((o) => o.stop());
};

/** Isochronic tone: a tone pulsing on and off `rate` times a second (works on speakers too). */
export const isochronic = (carrier: number, rate: number): Layer => (ctx, out) => {
  const o = ctx.createOscillator();
  o.frequency.value = carrier;
  const g = ctx.createGain();
  g.gain.value = 0.15;
  // smoothed square pulses: a square LFO through a low-pass to avoid clicks
  const sq = ctx.createOscillator();
  sq.type = "square";
  sq.frequency.value = rate;
  const smooth = ctx.createBiquadFilter();
  smooth.type = "lowpass"; smooth.frequency.value = Math.max(60, rate * 6);
  const depth = ctx.createGain();
  depth.gain.value = 0.15;
  sq.connect(smooth).connect(depth).connect(g.gain);
  o.connect(g).connect(out);
  o.start();
  sq.start();
  return () => { o.stop(); sq.stop(); };
};

/** A pure, steady sine tone (solfeggio and other frequency tones). */
export const pureTone = (freq: number, level = 0.25): Layer => (ctx, out) => {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = level;
  const shimmer = lfo(ctx, 0.2, level * 0.15, g.gain);
  o.connect(g).connect(out);
  o.start();
  return () => { o.stop(); shimmer.stop(); };
};

// ======================= elements =======================

/** Play several layers as one. */
export const combine = (...layers: Layer[]): Layer => (ctx, out, bank) => {
  const stops = layers.map((l) => l(ctx, out, bank));
  return () => stops.forEach((s) => s());
};

/** Earth: a deep ground rumble with soil crumbling and the odd pebble settling. */
export const soil: Layer = (ctx, out, bank) => {
  const n = stereoNoise(ctx, bank, "brown");
  const f = ctx.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 130; f.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.value = 0.7;
  const heave = lfo(ctx, 0.06, 0.25, g.gain);
  n.node.connect(f).connect(g).connect(out);
  const crumble = scatter(ctx, 14, (t) => burst(ctx, bank, out, t, { type: "bandpass", freq: rand(700, 2400), q: 1.2, peak: rand(0.02, 0.09), decay: rand(0.01, 0.04) }));
  const pebbles = scatter(ctx, 0.5, (t) => {
    const pan = rand(-0.7, 0.7);
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      burst(ctx, bank, out, t + k * rand(0.05, 0.12), { type: "bandpass", freq: rand(1800, 3200), q: 5, peak: rand(0.1, 0.25), decay: 0.02, pan });
    }
  });
  return () => { n.stop(); heave.stop(); crumble(); pebbles(); };
};
