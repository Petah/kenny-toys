import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { kenney } from './kenney';

/** A WebGL renderer that fills `parent`, keeps the camera's aspect in step and casts soft shadows. */
export function createRenderer(parent: HTMLElement, camera: THREE.PerspectiveCamera) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = 'block';
  parent.append(renderer.domElement);
  const resize = () => {
    const w = parent.clientWidth || 1;
    const h = parent.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(parent);
  resize();
  return renderer;
}

export interface LoadedGlb {
  gltf: GLTF;
  /** The file's raw bytes, for anything that wants the geometry directly (like a physics mesh). */
  buffer: ArrayBuffer;
}

/** Loads a .glb from the Kenney bundle. Its textures resolve next to it, so declare them too. */
export async function loadGlb(relPath: string): Promise<LoadedGlb> {
  const url = kenney(relPath);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} loading ${relPath}`);
  const buffer = await response.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), url.slice(0, url.lastIndexOf('/') + 1));
  return { gltf, buffer };
}

/**
 * Kenney kits colour everything from one shared colormap, but each .glb brings its own copy of
 * the material and texture. This swaps in one material per name across all of them, and turns
 * on shadows, so the GPU holds a single texture.
 */
export function shareMaterials(models: THREE.Object3D[]) {
  const byName = new Map<string, THREE.Material>();
  for (const model of models) {
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const shared = mats.map((m: THREE.Material) => {
        const existing = byName.get(m.name);
        if (existing) return existing;
        byName.set(m.name, m);
        return m;
      });
      o.material = Array.isArray(o.material) ? shared : shared[0];
    });
  }
}
