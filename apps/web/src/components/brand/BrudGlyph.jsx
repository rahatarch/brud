"use client";

import { asset } from "@/lib/asset";

import useRimLight from "@/hooks/useRimLight";
import {
  BRUD_GLOW_VIEWBOX,
  BRUD_GLOW_VIEWBOX_NUMBERS,
  BRUD_MARK_CENTER,
  BRUD_MARK_OUTLINE,
  BRUD_MARK_PATH,
  BRUD_MARK_RIM,
} from "./markGeometry";

/**
 * The travelling light itself: one soft round gradient, described once here
 * and painted by the hook. Its diameter is a fraction of the mark's own
 * width, matching the old gradient radius of 250 in the 570 viewBox.
 */
const LIGHT = {
  size: 0.8772,
  stops: [
    [0, "#ffd0a3"],
    [0.13, "rgba(255, 154, 60, 0.95)"],
    [0.32, "rgba(255, 122, 26, 0.62)"],
    [0.6, "rgba(255, 59, 129, 0.2)"],
    [1, "rgba(255, 59, 129, 0)"],
  ],
};

/**
 * Two sheets of glow, because the body sits between them: the outer spill and
 * the tighter bloom read from behind the mark, the crisp hot edge rides on
 * top. Each is the light shaped by the static band images built by
 * tools/buildMarkMasks.mjs.
 */
const SHEETS = [
  { key: "under", className: "glyph__glow glyph__glow--under", bands: [asset("/mark/spill.svg"), asset("/mark/bloom.svg")] },
  { key: "over", className: "glyph__glow glyph__glow--over", bands: [asset("/mark/edge.svg")] },
];

/**
 * The hero mark: a near-black body carrying a single travelling rim light.
 *
 * The glow is painted onto canvases rather than composited as CSS-masked
 * layers. The result is the same picture — the same light, shaped by the same
 * band images — but nothing on the page carries a mask, and that matters
 * because the scroll journey scales this mark up to about twelve times its
 * size. A masked layer has to be re-rasterised every time its scale changes:
 * measured on an Intel UHD 620, the three masked bands cost 113 dropped
 * frames out of 300 during the transition and halved the frame rate. The same
 * pixels unmasked cost 19.
 *
 * All of the motion lives in useRimLight; this file only describes the paint.
 */
export default function BrudGlyph({ className }) {
  const { hostRef } = useRimLight({
    center: BRUD_MARK_CENTER,
    radius: BRUD_MARK_RIM,
    outline: BRUD_MARK_OUTLINE,
    viewBox: BRUD_GLOW_VIEWBOX_NUMBERS,
    light: LIGHT,
    sheets: SHEETS,
  });

  return (
    <div ref={hostRef} className={className ? `glyph ${className}` : "glyph"} aria-hidden="true">
      <canvas className={SHEETS[0].className} data-rim-sheet={SHEETS[0].key} />

      <svg className="glyph__body" viewBox={BRUD_GLOW_VIEWBOX} width="100%" height="100%">
        <defs>
          {/* body stays near-black so the rim light carries all the colour */}
          <radialGradient id="brudBody" cx="50%" cy="58%" r="66%">
            <stop offset="0%" stopColor="#17181d" />
            <stop offset="60%" stopColor="#0c0d11" />
            <stop offset="100%" stopColor="#06070a" />
          </radialGradient>
        </defs>
        <path d={BRUD_MARK_PATH} fill="url(#brudBody)" />
      </svg>

      <canvas className={SHEETS[1].className} data-rim-sheet={SHEETS[1].key} />
    </div>
  );
}
