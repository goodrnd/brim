import {ExtrudeGeometry, Path, Shape} from 'three';
import {boolean} from './csg.ts';

// Regex prompt parser: the fallback when no LLM key is configured (see intent.ts).

export type Kind =
  | 'vase' | 'cup' | 'cylinder' | 'tube' | 'cone' | 'sphere'
  | 'box' | 'plate' | 'gear' | 'hex' | 'star' | 'tag';

export interface Spec {
  kind: Kind;
  width: number; // diameter for round kinds, mm
  depth: number;
  height: number;
  wall: number; // 0 = solid
  hole: number; // through-hole diameter, 0 = none
  teeth: number;
  points: number;
  ribs: number;
  twist: number; // degrees over full height
  taper: number; // top scale
  corner: number;
  segments: number;
}

export type Model =
  | {type: 'param'; spec: Spec}
  | {type: 'mesh'; name: string; positions: Float32Array};

export const kinds: Kind[] = ['vase', 'cup', 'cylinder', 'tube', 'cone', 'sphere', 'box', 'plate', 'gear', 'hex', 'star', 'tag'];

export const base: Spec = {
  kind: 'box', width: 40, depth: 40, height: 40, wall: 0, hole: 0,
  teeth: 20, points: 5, ribs: 0, twist: 0, taper: 1, corner: 0, segments: 96,
};

export const defaults: Record<Kind, Partial<Spec>> = {
  vase: {width: 60, height: 120, wall: 2, taper: 0.8},
  cup: {width: 80, height: 90, wall: 3},
  cylinder: {width: 30, height: 40},
  tube: {width: 30, height: 40, wall: 2},
  cone: {width: 50, height: 60},
  sphere: {width: 40, height: 40},
  box: {width: 60, depth: 40, height: 30, wall: 2, corner: 4},
  plate: {width: 100, depth: 100, height: 4, corner: 8},
  gear: {width: 40, height: 8, hole: 5},
  hex: {width: 30, height: 10},
  star: {width: 50, height: 8},
  tag: {width: 50, depth: 20, height: 3, corner: 4},
};

const kindWords: [Kind, RegExp][] = [
  ['vase', /\bvases?\b/], ['cup', /\b(cup|mug|planter|pot|bowl)s?\b/],
  ['tube', /\b(tube|pipe|ring|sleeve|spacer)s?\b/], ['cone', /\bcones?\b/],
  ['sphere', /\b(sphere|ball|orb)s?\b/], ['gear', /\b(gear|cog)s?\b/],
  ['hex', /\b(hex|hexagon(al)?)\b/], ['star', /\bstars?\b/],
  ['tag', /\b(tag|keychain|key ?ring|label)s?\b/],
  ['plate', /\b(plate|coaster|tile|sign)s?\b/],
  ['box', /\b(box|tray|cube|block|container|organi[sz]er)s?\b/],
  ['cylinder', /\b(cylinder|puck|disc|disk|peg)s?\b/],
];

const NUM = String.raw`(\d+(?:\.\d+)?)\s*(mm|cm|in)?`;
const toMm = (n: string, unit?: string) =>
  Number(n) * (unit === 'cm' ? 10 : unit === 'in' ? 25.4 : 1);

