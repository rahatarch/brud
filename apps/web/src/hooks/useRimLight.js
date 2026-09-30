"use client";

import { useEffect, useRef } from "react";

import { rimLightBudget, tracksPointer } from "@/lib/deviceBudgets";

const TAU = Math.PI * 2;

/** Where the light sits on first paint: upper-left of the rim. */
export const RIM_START_ANGLE = (-125 * Math.PI) / 180;

const DEFAULTS = {
  /** Idle travel around the border, in radians per second. */
  orbitSpeed: 0.62,
  /** How far out the cursor is felt, as a multiple of the rim radius. */
  attractRadius: 2.3,
  /** Correction rate towards the cursor at full influence, per second. */
  followSpeed: 7.5,
  /** How fast influence itself ramps in and out, per second. */
  blendSpeed: 5.5,
  /** How much bigger the light gets while the cursor is holding it. */
  swell: 0.2,
};

/* How far above the screen's own density the glow is drawn, and the ceiling
   on one sheet, both per device. See src/lib/deviceBudgets.js. */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t) => t * t * (3 - 2 * t);
const wrap = (a) => ((a % TAU) + TAU) % TAU;

/** Shortest signed way round from `from` to `to`, always within +/- PI. */
function shortestArc(from, to) {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/**
 * Point on the mark's outline in direction `angle`, from a radius profile
 * sampled at equal angular steps. Linear interpolation between samples keeps
 * the light gliding along the petals rather than stepping between them.
 */
export function rimPoint(center, outline, angle, fallbackRadius = 0) {
  let radius = fallbackRadius;
  if (outline?.length) {
    const t = (wrap(angle) / TAU) * outline.length;
    const i = Math.floor(t) % outline.length;
    const j = (i + 1) % outline.length;
    radius = outline[i] + (outline[j] - outline[i]) * (t - Math.floor(t));
  }
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/**
 * Walks a light source around the rim of a mark.
 *
 * Away from the mark the light orbits at a constant angular velocity, so it
 * reads as one continuous sweep all the way round the border. As the cursor
 * closes in, its direction takes over and the light swings across to meet it.
 * The handover both ways is a smoothstep of proximity, so neither state snaps.
 *
 * The painting. Each sheet is a canvas the size of the mark. A frame fills a
 * round gradient where the light currently is, then takes everything outside
 * the band shapes back out of it with `destination-in`. The band shapes are
 * rasterised once into an alpha map and reused, so a frame is two operations
 * on a bitmap that already exists: no masked layer, no re-rasterising, and
 * nothing for the compositor to redo when the journey scales the mark up.
 *
 * The loop parks itself whenever the tab is hidden or the mark is off screen.
 */
export default function useRimLight({ center, radius, outline, viewBox, light, sheets, ...tuning }) {
  const { orbitSpeed, attractRadius, followSpeed, blendSpeed, swell } = {
    ...DEFAULTS,
    ...tuning,
  };
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const [vbX, vbY, vbW, vbH] = viewBox;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const orbit = reduced ? 0 : orbitSpeed;

    const state = { angle: RIM_START_ANGLE, influence: 0, pointer: null };
    let frame = 0;
    let last = 0;
    let onScreen = true;
    let alive = true;

    // One entry a sheet: where to draw, the shape to cut it to, and the band
    // images that shape is made of.
    const layers = sheets.map((sheet) => ({
      spec: sheet,
      canvas: host.querySelector(`[data-rim-sheet="${sheet.key}"]`),
      ctx: null,
      images: null,
      map: null,
    }));

    // The mark's box on screen, cached: reading it inside pointermove would
    // force a layout on every single mouse event.
    let box = host.getBoundingClientRect();
    // Scrolling only marks the cached box as out of date. It is re-read the
    // next time the pointer moves, so scrolling never forces a layout.
    let stale = false;
    // Layout size, which ignores transforms. The mark can be scaled up by the
    // scroll journey; the glow lives inside it, so it must be drawn in the
    // mark's own unscaled space or it would be scaled twice.
    let layout = { w: host.offsetWidth, h: host.offsetHeight };
    let density = 1;

    const measure = () => {
      box = host.getBoundingClientRect();
      layout = { w: host.offsetWidth, h: host.offsetHeight };
      const area = layout.w * layout.h;
      // Re-read on every measure, so rotating a tablet or dragging a window
      // across a breakpoint picks the right budget up straight away.
      const { oversample, sheetPixels } = rimLightBudget();
      const ceiling = area ? Math.sqrt(sheetPixels / area) : 1;
      density = Math.min((window.devicePixelRatio || 1) * oversample, ceiling);
    };

    // The band shapes, flattened into one alpha map a sheet. Rebuilt only when
    // the mark changes size, never on a scroll frame.
    const buildMaps = () => {
      if (!layout.w || !layout.h) return;
      const w = Math.round(layout.w * density);
      const h = Math.round(layout.h * density);
      for (const layer of layers) {
        if (!layer.images || !layer.canvas) continue;
        layer.canvas.width = w;
        layer.canvas.height = h;
        const map = layer.map ?? document.createElement("canvas");
        map.width = w;
        map.height = h;
        const mapCtx = map.getContext("2d");
        mapCtx.clearRect(0, 0, w, h);
        // Laid over each other rather than added, so overlapping bands read
        // exactly as they did when each was its own masked element.
        for (const image of layer.images) mapCtx.drawImage(image, 0, 0, w, h);
        layer.map = map;
        layer.ctx = layer.canvas.getContext("2d");
      }
    };

    const write = () => {
      if (!layout.w || !layout.h) return;
      const point = rimPoint(center, outline, state.angle, radius);
      const cx = ((point.x - vbX) / vbW) * layout.w;
      const cy = ((point.y - vbY) / vbH) * layout.h;
      // The light swells a little while the cursor is holding it.
      const r = ((light.size * layout.w) / 2) * (1 + swell * state.influence);

      for (const layer of layers) {
        if (!layer.ctx || !layer.map) continue;
        const { ctx } = layer;
        ctx.setTransform(density, 0, 0, density, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, layout.w, layout.h);
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        for (const [offset, colour] of light.stops) gradient.addColorStop(offset, colour);
        ctx.fillStyle = gradient;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        // Everything outside the band shapes goes back out again.
        ctx.globalCompositeOperation = "destination-in";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(layer.map, 0, 0);
      }
    };

    const tick = (now) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
      last = now;

      // Proximity decides who owns the light this frame.
      let pull = 0;
      let toward = state.angle;
      if (state.pointer) {
        const dx = state.pointer.x - center.x;
        const dy = state.pointer.y - center.y;
        const distance = Math.hypot(dx, dy);
        pull = smoothstep(clamp01(1 - distance / (radius * attractRadius)));
        if (distance > 0.01) toward = Math.atan2(dy, dx);
      }
      state.influence += (pull - state.influence) * Math.min(1, blendSpeed * dt);

      // The continuous sweep, faded by however much the cursor has taken over.
      state.angle += orbit * (1 - state.influence) * dt;
      // ...then bend towards the cursor, along the shorter arc.
      state.angle +=
        shortestArc(state.angle, toward) * Math.min(1, state.influence * followSpeed * dt);
      state.angle = wrap(state.angle);
      write();

      // With motion reduced and nothing to chase, there is nothing left to draw.
      if (!orbit && !state.pointer && state.influence < 0.002) {
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame || !onScreen || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // Listening on the window keeps proximity working while the pointer is over
    // the headline or the nav, which never receive the mark's own events.
    const onMove = (event) => {
      if (stale) {
        stale = false;
        box = host.getBoundingClientRect();
      }
      if (!box.width || !box.height) return;
      state.pointer = {
        x: vbX + ((event.clientX - box.left) / box.width) * vbW,
        y: vbY + ((event.clientY - box.top) / box.height) * vbH,
      };
      start();
    };

    const onOut = (event) => {
      if (event.relatedTarget) return;
      state.pointer = null;
      start();
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const onViewportChange = () => {
      const before = `${layout.w}x${layout.h}@${density}`;
      measure();
      if (`${layout.w}x${layout.h}@${density}` !== before) buildMaps();
      write();
    };

    // No point animating a mark nobody can see.
    const seen = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) start();
        else stop();
      },
      { threshold: 0 },
    );
    seen.observe(host);

    const resized = new ResizeObserver(onViewportChange);
    resized.observe(host);

    // Touch has no hover to follow, and following a finger would drag the
    // light across the mark on every scroll. There it just keeps orbiting.
    const following = tracksPointer();
    if (following) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerout", onOut);
    }
    const onScrollStale = () => {
      stale = true;
    };
    window.addEventListener("scroll", onScrollStale, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    measure();
    // Nothing can be drawn until the band images are decoded. They are a few
    // kB of same-origin SVG, so this settles within the first frames.
    Promise.all(
      layers.map(async (layer) => {
        layer.images = await Promise.all(layer.spec.bands.map(loadImage));
      }),
    )
      .then(() => {
        if (!alive) return;
        buildMaps();
        write();
        start();
      })
      .catch(() => {
        /* a missing band image just means no glow; the mark still reads */
      });

    return () => {
      alive = false;
      stop();
      seen.disconnect();
      resized.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScrollStale);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    center,
    radius,
    outline,
    viewBox,
    light,
    sheets,
    orbitSpeed,
    attractRadius,
    followSpeed,
    blendSpeed,
    swell,
  ]);

  return { hostRef };
}
