"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/**
 * Inertial wheel scrolling for mouse and trackpad on desktop, via Lenis.
 *
 * Lenis still drives the real window scroll, so every scroll listener on the
 * site (hero journey, nav) keeps reading plain scrollY, and CSS scroll-driven
 * animations (footer parallax) stay in sync.
 *
 * Left off entirely on touch screens (their native momentum is better) and for
 * reduced motion. Open overlays and self-scrolling elements get native wheel.
 * The instance is exposed as window.__lenis so SmoothAnchors can use it.
 */
export default function SmoothScroll() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis = null;

    const destroy = () => {
      if (!lenis) return;
      lenis.destroy();
      lenis = null;
      delete window.__lenis;
    };

    const sync = () => {
      const want = fine.matches && !reduce.matches;
      if (want && !lenis) {
        lenis = new Lenis({
          autoRaf: true,
          lerp: 0.1,
          smoothWheel: true,
          syncTouch: false,
          prevent: (node) =>
            document.body.style.overflow === "hidden" || !!node.closest?.(".lightbox"),
        });
        window.__lenis = lenis;
      } else if (!want) {
        destroy();
      }
    };

    sync();
    fine.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    return () => {
      fine.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
      destroy();
    };
  }, []);

  return null;
}
