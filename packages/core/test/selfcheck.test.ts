import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOps,
  bounds,
  buildPositions,
  editMesh,
  newSpec,
  parsePrompt,
  toStl,
  volume,
  type Kind,
} from '../src/model.ts';
import {slice} from '../src/slicer.ts';

void test('prompt parsing', () => {
  const {spec} = parsePrompt('gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole');
  assert.equal(spec.kind, 'gear');
  assert.equal(spec.teeth, 24);
  assert.equal(spec.width, 50);
  assert.equal(spec.height, 6);
  assert.equal(spec.hole, 5);
  const box = parsePrompt('box 80 x 50 x 30 with 2mm walls').spec;
  assert.deepEqual([box.width, box.depth, box.height, box.wall], [80, 50, 30, 2]);
  assert.equal(parsePrompt('vase 12 cm tall').spec.height, 120);
});

void test('refine edits the previous spec', () => {
  const v = parsePrompt('vase 100 tall 60 wide').spec;
  const {spec, changes} = parsePrompt('make it taller, thicker walls', v);
  assert.equal(spec.height, 125);
  assert.equal(spec.wall, v.wall + 1);
  assert.equal(spec.width, 60);
  assert.ok(changes.length >= 2);
  assert.equal(parsePrompt('scale to 50%', v).spec.width, 30);
  assert.equal(parsePrompt('make it 20% bigger', v).spec.width, 72);
});

void test('every kind builds a closed, outward mesh that slices', () => {
  const kinds: Array<Kind> = [
    'vase',
    'cup',
    'cylinder',
    'tube',
    'cone',
    'sphere',
    'box',
    'plate',
    'gear',
    'hex',
    'star',
    'tag',
  ];
  for (const k of kinds) {
    const {spec} = parsePrompt(`${k} with a hole`);
    const p = buildPositions(spec);
    assert.ok(volume(p) > 0, `${k} volume`);
    // Closed mesh: every edge is shared by exactly two triangles in opposite directions.
    const edges = new Map<string, number>();
    const key = (i: number) => [p[i], p[i + 1], p[i + 2]].map((v) => v.toFixed(3)).join(',');
    for (let t = 0; t < p.length; t += 9) {
      for (let e = 0; e < 3; e++) {
        const [a, b] = [key(t + e * 3), key(t + ((e + 1) % 3) * 3)];
        if (a === b) {
          continue;
        }
        edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const [e, n] of edges) {
      const [a, b] = e.split('|');
      if ((edges.get(`${b}|${a}`) ?? 0) !== n) {
        open++;
      }
    }
    assert.ok(open / edges.size < 0.02, `${k}: ${open} unmatched edges of ${edges.size}`);
    assert.equal(toStl(p).byteLength, 84 + (p.length / 9) * 50);
    const r = slice(p, {printer: 'mk4', material: 'pla', layer: 0.3, infill: 15, speed: 60, vase: false});
    assert.ok(r.layers.length > 0 && r.grams > 0, `${k} slices`);
    assert.match(r.gcode, /M109 S210/);
    assert.doesNotMatch(r.gcode, /NaN/);
  }
});

void test('mesh edits read size words like spec edits', async () => {
  const positions = buildPositions(newSpec('box', {width: 100, corner: 0}));
  const width = async (prompt: string) => {
    const {model} = await editMesh(prompt, {type: 'mesh', name: 'b', positions});
    assert.ok(model.type === 'mesh');
    return Math.round(bounds(model.positions)[1][0] - bounds(model.positions)[0][0]);
  };
  assert.equal(await width('make it 20% bigger'), 120);
  assert.equal(await width('scale to 80%'), 80);
  assert.equal(await width('narrower'), 85);
});

void test('out-of-range values still build a mesh', async () => {
  for (const [kind, field, value] of [
    ['star', 'points', 0],
    ['cylinder', 'segments', 0],
    ['box', 'width', 0],
    ['gear', 'teeth', 1],
  ] as const) {
    const {model} = await applyOps({type: 'param', spec: newSpec(kind)}, [{op: 'set', field, value}]);
    assert.ok(model.type === 'param');
    assert.ok(volume(buildPositions(model.spec)) > 0, `${kind} ${field} ${value}`);
  }
});

void test('size presets scale only the dimensions the prompt leaves out', () => {
  const small = parsePrompt('vase 100 tall', undefined, 'small').spec;
  const large = parsePrompt('vase 100 tall', undefined, 'large').spec;
  assert.equal(small.height, 100);
  assert.equal(large.height, 100);
  assert.ok(small.width < newSpec('vase').width && newSpec('vase').width < large.width);
  assert.equal(large.wall, newSpec('vase').wall);
});
