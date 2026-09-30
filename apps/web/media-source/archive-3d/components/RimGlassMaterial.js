"use client";

import * as THREE from "three";
import { brudConfig } from "@/lib/brudConfig";

// MeshStandardMaterial plus an injected fresnel rim.
// Port of the Blender node chain: RimLW -> RimMask -> RimAsym -> RimColor -> Emission.
export function createRimGlassMaterial({
  baseColor = 0x050506,
  roughness = 0.08,
  metalness = 0.0,
  rimMul = 2.8,
  rimRange = [0.42, 0.92],
  envIntensity = 1.0,
} = {}) {
  const { rim } = brudConfig;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(baseColor),
    roughness,
    metalness,
    envMapIntensity: envIntensity,
  });

  const uniforms = {
    uRimMul: { value: rimMul },
    uRimRange: { value: new THREE.Vector2(rimRange[0], rimRange[1]) },
    uRimColorA: { value: new THREE.Color(...rim.colorA) },
    uRimColorB: { value: new THREE.Color(...rim.colorB) },
    uAsymDir: { value: new THREE.Vector3(...rim.asymDir).normalize() },
    uAsymRange: { value: new THREE.Vector2(...rim.asymRange) },
    uRimOpacity: { value: 1.0 },
  };

  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vRimWorldNormal;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vRimWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vRimWorldNormal;
         uniform float uRimMul;
         uniform float uRimOpacity;
         uniform vec2 uRimRange;
         uniform vec3 uRimColorA;
         uniform vec3 uRimColorB;
         uniform vec3 uAsymDir;
         uniform vec2 uAsymRange;

         float rimSmootherstep(float e0, float e1, float x) {
           float t = clamp((x - e0) / max(e1 - e0, 1e-5), 0.0, 1.0);
           return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
         }`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>

         // RimLW: Layer Weight "facing", blend 0.5
         vec3 rimViewDir = normalize(vViewPosition);
         float facing = clamp(dot(normalize(normal), rimViewDir), 0.0, 1.0);
         float rimMask = rimSmootherstep(uRimRange.x, uRimRange.y, 1.0 - facing);

         // RimAsym: brighten the lower right of every mark
         float asymDot = dot(normalize(vRimWorldNormal), uAsymDir);
         float asym = smoothstep(0.0, 1.0, asymDot * 0.5 + 0.5);
         asym = mix(uAsymRange.x, uAsymRange.y, asym);

         // RimColor ramp: 0 -> warm red, 0.35 -> deep red
         vec3 rimColor = mix(uRimColorA, uRimColorB, clamp(rimMask / 0.35, 0.0, 1.0));

         totalEmissiveRadiance += rimColor * rimMask * asym * uRimMul * uRimOpacity;`
      );
  };

  material.customProgramCacheKey = () => "brud-rim-glass";

  return material;
}

export function setRimStrength(material, value) {
  const u = material?.userData?.uniforms;
  if (u) u.uRimMul.value = value;
}

export function setRimOpacity(material, value) {
  const u = material?.userData?.uniforms;
  if (u) u.uRimOpacity.value = value;
}
