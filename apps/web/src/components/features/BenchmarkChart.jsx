"use client";

import { useEffect, useRef, useState } from "react";

const fmt = (n) => n.toLocaleString("en-US");

/**
 * Benchmarks as one horizontal card.
 *
 * A big live readout and headline chips up top, then a dot-matrix bar per
 * benchmark. The hovered (or focused) row lights up in the mark gradient with
 * a halftone halo and a knob at its end, and a dashed guide slides across to
 * meet it. Bars reveal once, when the card scrolls into view.
 *
 * Everything that moves is transform or opacity, so all of it runs on the
 * GPU: the bars reveal by sliding a clipping box right while the dots inside
 * slide left by the same amount, so the dots stay put and are uncovered. The
 * dots are static CSS backgrounds, so hovering never repaints the pattern.
 */
export default function BenchmarkChart({ data }) {
  const { rows, max, axis, highlights = [] } = data;
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const row = rows[active];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  return (
    <div className="bench" ref={ref} data-seen={seen ? "" : undefined}>
      <header className="bench__head">
        <div className="bench__readout">
          <span className="bench__eyebrow">{axis}</span>
          <p className="bench__figure" aria-live="polite">
            <span className="bench__figure-num">{fmt(row.files)}</span>
            <span className="bench__figure-unit">files</span>
          </p>
          <span className="bench__figure-name">
            {row.name}
            <span className="bench__figure-time">{row.time}</span>
          </span>
        </div>

        {highlights.length > 0 && (
          <ul className="bench__pills">
            {highlights.map((item) => (
              <li key={item.label} className="bench__pill">
                <span>{item.label}</span>
                <b>{item.value}</b>
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="bench__stage">
        <div className="bench__guide" aria-hidden="true">
          <span className="bench__guide-line" style={{ "--w": row.files / max }} />
        </div>

        <ul className="bench__rows" onPointerLeave={() => setActive(0)}>
          {rows.map((item, index) => (
            <li key={item.name}>
              <button
                type="button"
                className="bench__row"
                data-active={active === index ? "" : undefined}
                onPointerEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                aria-label={`${item.name}: ${item.result}. ${item.time}.`}
              >
                <span className="bench__name">{item.name}</span>
                <span className="bench__track" style={{ "--w": item.files / max, "--i": index }}>
                  <i className="bench__halo" />
                  <i className="bench__clip">
                    <i className="bench__fill" />
                  </i>
                  <i className="bench__knob" />
                  <b className="bench__tip">{fmt(item.files)}</b>
                </span>
                <span className="bench__time">{item.short}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="bench__axis" aria-hidden="true">
          <span />
          <span className="bench__ticks">
            {ticks.map((tick) => (
              <span key={tick}>{fmt(tick)}</span>
            ))}
          </span>
          <span />
        </div>
      </div>

      <dl className="bench__detail">
        <div>
          <dt>Scale</dt>
          <dd>{row.scale}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>{row.result}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="bench__detail-time">{row.time}</dd>
        </div>
      </dl>
    </div>
  );
}
