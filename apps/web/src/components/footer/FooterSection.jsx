"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { BRUD_MARK_PATH, BRUD_MARK_VIEWBOX } from "@/components/brand/markGeometry";
import { FOOTER } from "@/content/footer";

/* The mark's own dot grid, in the mark's drawing units (the mark is 392.12
   wide), so the dots scale with it exactly the way the font's dots scale with
   the type. A tile of 10 puts about 39 dots across the flower.

   Keep the radius near 0.354 of the tile: that is the dot-to-gap ratio the
   grid was drawn at, so changing the tile alone keeps the texture even. */
const DOT_TILE = 10;
const DOT_RADIUS = 3.54;

/** The flower, punched out of a fine grid of dots. */
function DottedMark() {
  return (
    <svg className="footer__glyph" viewBox={BRUD_MARK_VIEWBOX} aria-hidden="true">
      <defs>
        <pattern
          id="brudFooterDots"
          width={DOT_TILE}
          height={DOT_TILE}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={DOT_TILE / 2} cy={DOT_TILE / 2} r={DOT_RADIUS} fill="currentColor" />
        </pattern>
      </defs>
      <path d={BRUD_MARK_PATH} fill="url(#brudFooterDots)" />
    </svg>
  );
}

/**
 * Sizes the wordmark so it spans its container, whatever the container is.
 *
 * Measuring beats guessing at a vw value: the line is laid out once at a
 * reference size, and the ratio it needs becomes the real size. It runs on a
 * width change and when the wordmark face finishes loading, never on a scroll or
 * animation frame.
 */
function useFitToWidth(fill) {
  const boxRef = useRef(null);
  const lineRef = useRef(null);

  useEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return undefined;

    let lastWidth = -1;

    const fit = (force) => {
      const width = box.clientWidth;
      // Height changes as a side effect of resizing the type; only a change
      // in the width the line has to fill is worth re-measuring for.
      if (!force && width === lastWidth) return;
      lastWidth = width;
      line.style.fontSize = "100px";
      const natural = line.scrollWidth;
      if (!natural || !width) return;
      line.style.fontSize = `${(100 * width * fill) / natural}px`;
    };

    fit(true);
    const resized = new ResizeObserver(() => fit(false));
    resized.observe(box);
    // Array is self-hosted and swaps in: remeasure once it lands.
    document.fonts?.ready.then(() => fit(true));

    return () => resized.disconnect();
  }, [fill]);

  return { boxRef, lineRef };
}

/* The three faces on the pill. Drawn from primitives rather than borrowed
   marks: they say "whichever assistant you use", they are a few dozen bytes,
   and there is no logo here that is not ours. */
const FACES = [
  <path key="spark" d="M12 2.6l1.8 6.1L20 10.5l-6.2 1.8L12 18.4l-1.8-6.1L4 10.5l6.2-1.8z" />,
  <g key="orbit">
    <circle cx="12" cy="11" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="12" cy="11" r="2.2" />
  </g>,
  <path
    key="cube"
    d="M12 3.6l7 4v7l-7 4-7-4v-7z"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinejoin="round"
  />,
];

function CopyIcon() {
  return (
    <svg className="copypill__copy" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="copypill__copy" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12.8l4.4 4.4L19 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The dark pill: who it works with, what to copy, and the copy itself. */
function CopyPill() {
  const { label, done, command } = FOOTER.copy;
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the command is still written out in Install */
    }
  };

  return (
    <button type="button" className="copypill" onClick={copy} data-copied={copied ? "" : undefined}>
      <span className="copypill__faces" aria-hidden="true">
        {FACES.map((face, index) => (
          <span key={index} className="copypill__face">
            <svg viewBox="0 0 24 24" fill="currentColor">
              {face}
            </svg>
          </span>
        ))}
      </span>

      <span className="copypill__label">{copied ? done : label}</span>
      {copied ? <CheckIcon /> : <CopyIcon />}

      <span className="copypill__sr" role="status">
        {copied ? "Install command copied to clipboard" : ""}
      </span>
    </button>
  );
}

