"use client";

import { useEffect } from "react";

const DURATION = 950;
const ease = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2); // easeInOutQuart

/**
 * One handler for every in-page link (nav, hero buttons, wordmark). Scrolls
 * with an eased, cancellable animation instead of the browser's default jump.
 */
export default function SmoothAnchors() {
  useEffect(() => {
    let frame = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const stop = () => cancelAnimationFrame(frame);

    const scrollTo = (to) => {
      stop();
      if (reduce.matches) {
        window.scrollTo(0, to);
        return;
      }
      if (window.__lenis) {
        window.__lenis.scrollTo(to, { duration: DURATION / 1000, easing: ease });
        return;
      }
      const from = window.scrollY;
      const dist = to - from;
      if (Math.abs(dist) < 2) return;
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min((now - t0) / DURATION, 1);
        window.scrollTo(0, from + dist * ease(t));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.("a[href]");
      if (!link || link.target === "_blank") return;

      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;

      let to;
      if (url.hash && url.hash !== "#") {
        const node = document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (!node) return;
        to = node.getBoundingClientRect().top + window.scrollY;
      } else {
        to = 0; // the wordmark and bare "#" links go home
      }

      event.preventDefault();
      scrollTo(to);
      history.replaceState(null, "", url.hash && url.hash !== "#" ? url.hash : url.pathname);
    };

    // Any manual scroll input hands control straight back to the user.
    const opts = { passive: true };
    document.addEventListener("click", onClick);
    window.addEventListener("wheel", stop, opts);
    window.addEventListener("touchstart", stop, opts);
    window.addEventListener("keydown", stop);
    return () => {
      stop();
      document.removeEventListener("click", onClick);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);

  return null;
}
