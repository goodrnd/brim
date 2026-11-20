import type {Mesh, Object3D} from 'three';
import {ThreeMFLoader} from 'three/examples/jsm/loaders/3MFLoader.js';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';

export const meshFormats = '.stl,.3mf,.obj';

/** Parses an STL, 3MF or OBJ file into a triangle soup, picking the format by extension. */
// shortcut: 3MF `unit` is ignored (assumed mm) and OBJ is taken as Z-up; scale/rotate on import if users hit it.
export function parseMesh(name: string, buf: ArrayBuffer): Float32Array {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === '3mf') {
    return flatten(new ThreeMFLoader().parse(buf));
  }
  if (ext === 'obj') {
    return flatten(new OBJLoader().parse(new TextDecoder().decode(buf)));
  }
  return parseStl(buf);
}

/** Merges every mesh in a loaded scene into world-space triangles. */
function flatten(root: Object3D): Float32Array {
  root.updateMatrixWorld(true);
  const parts: Array<ArrayLike<number>> = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) {
      const g = (o as Mesh).geometry.clone().applyMatrix4(o.matrixWorld);
      parts.push((g.index ? g.toNonIndexed() : g).getAttribute('position').array);
    }
  });
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  if (!out.length) {
    throw new Error('No triangles found in file');
  }
  return out;
}

/** Parses binary or ASCII STL into a triangle soup. */
function parseStl(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (n > 0 && 84 + n * 50 === buf.byteLength) {
    const out = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 9; k++) {
        out[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
      }
    }
    return out;
  }
  const text = new TextDecoder().decode(buf);
  const nums = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
  if (!nums.length || nums.some(Number.isNaN)) {
    throw new Error('Not a valid STL file');
  }
  return new Float32Array(nums);
}
