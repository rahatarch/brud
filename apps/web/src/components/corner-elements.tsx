"use client";

import { useEffect, useState } from "react";

function useMousePosition() {
  const [pos, setPos] = useState({ x: -1000, y: -1000 });

  useEffect(() => {
    const handler = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  return pos;
}

function useViewportSize() {
  const [size, setSize] = useState({ w: 1920, h: 1080 });

  useEffect(() => {
    const handler = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return size;
}

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const OPACITY_RANGE = [0.025, 0.11] as const;

export default function CornerElements() {
  const mouse = useMousePosition();
  const vp = useViewportSize();

  const dTL = dist(mouse.x, mouse.y, 0, 0);
  const dTR = dist(mouse.x, mouse.y, vp.w, 0);
  const dBL = dist(mouse.x, mouse.y, 0, vp.h);
  const dBR = dist(mouse.x, mouse.y, vp.w, vp.h);

  const iTL = smoothstep(500, 0, dTL);
  const iTR = smoothstep(500, 0, dTR);
  const iBL = smoothstep(500, 0, dBL);
  const iBR = smoothstep(500, 0, dBR);

  const [lo, hi] = OPACITY_RANGE;
  const range = hi - lo;

  return (
    <>
      {/* Top-left: soft radial gradient orb */}
      <div
        className="fixed top-0 left-0 pointer-events-none"
        style={{ width: 260, height: 260, transform: "translate(-35%, -35%)" }}
      >
        <div
          className="w-full h-full rounded-full transition-all duration-500 ease-out"
          style={{
            background: `radial-gradient(circle at center, rgba(242,140,40,${lo + range * iTL}) 0%, rgba(232,63,120,${(lo + range * iTL) * 0.6}) 40%, transparent 70%)`,
          }}
        />
      </div>

      {/* Top-right: small dot cluster */}
      <div
        className="fixed top-0 right-0 pointer-events-none flex items-start justify-end"
        style={{ width: 140, height: 140, padding: 24 }}
      >
        <div className="relative" style={{ width: 32, height: 32 }}>
          {[
            [0, 0],
            [14, 0],
            [0, 14],
            [14, 14],
            [7, 7],
          ].map(([dx, dy], i) => (
            <div
              key={i}
              className="absolute rounded-full transition-all duration-500 ease-out"
              style={{
                width: 3,
                height: 3,
                top: dy,
                left: dx,
                backgroundColor: `rgba(242,140,40,${0.06 + range * iTR})`,
                transform: `scale(${1 + 0.12 * iTR})`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Bottom-left: thin diagonal line */}
      <div
        className="fixed bottom-0 left-0 pointer-events-none flex items-end justify-start"
        style={{ width: 140, height: 140, padding: 24 }}
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 40 40"
          className="transition-all duration-500 ease-out"
          style={{ transform: `translate(${iBL * -5}px, ${iBL * 5}px)` }}
        >
          <line
            x1="2"
            y1="38"
            x2="38"
            y2="2"
            stroke={`rgba(242,140,40,${0.05 + range * iBL})`}
            strokeWidth="1"
          />
          <line
            x1="8"
            y1="38"
            x2="38"
            y2="8"
            stroke={`rgba(232,63,120,${0.03 + range * iBL * 0.7})`}
            strokeWidth="0.5"
          />
        </svg>
      </div>

      {/* Bottom-right: scaling glow circle */}
      <div
        className="fixed bottom-0 right-0 pointer-events-none flex items-end justify-end"
        style={{ width: 200, height: 200, padding: 24 }}
      >
        <div
          className="rounded-full transition-all duration-500 ease-out"
          style={{
            width: 80,
            height: 80,
            transform: `scale(${1 + 0.12 * iBR})`,
            background: `radial-gradient(circle at center, rgba(232,63,120,${0.03 + range * iBR * 0.5}) 0%, rgba(242,140,40,${0.01 + range * iBR * 0.3}) 50%, transparent 70%)`,
            border: `1px solid rgba(242,140,40,${0.02 + range * iBR * 0.5})`,
          }}
        />
      </div>
    </>
  );
}