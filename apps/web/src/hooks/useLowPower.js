"use client";

import { useEffect } from "react";

/**
 * Flags weak machines so the CSS can drop the effects that cost them the most.
 *
 * Sets data-power="low" on <html> when the device reports few cores or little
 * memory, or when the user has asked for less motion. The only thing it turns
 * off is backdrop blur on the nav pills, which is the last expensive live
 * effect on the page and reads almost identically as a flat translucent fill.
 */
export default function useLowPower() {
  useEffect(() => {
    const cores = navigator.hardwareConcurrency ?? 8;
    const memory = navigator.deviceMemory ?? 8; // Chromium only; undefined elsewhere
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (cores <= 4 || memory <= 4 || reduced) {
      document.documentElement.dataset.power = "low";
    }
  }, []);
}
