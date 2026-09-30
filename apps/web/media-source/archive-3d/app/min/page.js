"use client";

// Absolute minimum control: r3f + one lit cube. No GLB, no drei, no composer,
// no custom shaders. If this is white, the problem is the renderer setup.
import dynamic from "next/dynamic";

const MinScene = dynamic(() => import("@/components/hero/MinScene"), { ssr: false });

export default function MinPage() {
  return (
    <main style={{ height: "100svh", background: "#0a0a0c" }}>
      <MinScene />
    </main>
  );
}
