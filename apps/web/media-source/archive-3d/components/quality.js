"use client";

// Device detection and tier stepping. Tiers map to the exported GLB variants.
export const TIERS = {
  // The scene is fill-rate bound, not triangle bound, so dpr is the strongest
  // performance lever. Rendering at dpr 2 costs 4x the pixels of dpr 1 for a
  // difference almost nobody can see on dark glass.
  low: { model: "/models/v2/marks_low.glb", dpr: 1, shadows: false, reflections: true },
  med: { model: "/models/v2/marks_med.glb", dpr: [1, 1.25], shadows: false, reflections: true },
  high: { model: "/models/v2/marks_high.glb", dpr: [1, 1.5], shadows: false, reflections: true },
};

const ORDER = ["high", "med", "low"];

export function detectTier() {
  if (typeof window === "undefined") return "med";

  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 900;

  if (coarse || narrow || cores <= 4 || mem <= 4) return "low";
  if (cores >= 8 && mem >= 8 && window.devicePixelRatio <= 2) return "high";
  return "med";
}

export function stepDown(tier) {
  const i = ORDER.indexOf(tier);
  return i < 0 || i === ORDER.length - 1 ? tier : ORDER[i + 1];
}

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
