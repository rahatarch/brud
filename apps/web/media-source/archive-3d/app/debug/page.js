"use client";

import dynamic from "next/dynamic";

const DebugScene = dynamic(() => import("@/components/hero/DebugScene"), { ssr: false });

export default function DebugPage() {
  return (
    <main style={{ height: "100svh", background: "#0a0a0c" }}>
      <DebugScene />
    </main>
  );
}
