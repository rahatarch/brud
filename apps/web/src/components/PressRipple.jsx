"use client";

import { useEffect } from "react";

const TARGETS = ".btn, .switch__item, .switch__badge, .install__copy";

/**
 * A soft ripple from the pointer on every button-like control. One delegated
 * listener; each ripple is a single element that removes itself when done.
 */
export default function PressRipple() {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onDown = (event) => {
      if (reduce.matches || event.button !== 0) return;
      const host = event.target.closest?.(TARGETS);
      if (!host) return;

      const box = host.getBoundingClientRect();
      const size = Math.hypot(box.width, box.height) * 2;
      const dot = document.createElement("span");
      dot.className = "ripple";
      dot.setAttribute("aria-hidden", "true");
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${event.clientX - box.left - size / 2}px`;
      dot.style.top = `${event.clientY - box.top - size / 2}px`;
      host.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove(), { once: true });
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  return null;
}
