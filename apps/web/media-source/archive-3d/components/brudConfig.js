// Every tunable value for the hero 3D scene lives here.
// Blender watt values do not map to three.js intensities, so the light rig is
// re-balanced for WebGL while keeping the same intent: silver key from the
// left, red rim from behind, black bodies, streaky floor.

export const brudConfig = {
  // Reference frame 2 sits at eye level: the camera is level with its aim
  // point, so the horizon line lands on the middle of the frame and the floor
  // reads as a shallow band at the bottom instead of a steep plane.
  camera: {
    position: [0, 1.42, 11.5],
    target: [0, 1.42, 0],
    fov: 39.6, // 50mm lens on a 36mm sensor
    near: 0.1,
    far: 100,
  },

  // Each GLB from web/v2 holds one mesh: origin at its centre, longest side
  // exactly 1.0, Y-up baked in, no parent node. So `width` is the on-screen
  // width in world units and `position` is a true world position.
  // Authored sizes in Blender: logo 2.10 m, bracket 1.05 m, vscode 1.10 m.
  marks: {
    Brud_Logo: {
      position: [0, 1.74, 0],
      width: 3.62,
      rimMul: 3.8,
      rimRange: [0.34, 0.9],
      baseColor: 0x08080a,
      roughness: 0.06,
      metalness: 0.15,
    },
    Brud_Bracket: {
      position: [-5.13, 2.26, 0],
      width: 1.02,
      rimMul: 3.0,
      rimRange: [0.5, 0.95],
      baseColor: 0x0a0a0c,
      roughness: 0.1,
      metalness: 0.2,
    },
    Brud_VSCode: {
      position: [4.87, 1.83, 0],
      width: 1.84,
      rimMul: 3.0,
      rimRange: [0.5, 0.95],
      baseColor: 0x0a0a0c,
      roughness: 0.1,
      metalness: 0.2,
    },
  },

  rim: {
    colorA: [1.0, 0.28, 0.22], // ramp stop 0
    colorB: [1.0, 0.045, 0.03], // ramp stop 0.35
    asymDir: [0.707, 0, -0.707], // brightens the lower right of each mark
    asymRange: [0.12, 1.0],
  },

  floor: {
    y: -0.62,
    // Only a radius of ~13 is ever visible (see edgeFade). A 60x60 plane
    // rasterised millions of pixels that were discarded anyway.
    size: [32, 32],
    fadeStart: 3.0,
    fadeEnd: 9.5,
    // Radial dissolve so the plane never shows its own edge: fully present
    // near the marks, gone before the geometry ends.
    edgeFade: [5.0, 13.0],
    streakScale: [14.0, 0.45],
    streakStrength: 0.82,
    patchScale: 3.4,
    // The floor plane is drawn OVER the mirrored marks, so its alpha is what
    // hides the reflection. Lower opacity = stronger, wetter reflection.
    baseOpacity: 0.4,
  },

  reflection: {
    strength: 0.78,
  },

  env: {
    background: 0x0a0a0c,
    // Silver gradient reflections only; the background stays black.
    gradient: [
      [0.03, 0.03, 0.035],
      [0.3, 0.31, 0.35],
      [0.88, 0.9, 0.96],
    ],
    intensity: 0.85,
  },

  // Single exposure control for the whole frame.
  exposure: 0.92,

  lights: {
    ambient: { intensity: 0.05, color: 0x20232b },
    // Silver key and lower-left kicker: the bright glass edges.
    silverKey: { position: [-7.5, 3.2, 5.5], intensity: 240, color: 0xcfd6e6 },
    silverLow: { position: [-4.6, -1.2, 3.4], intensity: 130, color: 0xbfc6d6 },
    specTop: { position: [0, 7.0, 4.0], intensity: 180, color: 0xffffff },
    // Red backlight that feeds the rim.
    rimRed: { position: [0, 1.6, -5.0], intensity: 300, color: 0xff2a1e },
    rimRedLow: { position: [1.8, -1.6, -2.4], intensity: 150, color: 0xff3b30 },
    // floorSheen was removed: the floor uses an unlit ShaderMaterial, so no
    // light in the scene has ever reached it. It only cost a sixth light on
    // every mark pixel. Its small red front fill is folded into rimRedLow.
  },

  motion: {
    idleRotation: 0.05, // radians, flower only
    pointerTilt: 0.05,
    pointerEase: 0.06,
    // World units the mark group slides against the cursor, [x, y]. The floor
    // stays fixed, so this reads as depth rather than the whole scene moving.
    parallax: [0.35, 0.18],
  },

  bloom: {
    threshold: 0.35,
    smoothing: 0.3,
    strength: 1.1,
    radius: 0.72,
  },
};

export default brudConfig;
