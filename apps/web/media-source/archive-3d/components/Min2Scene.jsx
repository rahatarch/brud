"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

function Model() {
  const gltf = useGLTF("/models/brud_low.glb", "/draco/gltf/");
  const scene = gltf.scene.clone(true);
  scene.traverse((c) => {
    if (c.isMesh) c.material = new THREE.MeshBasicMaterial({ color: "#ff3b30", wireframe: false });
  });
  return <primitive object={scene} />;
}

export default function Min2Scene() {
  return (
    <Canvas
      camera={{ position: [0, 1.8, 11.5], fov: 39.6 }}
      gl={{ preserveDrawingBuffer: true }}
      onCreated={({ gl, camera }) => {
        gl.setClearColor(0x0a0a0c, 1);
        camera.lookAt(0, 0.738, 0);
      }}
    >
      <Suspense fallback={null}>
        <Model />
      </Suspense>
    </Canvas>
  );
}
