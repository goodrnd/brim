import {bounds} from './model.ts';

// shortcut: one perimeter + scanline infill, solid only on the first/last layers, no supports or bridging; hand real prints to PrusaSlicer/Orca via the STL when quality matters.

/** `bambu_model` values bambu-printer-mcp accepts; it refuses to guess one, and a wrong one can damage hardware. */
export const bambuModels = {
  a1: 'A1',
  a1mini: 'A1 mini',
  p1p: 'P1P',
  p1s: 'P1S',
  p2s: 'P2S',
  x1c: 'X1 Carbon',
  x1e: 'X1E',
  h2s: 'H2S',
  h2d: 'H2D',
  h2dpro: 'H2D Pro',
  h2c: 'H2C',
  x2d: 'X2D',
} as const;
export type BambuModel = keyof typeof bambuModels;

export interface Printer {
  name: string;
  bed: [number, number, number];
  start: string;
  end: string;
  /** Set for Bambu printers driven through bambu-printer-mcp. */
  bambuModel?: BambuModel;
  /** Set when this Printer is one physical printer; identical printers are separate Printers. */
  serial?: string;
}

// Bambu firmware runs its own calibration; our G-code is only for upload_gcode. Prefer print_3mf with a slicer-made 3MF.
const bambuStart = 'G28 ; home\nG1 Z5 F3000';
const bambuEnd = 'G1 Z+10 F600\nM84';

export const printers = {
  mk4: {
    name: 'Prusa MK4',
    bed: [250, 210, 220],
    start: 'G28 ; home\nG29 ; mesh bed level\nG1 Z5 F3000',
    end: 'G1 Z+10 F600\nG1 X0 Y200 F3000\nM84',
  },
  ender: {
    name: 'Creality Ender-3 V3',
    bed: [220, 220, 250],
    start:
      'G28\nG29\nG1 Z2 F3000\nG1 X0.1 Y20 F5000\nG1 X0.1 Y200 E15 F1500 ; prime line\nG1 X0.4 Y200 F5000\nG1 X0.4 Y20 E15 F1500\nG92 E0',
    end: 'G91\nG1 Z10 F600\nG90\nG1 X0 Y220 F3000\nM84',
  },
  voron: {
    name: 'Voron 2.4 (350)',
    bed: [350, 350, 340],
    start: 'PRINT_START BED={bed} EXTRUDER={nozzle}',
    end: 'PRINT_END',
  },
  p1s: {name: 'Bambu Lab P1S', bed: [256, 256, 256], start: bambuStart, end: bambuEnd, bambuModel: 'p1s'},
  x1c: {name: 'Bambu Lab X1 Carbon', bed: [256, 256, 256], start: bambuStart, end: bambuEnd, bambuModel: 'x1c'},
  a1: {name: 'Bambu Lab A1', bed: [256, 256, 256], start: bambuStart, end: bambuEnd, bambuModel: 'a1'},
  a1mini: {name: 'Bambu Lab A1 mini', bed: [180, 180, 180], start: bambuStart, end: bambuEnd, bambuModel: 'a1mini'},
  h2d: {name: 'Bambu Lab H2D', bed: [325, 320, 325], start: bambuStart, end: bambuEnd, bambuModel: 'h2d'},
} satisfies Record<string, Printer>;

export interface Material {
  name: string;
  nozzle: number;
  bed: number;
  density: number; // g/cm³
  fan: number; // 0–255
}

export const materials = {
  pla: {name: 'PLA', nozzle: 210, bed: 60, density: 1.24, fan: 255},
  petg: {name: 'PETG', nozzle: 240, bed: 80, density: 1.27, fan: 120},
  abs: {name: 'ABS', nozzle: 250, bed: 100, density: 1.04, fan: 0},
  tpu: {name: 'TPU', nozzle: 225, bed: 50, density: 1.21, fan: 200},
} satisfies Record<string, Material>;

export interface SliceSettings {
  printer: string;
  material: string;
  layer: number;
  infill: number; // %
  speed: number; // mm/s
  vase: boolean;
}

type Pt = [number, number];
export interface Layer {
  z: number;
  paths: Array<{kind: 'wall' | 'infill' | 'travel'; pts: Array<Pt>}>;
}

