"use client";

import { useEffect, useRef } from "react";

import {
  BRUD_GLOW_VIEWBOX_NUMBERS as VB,
  BRUD_MARK_CENTER as CENTER,
  BRUD_MARK_OUTLINE as OUTLINE,
  BRUD_MARK_PATH,
} from "@/components/brand/markGeometry";

/** Scroll distance the hero stays pinned for, in viewport heights. */
const TRAVEL_VH = 2.3;
/** Peak tilt of the mark on the way in, in degrees. It levels out again. */
const TILT = 34;
/** Ceiling on the cover's pixel count, so a dense display stays affordable. */
const COVER_PIXELS = 4.2e6;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (t) => t * t * (3 - 2 * t);
const f = (v, d = 3) => v.toFixed(d);

// Outline radius of the mark in direction `angle` (same profile the rim light uses).
function outlineRadius(angle) {
  const a = ((angle % TAU) + TAU) % TAU;
  const t = (a / TAU) * OUTLINE.length;
  const i = Math.floor(t) % OUTLINE.length;
  const j = (i + 1) % OUTLINE.length;
  return OUTLINE[i] + (OUTLINE[j] - OUTLINE[i]) * (t - Math.floor(t));
}

/**
 * The hero-to-install transition.
 *
 * The hero stays pinned while you scroll. Scroll progress drives one number,
 * and that number does three things at once:
 *   - the mark flies toward the screen (scale, with a slight tilt),
 *   - the hero copy drifts outward and fades,
 *   - the page that follows (a copy of the Install section) is revealed
 *     through the mark's own silhouette, which grows until it fills the screen.
 * When it does, the real Install section takes over at the identical pixels
 * and the page scrolls normally from there.
 *
 * Performance. The reveal is turned inside out. The copy of the next section
 * lies still and only fades up; what opens is a cover over it, which is a
 * canvas the size of the viewport with the mark's silhouette punched out of
 * it (see HeroPortal). A frame costs one rectangle fill and one path fill at
 * viewport size, whatever scale the silhouette has reached.
 *
 * Two earlier approaches were measurably worse and are worth not repeating:
 *
 *   - Cutting the section to the shape, with a clip-path or a CSS mask, makes
 *     the browser rebuild an offscreen surface for it on every frame the
 *     scale changes. On a 4x-slowed CPU that cost about one dropped frame in
 *     four no matter how little was inside it.
 *   - Doing the same job with ordinary elements, as a picture of the hole plus
 *     four plain boxes reaching past the screen, means those boxes are scaled
 *     up with the flight: about 20,000px across at full zoom. Software
 *     rendering absorbs that; a real GPU collapses to single-figure frame
 *     rates on layers that large.
 *
 * So nothing here is masked or clipped, and nothing grows without bound.
 */
