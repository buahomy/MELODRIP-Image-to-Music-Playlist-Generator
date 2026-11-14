// Shared groove-model training code. Runs inside a Web Worker (so training
// never blocks the drum scheduler or the UI) and as a main-thread fallback.

import { CORPUS, GENRES, N, STEPS, VOICES } from "./patterns";

type TF = typeof import("@tensorflow/tfjs");
type LayersModel = import("@tensorflow/tfjs").LayersModel;

export const IN = N * 2 + GENRES.length;
export const MODEL_KEY = "indexeddb://melodrip-groove-v1";

export type Progress = { epoch: number; epochs: number; loss: number; losses: number[] };

export function encodeInput(cells: ArrayLike<number>, known: ArrayLike<number>, genre: number, out: Float32Array, offset = 0) {
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

export const EPOCHS = 32; // the loss curve flattens around here

export function buildModel(tf: TF): LayersModel {
  const m = tf.sequential();
  m.add(tf.layers.dense({ inputShape: [IN], units: 192, activation: "relu" }));
  m.add(tf.layers.dropout({ rate: 0.15 }));
  m.add(tf.layers.dense({ units: 192, activation: "relu" }));
  m.add(tf.layers.dense({ units: N, activation: "sigmoid" }));
  return m;
}

/** Train `m`; `pause` runs between batches (a frame yield on the main thread, nothing in a worker). */
export async function trainModel(tf: TF, m: LayersModel, onProgress: (p: Progress) => void, pause: () => Promise<void>) {
  type Scalar = import("@tensorflow/tfjs").Scalar;
  type Tensor = import("@tensorflow/tfjs").Tensor;
  const BATCH = 64;
  const PER_EPOCH = 10;
  const losses: number[] = [];
  const opt = tf.train.adam(0.003);
  for (let e = 0; e < EPOCHS; e++) {
    let total = 0;
    for (let b = 0; b < PER_EPOCH; b++) {
      const xs = new Float32Array(BATCH * IN);
      const ys = new Float32Array(BATCH * N);
      const ws = new Float32Array(BATCH * N);
      for (let r = 0; r < BATCH; r++) trainingExample(xs, ys, ws, r);
      const cost = tf.tidy(() => {
        const x = tf.tensor2d(xs, [BATCH, IN]);
        const y = tf.tensor2d(ys, [BATCH, N]);
        const w = tf.tensor2d(ws, [BATCH, N]);
        return opt.minimize(() => tf.losses.logLoss(y, m.apply(x, { training: true }) as Tensor, w) as Scalar, true) as Scalar;
      }) as Scalar;
      total += (await cost.data())[0];
      cost.dispose();
      await pause();
    }
    losses.push(total / PER_EPOCH);
    onProgress({ epoch: e + 1, epochs: EPOCHS, loss: losses[losses.length - 1], losses: [...losses] });
  }
  opt.dispose();
  return losses;
}
