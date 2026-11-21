// Mesh booleans via manifold-3d (WASM). Output is always a closed mesh; runs in the browser and Node.
import Module, {type Manifold} from 'manifold-3d';

const wasm = await Module();
wasm.setup();

export type BoolOp = 'add' | 'subtract';

/** Welds a triangle soup into an indexed manifold. Throws when the soup is not a closed solid. */
export function toManifold(p: Float32Array): Manifold {
  const index = new Map<string, number>();
  const verts: Array<number> = [];
  const tris: Array<number> = [];
  const id = (i: number) => {
    // Weld on a 1 µm grid: soups repeat vertices with float noise.
    const k = `${Math.round(p[i] * 1e3)},${Math.round(p[i + 1] * 1e3)},${Math.round(p[i + 2] * 1e3)}`;
    let v = index.get(k);
    if (v === undefined) {
      v = verts.length / 3;
      index.set(k, v);
      verts.push(p[i], p[i + 1], p[i + 2]);
    }
    return v;
  };
  for (let t = 0; t < p.length; t += 9) {
    const [a, b, c] = [id(t), id(t + 3), id(t + 6)];
    if (a !== b && b !== c && a !== c) {
      tris.push(a, b, c);
    } // drop degenerate slivers
  }
  const mesh = new wasm.Mesh({numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris)});
  mesh.merge();
  const m = new wasm.Manifold(mesh);
  if (m.status() !== 'NoError') {
    throw new Error(`mesh is not a closed solid (${m.status()})`);
  }
  return m;
}

export function toSoup(m: Manifold): Float32Array {
  const {vertProperties: v, triVerts: t, numProp: n} = m.getMesh();
  const out = new Float32Array(t.length * 3);
  for (let i = 0; i < t.length; i++) {
    out.set(v.subarray(t[i] * n, t[i] * n + 3), i * 3);
  }
  return out;
}

/** Combines two triangle soups into one closed soup. */
export function boolean(a: Float32Array, b: Float32Array, op: BoolOp): Float32Array {
  const [ma, mb] = [toManifold(a), toManifold(b)];
  const r = op === 'add' ? ma.add(mb) : ma.subtract(mb);
  try {
    if (r.isEmpty()) {
      throw new Error(`${op} left nothing`);
    }
    return toSoup(r);
  } finally {
    ma.delete();
    mb.delete();
    r.delete();
  }
}
