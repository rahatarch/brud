"use client";

import * as THREE from "three";
import { brudConfig } from "@/lib/brudConfig";

// Transparent floor shader with procedural wet/dry noise.
// The mirrored marks are drawn under this plane; the plane's alpha decides
// how much of each reflection survives, which is what makes the streaks.
export function createFloorMaterial() {
  const { floor } = brudConfig;

  const uniforms = {
    uStreakScale: { value: new THREE.Vector2(...floor.streakScale) },
    uStreakStrength: { value: floor.streakStrength },
    uPatchScale: { value: floor.patchScale },
    uFade: { value: new THREE.Vector2(floor.fadeStart, floor.fadeEnd) },
    uEdgeFade: { value: new THREE.Vector2(...(floor.edgeFade || [5.0, 13.0])) },
    uBaseOpacity: { value: floor.baseOpacity },
    uSurfaceDark: { value: new THREE.Color(0.003, 0.003, 0.004) },
    uSurfaceBright: { value: new THREE.Color(0.04, 0.039, 0.043) },
  };

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;

      uniform vec2 uStreakScale;
      uniform float uStreakStrength;
      uniform float uPatchScale;
      uniform vec2 uFade;
      uniform vec2 uEdgeFade;
      uniform float uBaseOpacity;
      uniform vec3 uSurfaceDark;
      uniform vec3 uSurfaceBright;

      // sin() is expensive on integrated GPUs and this runs once per octave
      // per pixel. A fract/dot hash gives the same look for a fraction of the
      // cost.
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      // Three octaves for the streaks, two for the blotches. The fourth octave
      // was below one pixel on screen and only cost fill rate.
      float fbm3(vec2 p) {
        float v = 0.5 * vnoise(p);
        p *= 2.03; v += 0.25 * vnoise(p);
        p *= 2.03; v += 0.125 * vnoise(p);
        return v;
      }

      float fbm2(vec2 p) {
        float v = 0.5 * vnoise(p);
        p *= 2.03; v += 0.25 * vnoise(p);
        return v;
      }

      void main() {
        // Radial dissolve first. The plane is far larger than the visible
        // reflection pool, so most of its pixels can leave before doing any
        // noise work at all.
        float radial = length(vWorld.xz);
        float edge = 1.0 - smoothstep(uEdgeFade.x, uEdgeFade.y, radial);
        if (edge <= 0.002) discard;

        // Vertical streak edges: stretched along depth, tight across width.
        float streak = fbm3(vec2(vWorld.x * uStreakScale.x, vWorld.z * uStreakScale.y));
        // Blotchy wet / dry patches.
        float wetPatch = fbm2(vec2(vWorld.x, vWorld.z) * (uPatchScale * 0.35));
        // Fine asphalt grain.
        float grain = vnoise(vec2(vWorld.x, vWorld.z) * 150.0);

        // Reflections stay near the marks and die out toward the horizon.
        float depth = abs(vWorld.z);
        float horizon = smoothstep(uFade.x, uFade.y, depth);

        float wet = mix(0.35, 1.0, wetPatch);
        float veil = mix(1.0 - uStreakStrength, 1.0, streak);
        float alpha = mix(veil * (1.0 - wet * 0.55), 1.0, horizon);
        alpha = clamp(alpha * uBaseOpacity + 0.08, 0.0, 1.0);

        // The plane must reach zero alpha before its own border enters the
        // frame, otherwise the rectangle edge is visible.
        alpha *= edge;

        vec3 surface = mix(uSurfaceDark, uSurfaceBright, grain * 0.6 + wetPatch * 0.4);
        surface *= edge;

        gl_FragColor = vec4(surface, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}
