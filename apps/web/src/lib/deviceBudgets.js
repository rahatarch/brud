"use client";

/**
 * Device profiles for the numbers JavaScript needs.
 *
 * The hero's device-specific CSS is split one file per device
 * (src/styles/hero.css for the desktop composition, hero.tablet.css,
 * hero.mobile.css). This is the same idea for values a stylesheet cannot
 * express, so no per-device number ends up buried inside a shared module.
 */

/** Must stay in step with the breakpoints in the hero stylesheets. */
export const BREAKPOINT = { mobile: 640, tablet: 1080 };

export function deviceClass() {
  if (typeof window === "undefined") return "desktop";
  const width = window.innerWidth;
  if (width <= BREAKPOINT.mobile) return "mobile";
  if (width <= BREAKPOINT.tablet) return "tablet";
  return "desktop";
}

/**
 * How much canvas the mark's rim light may spend, per device.
 *
 * `oversample` draws above the screen's own density, so the glow survives the
 * scroll journey zooming the mark up; `sheetPixels` is the hard ceiling on
 * one sheet, whatever that density works out to.
 *
 * The desktop row is the pair the effect shipped with, unchanged, so nothing
 * about a desktop frame moves. A phone paints the same picture at roughly
 * half the pixels: the glow is a soft gradient, so the difference does not
 * show, and the per-frame fill is the part a mobile GPU actually feels.
 */
const RIM_LIGHT = {
  desktop: { oversample: 2, sheetPixels: 1.1e6 },
  tablet: { oversample: 1.75, sheetPixels: 8e5 },
  mobile: { oversample: 1.5, sheetPixels: 5.5e5 },
};

export function rimLightBudget() {
  return RIM_LIGHT[deviceClass()];
}

/**
 * Whether the rim light should chase the pointer.
 *
 * A finger has no hover state: there is nothing to follow between taps, and
 * tracking it would drag the light across the mark every time the page is
 * scrolled. On touch the light keeps to its steady orbit instead.
 */
export function tracksPointer() {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(pointer: coarse)").matches;
}
