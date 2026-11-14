// Runs the whole groove model off the main thread: loads TensorFlow.js, loads
// the model this device trained before (or trains one, reporting progress),
// then answers prediction requests. The page stays smooth throughout.

import * as tf from "@tensorflow/tfjs";
import { buildModel, encodeInput, IN, MODEL_KEY, trainModel } from "./train-core";

let model: tf.LayersModel | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      await tf.setBackend("cpu");
      await tf.ready();
      const started = performance.now();
      let trained = false;
      try {
        model = await tf.loadLayersModel(MODEL_KEY);
      } catch {
        const fresh = buildModel(tf);
        await trainModel(tf, fresh, (p) => self.postMessage({ type: "progress", ...p }), async () => {});
        try {
          await fresh.save(MODEL_KEY);
        } catch {}
        model = fresh;
        trained = true;
      }
      self.postMessage({ type: "ready", trained, seconds: trained ? (performance.now() - started) / 1000 : 0 });
    } else if (m.type === "predict" && model) {
      const x = new Float32Array(IN);
      encodeInput(m.cells, m.known, m.genre, x);
      const result = tf.tidy(() => (model!.predict(tf.tensor2d(x, [1, IN])) as tf.Tensor).dataSync() as Float32Array);
      (self as unknown as Worker).postMessage({ type: "result", id: m.id, result }, [result.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
};
