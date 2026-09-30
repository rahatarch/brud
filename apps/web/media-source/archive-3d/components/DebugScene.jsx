"use client";

// Minimal control: no custom materials, no composer. If the marks show up here
// the GLB pipeline is fine and the problem is material/lighting/composer.
import { Canvas } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { brudConfig } from "@/lib/brudConfig";

function Marks() {
  const gltf = useGLTF("/models/brud_med.glb", "/draco/gltf/");
  const scene = gltf.scene.clone(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (typeof window !== "undefined") {
    window.__brudBounds = {
      size: size.toArray().map((n) => +n.toFixed(2)),
      center: center.toArray().map((n) => +n.toFixed(2)),
      meshes: [],
    };
    scene.traverse((c) => {
      if (c.isMesh) {
        window.__brudBounds.meshes.push({
          name: c.name,
          pos: c.position.toArray().map((n) => +n.toFixed(2)),
          scale: +c.scale.x.toFixed(3),
          verts: c.geometry.attributes.position?.count ?? 0,
          hasNormals: !!c.geometry.attributes.normal,
        });
      }
    });
  }
  scene.traverse((c) => {
    if (c.isMesh) c.material = new THREE.MeshNormalMaterial();
  });
  return <primitive object={scene} />;
}

export default function DebugScene() {
  const { camera } = brudConfig;
  return (
    <Canvas
      camera={{ position: camera.position, fov: camera.fov }}
      onCreated={({ camera: cam }) => cam.lookAt(...camera.target)}
    >
      <Marks />
    </Canvas>
  );
}
