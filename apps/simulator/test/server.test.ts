import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import test from 'node:test';
import {connect as tlsConnect} from 'node:tls';
import {Client as FtpClient} from 'basic-ftp';
import mqtt from 'mqtt';
import type {Reply, Request} from '../src/printer.ts';
import {defaults, start} from '../src/server.ts';

// Talks to the fake the way bambu-printer-mcp does: mqtt + basic-ftp + the camera auth packet.
void test('upload, print, pause, finish, camera', async (t) => {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const fake = await start({
    ...defaults,
    host: '127.0.0.1',
    dir: mkdtempSync(join(tmpdir(), 'fake-printer-')),
    jobSeconds: 2,
    ssdp: false,
    ports: {mqtt: port, ftps: port + 1, camera: port + 2},
  });
  t.after(() => fake.stop());
  const {serial, token} = defaults;

  const ftp = new FtpClient();
  await ftp.access({
    host: '127.0.0.1',
    port: port + 1,
    user: 'bblp',
    password: token,
    secure: 'implicit',
    secureOptions: {rejectUnauthorized: false},
  });
  await ftp.uploadFrom(Readable.from([Buffer.from('fake 3mf')]), '/cache/cube.gcode.3mf');
  assert.deepEqual(
    (await ftp.list('/cache')).map((e) => e.name),
    ['cube.gcode.3mf'],
  );
  ftp.close();

  await assert.rejects(
    mqtt.connectAsync(`mqtts://127.0.0.1:${port}`, {
      username: 'bblp',
      password: 'wrong',
      rejectUnauthorized: false,
      reconnectPeriod: 0,
    }),
  );
  const client = await mqtt.connectAsync(`mqtts://127.0.0.1:${port}`, {
    username: 'bblp',
    password: token,
    rejectUnauthorized: false,
  });
  t.after(() => client.end(true));
  const reports: Array<Reply> = [];
  client.on('message', (_topic, payload) => reports.push(JSON.parse(payload.toString())));
  await client.subscribeAsync(`device/${serial}/report`);
  const send = (message: Request) => client.publishAsync(`device/${serial}/request`, JSON.stringify(message));
  const waitFor = async (match: (r: Reply) => boolean, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
      const found = reports.find(match);
      if (found) {
        return found;
      }
    }
    throw new Error('no matching report');
  };

  await send({info: {command: 'get_version', sequence_id: '1'}});
  assert.equal((await waitFor((r) => r.info?.command === 'get_version')).info.module[0].sn, serial);
  await send({pushing: {command: 'pushall', sequence_id: '2'}});
  const full = (await waitFor((r) => r.print?.msg === 0)).print;
  assert.equal(full.gcode_state, 'IDLE');
  assert.equal(full.ams.ams[0].tray.length, 4);

  await send({
    print: {
      command: 'project_file',
      sequence_id: '3',
      url: 'file:///sdcard/cache/missing.3mf',
      param: 'Metadata/plate_1.gcode',
    },
  });
  assert.equal((await waitFor((r) => r.print?.sequence_id === '3')).print.result, 'fail');
  await send({
    print: {
      command: 'project_file',
      sequence_id: '4',
      url: 'file:///sdcard/cache/cube.gcode.3mf',
      param: 'Metadata/plate_1.gcode',
      subtask_name: 'cube',
    },
  });
  assert.equal((await waitFor((r) => r.print?.sequence_id === '4')).print.result, 'success');
  await waitFor((r) => r.print?.gcode_state === 'PREPARE' && r.print.subtask_name === 'cube');

  // Skip the heat-up so the test is quick.
  fake.printer.nozzle = 220;
  fake.printer.bed = 55;
  await waitFor((r) => r.print?.gcode_state === 'RUNNING');
  await send({print: {command: 'pause', sequence_id: '5', param: ''}});
  await waitFor((r) => r.print?.gcode_state === 'PAUSE');
  await send({print: {command: 'resume', sequence_id: '6', param: ''}});
  const finished = (await waitFor((r) => r.print?.gcode_state === 'FINISH')).print;
  assert.equal(finished.mc_percent, 100);
  assert.equal(finished.layer_num, finished.total_layer_num);

  await send({print: {command: 'gcode_line', sequence_id: '7', param: 'M140 S60\n'}});
  await waitFor((r) => r.print?.bed_target_temper === 60);

  const auth = Buffer.alloc(80);
  auth.writeUInt32LE(0x40, 0);
  auth.writeUInt32LE(0x30_00, 4);
  auth.write('bblp', 16);
  auth.write(token, 48);
  const jpeg = await new Promise<Buffer>((resolve, reject) => {
    const socket = tlsConnect({host: '127.0.0.1', port: port + 2, rejectUnauthorized: false}, () => socket.write(auth));
    let data = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 16 && data.length >= 16 + data.readUInt32LE(0)) {
        socket.destroy();
        resolve(data.subarray(16, 16 + data.readUInt32LE(0)));
      }
    });
    socket.on('error', reject);
  });
  assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8]);
});
