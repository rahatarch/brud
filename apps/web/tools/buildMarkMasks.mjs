/**
 * Bakes the mark's three glow bands into static SVG mask files.
 *
 * Why: the glow used to be an SVG gaussian blur over a moving gradient, which
 * meant Chrome re-rasterised two large blurs every single frame. These masks
 * are static images, so the travelling light becomes a plain composited
 * transform underneath them and costs no raster at all.
 *
 * Run with: node tools/buildMarkMasks.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRUD_GLOW_VIEWBOX, BRUD_MARK_PATH } from "../src/components/brand/markGeometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../public/mark");

// Each band mirrors one layer of the old paint stack: the wide outer spill,
// the tighter bloom, and the crisp hot edge.
const BANDS = [
  { name: "spill", strokeWidth: 20, blur: 26, opacity: 0.9 },
  { name: "bloom", strokeWidth: 9, blur: 7, opacity: 1 },
  { name: "edge", strokeWidth: 2.4, blur: 0, opacity: 1 },
];

function band({ strokeWidth, blur, opacity }) {
  const defs = blur
    ? `<defs><filter id="b" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>`
    : "";
  const filter = blur ? ' filter="url(#b)"' : "";
  const alpha = opacity === 1 ? "" : ` opacity="${opacity}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRUD_GLOW_VIEWBOX}">${defs}` +
    `<g${filter}${alpha}><path d="${BRUD_MARK_PATH}" fill="none" stroke="#fff" stroke-width="${strokeWidth}"/></g>` +
    `</svg>`
  );
}

mkdirSync(outDir, { recursive: true });
for (const spec of BANDS) {
  const svg = band(spec);
  writeFileSync(resolve(outDir, `${spec.name}.svg`), svg);
  console.log(`public/mark/${spec.name}.svg  ${svg.length} bytes`);
}
