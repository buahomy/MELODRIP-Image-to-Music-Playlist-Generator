// The 3D pop-it ring: five concentric rings of silicone bubbles (one per drum
// voice, 16 steps around), a glowing core that pulses with the output level,
// a light wedge that sweeps with the playhead, and ripples on every hit.
// three.js is loaded only when Beat Lab opens.

import { N, STEPS, VOICES } from "./patterns";
import type { BeatEngine } from "./engine";

export type Ring = { popAt: (i: number) => void; dispose: () => void };

const RING_R = (v: number) => 1.55 + v * 0.95;
const BUB_R = (v: number) => 0.23 + v * 0.045;
const stepPos = (v: number, s: number): [number, number] => {
  const a = (s / STEPS) * Math.PI * 2;
  return [RING_R(v) * Math.sin(a), -RING_R(v) * Math.cos(a)];
};

export async function createRing(
  host: HTMLElement,
  tip: HTMLElement,
  engine: BeatEngine,
  actions: { toggle: (i: number) => void; togglePlay: () => void }
): Promise<Ring | null> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
  const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
  const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
  const { UnrealBloomPass } = await import("three/examples/jsm/postprocessing/UnrealBloomPass.js");
  const { OutputPass } = await import("three/examples/jsm/postprocessing/OutputPass.js");

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: import("three").WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.touchAction = "none";
  host.appendChild(renderer.domElement);

  const ground = "#0d0830";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ground);
  scene.fog = new THREE.Fog(ground, 20, 36);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 11.5, 8.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = !reducedMotion;
  controls.maxPolarAngle = 1.2;
  controls.minDistance = 9;
  controls.maxDistance = 26;

  scene.add(new THREE.HemisphereLight("#d9c8ff", "#0b0626", 0.7));
  const key = new THREE.DirectionalLight("#ffe0f6", 1.6);
  key.position.set(4, 10, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight("#8c7bff", 1.2);
  rim.position.set(-5, 2, -4);
  scene.add(rim);
  const coreLight = new THREE.PointLight("#ff8fd8", 6, 9, 2);
  coreLight.position.set(0, 1.4, 0);
  scene.add(coreLight);

  // the back plate
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 6.75, 0.45, 160),
    new THREE.MeshStandardMaterial({ color: "#1a1150", roughness: 0.82, metalness: 0.08 })
  );
  plate.position.y = -0.23;
  scene.add(plate);

  type Bubble = {
    v: number; s: number; i: number;
    group: import("three").Group;
    dome: import("three").Mesh<import("three").SphereGeometry, import("three").MeshPhysicalMaterial>;
    rim: import("three").Mesh<import("three").TorusGeometry, import("three").MeshBasicMaterial>;
    k: number; pulse: number; hover: number; pop: number;
  };
  const bubbles: Bubble[] = [];
  const pickables: import("three").Object3D[] = [];
  VOICES.forEach((voice, v) => {
    const color = new THREE.Color(voice.color);
    const track = new THREE.Mesh(
      new THREE.TorusGeometry(RING_R(v), 0.014, 8, 220),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28 })
    );
    track.rotation.x = Math.PI / 2;
    track.position.y = 0.005;
    scene.add(track);
    const domeGeo = new THREE.SphereGeometry(BUB_R(v), 36, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    const rimGeo = new THREE.TorusGeometry(BUB_R(v), 0.02 + v * 0.004, 10, 56);
    for (let s = 0; s < STEPS; s++) {
      const [x, z] = stepPos(v, s);
      const group = new THREE.Group();
      group.position.set(x, 0.01, z);
      const dome = new THREE.Mesh(
        domeGeo,
        new THREE.MeshPhysicalMaterial({
          color, emissive: color, emissiveIntensity: 0, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25,
          transparent: true, opacity: 0.2,
        })
      );
      const ring = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      ring.rotation.x = Math.PI / 2;
      group.add(dome, ring);
      scene.add(group);
      const i = v * STEPS + s;
      const b: Bubble = { v, s, i, group, dome, rim: ring, k: engine.grid[i], pulse: 0, hover: 0, pop: 0 };
      dome.userData.bubble = b;
      pickables.push(dome);
      bubbles.push(b);
    }
  });

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 48, 32),
    new THREE.MeshPhysicalMaterial({ color: "#3a1c80", emissive: "#ff8fd8", emissiveIntensity: 0.18, roughness: 0.25, clearcoat: 1 })
  );
  core.position.y = 0.25;
  core.userData.core = true;
  scene.add(core);
  pickables.push(core);

  // playhead: a soft wedge of light sweeping clockwise
  const width = (Math.PI * 2) / STEPS;
  const wedge = new THREE.Mesh(
    new THREE.RingGeometry(1.05, 6.25, 48, 1, Math.PI / 2 - width / 2, width),
    new THREE.MeshBasicMaterial({
      color: "#ffe6fa", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  wedge.rotation.x = -Math.PI / 2;
  wedge.position.y = 0.02;
  const wedgePivot = new THREE.Group();
  wedgePivot.add(wedge);
  scene.add(wedgePivot);

  // ripples on each hit
  const ripples = Array.from({ length: 24 }, () => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    return { m, life: 0, r: 0 };
  });
  let rippleNext = 0;
  const ripple = (b: Bubble) => {
    if (reducedMotion) return;
    const r = ripples[rippleNext++ % ripples.length];
    r.m.position.set(b.group.position.x, 0.03, b.group.position.z);
    r.m.material.color.set(VOICES[b.v].color);
    r.life = 1;
    r.r = BUB_R(b.v);
    r.m.visible = true;
  };

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.45, 0.34));
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the whole plate in view on narrow screens
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const fit = 7.2 / Math.tan(Math.min(half, Math.atan(Math.tan(half) * camera.aspect)));
    camera.position.copy(camera.position.clone().normalize().multiplyScalar(Math.max(fit, 12)));
    controls.maxDistance = Math.max(26, fit * 1.6);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // picking: a short tap pops a bubble, a drag orbits
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; t: number } | null = null;
  let hovered: Bubble | null = null;
  let pointer: PointerEvent | null = null;
  const el = renderer.domElement;
  const pick = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(pickables, false)[0]?.object ?? null;
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved > 8 || !quick) return;
    const hit = pick(e);
    if (!hit) return;
    if (hit.userData.core) actions.togglePlay();
    else actions.toggle((hit.userData.bubble as Bubble).i);
  };
  // hover tooltips only for a real mouse; on iPhone a tap is a tap
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse") pointer = e;
  };
  const onLeave = () => {
    pointer = null;
    hovered = null;
    tip.hidden = true;
    el.style.cursor = "";
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);

  const clock = new THREE.Clock();
  let frameId = 0;
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update();

    if (pointer) {
      const obj = pick(pointer);
      hovered = (obj?.userData.bubble as Bubble | undefined) ?? null;
      el.style.cursor = obj ? "pointer" : "";
      const r = el.getBoundingClientRect();
      if (hovered) {
        const g = engine.ghosts[hovered.i];
        tip.textContent =
          `${VOICES[hovered.v].name} · step ${hovered.s + 1}` +
          (!engine.grid[hovered.i] && engine.showGhosts && g > 0.3 ? ` · AI ${Math.round(g * 100)}%` : "");
      } else if (obj?.userData.core) {
        tip.textContent = engine.playing ? "Stop" : "Play";
      }
      tip.hidden = !obj;
      tip.style.left = `${pointer.clientX - r.left}px`;
      tip.style.top = `${pointer.clientY - r.top}px`;
      pointer = null;
    }

    // playhead and hit pulses follow the audio clock
    let kickPulse = 0;
    const ctx = engine.kit.ctx;
    if (engine.playing && ctx) {
      const now = ctx.currentTime;
      while (engine.hits.length && engine.hits[0].t <= now) {
        const h = engine.hits.shift()!;
        const b = bubbles[h.v * STEPS + h.s];
        b.pulse = 1;
        ripple(b);
        if (h.v === 0) kickPulse = 1;
      }
      while (engine.ticks.length > 1 && engine.ticks[1].t <= now) engine.ticks.shift();
      if (engine.ticks.length && engine.ticks[0].t <= now) {
        const cur = engine.ticks[0];
        const frac = Math.min(1, (now - cur.t) / engine.stepDur());
        wedgePivot.rotation.y = -((cur.s + frac) / STEPS) * Math.PI * 2;
        engine.setStep(cur.s);
      }
    }
    const wm = wedge.material;
    wm.opacity += ((engine.playing ? 0.12 : 0) - wm.opacity) * Math.min(1, dt * 8);

    const ease = Math.min(1, dt * 14);
    for (const b of bubbles) {
      const on = engine.grid[b.i];
      b.k += (on - b.k) * ease;
      b.pulse = Math.max(0, b.pulse - dt * 3.2);
      b.pop = Math.max(0, b.pop - dt * 2.6);
      b.hover += ((b === hovered ? 1 : 0) - b.hover) * ease;
      const ghost = engine.showGhosts ? engine.ghosts[b.i] * (1 - b.k) : 0;
      // pressed silicone: an active bubble sinks and glows
      b.dome.scale.y = 1 - 0.55 * b.k + b.pop * 0.6;
      const m = b.dome.material;
      m.opacity = 0.18 + 0.78 * b.k + ghost * 0.35;
      m.emissiveIntensity = 0.75 * b.k + b.pulse * 2.4 + ghost * 0.9;
      b.rim.material.opacity = 0.3 + 0.6 * b.k + b.hover * 0.45 + ghost * 0.4;
      const sc = 1 + (reducedMotion ? 0 : b.pulse * 0.32) + b.hover * 0.1;
      b.group.scale.set(sc, sc, sc);
    }
    for (const r of ripples) {
      if (!r.m.visible) continue;
      r.life -= dt * 2;
      if (r.life <= 0) {
        r.m.visible = false;
        continue;
      }
      const s = r.r * (1 + (1 - r.life) * 1.8);
      r.m.scale.set(s, s, s);
      r.m.material.opacity = r.life * 0.55;
    }

    const lvl = engine.kit.level();
    const cm = core.material;
    cm.emissiveIntensity += (0.18 + lvl * 3.2 + kickPulse * 1.2 - cm.emissiveIntensity) * Math.min(1, dt * 10);
    coreLight.intensity = 3 + cm.emissiveIntensity * 8;
    const cs = 1 + (reducedMotion ? 0 : lvl * 0.5);
    core.scale.set(cs, cs, cs);

    composer.render();
    frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);

  return {
    popAt: (i) => {
      const b = bubbles[i];
      if (b && i < N) {
        b.pop = 1;
        b.pulse = Math.max(b.pulse, 0.6);
      }
    },
    // iOS limits live WebGL contexts per page, so free everything on the way out.
    dispose: () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as import("three").Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as import("three").Material | import("three").Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    },
  };
}