/** Finds "<number> <word>" or "<word> <number>" and returns millimetres. */
function grab(text: string, words: string): number | undefined {
  const after = new RegExp(`${NUM}\\s*(?:${words})\\b`).exec(text);
  if (after) return toMm(after[1], after[2]);
  const before = new RegExp(`\\b(?:${words})\\s*(?:of|=|:|is)?\\s*${NUM}`).exec(text);
  if (before) return toMm(before[1], before[2]);
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const round = new Set<Kind>(['vase', 'cup', 'cylinder', 'tube', 'cone', 'sphere', 'gear', 'hex', 'star']);

export function describe(spec: Spec): string {
  const size = round.has(spec.kind)
    ? `Ø${fmt(spec.width)} × ${fmt(spec.height)} mm`
    : `${fmt(spec.width)} × ${fmt(spec.depth)} × ${fmt(spec.height)} mm`;
  const parts: string[] = [spec.kind, size];
  if (spec.wall) parts.push(`${fmt(spec.wall)} mm walls`);
  if (spec.hole) parts.push(`Ø${fmt(spec.hole)} hole`);
  if (spec.kind === 'gear') parts.push(`${spec.teeth} teeth`);
  if (spec.kind === 'star') parts.push(`${spec.points} points`);
  if (spec.ribs) parts.push(`${spec.ribs} ribs`);
  if (spec.twist) parts.push(`${fmt(spec.twist)}° twist`);
  if (spec.taper !== 1) parts.push(`taper ${fmt(spec.taper)}`);
  if (spec.corner) parts.push(`${fmt(spec.corner)} mm corners`);
  if (spec.segments < 24) parts.push('low poly');
  return parts.join(' · ');
}

/** Turns a prompt into a spec. With `prev`, the prompt edits that spec. Returns what changed. */
export function parsePrompt(prompt: string, prev?: Spec): {spec: Spec; changes: string[]} {
  const t = prompt.toLowerCase();
  const changes: string[] = [];
  const kind = kindWords.find(([, re]) => re.test(t))?.[0];
  let s: Spec;
  if (!prev || (kind && kind !== prev.kind)) {
    const k = kind ?? prev?.kind ?? 'box';
    s = newSpec(k);
    if (prev) changes.push(`turned it into a ${k}`);
  } else s = {...prev};
  const set = <K extends keyof Spec>(key: K, value: Spec[K], note: string) => {
    if (s[key] === value) return;
    s[key] = value;
    changes.push(note);
  };

  // Relative edits.
  if (prev) {
    const mul = (keys: ('width' | 'depth' | 'height')[], f: number, note: string) => {
      for (const k of keys) s[k] *= f;
      changes.push(note);
    };
    const rel = /(\d+(?:\.\d+)?)\s*%\s*(bigger|larger|smaller)/.exec(t);
    if (rel) mul(['width', 'depth', 'height'], rel[2] === 'smaller' ? 1 - Number(rel[1]) / 100 : 1 + Number(rel[1]) / 100, `${rel[1]}% ${rel[2]}`);
    else if (/\b(twice|double) (as )?(big|large|the size)/.test(t)) mul(['width', 'depth', 'height'], 2, 'doubled the size');
    else if (/\bhalf (the )?size\b/.test(t)) mul(['width', 'depth', 'height'], 0.5, 'halved the size');
    else if (/\b(bigger|larger)\b/.test(t)) mul(['width', 'depth', 'height'], 1.25, 'scaled up 25%');
    else if (/\bsmaller\b/.test(t)) mul(['width', 'depth', 'height'], 0.8, 'scaled down 20%');
    const pct = /\bscale\D{0,6}(\d+(?:\.\d+)?)\s*%/.exec(t);
    if (pct) mul(['width', 'depth', 'height'], Number(pct[1]) / 100, `scaled to ${pct[1]}%`);
    if (/\b(taller|higher)\b/.test(t)) mul(['height'], 1.25, 'made it 25% taller');
    if (/\b(shorter|lower|flatter)\b/.test(t)) mul(['height'], 0.8, 'made it 20% shorter');
    if (/\b(wider|fatter)\b/.test(t)) mul(['width', 'depth'], 1.2, 'made it 20% wider');
    if (/\b(narrower|slimmer|skinnier)\b/.test(t)) mul(['width', 'depth'], 0.85, 'made it 15% narrower');
    if (/\b(thicker|sturdier|stronger) walls?\b|\b(sturdier|stronger)\b/.test(t))
      set('wall', (s.wall || 1.2) + 1, 'thickened the walls by 1 mm');
    if (/\bthinner walls?\b/.test(t)) set('wall', Math.max(0.8, s.wall - 0.5), 'thinned the walls');
    if (/\bmore teeth\b/.test(t)) set('teeth', s.teeth + 4, 'added 4 teeth');
    if (/\bfewer teeth\b/.test(t)) set('teeth', Math.max(6, s.teeth - 4), 'removed 4 teeth');
    if (/\bmore points\b/.test(t)) set('points', s.points + 1, 'added a point');
    if (/\bfewer points\b/.test(t)) set('points', Math.max(3, s.points - 1), 'removed a point');
    if (/\bmore ribs\b/.test(t)) set('ribs', s.ribs + 4, 'added 4 ribs');
    if (/\b(more twist|twist (it )?more|twistier)\b/.test(t)) set('twist', s.twist + 45, 'twisted 45° more');
    if (/\b(no|remove( the)?|less) twist|\bstraight(en)?\b|\buntwist/.test(t)) set('twist', 0, 'removed the twist');
    if (/\b(no|remove( the)?) ribs?\b|\bsmooth sides\b/.test(t)) set('ribs', 0, 'removed the ribs');
    if (/\b(no|remove( the)?|without( a)?) hole\b/.test(t)) set('hole', 0, 'removed the hole');
    if (/\bsharp(er)? corners\b/.test(t)) set('corner', 0, 'sharpened the corners');
    else if (/\b(round(er|ed)?|soft(er)?) corners\b|\brounder\b/.test(t)) set('corner', s.corner + 3, 'rounded the corners');
  }
  if (/\b(smoother|high[- ]?(res|poly|detail))\b/.test(t)) set('segments', 192, 'raised the resolution');
  if (/\blow[- ]?poly\b|\bfaceted\b/.test(t)) set('segments', round.has(s.kind) ? 8 : s.segments, 'made it low poly');
  if (/\bsolid\b/.test(t)) set('wall', 0, 'made it solid');
  else if (/\b(hollow|open top|open)\b/.test(t) && !s.wall) set('wall', 2, 'hollowed it with 2 mm walls');
  if (/\btaper(ed)?\b/.test(t) && s.taper >= 1) set('taper', 0.7, 'tapered the top');
  if (/\bflared?\b/.test(t)) set('taper', 1.3, 'flared the top');
  if (/\btwist(ed)?\b/.test(t) && !s.twist && !/\bno twist|untwist/.test(t)) set('twist', 90, 'added a 90° twist');
  if (/\b(ribbed|fluted)\b/.test(t) && !s.ribs) set('ribs', 12, 'added 12 ribs');
  if (/\b(add|with|plus|and)( a| an)? hole\b|\bhole in\b/.test(t) && !s.hole) set('hole', 4, 'added a Ø4 hole');

  // Absolute numbers.
  const dims = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?\s*(mm|cm)?/.exec(t);
  if (dims) {
    set('width', toMm(dims[1], dims[4]), `width ${dims[1]}`);
    set('depth', toMm(dims[2], dims[4]), `depth ${dims[2]}`);
    if (dims[3]) set('height', toMm(dims[3], dims[4]), `height ${dims[3]}`);
  }
  const cube = /(\d+(?:\.\d+)?)\s*(mm|cm)?\s*cube/.exec(t);
  if (cube) {
    const v = toMm(cube[1], cube[2]);
    s.width = s.depth = s.height = v;
    changes.push(`${fmt(v)} mm cube`);
  }
  const height = grab(t, 'tall|high|in height|height');
  if (height) set('height', height, `height ${fmt(height)} mm`);
  const thick = grab(t, 'thick|thickness');
  if (thick && !/walls?/.test(t)) set('height', thick, `thickness ${fmt(thick)} mm`);
  const radius = grab(t, 'radius');
  const width = radius ? radius * 2 : grab(t, 'wide|width|diameter|across|dia|long|length|size');
  if (width) {
    set('width', width, `width ${fmt(width)} mm`);
    if (round.has(s.kind) || s.kind === 'hex') s.depth = width;
  }
  const depth = grab(t, 'deep|depth');
  if (depth) set('depth', depth, `depth ${fmt(depth)} mm`);
  const wall = grab(t, 'walls?|wall thickness|thick walls?');
  if (wall) set('wall', wall, `${fmt(wall)} mm walls`);
  const hole = grab(t, 'hole|bore|shaft');
  if (hole) set('hole', hole, `Ø${fmt(hole)} hole`);
  const teeth = /(\d+)\s*teeth/.exec(t);
  if (teeth) set('teeth', Math.max(6, Number(teeth[1])), `${teeth[1]} teeth`);
  const points = /(\d+)[\s-]*points?/.exec(t);
  if (points) set('points', Math.max(3, Number(points[1])), `${points[1]} points`);
  const ribs = /(\d+)\s*(ribs|flutes)/.exec(t);
  if (ribs) set('ribs', Number(ribs[1]), `${ribs[1]} ribs`);
  const twist = /(\d+)\s*(°|deg|degrees?)?\s*twist|twist(?:ed)?\s*(?:by\s*)?(\d+)/.exec(t);
  if (twist) set('twist', Number(twist[1] ?? twist[3]), `${twist[1] ?? twist[3]}° twist`);
  const corner = grab(t, 'corners?|fillets?|corner radius');
  if (corner) set('corner', corner, `${fmt(corner)} mm corners`);

  normalize(s);
  if (!prev) changes.unshift(describe(s));
  return {spec: s, changes};
}

export const newSpec = (kind: Kind, over: Partial<Spec> = {}): Spec => normalize({...base, ...defaults[kind], ...over, kind});

/** Enforces the shape rules every spec must satisfy, in place. */
export function normalize(s: Spec): Spec {
  if (round.has(s.kind)) s.depth = s.width;
  if (s.kind === 'sphere') s.height = s.width;
  s.wall = Math.max(0, Math.min(s.wall, Math.min(s.width, s.depth) / 2 - 1));
  s.hole = Math.min(s.hole, Math.min(s.width, s.depth) * 0.8);
  return s;
}

/** Edits the LLM may return. Factors are relative (1 = unchanged); axes are X=width, Y=depth, Z=height. */
export type Op =
  | {op: 'set'; field: NumField; value: number}
  | {op: 'scale'; x: number; y: number; z: number}
  | {op: 'rotate'; axis: 'x' | 'y' | 'z'; degrees: number}
  /** `at` moves the part's bottom centre from the model's bottom centre, in mm. */
  | {op: 'add' | 'subtract'; part: Spec; at: [number, number, number]};
export type NumField = Exclude<keyof Spec, 'kind'>;
export const numFields = Object.keys(base).filter((k) => k !== 'kind') as NumField[];

export const describeOp = (o: Op) =>
  o.op === 'set' ? `set ${o.field} ${fmt(o.value)}`
  : o.op === 'scale' ? `scale ${[o.x, o.y, o.z].map(fmt).join(' × ')}`
  : o.op === 'rotate' ? `rotate ${fmt(o.degrees)}° about ${o.axis.toUpperCase()}`
  : `${o.op} ${describe(o.part)} at ${o.at.map(fmt).join(', ')}`;

/** Applies ops to a model. Returns the new model and one note per op. A boolean turns a parametric model into a mesh. */
export function applyOps(m: Model, ops: Op[]): {model: Model; changes: string[]} {
  const changes: string[] = [];
  for (const o of ops) {
    if ('part' in o) {
      const tool = buildPositions(o.part);
      for (let i = 0; i < tool.length; i += 3) for (let k = 0; k < 3; k++) tool[i + k] += o.at[k];
      try {
        const p = boolean(m.type === 'param' ? buildPositions(m.spec) : m.positions, tool, o.op);
        m = {type: 'mesh', name: m.type === 'mesh' ? m.name : m.spec.kind, positions: finalize(Array.from(p))};
        changes.push(describeOp(o));
      } catch (e) {
        changes.push(`skipped ${describeOp(o)}: ${(e as Error).message}`);
      }
    } else if (m.type === 'param') {
      const s = {...m.spec};
      if (o.op === 'set') s[o.field] = o.value;
      else if (o.op === 'scale') (s.width *= o.x), (s.depth *= o.y), (s.height *= o.z);
      else { changes.push(`skipped ${describeOp(o)}: rotation applies to imported meshes`); continue; }
      m = {type: 'param', spec: normalize(s)};
      changes.push(describeOp(o));
    } else {
      if (o.op === 'set') { changes.push(`skipped ${describeOp(o)}: imported meshes have no ${o.field}`); continue; }
      m = {...m, positions: finalize(Array.from(transform(m.positions, o)))};
      changes.push(describeOp(o));
    }
  }
  return {model: m, changes};
}

function transform(src: Float32Array, o: Extract<Op, {op: 'scale' | 'rotate'}>): Float32Array {
  const p = new Float32Array(src);
  if (o.op === 'scale') for (let i = 0; i < p.length; i += 3) (p[i] *= o.x), (p[i + 1] *= o.y), (p[i + 2] *= o.z);
  else {
    const a = (o.degrees * Math.PI) / 180;
    const [c, sn] = [Math.cos(a), Math.sin(a)];
    const [u, v] = o.axis === 'x' ? [1, 2] : o.axis === 'y' ? [2, 0] : [0, 1];
    for (let i = 0; i < p.length; i += 3) {
      const [pu, pv] = [p[i + u], p[i + v]];
      p[i + u] = pu * c - pv * sn;
      p[i + v] = pu * sn + pv * c;
    }
  }
  return p;
}

/** Scales, flips or drills an uploaded mesh. */
export function editMesh(prompt: string, positions: Float32Array): {positions: Float32Array; changes: string[]} {
  const t = prompt.toLowerCase();
  let [sx, sy, sz] = [1, 1, 1];
  const changes: string[] = [];
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  if (pct) {
    sx = sy = sz = Number(pct[1]) / 100;
    changes.push(`scaled to ${pct[1]}%`);
  } else if (/\b(twice|double)\b/.test(t)) (sx = sy = sz = 2), changes.push('doubled the size');
  else if (/\bhalf\b/.test(t)) (sx = sy = sz = 0.5), changes.push('halved the size');
  else if (/\b(bigger|larger)\b/.test(t)) (sx = sy = sz = 1.25), changes.push('scaled up 25%');
  else if (/\bsmaller\b/.test(t)) (sx = sy = sz = 0.8), changes.push('scaled down 20%');
  if (/\b(taller|higher)\b/.test(t)) (sz *= 1.25), changes.push('made it 25% taller');
  if (/\b(shorter|lower|flatter)\b/.test(t)) (sz *= 0.8), changes.push('made it 20% shorter');
  if (/\bwider\b/.test(t)) (sx *= 1.2), (sy *= 1.2), changes.push('made it 20% wider');
  const out = new Float32Array(positions);
  for (let i = 0; i < out.length; i += 3) (out[i] *= sx), (out[i + 1] *= sy), (out[i + 2] *= sz);
  if (/\b(flip|upside down)\b/.test(t)) {
    for (let i = 0; i < out.length; i += 3) (out[i + 1] = -out[i + 1]), (out[i + 2] = -out[i + 2]);
    changes.push('flipped it upside down');
  }
  if (/\b(rotate|stand( it)? up|lay( it)? (flat|down))\b/.test(t)) {
    for (let i = 0; i < out.length; i += 3) {
      const y = out[i + 1];
      out[i + 1] = -out[i + 2];
      out[i + 2] = y;
    }
    changes.push('rotated 90° about X');
  }
  let result = finalize(Array.from(out));
  if (/\b(hole|drill|bore)\b/.test(t)) {
    const d = grab(t, 'hole|bore') ?? 4;
    const h = bounds(result)[1][2] + 2;
    const r = applyOps({type: 'mesh', name: '', positions: result}, [{op: 'subtract', part: newSpec('cylinder', {width: d, height: h}), at: [0, 0, -1]}]);
    if (r.model.type === 'mesh') result = r.model.positions;
    changes.push(...r.changes);
  }
  return {positions: result, changes};
}

// ---------- geometry ----------

type P2 = [number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Revolves a closed (r, z) profile around Z. `radial` modulates the radius by angle and height. */
function revolve(profile: P2[], segs: number, radial: (phi: number, z: number) => number): number[] {
  const out: number[] = [];
  const pt = ([r, z]: P2, phi: number) => {
    const f = r * radial(phi, z);
    return [f * Math.cos(phi), f * Math.sin(phi), z];
  };
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    if (a[0] === 0 && b[0] === 0) continue;
    for (let j = 0; j < segs; j++) {
      const p0 = (j / segs) * Math.PI * 2;
      const p1 = ((j + 1) / segs) * Math.PI * 2;
      out.push(...pt(a, p0), ...pt(b, p0), ...pt(b, p1), ...pt(a, p0), ...pt(b, p1), ...pt(a, p1));
    }
  }
  return out;
}

function roundedRect<T extends Shape | Path = Shape>(w: number, d: number, c: number, path: T = new Shape() as T): T {
  c = Math.max(0, Math.min(c, w / 2 - 0.01, d / 2 - 0.01));
  const [x, y] = [-w / 2, -d / 2];
  path.moveTo(x + c, y);
  path.lineTo(x + w - c, y);
  if (c) path.quadraticCurveTo(x + w, y, x + w, y + c);
  path.lineTo(x + w, y + d - c);
  if (c) path.quadraticCurveTo(x + w, y + d, x + w - c, y + d);
  path.lineTo(x + c, y + d);
  if (c) path.quadraticCurveTo(x, y + d, x, y + d - c);
  path.lineTo(x, y + c);
  if (c) path.quadraticCurveTo(x, y, x + c, y);
  return path;
}

function polygon(pts: P2[]) {
  const s = new Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  return s;
}

function circle(cx: number, cy: number, r: number) {
  const p = new Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

function outline(s: Spec): Shape {
  const R = s.width / 2;
  if (s.kind === 'gear') {
    const m = s.width / (s.teeth + 2);
    const root = R - 2.25 * m;
    const pts: P2[] = [];
    for (let i = 0; i < s.teeth; i++) {
      const a = (i / s.teeth) * Math.PI * 2;
      const st = (Math.PI * 2) / s.teeth;
      for (const [r, f] of [[root, 0], [R, 0.3], [R, 0.5], [root, 0.8]] as P2[])
        pts.push([r * Math.cos(a + f * st), r * Math.sin(a + f * st)]);
    }
    return polygon(pts);
  }
  if (s.kind === 'star') {
    const pts: P2[] = [];
    for (let i = 0; i < s.points * 2; i++) {
      const r = i % 2 ? R * 0.45 : R;
      const a = (i / (s.points * 2)) * Math.PI * 2 + Math.PI / 2;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return polygon(pts);
  }
  if (s.kind === 'hex') {
    return polygon(Array.from({length: 6}, (_, i) => [R * Math.cos((i * Math.PI) / 3), R * Math.sin((i * Math.PI) / 3)] as P2));
  }
  return roundedRect(s.width, s.depth, s.corner);
}

function extrude(shape: Shape, depth: number, z0: number, s: Spec): number[] {
  const steps = s.twist || s.taper !== 1 ? Math.max(8, Math.ceil(s.height / 2)) : 1;
  const g = new ExtrudeGeometry(shape, {depth, steps, bevelEnabled: false, curveSegments: 12});
  const arr = Array.from(g.getAttribute('position').array as Float32Array);
  for (let i = 0; i < arr.length; i += 3) {
    const z = arr[i + 2] + z0;
    const t = z / s.height;
    const a = ((s.twist * Math.PI) / 180) * t;
    const k = lerp(1, s.taper, t);
    const [x, y] = [arr[i] * k, arr[i + 1] * k];
    arr[i] = x * Math.cos(a) - y * Math.sin(a);
    arr[i + 1] = x * Math.sin(a) + y * Math.cos(a);
    arr[i + 2] = z;
  }
  return arr;
}

/** Builds a triangle soup (Z up, centred, resting on z=0). */
export function buildPositions(s: Spec): Float32Array {
  const h = s.height;
  const R = s.width / 2;
  if (['vase', 'cup', 'cylinder', 'tube', 'cone', 'sphere'].includes(s.kind)) {
    const curved = s.kind === 'vase' || s.kind === 'sphere' || s.ribs > 0 || s.twist !== 0;
    const n = curved ? 64 : 1;
    const r = (t: number) => {
      if (s.kind === 'sphere') return R * Math.sin(Math.PI * t);
      if (s.kind === 'cone') return Math.max(R * (1 - t), 0.01);
      const k = lerp(1, s.taper, t);
      return s.kind === 'vase' ? R * k * (0.62 + 0.38 * Math.sin(Math.PI * (0.15 + 0.85 * t))) : R * k;
    };
    const ts = Array.from({length: n + 1}, (_, i) => i / n);
    const outer = ts.map((t) => [r(t), t * h] as P2);
    let profile: P2[];
    const wall = s.kind === 'sphere' || s.kind === 'cone' ? 0 : s.wall;
    if (wall > 0 && s.kind === 'tube') {
      profile = [...outer, ...ts.slice().reverse().map((t) => [Math.max(r(t) - wall, 0.5), t * h] as P2)];
    } else if (wall > 0) {
      const floor = Math.min(Math.max(wall, 1.2), h / 2);
      const inner = ts.filter((t) => t * h > floor).reverse().map((t) => [Math.max(r(t) - wall, 0.5), t * h] as P2);
      profile = [[0, 0], ...outer, ...inner, [Math.max(r(floor / h) - wall, 0.5), floor], [0, floor]];
    } else {
      profile = [[0, 0], ...outer, [0, h]];
    }
    const segs = s.segments;
    const tw = (s.twist * Math.PI) / 180;
    const ribs = (phi: number, z: number) => (s.ribs ? 1 + 0.06 * Math.cos(s.ribs * (phi + (tw * z) / h)) : 1);
    return finalize(revolve(profile, segs, ribs));
  }
  const shape = outline(s);
  if (s.hole) shape.holes.push(s.kind === 'tag' ? circle(-s.width / 2 + Math.max(5, s.hole), 0, s.hole / 2) : circle(0, 0, s.hole / 2));
  if (s.kind === 'box' && s.wall > 0) {
    const floor = Math.min(Math.max(s.wall, 1.2), h / 2);
    const ring = outline(s);
    ring.holes.push(roundedRect(s.width - 2 * s.wall, s.depth - 2 * s.wall, Math.max(0, s.corner - s.wall), new Path()));
    return finalize([...extrude(shape, floor, 0, s), ...extrude(ring, h - floor, floor, s)]);
  }
  return finalize(extrude(shape, h, 0, s));
}

/** Centres on XY, rests on z=0, and makes the winding point outward. */
export function finalize(arr: number[]): Float32Array {
  const out = new Float32Array(arr);
  const [min, max] = bounds(out);
  const [cx, cy] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  for (let i = 0; i < out.length; i += 3) (out[i] -= cx), (out[i + 1] -= cy), (out[i + 2] -= min[2]);
  if (volume(out) < 0) {
    for (let i = 0; i < out.length; i += 9)
      for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
  }
  return out;
}

export function bounds(p: Float32Array): [number[], number[]] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  return [min, max];
}

/** Signed volume in mm³ (positive when faces point outward). */
export function volume(p: Float32Array): number {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function toStl(p: Float32Array): ArrayBuffer {
  const n = p.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50;
    const v = p.subarray(t * 9, t * 9 + 9);
    const [ux, uy, uz] = [v[3] - v[0], v[4] - v[1], v[5] - v[2]];
    const [wx, wy, wz] = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
    const nrm = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    const len = Math.hypot(...nrm) || 1;
    nrm.forEach((c, k) => dv.setFloat32(o + k * 4, c / len, true));
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, v[k], true);
  }
  return buf;
}
