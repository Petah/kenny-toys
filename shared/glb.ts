/**
 * Reads the triangles out of a .glb file, with each node's transform applied, so physics can
 * use exactly the geometry that's drawn. No three.js, so the hole checker can run it in Node.
 */

export interface Triangles {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
}

interface GltfJson {
  nodes: { mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; name?: string }[];
  scenes: { nodes: number[] }[];
  scene?: number;
  meshes: { primitives: { attributes: { POSITION: number }; indices?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

type Mat = number[];

/** Column-major 4x4 from translation, quaternion rotation and scale. */
function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): Mat {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function multiply(a: Mat, b: Mat): Mat {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/**
 * Triangles from a GLB. `skip` leaves out named nodes (and their children), for parts that are
 * drawn but shouldn't collide, like the windmill's blades.
 */
export function readGlb(buffer: ArrayBuffer, skip: string[] = []): Triangles {
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as GltfJson;
  const binStart = 20 + jsonLength + 8;

  const positions: number[] = [];
  const indices: number[] = [];
  const visit = (index: number, parent: Mat) => {
    const node = json.nodes[index];
    if (node.name && skip.includes(node.name)) return;
    const world = multiply(parent, compose(node.translation, node.rotation, node.scale));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const base = positions.length / 3;
        const pa = json.accessors[prim.attributes.POSITION];
        const pv = json.bufferViews[pa.bufferView];
        const pOff = binStart + (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0);
        const stride = pv.byteStride ?? 12;
        for (let i = 0; i < pa.count; i++) {
          const x = view.getFloat32(pOff + i * stride, true);
          const y = view.getFloat32(pOff + i * stride + 4, true);
          const z = view.getFloat32(pOff + i * stride + 8, true);
          positions.push(
            world[0] * x + world[4] * y + world[8] * z + world[12],
            world[1] * x + world[5] * y + world[9] * z + world[13],
            world[2] * x + world[6] * y + world[10] * z + world[14],
          );
        }
        if (prim.indices === undefined) {
          for (let i = 0; i < pa.count; i++) indices.push(base + i);
          continue;
        }
        const ia = json.accessors[prim.indices];
        const iv = json.bufferViews[ia.bufferView];
        const iOff = binStart + (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
        const size = ia.componentType === 5121 ? 1 : ia.componentType === 5123 ? 2 : 4;
        for (let i = 0; i < ia.count; i++) {
          const at = iOff + i * size;
          indices.push(base + (size === 1 ? view.getUint8(at) : size === 2 ? view.getUint16(at, true) : view.getUint32(at, true)));
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const identity = compose();
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, identity);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
