// The groove model: a small denoising network trained on the device.
// Input: 80 cell values (hits we know about), 80 "known" flags and an 8-way
// style. Output: the chance of a hit in every cell. It's trained like Coconet
// (random cells are hidden and it learns to fill them), so one model can
// complete a pattern, vary it, or invent one by repeated resampling.
// TensorFlow.js is loaded only when Beat Lab opens.

import { CORPUS, GENRES, GENRE_BPM, N, STEPS, VOICES } from "./patterns";

type TF = typeof import("@tensorflow/tfjs");
type LayersModel = import("@tensorflow/tfjs").LayersModel;

const IN = N * 2 + GENRES.length;
const MODEL_KEY = "indexeddb://melodrip-groove-v1";

export type Progress = { epoch: number; epochs: number; loss: number; losses: number[] };

function encodeInput(cells: ArrayLike<number>, known: ArrayLike<number>, genre: number, out: Float32Array, offset = 0) {
  for (let i = 0; i < N; i++) {
    out[offset + i] = cells[i] * known[i];
    out[offset + N + i] = known[i];
  }
  if (genre >= 0) out[offset + 2 * N + genre] = 1;
}

function trainingExample(xs: Float32Array, ys: Float32Array, ws: Float32Array, row: number) {
  const pat = CORPUS[Math.floor(Math.random() * CORPUS.length)];
  const cells = Float32Array.from(pat.cells);
  if (Math.random() < 0.4) {
    // swap one instrument with another groove of the same style
    const peers = CORPUS.filter((p) => p.g === pat.g);
    const other = peers[Math.floor(Math.random() * peers.length)];
    const v = Math.floor(Math.random() * VOICES.length);
    for (let s = 0; s < STEPS; s++) cells[v * STEPS + s] = other.cells[v * STEPS + s];
  }
  const known = new Float32Array(N);
  if (Math.random() < 0.3) {
    for (let i = 0; i < N; i++) known[i] = cells[i] && Math.random() < 0.6 ? 1 : 0; // "suggest" mode
  } else {
    const r = Math.random();
    for (let i = 0; i < N; i++) known[i] = Math.random() > r ? 1 : 0;
  }
  encodeInput(cells, known, Math.random() < 0.75 ? pat.g : -1, xs, row * IN);
  for (let i = 0; i < N; i++) {
    ys[row * N + i] = cells[i];
    ws[row * N + i] = known[i] ? 0.05 : 1;
  }
}

const sharpen = (p: number, temp: number) => {
  const a = Math.pow(p, 1 / temp);
  const b = Math.pow(1 - p, 1 / temp);
  return a / (a + b);
};

export class GrooveModel {
  private tf: TF | null = null;
  private model: LayersModel | null = null;
  backend = "";
  losses: number[] = [];

  get ready() {
    return this.model !== null;
  }

  /** Load the model this device trained before, or train one now (a few seconds). */
  async start(onProgress: (p: Progress) => void): Promise<{ trained: boolean; seconds: number }> {
    const tf = (this.tf = await import("@tensorflow/tfjs"));
    // The network is tiny (~100k weights), so the CPU trains it quickly and the
    // GPU stays free for the 3D ring; on iPhone they'd otherwise fight over it.
    await tf.setBackend("cpu");
    await tf.ready();
    this.backend = tf.getBackend();
    try {
      this.model = await tf.loadLayersModel(MODEL_KEY);
      return { trained: false, seconds: 0 };
    } catch {
      const m = tf.sequential();
      m.add(tf.layers.dense({ inputShape: [IN], units: 192, activation: "relu" }));
      m.add(tf.layers.dropout({ rate: 0.15 }));
      m.add(tf.layers.dense({ units: 192, activation: "relu" }));
      m.add(tf.layers.dense({ units: N, activation: "sigmoid" }));
      const started = performance.now();
      await this.train(m, onProgress);
      this.model = m;
      try {
        await m.save(MODEL_KEY);
      } catch {
        // storage blocked: it retrains next visit
      }
      return { trained: true, seconds: (performance.now() - started) / 1000 };
    }
  }

