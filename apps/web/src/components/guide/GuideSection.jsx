"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { GUIDE } from "@/content/guide";

import GuideLightbox from "./GuideLightbox";

const STEPS = GUIDE.steps;
const EDGE = 18; // keep-out margin from the viewport
const GAP = 26; // distance from the cursor
const EASE = 0.22; // how hard the card chases the pointer each frame

/**
 * The walkthrough: a centred list of step titles, nothing else at rest.
 *
 * Hovering a row floats that step's screenshot beside the cursor; clicking
 * opens it full screen. Every screenshot is mounted once the section comes
 * near the viewport, so the hover never waits on the network, and the card
 * itself only ever receives a transform, written once per frame.
 */
export default function GuideSection() {
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(-1);
  const [armed, setArmed] = useState(false);

  const sectionRef = useRef(null);
  const cardRef = useRef(null);

  const pointer = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const at = useRef(null);
  const size = useRef({ w: 0, h: 0 });
  const raf = useRef(0);
  const decoding = useRef(new Map());

  // The preview shows the shot at ~420px; full screen jumps to ~1330px, and
  // Chrome has to decode the bitmap again at the new size. Doing that on the
  // frame the overlay mounts is what makes the open feel heavy, so we decode
  // ahead of time on hover and the click has nothing left to wait for.
  const warm = useCallback((index) => {
    const src = STEPS[index].image;
    let job = decoding.current.get(src);
    if (!job) {
      const img = new Image();
      img.src = src;
      job = img.decode().catch(() => {});
      decoding.current.set(src, job);
    }
    return job;
  }, []);

  const reveal = useCallback(
    async (index) => {
      // Never block for long: on touch there was no hover to warm it up.
      await Promise.race([
        warm(index),
        new Promise((done) => {
          setTimeout(done, 140);
        }),
      ]);
      setOpen(index);
      // The arrows are the next thing they are likely to press.
      warm((index + 1) % STEPS.length);
      warm((index - 1 + STEPS.length) % STEPS.length);
    },
    [warm]
  );

  // Load the screenshots only when the guide is close to the screen.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setArmed(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setArmed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Card size is read on enter and on resize only, never inside the loop.
  const measure = useCallback(() => {
    const card = cardRef.current;
    if (card) size.current = { w: card.offsetWidth, h: card.offsetHeight };
  }, []);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Where the card wants to be for the current pointer position: beside the
  // cursor, flipped to whichever side has room, clamped to the viewport.
  const aim = useCallback(() => {
    const { w, h } = size.current;
    const { x, y } = pointer.current;
    const right = x + GAP;
    const left = x - GAP - w;
    const room = right + w + EDGE <= window.innerWidth;
    const wanted = room || left < EDGE ? right : left;
    target.current.x = Math.min(
      Math.max(wanted, EDGE),
      window.innerWidth - w - EDGE
    );
    target.current.y = Math.min(
      Math.max(y - h / 2, EDGE),
      window.innerHeight - h - EDGE
    );
  }, []);

  const draw = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transform = `translate3d(${at.current.x.toFixed(
      1
    )}px, ${at.current.y.toFixed(1)}px, 0)`;
  }, []);

  const tick = useCallback(() => {
    if (!at.current) at.current = { ...target.current };
    at.current.x += (target.current.x - at.current.x) * EASE;
    at.current.y += (target.current.y - at.current.y) * EASE;
    draw();
    raf.current = requestAnimationFrame(tick);
  }, [draw]);

  useEffect(() => {
    if (active === -1) return undefined;
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active, tick]);

  const track = useCallback(
    (event) => {
      pointer.current.x = event.clientX;
      pointer.current.y = event.clientY;
      aim();
    },
    [aim]
  );

  const enter = (index) => (event) => {
    // Coarse pointers get no preview; a tap goes straight to full screen.
    if (event.pointerType === "touch") return;
    pointer.current.x = event.clientX;
    pointer.current.y = event.clientY;
    measure();
    aim();
    // Appear where the cursor already is rather than sliding in from the
    // last row's position.
    at.current = { ...target.current };
    draw();
    setActive(index);
    warm(index);
  };

  return (
    <section className="guide" id="guide" ref={sectionRef}>
      <header className="guide__head">
        <h2 className="guide__title">{GUIDE.title}</h2>
        <p className="guide__lede">{GUIDE.lede}</p>
      </header>

      <ol
        className="guide__list"
        onPointerMove={active === -1 ? undefined : track}
        onPointerLeave={() => setActive(-1)}
      >
        {STEPS.map((step, index) => (
          <li key={step.image} className="guide__row">
            <button
              type="button"
              className="guide__step"
              data-active={active === index ? "" : undefined}
              data-dim={active !== -1 && active !== index ? "" : undefined}
              onPointerEnter={enter(index)}
              onFocus={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                pointer.current.x = box.right;
                pointer.current.y = box.top + box.height / 2;
                measure();
                aim();
                at.current = { ...target.current };
                draw();
                setActive(index);
              }}
              onBlur={() => setActive(-1)}
              onClick={() => reveal(index)}
            >
              <span className="guide__num">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="guide__label">{step.title}</span>
              <span className="guide__hint" aria-hidden="true">
                View
              </span>
            </button>
          </li>
        ))}
      </ol>

      {/* One card, twelve stacked frames. Only opacity and a transform move. */}
      <div
        className="guide__preview"
        ref={cardRef}
        data-on={active !== -1 && open === -1 ? "" : undefined}
        aria-hidden="true"
      >
        {armed &&
          STEPS.map((step, index) => (
            <img
              key={step.image}
              className="guide__shot"
              src={step.image}
              alt=""
              width={GUIDE.shot.width}
              height={GUIDE.shot.height}
              decoding="async"
              data-on={active === index ? "" : undefined}
            />
          ))}
      </div>

      <GuideLightbox
        steps={STEPS}
        index={open}
        shot={GUIDE.shot}
        onChange={reveal}
        onClose={() => setOpen(-1)}
      />
    </section>
  );
}
