"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";

function Cube() {
  const ref = useRef();
  const { gl } = useThree();
  useFrame((state) => {
    ref.current.rotation.y = state.clock.elapsedTime * 0.6;
    if (typeof window !== "undefined") {
      window.__minInfo = {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        contextLost: gl.getContext().isContextLost(),
        outputColorSpace: gl.outputColorSpace,
        toneMapping: gl.toneMapping,
        pixelRatio: gl.getPixelRatio(),
      };
    }
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#ff3b30" roughness={0.4} />
    </mesh>
  );
}

export default function MinScene() {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 7], fov: 40 }}
      gl={{ preserveDrawingBuffer: true }}
      onCreated={({ gl }) => gl.setClearColor(0x0a0a0c, 1)}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 5, 6]} intensity={80} />
      <Cube />
    </Canvas>
  );
}