export default function Journey({ children }) {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!root || reduce.matches) return undefined;

    const hero = root.querySelector(".hero");
    const mark = root.querySelector(".hero__mark");
    const cover = root.querySelector("[data-journey-shroud]");
    const content = root.querySelector("[data-journey-content]");
    const next = root.nextElementSibling;
    if (!hero || !mark || !cover || !content) return undefined;

    const targets = {
      mark,
      halo: root.querySelector(".hero__halo"),
      headline: root.querySelector(".headline"),
      points: root.querySelector(".points"),
      meta: root.querySelector(".hero__meta"),
      portal: root.querySelector("[data-journey-portal]"),
      content,
      body: root.querySelector(".glyph__body"),
      vignette: root.querySelector(".hero__vignette"),
      grain: root.querySelector(".hero__grain"),
      floor: root.querySelector(".hero__floor"),
    };
    const names = Object.keys(targets).filter((n) => targets[n]);

    const path = new Path2D(BRUD_MARK_PATH);
    const ctx = cover.getContext("2d");
    const fill =
      getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim() || "#08090b";

    let geo = null;
    let last = -1;
    let frame = 0;
    const flags = {};

    // Everything is measured from layout (offset*), never from bounding boxes,
    // so a mark that is mid-zoom does not corrupt its own measurements.
    const measure = () => {
      let x = 0;
      let y = 0;
      for (let n = mark; n && n !== hero; n = n.offsetParent) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      const mW = mark.offsetWidth;
      const mH = mark.offsetHeight;
      const heroW = hero.offsetWidth;
      const heroH = hero.offsetHeight;
      // Scale that takes the mark's own drawing units to CSS pixels.
      const k0 = Math.min(mW / VB[2], mH / VB[3]);
      const px = x + (mW - VB[2] * k0) / 2 + CX(k0);
      const py = y + (mH - VB[3] * k0) / 2 + CY(k0);

      // How far the silhouette has to grow to swallow the whole screen: walk
      // the screen's edge and ask, in each direction, how big the outline is.
      let need = 0;
      const steps = 360;
      for (let i = 0; i < steps; i += 1) {
        const t = i / steps;
        const edge = t * 4;
        const side = Math.floor(edge);
        const fr = edge - side;
        const ex = side === 0 ? fr * heroW : side === 1 ? heroW : side === 2 ? (1 - fr) * heroW : 0;
        const ey = side === 0 ? 0 : side === 1 ? fr * heroH : side === 2 ? heroH : (1 - fr) * heroH;
        const dx = ex - px;
        const dy = ey - py;
        const reach = outlineRadius(Math.atan2(dy, dx)) * k0;
        need = Math.max(need, Math.hypot(dx, dy) / reach);
      }

      const travel = window.innerHeight * TRAVEL_VH;
      const top = root.getBoundingClientRect().top + window.scrollY;
      // Held below the screen's own density when the screen is large, so the
      // cover's cost cannot run away on a weak machine.
      const density = Math.min(window.devicePixelRatio || 1, Math.sqrt(COVER_PIXELS / (heroW * heroH)));
      geo = { top, k0, px, py, travel, end: Math.max(need * 1.05, 3), w: heroW, h: heroH, density };

      root.style.height = `${heroH + travel}px`;
      if (next) next.style.marginTop = `-${heroH}px`;
      mark.style.transformOrigin = `${px - x}px ${py - y}px`;
      cover.width = Math.round(heroW * density);
      cover.height = Math.round(heroH * density);
    };

    // The mark's centre inside its own drawing units, in CSS pixels.
    function CX(k) {
      return (CENTER.x - VB[0]) * k;
    }
    function CY(k) {
      return (CENTER.y - VB[1]) * k;
    }

    // The cover: fill the screen, then take the silhouette back out of it.
    const drawCover = (tilt, k) => {
      const { w, h, density, px, py } = geo;
      ctx.setTransform(density, 0, 0, density, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "destination-out";
      ctx.translate(px, py);
      ctx.rotate(tilt * DEG);
      ctx.scale(k, k);
      ctx.translate(-CENTER.x, -CENTER.y);
      ctx.fill(path);
    };

    // Every animated element value at progress p, as compositor-only properties.
    const frameAt = (p) => {
      const e = 0.4 * p + 0.6 * sstep(p);
      const scale = Math.exp(Math.log(geo.end) * e);
      const tilt = TILT * Math.sin(Math.PI * e);
      const out = sstep(clamp01(p / 0.3));
      const show = sstep(clamp01((p - 0.2) / 0.36));
      const settle = 1 + 0.14 * (1 - sstep(clamp01((p - 0.2) / 0.8)));
      const grow = 1 + 0.22 * out;
      // The scrim sits above the reveal, so it leaves as the reveal arrives.
      const scrim = f(1 - sstep(clamp01((p - 0.22) / 0.5)), 4);
      return {
        tilt,
        k: geo.k0 * scale,
        mark: { transform: `rotate(${f(tilt)}deg) scale(${f(scale, 4)})` },
        // Same composition as the old `scale` property over the CSS centring.
        halo: {
          transform: `scale(${f(1 + 2.2 * e, 4)}) translate(-50%, -50%)`,
          opacity: f(1 - sstep(clamp01((p - 0.55) / 0.4)), 4),
        },
        headline: {
          transform: `translate(${f(-110 * out, 2)}px, 0px) scale(${f(grow, 4)})`,
          opacity: f(1 - out, 4),
        },
        points: {
          transform: `translate(${f(110 * out, 2)}px, 0px) scale(${f(grow, 4)})`,
          opacity: f(1 - out, 4),
        },
        meta: { transform: `translate(0px, ${f(48 * out, 2)}px)`, opacity: f(1 - out, 4) },
        portal: { opacity: f(show, 4) },
        // The revealed section holds still, bar a gentle settle to rest.
        content: { transform: `scale(${f(settle, 5)})` },
        // The mark's body gives way to the section showing through it, exactly
        // as the reveal fades up.
        body: { opacity: f(1 - show, 4) },
        // Faded one by one: fading their wrapper instead would make the
        // browser composite the whole group through an offscreen surface.
        vignette: { opacity: scrim },
        grain: { opacity: f(0.045 * Number(scrim), 4) },
        floor: { opacity: scrim },
      };
    };

    const apply = (p) => {
      const v = frameAt(p);
      names.forEach((n) => {
        const s = v[n];
        if (s.transform !== undefined) targets[n].style.transform = s.transform;
        if (s.opacity !== undefined) targets[n].style.opacity = s.opacity;
      });
      drawCover(v.tilt, v.k);
    };

    // Discrete state only. Each attribute is written when it flips, never per frame.
    const setFlag = (attr, on) => {
      if (flags[attr] === on) return;
      flags[attr] = on;
      root.toggleAttribute(attr, on);
    };

    const update = () => {
      frame = 0;
      if (!geo) return;
      // scrollY plus a cached offset: no layout read.
      const p = clamp01((window.scrollY - geo.top) / geo.travel);
      if (Math.abs(p - last) < 0.0002) return;
      last = p;

      const done = p >= 0.9995;
      setFlag("data-done", done);
      // While it is in flight the header drops its live backdrop blur.
      setFlag("data-flying", p > 0 && !done);
      // Copy that has fully faded stops taking clicks and stops being drawn.
      setFlag("data-copy-gone", p >= 0.3);

      apply(p);
    };

    const request = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const remeasure = () => {
      measure();
      last = -1;
      request();
    };

    // Decode the images of the page behind the cover before anyone scrolls, so
    // the first frame the hole opens never waits on an image decode.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
    const cancelIdle = window.cancelIdleCallback || clearTimeout;
    const warmHandle = idle(
      () => {
        content.querySelectorAll("img").forEach((img) => {
          img.loading = "eager";
          img.decode?.().catch(() => {});
        });
      },
      { timeout: 1500 },
    );

    root.toggleAttribute("data-live", true);
    remeasure();
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", remeasure);
    const resized = new ResizeObserver(remeasure);
    resized.observe(hero);
    // Fonts can shift the stage after first paint.
    document.fonts?.ready.then(remeasure);

    return () => {
      cancelAnimationFrame(frame);
      cancelIdle(warmHandle);
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", remeasure);
      resized.disconnect();
      names.forEach((n) => {
        targets[n].style.transform = "";
        targets[n].style.opacity = "";
      });
      ["data-live", "data-done", "data-flying", "data-copy-gone"].forEach((a) => root.removeAttribute(a));
      root.style.height = "";
      if (next) next.style.marginTop = "";
    };
  }, []);

  return (
    <div className="journey" ref={rootRef}>
      {children}
    </div>
  );
}
