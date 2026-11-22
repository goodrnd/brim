import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {defaults, mcpEnv, start} from '@brim/simulator/server.ts';
import {connect, type Progress} from '../src/bambu.ts';

const studio = '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio';

const v = (x: number, y: number, z: number) => [x * 20, y * 20, z * 20].join(' ');
/** A 20 mm cube as ASCII STL. */
function cube(path: string) {
  const quads = [
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ];
  const facets = quads.flatMap(([a, b, c, d]) =>
    [
      [a, b, c],
      [a, c, d],
    ].map(
      (t) =>
        `facet normal 0 0 0\nouter loop\n${t.map((p) => `vertex ${v(p[0], p[1], p[2])}`).join('\n')}\nendloop\nendfacet`,
    ),
  );
  writeFileSync(path, `solid cube\n${facets.join('\n')}\nendsolid cube\n`);
}

const until = async (read: () => Promise<Progress>, ok: (p: Progress) => boolean, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    const p = await read();
    if (ok(p)) {
      return p;
    }
  }
  throw new Error('timed out');
};

// The X2D prints through Bambu's closed networking plug-in; the simulator's stand-in helper takes its place.
void test(
  'slice an STL and print it on a simulated X2D through bambu-printer-mcp',
  {skip: !existsSync(studio) && 'needs Bambu Studio'},
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'brim-x2d-'));
    // The MCP always uses the printer's real ports, so this needs them free (stop `npm run simulator` first).
    const sim = await start({...defaults, dir, jobSeconds: 4, ssdp: false});
    t.after(() => sim.stop());
    // The MCP asks a person only for physical checks (after a cleared error, say); none come up here.
    const printer = await connect(mcpEnv(sim.config), async () => false);
    t.after(() => printer.close());

    const idle = await printer.progress();
    assert.equal(idle.state, 'idle');
    const filaments = await printer.filaments();
    assert.ok(JSON.stringify(filaments).includes('PLA'));

    const stl = join(dir, 'cube.stl');
    cube(stl);
    const sliced = await printer.slice(stl);
    assert.match(sliced, /\.3mf$/);
    await printer.print(sliced, [0]);
    // Skip the ~30 s heat-up.
    sim.printer.nozzle = 220;
    sim.printer.bed = 55;
    await until(printer.progress, (p) => p.state === 'printing');
    await printer.pause();
    await until(printer.progress, (p) => p.state === 'paused');
    await printer.resume();
    const done = await until(printer.progress, (p) => p.state === 'finished');
    assert.equal(done.job?.progress, 100);
  },
);
