// The groove model: a small denoising network trained on the device.
// Input: 80 cell values (hits we know about), 80 "known" flags and an 8-way
// style. Output: the chance of a hit in every cell. It's trained like Coconet
// (random cells are hidden and it learns to fill them), so one model can
// complete a pattern, vary it, or invent one by repeated resampling.
//
// All of TensorFlow.js lives in a Web Worker (groove.worker.ts): loading the
// library, training, and every prediction. The page never parses TensorFlow,
// so the drums and the ring stay smooth from the first second. Predictions
// come back over postMessage in a few milliseconds. If workers aren't
// available, the same code runs here instead, yielding between batches.

import { GENRES, GENRE_BPM, N } from "./patterns";
import type { Progress } from "./train-core";
export type { Progress } from "./train-core";

type Predict = (cells: Float32Array, known: Float32Array, genre: number) => Promise<Float32Array>;

const sharpen = (p: number, temp: number) => {
  const a = Math.pow(p, 1 / temp);
  const b = Math.pow(1 - p, 1 / temp);
  return a / (a + b);
};

export class GrooveModel {
  private predictFn: Predict | null = null;
  private worker: Worker | null = null;
  losses: number[] = [];

  get ready() {
    return this.predictFn !== null;
  }

  /** Load the model this device trained before, or train one now. */
  async start(onProgress: (p: Progress) => void): Promise<{ trained: boolean; seconds: number }> {
    const track = (p: Progress) => {
      this.losses = p.losses;
      onProgress(p);
    };
    try {
      return await this.startWorker(track);
    } catch {
      return await this.startHere(track);
    }
  }

  private startWorker(onProgress: (p: Progress) => void) {
    return new Promise<{ trained: boolean; seconds: number }>((resolve, reject) => {
      if (typeof Worker === "undefined") return reject(new Error("no workers"));
      const worker = new Worker(new URL("./groove.worker.ts", import.meta.url), { type: "module" });
      const pending = new Map<number, (r: Float32Array) => void>();
      let nextId = 1;
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === "progress") onProgress(m as Progress);
        else if (m.type === "ready") {
          this.worker = worker;
          this.predictFn = (cells, known, genre) =>
            new Promise((res) => {
              const id = nextId++;
              pending.set(id, res);
              worker.postMessage({ type: "predict", id, cells, known, genre });
            });
          resolve({ trained: m.trained, seconds: m.seconds });
        } else if (m.type === "result") {
          pending.get(m.id)?.(m.result);
          pending.delete(m.id);
        } else if (m.type === "error") {
          worker.terminate();
          reject(new Error(m.message));
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error("worker error"));
      };
      worker.postMessage({ type: "init" });
    });
  }

  /** Fallback without workers: same model on this thread. */
  private async startHere(onProgress: (p: Progress) => void) {
    const tf = await import("@tensorflow/tfjs");
    const { buildModel, encodeInput, IN, MODEL_KEY, trainModel } = await import("./train-core");
    await tf.setBackend("cpu");
    await tf.ready();
    const started = performance.now();
    let trained = false;
    let model: import("@tensorflow/tfjs").LayersModel;
    try {
      model = await tf.loadLayersModel(MODEL_KEY);
    } catch {
      model = buildModel(tf);
      await trainModel(tf, model, onProgress, () => tf.nextFrame().then(() => undefined));
      trained = true;
      try {
        await model.save(MODEL_KEY);
      } catch {}
    }
    this.predictFn = async (cells, known, genre) => {
      const x = new Float32Array(IN);
      encodeInput(cells, known, genre, x);
      return tf.tidy(() => (model.predict(tf.tensor2d(x, [1, IN])) as import("@tensorflow/tfjs").Tensor).dataSync() as Float32Array);
    };
    return { trained, seconds: trained ? (performance.now() - started) / 1000 : 0 };
  }

  private predict(cells: ArrayLike<number>, known: ArrayLike<number>, genre: number) {
    return this.predictFn!(Float32Array.from(cells), Float32Array.from(known), genre);
  }

  /** Probability of a hit in every empty cell, given what's already there. */
  async suggestions(grid: Float32Array<ArrayBufferLike>, style: number) {
    const known = grid.map((c) => (c ? 1 : 0));
    const p = await this.predict(grid, known, style);
    return p.map((q, i) => (grid[i] ? 0 : q));
  }

  async complete(grid: Float32Array<ArrayBufferLike>, style: number, creativity: number) {
    const cells = Float32Array.from(grid);
    const known = cells.map((c) => (c ? 1 : 0));
    const p = await this.predict(cells, known, style);
    const temp = 0.55 + creativity * 1.25;
    const thr = 0.62 - creativity * 0.25;
    for (let i = 0; i < N; i++) {
      if (cells[i]) continue;
      const q = sharpen(p[i], temp);
      if (q > thr || Math.random() < q * creativity * 0.35) cells[i] = 1;
    }
    return cells;
  }

  async vary(grid: Float32Array<ArrayBufferLike>, style: number, creativity: number) {
    const cells = Float32Array.from(grid);
    const temp = 0.55 + creativity * 1.25;
    let known = cells.map(() => (Math.random() < 0.6 ? 1 : 0));
    for (let k = 0; k < 4; k++) {
      const p = await this.predict(cells, known, style);
      for (let i = 0; i < N; i++) if (!known[i]) cells[i] = Math.random() < sharpen(p[i], temp) ? 1 : 0;
      known = cells.map(() => (Math.random() < 0.75 ? 1 : 0));
    }
    return cells;
  }

  /** Invent a groove from silence. `style` -1 picks one at random. */
  async dream(style: number, creativity: number) {
    const genre = style >= 0 ? style : Math.floor(Math.random() * GENRES.length);
    const temp = 0.55 + creativity * 1.25;
    const ROUNDS = 12;
    const cells = new Float32Array(N);
    let known = new Float32Array(N);
    for (let k = 0; k < ROUNDS; k++) {
      const p = await this.predict(cells, known, genre);
      for (let i = 0; i < N; i++) if (!known[i]) cells[i] = Math.random() < sharpen(p[i], temp) ? 1 : 0;
      const hide = 0.9 * (1 - (k + 1) / ROUNDS);
      known = cells.map(() => (Math.random() > hide ? 1 : 0));
    }
    return { cells, genre, bpm: GENRE_BPM[genre] };
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.predictFn = null;
  }
}
