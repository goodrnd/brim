/**
 * Stands in for bambu-printer-mcp's X2D native helper (native/bambu-native-print), which drives Bambu's closed
 * networking plug-in. bambu-printer-mcp runs it when BAMBU_NATIVE_HELPER points here (see bin/native-helper):
 * the mode comes as argv[2], everything else as BAMBU_NATIVE_* env, and progress goes out as stdout lines.
 * The plug-in's own wire (port 6000 tunnel, eMMC upload) is not simulated; this sends what it would
 * have caused, as plain MQTT, to the simulator.
 */
import {copyFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {createInterface} from 'node:readline';
import mqtt from 'mqtt';
import type {Request} from './printer.ts';
import {defaults} from './server.ts';

const env = process.env;
const mode = process.argv[2];
const out = (line: string) => process.stdout.write(line + '\n');
const fail = (message: string) => {
  out(`native_error=${message}`);
  process.exit(1);
};

/** The helper asks the server to re-check fresh printer state right before it dispatches, on every attempt. */
async function authorize(attempt: number) {
  out(`native_dispatch_request=${attempt}`);
  const input = createInterface({input: process.stdin});
  const {value} = await input[Symbol.asyncIterator]().next();
  // The server keeps stdin open; an open reader would keep this process, and the server's print call, alive.
  input.close();
  process.stdin.destroy();
  if (value !== `native_dispatch_authorized=${attempt}`) {
    fail('native dispatch authorization was missing or rejected');
  }
}

async function send(message: Request) {
  const host = env.BAMBU_NATIVE_HOST;
  const serial = env.BAMBU_NATIVE_SERIAL;
  if (!host || !serial || !env.BAMBU_NATIVE_ACCESS_CODE) {
    fail('BAMBU_NATIVE_HOST, BAMBU_NATIVE_SERIAL and BAMBU_NATIVE_ACCESS_CODE are required');
  }
  const client = await mqtt.connectAsync(`mqtts://${host}:${env.BAMBU_SIM_MQTT_PORT || 8883}`, {
    username: 'bblp',
    password: env.BAMBU_NATIVE_ACCESS_CODE,
    rejectUnauthorized: false,
    reconnectPeriod: 0,
  });
  await client.publishAsync(`device/${serial}/request`, JSON.stringify(message), {qos: 1});
  await client.endAsync();
}

switch (mode) {
  case '--probe':
    out('native_probe result=0');
    break;
  case '--print-authorized':
  case '--upload': {
    const file = env.BAMBU_NATIVE_FILE;
    if (!file) {
      fail('BAMBU_NATIVE_FILE is required');
    }
    const name = env.BAMBU_NATIVE_DST_FILE || basename(file!);
    out('native_update status=1 code=0 msg=uploading');
    // The plug-in uploads to the printer's storage; the simulator's storage is a local dir.
    copyFileSync(file!, join(env.BAMBU_SIM_DIR || defaults.dir, name));
    if (mode === '--upload') {
      out('native_upload result=0');
      break;
    }
    await authorize(1);
    await send({
      print: {
        command: 'project_file',
        sequence_id: String(Date.now()),
        url: `ftp:///${name}`,
        param: `Metadata/plate_${env.BAMBU_NATIVE_PLATE_INDEX || 1}.gcode`,
        subtask_name: env.BAMBU_NATIVE_TASK_NAME || name.replace(/\.3mf$/i, ''),
        use_ams: env.BAMBU_NATIVE_USE_AMS === 'true',
        ams_mapping: env.BAMBU_NATIVE_AMS_MAPPING ? (JSON.parse(env.BAMBU_NATIVE_AMS_MAPPING) as Array<number>) : [],
        bed_type: env.BAMBU_NATIVE_BED_TYPE,
      },
    });
    out('native_update status=2 code=0 msg=sent');
    out('native_print result=0');
    break;
  }
  case '--command':
  case '--command-authorized': {
    const message = env.BAMBU_NATIVE_COMMAND_JSON;
    if (!message) {
      fail('BAMBU_NATIVE_COMMAND_JSON is required');
    }
    if (mode === '--command-authorized') {
      await authorize(1);
    }
    await send(JSON.parse(message!) as Request);
    out('native_command result=0');
    break;
  }
  default:
    fail(`unknown mode ${mode}`);
}