  private async train(m: LayersModel, onProgress: (p: Progress) => void) {
    const tf = this.tf!;
    const EPOCHS = 45;
    const BATCH = 64;
    const PER_EPOCH = 10;
    const opt = tf.train.adam(0.003);
    for (let e = 0; e < EPOCHS; e++) {
      let total = 0;
      for (let b = 0; b < PER_EPOCH; b++) {
        const xs = new Float32Array(BATCH * IN);
        const ys = new Float32Array(BATCH * N);
        const ws = new Float32Array(BATCH * N);
        for (let r = 0; r < BATCH; r++) trainingExample(xs, ys, ws, r);
        type Scalar = import("@tensorflow/tfjs").Scalar;
        type Tensor = import("@tensorflow/tfjs").Tensor;
        const cost = tf.tidy(() => {
          const x = tf.tensor2d(xs, [BATCH, IN]);
          const y = tf.tensor2d(ys, [BATCH, N]);
          const w = tf.tensor2d(ws, [BATCH, N]);
          return opt.minimize(() => tf.losses.logLoss(y, m.apply(x, { training: true }) as Tensor, w) as Scalar, true) as Scalar;
        }) as Scalar;
        total += (await cost.data())[0];
        cost.dispose();
      }
      this.losses.push(total / PER_EPOCH);
      onProgress({ epoch: e + 1, epochs: EPOCHS, loss: this.losses[this.losses.length - 1], losses: this.losses });
      await tf.nextFrame();
    }
    opt.dispose();
  }

  predict(cells: ArrayLike<number>, known: ArrayLike<number>, genre: number): Float32Array {
    const tf = this.tf!;
    const x = new Float32Array(IN);
    encodeInput(cells, known, genre, x);
    return tf.tidy(() => (this.model!.predict(tf.tensor2d(x, [1, IN])) as import("@tensorflow/tfjs").Tensor).dataSync() as Float32Array);
  }

  /** Probability of a hit in every empty cell, given what's already there. */
  suggestions(grid: Float32Array<ArrayBufferLike>, style: number) {
    const known = grid.map((c) => (c ? 1 : 0));
    const p = this.predict(grid, known, style);
    return p.map((q, i) => (grid[i] ? 0 : q));
  }

  complete(grid: Float32Array<ArrayBufferLike>, style: number, creativity: number) {
    const cells = Float32Array.from(grid);
    const known = cells.map((c) => (c ? 1 : 0));
    const p = this.predict(cells, known, style);
    const temp = 0.55 + creativity * 1.25;
    const thr = 0.62 - creativity * 0.25;
    for (let i = 0; i < N; i++) {
      if (cells[i]) continue;
      const q = sharpen(p[i], temp);
      if (q > thr || Math.random() < q * creativity * 0.35) cells[i] = 1;
    }
    return cells;
  }

  vary(grid: Float32Array<ArrayBufferLike>, style: number, creativity: number) {
    const cells = Float32Array.from(grid);
    const temp = 0.55 + creativity * 1.25;
    let known = cells.map(() => (Math.random() < 0.6 ? 1 : 0));
    for (let k = 0; k < 4; k++) {
      const p = this.predict(cells, known, style);
      for (let i = 0; i < N; i++) if (!known[i]) cells[i] = Math.random() < sharpen(p[i], temp) ? 1 : 0;
      known = cells.map(() => (Math.random() < 0.75 ? 1 : 0));
    }
    return cells;
  }

  /** Invent a groove from silence. `style` -1 picks one at random. */
  dream(style: number, creativity: number) {
    const genre = style >= 0 ? style : Math.floor(Math.random() * GENRES.length);
    const temp = 0.55 + creativity * 1.25;
    const ROUNDS = 12;
    const cells = new Float32Array(N);
    let known = new Float32Array(N);
    for (let k = 0; k < ROUNDS; k++) {
      const p = this.predict(cells, known, genre);
      for (let i = 0; i < N; i++) if (!known[i]) cells[i] = Math.random() < sharpen(p[i], temp) ? 1 : 0;
      const hide = 0.9 * (1 - (k + 1) / ROUNDS);
      known = cells.map(() => (Math.random() > hide ? 1 : 0));
    }
    return { cells, genre, bpm: GENRE_BPM[genre] };
  }
}
