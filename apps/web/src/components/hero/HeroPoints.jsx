"use client";

import { useRef, useState } from "react";
import { HERO } from "@/content/hero";

// Right column of the stage. Each beat reads as a single line until you point
// at it; then the row grows to fit and the rest of the sentence fades in, the
// way the Vercel hero list behaves. The tail is always in the layout (just
// transparent), so the expanded height is simply the inner span's height and
// we never have to guess at it.
export default function HeroPoints() {
  const [active, setActive] = useState(-1);
  const rows = useRef([]);
  const texts = useRef([]);

  const open = (i) => {
    const row = rows.current[i];
    const text = texts.current[i];
    if (row && text) row.style.height = `${text.offsetHeight}px`;
    setActive(i);
  };

  const close = (i) => {
    const row = rows.current[i];
    if (row) row.style.height = "";
    setActive((current) => (current === i ? -1 : current));
  };

  return (
    <ul className="points">
      {HERO.points.map((point, i) => (
        <li
          key={point.lead}
          ref={(el) => {
            rows.current[i] = el;
          }}
          className="points__row"
          data-open={active === i ? "" : undefined}
          data-dim={active !== -1 && active !== i ? "" : undefined}
          tabIndex={0}
          onMouseEnter={() => open(i)}
          onMouseLeave={() => close(i)}
          onFocus={() => open(i)}
          onBlur={() => close(i)}
        >
          <span
            className="points__text"
            ref={(el) => {
              texts.current[i] = el;
            }}
          >
            <span className="points__lead">{point.lead}</span>
            <span className="points__tail"> {point.tail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
