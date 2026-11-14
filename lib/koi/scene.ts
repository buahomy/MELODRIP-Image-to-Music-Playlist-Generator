// The crystal koi: a GLB model drawn with three.js on a transparent canvas over
// the pond video. Its body bends in a swimming wave (vertex shader), it hovers
// nose-down toward the lotus, and on cue it dives into the water.
// three.js and the model load only when the koi scrolls into view.

export const KOI_GLB =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261104_151843_47d87652-1c40-465c-b0d6-cd94c22a9d3e.glb";

export type Koi = {
  /** Swim hard and dive out of the bottom of the frame; resolves when it's under. */
  dive: () => Promise<void>;
  /** A quick startled flick, e.g. when tapped. */
  flick: () => void;
  setVisible: (on: boolean) => void;
  dispose: () => void;
};

type Pose = { x: number; y: number; s: number; yaw: number; pitch: number; roll: number };

// x, y in half-frame units (-1..1); s = fish length as a share of frame height;
// yaw 0 faces right, negative pitch is nose down.
// Hovers in the upper half so the copy and buttons below stay clear.
const HOVER: Pose = { x: 0.0, y: 0.4, s: 0.5, yaw: 0.18, pitch: -0.92, roll: 0.05 };
const DIVE: Pose = { x: 0.16, y: -1.6, s: 0.5, yaw: 0.12, pitch: -1.45, roll: 0.0 };

export async function createKoi(canvas: HTMLCanvasElement, onReady: () => void): Promise<Koi | null> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: import("three").WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xc6b2ff, 0x2a1c80, 0.7));
  const key = new THREE.DirectionalLight(0xffc8f0, 1.6);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8c7bff, 2.8);
  rim.position.set(-5, -1, -4);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  let fh = 2 * Math.tan(THREE.MathUtils.degToRad(15)) * 10;
  let fw = fh;

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fw = fh * camera.aspect;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // rig (position + heading) → body (scale) → mesh
  const rig = new THREE.Group();
  const body = new THREE.Group();
  rig.add(body);
  rig.rotation.order = "XYZ";
  scene.add(rig);

  const uniforms = { uTime: { value: 0 }, uAmp: { value: 0.075 } };

  const gltf = await new GLTFLoader().loadAsync(KOI_GLB).catch(() => null);
  if (!gltf) {
    renderer.dispose();
    return null;
  }

  // Bake every mesh into one normalised geometry: nose to +X, length 1, centred.
  let geometry: import("three").BufferGeometry | null = null;
  let texture: import("three").Texture | null = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as import("three").Mesh;
    if (!m.isMesh || geometry) return;
    geometry = m.geometry.clone();
    geometry.applyMatrix4(m.matrixWorld);
    const mat = m.material as import("three").MeshStandardMaterial;
    texture = mat?.map ?? null;
  });
  if (!geometry) {
    renderer.dispose();
    return null;
  }
  const geo = geometry as import("three").BufferGeometry;
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  if (size.z >= size.x && size.z >= size.y) geo.rotateY(Math.PI / 2);
  else if (size.y >= size.x && size.y >= size.z) geo.rotateZ(-Math.PI / 2);
  geo.rotateY(Math.PI); // this model faces -X otherwise
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);
  geo.boundingBox!.getSize(size);
  const len = Math.max(size.x, size.y, size.z);
  geo.scale(1 / len, 1 / len, 1 / len);
  geo.computeVertexNormals();

  const tex = texture as import("three").Texture | null;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  // Lilac-pink crystal: clearcoat, iridescence and a violet inner glow.
  const material = new THREE.MeshPhysicalMaterial({
    color: tex ? 0xc9b4ff : 0xb8a4ff,
    map: tex,
    emissiveMap: tex,
    emissive: 0x7a46ff,
    emissiveIntensity: 0.55,
    roughness: 0.18,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    iridescence: 0.85,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: [260, 700],
    sheen: 0.25,
    sheenColor: new THREE.Color(0xff9ce6),
    transparent: true,
    opacity: 0.95,
    envMapIntensity: 0.75,
    side: THREE.DoubleSide,
  });
  // Swimming: a travelling wave that grows toward the tail (head is +X).
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.vertexShader =
      "uniform float uTime;\nuniform float uAmp;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position);
        float tail = clamp((0.32 - position.x) / 0.82, 0.0, 1.0);
        transformed.z += sin(position.x * 5.2 - uTime * 6.5) * uAmp * (0.15 + 1.6 * tail * tail);
        transformed.y += cos(position.x * 2.6 - uTime * 3.25) * uAmp * 0.12 * tail;`
      );
  };
  const mesh = new THREE.Mesh(geo, material);
  body.add(mesh);
  onReady();

  // ---- animation ----
  const cur: Pose = { ...HOVER, y: HOVER.y - 0.25 }; // glide up into place on first show
  let target: Pose = HOVER;
  let ease = 2.2; // response rate
  let swimTime = 0;
  let burst = 0; // extra swim speed, decays
  let visible = true;
  let frame = 0;
  const clock = new THREE.Clock();

  const render = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    burst = Math.max(0, burst - dt * 0.9);
    const speedUp = Math.min(burst, 1.6);
    if (!reducedMotion) swimTime += dt * (1 + speedUp);
    uniforms.uTime.value = swimTime;
    uniforms.uAmp.value = 0.07 + 0.03 * speedUp;

    const k = reducedMotion ? 1 : 1 - Math.exp(-ease * dt);
    (Object.keys(cur) as (keyof Pose)[]).forEach((p) => (cur[p] += (target[p] - cur[p]) * k));
    const bob = reducedMotion ? 0 : Math.sin(0.9 * t) * 0.02;
    rig.position.set((cur.x * fw) / 2, ((cur.y + bob) * fh) / 2, 0);
    rig.rotation.set(
      cur.roll + (reducedMotion ? 0 : Math.sin(0.7 * t) * 0.04),
      cur.yaw + (reducedMotion ? 0 : Math.sin(0.5 * t) * 0.06),
      cur.pitch
    );
    body.scale.setScalar(cur.s * fh);
    renderer.render(scene, camera);
    if (visible) frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return {
    dive: () =>
      new Promise((resolve) => {
        burst = 1.6;
        target = DIVE;
        ease = 3.4;
        setTimeout(resolve, reducedMotion ? 0 : 900);
      }),
    flick: () => {
      burst = Math.max(burst, 1.2);
    },
    setVisible: (on) => {
      if (on === visible) return;
      visible = on;
      if (on) {
        clock.getDelta();
        frame = requestAnimationFrame(render);
      } else cancelAnimationFrame(frame);
    },
    // iOS limits live WebGL contexts per page, so free everything on the way out.
    dispose: () => {
      visible = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      geo.dispose();
      material.dispose();
      tex?.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
