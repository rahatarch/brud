"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { brudConfig } from "@/lib/brudConfig";
import { createRimGlassMaterial, setRimStrength } from "./RimGlassMaterial";
import { createFloorMaterial } from "./FloorMaterial";
import { TIERS, detectTier, stepDown, prefersReducedMotion } from "./quality";

const DRACO_PATH = "/draco/gltf/";

/* -------------------------------------------------- environment gradient */
// EnvRamp from BrudWorld: only reflections see it, the background stays black.
function useEnvGradient() {
  return useMemo(() => {
    const stops = brudConfig.env.gradient;
    // PMREMGenerator sizes its cubemap as image.width / 4, so the source must be
    // wide enough to give a power-of-two cube size. A 1px-wide texture yields
    // 0.25 and produces invalid CUBEUV_* defines in three's cube-UV chunk.
    const w = 256;
    const h = 64;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < h; i++) {
      const t = i / (h - 1);
      const [a, b] = t < 0.46 ? [stops[0], stops[1]] : [stops[1], stops[2]];
      const k = t < 0.46 ? t / 0.46 : (t - 0.46) / 0.54;
      const rgb = [0, 1, 2].map((c) => Math.round(THREE.MathUtils.lerp(a[c], b[c], k) * 255));
      for (let x = 0; x < w; x++) {
        const p = (i * w + x) * 4;
        data[p] = rgb[0];
        data[p + 1] = rgb[1];
        data[p + 2] = rgb[2];
        data[p + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

/* ------------------------------------------------------------------ marks */
// Blender appends .001 to a node when the name is already taken, and glTF
// strips the dot, so a mesh can arrive as "Brud_Logo001". Map it back.
const canonicalName = (name) => name.replace(/[._]?\d+$/, "");

function buildMarks(gltf, { mirrored = false } = {}) {
  const root = gltf.scene.clone(true);
  const marks = {};

  // The v2 GLBs have no parent nodes, but attaching to the root keeps this
  // safe if an asset is ever re-exported with nesting.
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  root.updateWorldMatrix(true, true);
  meshes.forEach((child) => root.attach(child));

  meshes.forEach((child) => {
    child.name = canonicalName(child.name);
    const cfg = brudConfig.marks[child.name] || brudConfig.marks.Brud_Logo;

    const material = createRimGlassMaterial({
      baseColor: cfg.baseColor,
      roughness: cfg.roughness,
      metalness: cfg.metalness ?? 0,
      rimMul: mirrored ? cfg.rimMul * brudConfig.reflection.strength : cfg.rimMul,
      rimRange: cfg.rimRange,
      envIntensity: mirrored ? 0.5 : 1.4,
    });

    if (mirrored) {
      material.side = THREE.BackSide;
      material.transparent = true;
      material.opacity = brudConfig.reflection.strength;
      material.depthWrite = false;
    }

    // v2 assets are normalised to a longest side of 1.0, so `width` is the
    // on-screen width in world units and needs no correction factor.
    if (cfg.position) child.position.set(...cfg.position);
    child.scale.setScalar(cfg.width ?? 1);
    child.rotation.set(0, 0, 0);

    child.material = material;
    child.castShadow = false;
    child.receiveShadow = false;
    child.renderOrder = mirrored ? 0 : 2;
    marks[child.name] = child;
  });

  return { root, marks };
}

/* ------------------------------------------------------------------ scene */
// Post-processing is OFF by default: the EffectComposer reliably kills the
// WebGL context on this scene (canvas goes white). Opt in with ?fx=1 while the
// composer is being fixed.
const useNoFx = () => typeof window === "undefined" || !window.location.search.includes("fx=1");

const Scene = forwardRef(function Scene({ tier, onFrame, onTierDrop }, ref) {
  const noFx = useNoFx();
  const gltf = useGLTF(TIERS[tier].model, DRACO_PATH);
  const env = useEnvGradient();
  const { scene, gl } = useThree();

  // three.js cannot use a raw equirectangular texture as scene.environment:
  // its cube-UV shader chunk expects a PMREM-processed mipmap chain. Feeding it
  // the raw DataTexture breaks every MeshStandardMaterial in the scene.
  const envRT = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(env);
    pmrem.dispose();
    return rt;
  }, [gl, env]);

  const real = useMemo(() => buildMarks(gltf), [gltf]);
  const mirror = useMemo(() => buildMarks(gltf, { mirrored: true }), [gltf]);
  const floorMaterial = useMemo(() => createFloorMaterial(), []);

  const groupRef = useRef();
  const parallaxRef = useRef();
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const rate = useRef({ n: 0, t: 0, fps: 0 });

  // Software rendering (SwiftShader / llvmpipe) looks identical but runs at a
  // few frames per second. Report the real renderer so it can be ruled out.
  const gpu = useMemo(() => {
    try {
      const ext = gl.getContext().getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    } catch {
      return "unknown";
    }
  }, [gl]);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    scene.environment = envRT.texture;
    scene.environmentIntensity = brudConfig.env.intensity;
    scene.background = new THREE.Color(brudConfig.env.background);
    // Tone mapping must run exactly once. With the composer it lives at the end
    // of the effect chain; without it, the renderer has to do the job or every
    // value above 1.0 clips to white.
    gl.toneMapping = noFx ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = brudConfig.exposure ?? 1.0;
    return () => {
      scene.environment = null;
    };
  }, [scene, envRT, gl, noFx]);

  useEffect(() => () => envRT.dispose(), [envRT]);

  useEffect(() => {
    const onMove = (e) => {
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useImperativeHandle(ref, () => ({
    marks: real.marks,
    setTransform(name, { position, rotation, scale } = {}) {
      [real.marks[name], mirror.marks[name]].forEach((target) => {
        if (!target) return;
        if (position) target.position.set(...position);
        if (rotation) target.rotation.set(...rotation);
        if (scale) target.scale.setScalar(scale);
      });
    },
    setRimStrength(name, value) {
      setRimStrength(real.marks[name]?.material, value);
      setRimStrength(mirror.marks[name]?.material, value * brudConfig.reflection.strength);
    },
  }));

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const { motion } = brudConfig;

    const p = pointer.current;
    p.x += (p.tx - p.x) * motion.pointerEase;
    p.y += (p.ty - p.y) * motion.pointerEase;

    // Parallax: the marks tilt and slide against the cursor, the floor does
    // not, so the ground stays put and the depth reads correctly.
    if (parallaxRef.current && !reduced) {
      const g = parallaxRef.current;
      g.rotation.y = p.x * motion.pointerTilt;
      g.rotation.x = p.y * motion.pointerTilt * 0.4;
      g.position.x = -p.x * motion.parallax[0];
      g.position.y = p.y * motion.parallax[1];
    }

    const logo = real.marks.Brud_Logo;
    const logoGhost = mirror.marks.Brud_Logo;
    if (logo && !reduced) {
      const spin = Math.sin(t * 0.35) * motion.idleRotation;
      logo.rotation.y = spin;
      if (logoGhost) logoGhost.rotation.y = spin;
    }

    onFrame?.(t, real.marks);

    // Adaptive resolution. This scene is fill-rate bound, so the honest way to
    // hold a steady frame rate on an unknown laptop is to render fewer pixels
    // until it is fast enough. One-way ladder: never step back up, because
    // that oscillates and looks worse than a stable lower resolution.
    const r = rate.current;
    r.n += 1;
    r.t += delta;
    if (r.t >= 0.5) {
      r.fps = Math.round(r.n / r.t);
      r.n = 0;
      r.t = 0;
      r.windows = (r.windows || 0) + 1;
      r.tick = true;

      // Skip the first window: shader compilation and texture upload land
      // there and are not representative of steady state.
      if (r.windows > 1 && r.fps < 24) {
        // Go through R3F's setDpr, not gl.setPixelRatio: R3F owns the pixel
        // ratio and re-applies its own value on the next resize or re-render.
        const cur = r.dpr ?? state.viewport.dpr;
        if (cur > 0.55) {
          r.dpr = Math.max(0.5, cur - 0.25);
          state.setDpr(r.dpr);
        } else if (!r.tierDropped) {
          // Already at the floor resolution and still slow: shed geometry.
          r.tierDropped = true;
          onTierDrop?.();
        }
      }
    }

    // Debug instrumentation is not free: it allocates vectors and projects 24
    // bounding-box corners. Twice a second is plenty for a readout.
    if (typeof window !== "undefined" && r.tick) {
      r.tick = false;
      // info.autoReset clears the counters before each render, so reading them
      // in useFrame always returned 0. Read the previous frame, then reset.
      state.gl.info.autoReset = false;
      const v = new THREE.Vector3();
      const marks = Object.entries(real.marks).map(([name, m]) => {
        m.getWorldPosition(v);
        const screen = v.clone().project(state.camera);
        // Project the mesh's bounding box to screen fractions so placement can
        // be compared with the reference image numerically.
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        const c = new THREE.Vector3();
        for (let i = 0; i < 8; i++) {
          c.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
          m.localToWorld(c).project(state.camera);
          const fx = (c.x + 1) / 2;
          const fy = (1 - c.y) / 2;
          minX = Math.min(minX, fx); maxX = Math.max(maxX, fx);
          minY = Math.min(minY, fy); maxY = Math.max(maxY, fy);
        }
        const r3 = (n) => +n.toFixed(3);
        return {
          name,
          visible: m.visible,
          inFrustum: !m.frustumCulled || true,
          world: v.toArray().map((n) => +n.toFixed(2)),
          ndc: [+screen.x.toFixed(2), +screen.y.toFixed(2), +screen.z.toFixed(2)],
          // fractions of the frame: centre x/y and width
          cx: r3((minX + maxX) / 2),
          cy: r3((minY + maxY) / 2),
          w: r3(maxX - minX),
          h: r3(maxY - minY),
          mat: m.material?.type,
          prog: !!m.material?.program,
        };
      });
      window.__brudInfo = {
        fps: r.fps,
        gpu,
        dpr: state.gl.getPixelRatio(),
        calls: state.gl.info.render.calls,
        triangles: state.gl.info.render.triangles,
        contextLost: state.gl.getContext().isContextLost(),
        cam: state.camera.position.toArray().map((n) => +n.toFixed(2)),
        sceneChildren: state.scene.children.length,
        marks,
      };
      state.gl.info.reset();
    }

  });

  const { floor, bloom } = brudConfig;
  const L = brudConfig.lights;

  return (
    <>
      <ambientLight intensity={L.ambient.intensity} color={L.ambient.color} />
      <pointLight {...L.silverKey} distance={60} decay={2} />
      <pointLight {...L.silverLow} distance={60} decay={2} />
      <pointLight {...L.specTop} distance={60} decay={2} />
      <pointLight {...L.rimRed} distance={50} decay={2} />
      <pointLight {...L.rimRedLow} distance={40} decay={2} />

      <group ref={groupRef}>
        {/* The floor is outside the parallax group so the ground never slides. */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, floor.y, 0]}
          material={floorMaterial}
          renderOrder={1}
        >
          <planeGeometry args={floor.size} />
        </mesh>

        <group ref={parallaxRef}>
          {/* mirrored copies, drawn first and veiled by the floor plane */}
          <group position={[0, floor.y * 2, 0]} scale={[1, -1, 1]}>
            <primitive object={mirror.root} />
          </group>

          <primitive object={real.root} />
        </group>
      </group>

      {!noFx && (
      <EffectComposer disableNormalPass multisampling={0}>
        <Bloom
          luminanceThreshold={bloom.threshold}
          luminanceSmoothing={bloom.smoothing}
          intensity={bloom.strength}
          radius={bloom.radius}
          mipmapBlur
        />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
      )}
    </>
  );
});

/* ------------------------------------------------------------------- root */
const BrudHero = forwardRef(function BrudHero({ onFrame, className }, ref) {
  const [tier, setTier] = useState(null);
  // Bumping this key remounts the Canvas, which is the only reliable way to
  // get a fresh WebGL context after the browser drops one.
  const [generation, setGeneration] = useState(0);
  const recovering = useRef(false);

  useEffect(() => setTier(detectTier()), []);

  if (!tier) return <div className={className} aria-hidden="true" />;

  const { camera } = brudConfig;

  const handleCreated = ({ gl, camera: cam }) => {
    cam.lookAt(...brudConfig.camera.target);

    const canvas = gl.domElement;

    canvas.addEventListener("webglcontextlost", (event) => {
      // Without preventDefault the browser will never fire a restore event.
      event.preventDefault();
      if (typeof window !== "undefined") {
        window.__brudLost = (window.__brudLost || 0) + 1;
      }
      if (recovering.current) return;
      recovering.current = true;
      // Drop to a cheaper tier and rebuild the context once the GPU settles.
      setTimeout(() => {
        setTier((t) => stepDown(t));
        setGeneration((g) => g + 1);
        recovering.current = false;
      }, 600);
    });

    canvas.addEventListener("webglcontextrestored", () => {
      if (typeof window !== "undefined") {
        window.__brudRestored = (window.__brudRestored || 0) + 1;
      }
    });
  };

  return (
    <div className={className}>
      <Canvas
        key={generation}
        dpr={TIERS[tier].dpr}
        // antialias costs a full extra multisampled buffer; the scene has no
        // hard geometric edges that need it, and dropping it lowers the odds of
        // the context being evicted under memory pressure.
        gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
        camera={{ position: camera.position, fov: camera.fov, near: camera.near, far: camera.far }}
        onCreated={handleCreated}
      >
        <Scene ref={ref} tier={tier} onFrame={onFrame} onTierDrop={() => setTier((t) => stepDown(t))} />
      </Canvas>
    </div>
  );
});

Object.values(TIERS).forEach((t) => useGLTF.preload(t.model, DRACO_PATH));

export default BrudHero;
