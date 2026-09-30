"use client";

import { useEffect } from "react";

/* What rises into place as it scrolls in. One list, so the sections
   themselves stay free of animation code. "lift" is the default: a short
   rise and fade. "frame" is for the large objects, which also settle from a
   touch smaller. */
const TARGETS = [
  [".install__head, .features__head, .guide__head, .faq__head", "lift"],
  // The benchmark card only lifts: scaling it would re-rasterise all of its
  // dot patterns on every frame of the reveal.
  [".install__frame", "frame"],
  [".bench", "lift"],
  [
    [
      ".install__step",
      ".install__actions",
      ".install__manual",
      ".features__pain",
      ".features__sub",
      ".features__sub-lede",
      ".features__note",
      ".features__stat",
      ".features__closing",
      ".guide__row",
      ".faq__item",
      ".footer__title",
      ".footer__actions",
      ".footer__bar",
    ].join(", "),
    "lift",
  ],
];

const STAGGER = 70; // ms between items that arrive together
const MAX_STAGGER = 6;

/**
 * Scroll-in reveals for the whole page, from one IntersectionObserver.
 *
 * Only things still below the fold are ever hidden, so nothing on screen at
 * load blinks out and back, and with JavaScript off nothing is hidden at all.
 * Items that cross into view in the same frame are staggered top to bottom.
 * Each element is observed once; when its transition ends the attributes are
 * removed, so hover styles and later layout see the element exactly as the
 * stylesheet wrote it.
 */
export default function ScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    if (typeof IntersectionObserver === "undefined") return undefined;

    const done = (event) => {
      const el = event.currentTarget;
      // Wait for the longer of the two (transform), and ignore children's.
      if (event.target !== el || event.propertyName !== "transform") return;
      el.removeEventListener("transitionend", done);
      el.removeAttribute("data-reveal");
      el.classList.remove("is-in");
      el.style.removeProperty("--reveal-delay");
    };

    const io = new IntersectionObserver(
      (entries) => {
        const arriving = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top ||
              a.boundingClientRect.left - b.boundingClientRect.left
          );

        arriving.forEach((entry, index) => {
          const el = entry.target;
          io.unobserve(el);
          el.style.setProperty("--reveal-delay", `${Math.min(index, MAX_STAGGER) * STAGGER}ms`);
          el.addEventListener("transitionend", done);
          el.classList.add("is-in");
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    const fold = window.innerHeight;
    for (const [selector, kind] of TARGETS) {
      for (const el of document.querySelectorAll(selector)) {
        // The copy of Install drawn inside the hero mark is decoration only.
        if (el.closest("[aria-hidden='true'], [inert]")) continue;
        if (el.getBoundingClientRect().top < fold) continue;
        el.setAttribute("data-reveal", kind);
        io.observe(el);
      }
    }

    return () => io.disconnect();
  }, []);

  return null;
}