export interface SliceResult {
  gcode: string;
  layers: Array<Layer>;
  filamentMm: number;
  grams: number;
  seconds: number;
}

const NOZZLE = 0.4;
const FILAMENT_AREA = Math.PI * 0.875 ** 2;

/** Intersects the mesh with z and chains the segments into closed loops. */
function contours(p: Float32Array, z: number): Array<Array<Pt>> {
  const segs: Array<[Pt, Pt]> = [];
  for (let i = 0; i < p.length; i += 9) {
    const pts: Array<Pt> = [];
    for (let k = 0; k < 3; k++) {
      const a = i + k * 3;
      const b = i + ((k + 1) % 3) * 3;
      const [za, zb] = [p[a + 2], p[b + 2]];
      if (za < z !== zb < z) {
        const t = (z - za) / (zb - za);
        pts.push([p[a] + (p[b] - p[a]) * t, p[a + 1] + (p[b + 1] - p[a + 1]) * t]);
      }
    }
    if (pts.length === 2) {
      segs.push([pts[0], pts[1]]);
    }
  }
  const key = (q: Pt) => `${Math.round(q[0] * 1000)},${Math.round(q[1] * 1000)}`;
  const byPoint = new Map<string, Array<number>>();
  segs.forEach(([a, b], i) => {
    for (const q of [a, b]) {
      const k = key(q);
      byPoint.set(k, [...(byPoint.get(k) ?? []), i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops: Array<Array<Pt>> = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) {
      continue;
    }
    used[s] = 1;
    const loop: Array<Pt> = [segs[s][0]];
    let cur = segs[s][1];
    for (let guard = 0; guard < segs.length; guard++) {
      loop.push(cur);
      const next = byPoint.get(key(cur))?.find((i) => !used[i]);
      if (next === undefined) {
        break;
      }
      used[next] = 1;
      cur = key(segs[next][0]) === key(cur) ? segs[next][1] : segs[next][0];
    }
    if (loop.length > 2) {
      loops.push(loop);
    }
  }
  return loops;
}

/** Even-odd scanlines across all loops, so holes stay empty. */
function infill(loops: Array<Array<Pt>>, spacing: number, angle: number): Array<Array<Pt>> {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const rot = ([x, y]: Pt): Pt => [x * c + y * s, -x * s + y * c];
  const back = ([x, y]: Pt): Pt => [x * c - y * s, x * s + y * c];
  const r = loops.map((l) => l.map(rot));
  const ys = r.flat().map((q) => q[1]);
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const lines: Array<Array<Pt>> = [];
  let flip = false;
  for (let y = y0 + spacing / 2; y < y1; y += spacing) {
    const xs: Array<number> = [];
    for (const l of r) {
      for (let i = 0; i < l.length; i++) {
        const [a, b] = [l[i], l[(i + 1) % l.length]];
        if (a[1] < y !== b[1] < y) {
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
    }
    xs.sort((a, b) => a - b);
    const row: Array<Array<Pt>> = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const [xa, xb] = [xs[i] + NOZZLE / 2, xs[i + 1] - NOZZLE / 2];
      if (xb > xa) {
        row.push([back([xa, y]), back([xb, y])]);
      }
    }
    if (flip) {
      row.reverse().forEach((seg) => seg.reverse());
    }
    lines.push(...row);
    flip = !flip;
  }
  return lines;
}

const area = (l: Array<Pt>) =>
  l.reduce((a, [x, y], i) => {
    const [nx, ny] = l[(i + 1) % l.length];
    return a + x * ny - nx * y;
  }, 0) / 2;

export function slice(
  positions: Float32Array,
  set: SliceSettings,
  printer: Printer = printers[set.printer as keyof typeof printers],
  mat: Material = materials[set.material as keyof typeof materials],
): SliceResult {
  const [min, max] = bounds(positions);
  const [ox, oy] = [printer.bed[0] / 2, printer.bed[1] / 2];
  const height = max[2] - min[2];
  const count = Math.max(1, Math.floor(height / set.layer));
  const solid = Math.max(2, Math.round(0.8 / set.layer));
  const lines: Array<string> = [];
  const layers: Array<Layer> = [];
  let e = 0;
  let seconds = 0;
  let pos: Pt = [0, 0];
  const feed = set.speed * 60;

  const emit = (to: Pt, z: number, extrude: boolean, layerH: number, speed = feed) => {
    const d = Math.hypot(to[0] - pos[0], to[1] - pos[1]);
    if (d < 1e-3) {
      return;
    }
    const x = (to[0] + ox).toFixed(3);
    const y = (to[1] + oy).toFixed(3);
    if (extrude) {
      const de = (d * layerH * NOZZLE * 1.05) / FILAMENT_AREA;
      e += de;
      lines.push(`G1 X${x} Y${y} E${de.toFixed(5)} F${speed}`);
      seconds += d / (speed / 60);
    } else {
      lines.push(`G0 X${x} Y${y} F9000`);
      seconds += d / 150;
    }
    pos = to;
    void z;
  };
  const travel = (to: Pt) => {
    if (Math.hypot(to[0] - pos[0], to[1] - pos[1]) > 2) {
      lines.push('G1 E-0.8 F2400');
      emit(to, 0, false, 0);
      lines.push('G1 E0.8 F2400');
    } else {
      emit(to, 0, false, 0);
    }
  };

  lines.push(
    `; generated by Brim`,
    `; printer: ${printer.name}, material: ${mat.name}, layer: ${set.layer} mm, infill: ${set.infill}%${set.vase ? ', spiral vase' : ''}`,
    `M140 S${mat.bed}`,
    `M104 S${mat.nozzle}`,
    `M190 S${mat.bed}`,
    `M109 S${mat.nozzle}`,
    printer.start.replace('{bed}', String(mat.bed)).replace('{nozzle}', String(mat.nozzle)),
    'G90 ; absolute XYZ',
    'M83 ; relative E',
    'G92 E0',
  );

  for (let li = 0; li < count; li++) {
    const z = min[2] + (li + 0.5) * set.layer;
    const printZ = (li + 1) * set.layer;
    const loops = contours(positions, z).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    const layer: Layer = {z: printZ, paths: []};
    lines.push(`;LAYER:${li}`, `G1 Z${printZ.toFixed(3)} F600`);
    if (li === 1) {
      lines.push(`M106 S${mat.fan}`);
    }
    const firstSpeed = li === 0 ? Math.min(feed, 1200) : feed;
    const spiral = set.vase && li >= solid && loops.length > 0;

    if (spiral) {
      // Single outer wall with Z rising continuously over the loop.
      const loop = loops[0];
      travel(loop[0]);
      layer.paths.push({kind: 'wall', pts: [...loop, loop[0]]});
      const n = loop.length;
      [...loop.slice(1), loop[0]].forEach((q, i) => {
        const zz = printZ - set.layer + (set.layer * (i + 1)) / n;
        lines.push(`G1 Z${zz.toFixed(3)}`);
        emit(q, zz, true, set.layer, firstSpeed);
      });
    } else {
      for (const loop of loops) {
        travel(loop[0]);
        for (const q of [...loop.slice(1), loop[0]]) {
          emit(q, printZ, true, set.layer, firstSpeed);
        }
        layer.paths.push({kind: 'wall', pts: [...loop, loop[0]]});
      }
      const isSolid = li < solid || li >= count - solid || (set.vase && li < solid);
      const density = isSolid ? 100 : set.infill;
      if (density > 0 && loops.length && !(set.vase && !isSolid)) {
        const spacing = NOZZLE / (density / 100);
        const angle = isSolid ? (li % 2 ? Math.PI / 4 : -Math.PI / 4) : li % 2 ? Math.PI / 4 : -Math.PI / 4;
        for (const seg of infill(loops, spacing, angle)) {
          travel(seg[0]);
          emit(seg[1], printZ, true, set.layer, firstSpeed);
          layer.paths.push({kind: 'infill', pts: seg});
        }
      }
    }
    layers.push(layer);
  }

  lines.push('M107', 'M104 S0', 'M140 S0', printer.end);
  const grams = ((e * FILAMENT_AREA) / 1000) * mat.density;
  lines.splice(
    2,
    0,
    `; filament used: ${(e / 1000).toFixed(2)} m, ${grams.toFixed(1)} g, est. ${Math.round(seconds / 60)} min`,
  );
  return {gcode: lines.join('\n') + '\n', layers, filamentMm: e, grams, seconds};
}
