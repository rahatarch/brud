"use client";

import { useEffect, useRef } from "react";

import { HERO } from "@/content/hero";

/**
 * The hero headline, morphing between the two phrases in src/content/hero.js.
 *
 * Both phrases sit in the same grid cell, so the block never changes size and
 * nothing below it moves. Each phrase is blurred and faded on its own; the
 * wrapper then runs an alpha threshold over the pair, which is what fuses the
 * two blurred layers into one gooey shape instead of a plain cross-fade.
 */

const MORPH_MS = 900; // how long one shape-change takes
const HOLD_MS = 2600; // how long each phrase rests before it changes
const MAX_BLUR = 8; // blur on a phrase at the half-way point, in px
const BLUR_CAP = 16; // never blur past this: wider costs raster and shows nothing
const FADE_EXP = 0.28; // <1 keeps both layers present through the crossover
const GONE = 0.008; // below this a phrase is invisible, so stop drawing it

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Paint one phrase at a given visibility, 0 = gone, 1 = fully legible.
 *
 * Returns early when nothing has moved, which is the whole point: during the
 * seconds each phrase spends at rest there are no style writes at all, so the
 * browser has nothing to repaint. An invisible phrase is taken out of painting
 * entirely rather than left as a hugely blurred, fully transparent layer.
 */
function paint(layer, visibility) {
  const v = Math.min(Math.max(visibility, 0), 1);
  if (Math.abs(v - Number(layer.dataset.at)) < 0.002) return;
  layer.dataset.at = String(v);

  if (v < GONE) {
    layer.style.visibility = "hidden";
    layer.style.filter = "none";
    layer.classList.remove("headline__phrase--live");
    return;
  }

  layer.style.visibility = "";
  const safe = Math.max(v, 0.0001);
  layer.style.opacity = String(safe ** FADE_EXP);
  if (safe >= 1) {
    layer.style.filter = "none";
    layer.classList.remove("headline__phrase--live");
  } else {
    layer.classList.add("headline__phrase--live");
    layer.style.filter = `blur(${Math.min(MAX_BLUR / safe - MAX_BLUR, BLUR_CAP).toFixed(2)}px)`;
  }
}

export default function MorphingTitle() {
  const rootRef = useRef(null);
  const firstRef = useRef(null);
  const secondRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const first = firstRef.current;
    const second = secondRef.current;
    if (!root || !first || !second) return undefined;

    const stillness = window.matchMedia("(prefers-reduced-motion: reduce)");
    const period = 2 * (HOLD_MS + MORPH_MS);
    let frame = 0;
    let origin = 0;
    let onScreen = true;
    // While the scroll journey is in flight the headline is leaving anyway;
    // freezing the morph keeps its blur filter from repainting mid-scroll.
    const journey = root.closest(".journey");

    let prev = 0;

    const tick = (now) => {
      const held = journey?.hasAttribute("data-flying");
      // Shift the clock by the paused time so the morph resumes where it froze.
      if (held && origin) origin += now - prev;
      prev = now;
      if (held) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Hold the first phrase while the hero entrance plays (intro.css), so
      // the first morph comes a full rest after the title has landed.
      if (document.documentElement.classList.contains("intro")) {
        origin = 0;
        frame = requestAnimationFrame(tick);
        return;
      }
      if (!origin) origin = now;
      const t = (now - origin) % period;

      let toSecond;
      if (t < HOLD_MS) toSecond = 0;
      else if (t < HOLD_MS + MORPH_MS) toSecond = easeInOut((t - HOLD_MS) / MORPH_MS);
      else if (t < 2 * HOLD_MS + MORPH_MS) toSecond = 1;
      else toSecond = 1 - easeInOut((t - (2 * HOLD_MS + MORPH_MS)) / MORPH_MS);

      paint(second, toSecond);
      paint(first, 1 - toSecond);
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // Anyone who asked their system for less motion just gets the first
    // phrase, and so does anyone who cannot currently see the headline.
    const run = () => {
      stop();
      origin = 0;
      if (stillness.matches) {
        paint(first, 1);
        paint(second, 0);
        return;
      }
      if (!onScreen || document.hidden) return;
      frame = requestAnimationFrame(tick);
    };

    const seen = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        run();
      },
      { threshold: 0 },
    );
    seen.observe(root);

    run();
    stillness.addEventListener("change", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      stop();
      seen.disconnect();
      stillness.removeEventListener("change", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  return (
    <h1 className="headline__title" ref={rootRef}>
      <span className="headline__morph" aria-hidden="true">
        {/* Server-rendered already at rest (first shown, second hidden), so
            the page never paints both phrases on top of each other before
            the script arrives. data-at tells paint() where each one starts. */}
        <span className="headline__phrase" ref={firstRef} data-at="1">
          {HERO.title.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
        <span
          className="headline__phrase"
          ref={secondRef}
          data-at="0"
          style={{ visibility: "hidden", opacity: 0 }}
        >
          {HERO.titleAlt.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </span>

      {/* The real, readable headline for search engines and screen readers. */}
      <span className="headline__plain">
        {HERO.title.join(" ")} — {HERO.titleAlt.join(" ")}
      </span>

      {/* The threshold that fuses the two blurred layers. */}
      <svg className="headline__filter" aria-hidden="true" focusable="false">
        <defs>
          <filter id="brud-goo">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -20"
            />
          </filter>
        </defs>
      </svg>
    </h1>
  );
}
