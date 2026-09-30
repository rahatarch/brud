"use client";

import { useEffect, useState } from "react";

import BrudMark from "@/components/brand/BrudMark";
import { NAV } from "@/content/hero";

const SECTION_IDS = NAV.links.map((link) => link.href.slice(1));

function Bar({ active }) {
  return (
    <>
      <a className="wordmark" href={NAV.brand.href}>
        <span>{NAV.brand.lead}</span>
        <BrudMark size={23} />
        <span>{NAV.brand.trail}</span>
      </a>

      <div className="switch">
        {NAV.links.map((link) => {
          const on = active === link.href.slice(1);
          return (
            <a
              key={link.href}
              className={on ? "switch__item switch__item--active" : "switch__item"}
              href={link.href}
              aria-current={on ? "location" : undefined}
            >
              {on ? <span className="switch__dot" /> : null}
              {link.label}
            </a>
          );
        })}
        <a
          className="switch__badge"
          href={NAV.github}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Star Brud Code on GitHub"
          title="Star on GitHub"
        >
          <svg viewBox="0 0 16 16" width="19" height="19" aria-hidden="true" fill="#0D0E10">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
    </>
  );
}

/**
 * The header is fixed so it stays on screen while you scroll. An invisible,
 * inert twin keeps its row in the hero grid, so nothing shifts. It tightens
 * once you leave the top, and highlights the section you are reading.
 */
export default function HeroNav() {
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState(null);

  useEffect(() => {
    let frame = 0;
    // Section tops in page coordinates, read once and after layout changes,
    // so a scroll frame never has to ask the browser for layout.
    let tops = [];
    const measure = () => {
      tops = SECTION_IDS.map((id) => {
        const node = document.getElementById(id);
        return node ? node.getBoundingClientRect().top + window.scrollY : Infinity;
      });
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setStuck(y > 24);
        // The last section whose top has passed 40% of the viewport is current.
        const line = y + window.innerHeight * 0.4;
        let current = null;
        SECTION_IDS.forEach((id, i) => {
          if (tops[i] <= line) current = id;
        });
        setActive(current);
      });
    };
    const remeasure = () => {
      measure();
      onScroll();
    };
    measure();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    const resized = new ResizeObserver(remeasure);
    resized.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      resized.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="nav nav--spacer" aria-hidden="true" inert>
        <Bar active={null} />
      </div>
      <header className="nav nav--fixed" data-stuck={stuck ? "" : undefined}>
        <Bar active={active} />
      </header>
    </>
  );
}
