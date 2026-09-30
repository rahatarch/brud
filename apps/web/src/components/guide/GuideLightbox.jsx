"use client";

import { useEffect, useRef } from "react";

// Full-screen view of one step. Esc or a click on the backdrop closes it;
// the arrow keys walk the guide without leaving the overlay.
export default function GuideLightbox({ steps, index, shot, onChange, onClose }) {
  const open = index >= 0;
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onChange((index + 1) % steps.length);
      if (event.key === "ArrowLeft") onChange((index - 1 + steps.length) % steps.length);
    };

    // Hiding the scrollbar reflows the page under the overlay, which reads as
    // a jump on the frame it opens. Pad by exactly the width it took up.
    const { body } = document;
    const bar = window.innerWidth - document.documentElement.clientWidth;
    const overflow = body.style.overflow;
    const pad = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (bar > 0) body.style.paddingRight = `${bar}px`;

    window.addEventListener("keydown", onKey);
    closeRef.current?.focus({ preventScroll: true });

    return () => {
      body.style.overflow = overflow;
      body.style.paddingRight = pad;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, index, steps.length, onChange, onClose]);

  if (!open) return null;

  const step = steps[index];

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      onClick={onClose}
    >
      <figure className="lightbox__figure" onClick={(e) => e.stopPropagation()}>
        <img
          className="lightbox__shot"
          src={step.image}
          alt={step.alt}
          /* Already decoded before we mounted, so painting it with the first
             frame is free and avoids a blank flash followed by a pop. */
          decoding="sync"
          width={shot.width}
          height={shot.height}
        />
        <figcaption className="lightbox__caption">
          <span className="lightbox__count">
            {String(index + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
          </span>
          <span className="lightbox__title">{step.title}</span>
        </figcaption>
      </figure>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--prev"
        aria-label="Previous step"
        onClick={(e) => {
          e.stopPropagation();
          onChange((index - 1 + steps.length) % steps.length);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 5 8 12l7 7" />
        </svg>
      </button>

      <button
        type="button"
        className="lightbox__nav lightbox__nav--next"
        aria-label="Next step"
        onClick={(e) => {
          e.stopPropagation();
          onChange((index + 1) % steps.length);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>

      <button
        type="button"
        className="lightbox__close"
        aria-label="Close"
        ref={closeRef}
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
