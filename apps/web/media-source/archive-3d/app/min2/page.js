"use client";

// Same as /min but loads the Draco GLB. Isolates the GLB/Draco path.
import dynamic from "next/dynamic";

const Min2Scene = dynamic(() => import("@/components/hero/Min2Scene"), { ssr: false });

export default function Min2Page() {
  return (
    <main style={{ height: "100svh", background: "#0a0a0c" }}>
      <Min2Scene />
    </main>
  );
}
