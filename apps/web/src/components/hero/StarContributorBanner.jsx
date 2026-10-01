"use client";

import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "brud-star-banner-dismissed";

export default function StarContributorBanner() {
  const [dismissed, setDismissed] = useState(true);
  const bannerRef = useRef(null);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    if (dismissed) return;

    const el = bannerRef.current;
    if (!el) return;

    const setHeight = () => {
      document.documentElement.style.setProperty("--banner-height", `${el.offsetHeight}px`);
    };

    setHeight();

    const ro = new ResizeObserver(setHeight);
    ro.observe(el);

    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty("--banner-height", "0px");
    };
  }, [dismissed]);

  const handleDismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
    document.documentElement.style.setProperty("--banner-height", "0px");
  };

  if (dismissed) return null;

  return (
    <aside ref={bannerRef} aria-label="Star Contributor announcement" className="star-banner">
      <span className="star-banner__text">
        Honoring <strong>Miftahul Islam Efaz</strong> — Founding Star Contributor
        of Brud Code
      </span>
      <a href="/contributors" className="star-banner__action">
        View Spotlight &rarr;
      </a>
      <button
        className="star-banner__dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss"
        type="button"
      >
        &times;
      </button>
    </aside>
  );
}