/**
 * Parallax for the footer's layers.
 *
 * Writes one number, --fp, onto the footer: 0 as its top edge enters the
 * viewport, 1 when the page is scrolled to the very end. The stylesheet turns
 * that into transforms, so the amounts live in CSS and differ per device.
 * The scroll listener only exists while the footer is on screen, and does
 * no layout reads beyond one rect per frame.
 */
function useFooterParallax() {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    // Browsers with CSS scroll-driven animations run the parallax on the
    // compositor (see footer.css); this is only the fallback for the rest.
    if (window.CSS?.supports?.("animation-timeline: view()")) return undefined;

    let frame = 0;
    let lastP = -1;

    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight;
      const travel = Math.min(rect.height, vh) || 1;
      const p = Math.min(1, Math.max(0, (vh - rect.top) / travel));
      const rounded = Math.round(p * 1000) / 1000;
      if (rounded !== lastP) {
        lastP = rounded;
        node.style.setProperty("--fp", rounded);
      }
    };

    const request = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        window.addEventListener("scroll", request, { passive: true });
        window.addEventListener("resize", request);
        request();
      } else {
        window.removeEventListener("scroll", request);
        window.removeEventListener("resize", request);
      }
    });
    io.observe(node);

    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
    };
  }, []);

  return ref;
}

/**
 * The looping background clip.
 *
 * Nothing is fetched until the footer comes within a screen of the viewport
 * (preload="none" and no src until then). It plays only while the footer is
 * on screen and never for reduced-motion users, who keep the still.
 */
function FooterVideo({ sources }) {
  const ref = useRef(null);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const visible = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          setArmed(true);
          if (video.currentSrc) video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { rootMargin: "100% 0px" }
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  // Once the sources are in the DOM, tell the element to pick one and start.
  // With preload="none" nothing loads on its own, so this is what kicks it off.
  useEffect(() => {
    const video = ref.current;
    if (!armed || !video) return;
    video.muted = true; // the property, not just the attribute, is what autoplay checks
    video.load();
    if (visible.current) video.play().catch(() => {});
  }, [armed]);

  return (
    <video
      ref={ref}
      className={`footer__video${playing ? " is-playing" : ""}`}
      muted
      autoPlay
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      onPlaying={() => setPlaying(true)}
      onCanPlay={(e) => {
        if (visible.current && e.currentTarget.paused) e.currentTarget.play().catch(() => {});
      }}
    >
      {armed &&
        sources.map((s) => <source key={s.src} src={s.src} type={s.type} />)}
    </video>
  );
}

/**
 * The closing section.
 *
 * Three bands over one ember plate: the last call to action, a thin row of
 * links, and the wordmark set in Array across the foot of the page.
 *
 * The plate is the looping clip over its still first frame, so the section
 * never shows empty while the clip loads, and phones on slow links or with
 * reduced motion still get the full picture.
 */
export default function FooterSection() {
  const { title, action, links, legal, wordmark, background } = FOOTER;
  const { boxRef, lineRef } = useFitToWidth(1);
  const footerRef = useFooterParallax();

  return (
    <footer className="footer" ref={footerRef}>
      <div className="footer__plate" aria-hidden="true">
        <Image
          className="footer__image"
          src={background.src}
          alt=""
          fill
          sizes="100vw"
          quality={80}
        />
        <FooterVideo sources={background.video} />
      </div>
      {/* Outside the plate on purpose: the plate moves with the parallax,
          the fade must stay pinned to the footer's top edge. */}
      <div className="footer__fade" aria-hidden="true" />

      <div className="footer__cta">
        <h2 className="footer__title">{title}</h2>

        <div className="footer__actions">
          <a className="btn btn--solid" href={action.href}>
            {action.label}
          </a>
          <CopyPill />
        </div>
      </div>

      <div className="footer__bar">
        <ul className="footer__links">
          {links.map((link) => (
            <li key={link.label}>
              <a
                className="footer__link"
                href={link.href}
                {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <p className="footer__legal">{legal}</p>
      </div>

      <div className="footer__wordmark" ref={boxRef}>
        <span className="footer__word" ref={lineRef}>
          <span className="footer__sr">{wordmark.label}</span>
          <span aria-hidden="true">{wordmark.lead}</span>
          <DottedMark />
          <span aria-hidden="true">{wordmark.trail}</span>
        </span>
      </div>
    </footer>
  );
}
