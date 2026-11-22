/**
 * A simulated Bambu printer on the real ports, for driving bambu-printer-mcp without hardware:
 * MQTT over TLS (8883), implicit FTPS (990) and the P1-style port-6000 JPEG camera.
 */
import {existsSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer, type TlsOptions} from 'node:tls';
import {Aedes} from 'aedes';
import FtpSrv from 'ftp-srv';
import {generate} from 'selfsigned';
import {authorized, frame, packet} from './camera.ts';
import {type Model, models, Printer, type Reply, type Request} from './printer.ts';
import {announce} from './ssdp.ts';

export type Config = {
  model: Model;
  serial: string;
  token: string;
  /** macOS lets an unprivileged process bind 990 only on the wildcard address. */
  host: string;
  dir: string;
  jobSeconds: number;
  ports: {mqtt: number; ftps: number; camera: number};
  /** Announce on the LAN over SSDP so bambu-printer-mcp's discovery finds it. */
  ssdp: boolean;
};

export const defaults: Config = {
  model: 'x2d',
  serial: models.x2d.serial,
  token: '12345678',
  host: '0.0.0.0',
  dir: join(tmpdir(), 'brim-simulator'),
  jobSeconds: 120,
  ports: {mqtt: 8883, ftps: 990, camera: 6000},
  ssdp: true,
};

// oxlint-disable-next-line no-console -- a dev server: its log is its output
const log = (...args: Array<unknown>) => console.log(new Date().toISOString().slice(11, 19), ...args);
const quiet = {trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child: () => quiet};

export async function start(config: Config = defaults) {
  const {serial, token, host, ports} = config;
  const dir = resolve(config.dir);
  for (const sub of ['cache', 'timelapse', 'logs']) {
    mkdirSync(join(dir, sub), {recursive: true});
  }
  const pems = await generate([{name: 'commonName', value: serial}], {algorithm: 'sha256'});
  const tls: TlsOptions = {key: pems.private, cert: pems.cert};
  const printer = new Printer({model: config.model, serial, jobSeconds: config.jobSeconds});

  const broker = await Aedes.createBroker({
    authenticate: (_client, username, password, done) => done(null, username === 'bblp' && String(password) === token),
    // Like the printer, only this serial's topics exist.
    authorizeSubscribe: (_client, sub, done) =>
      done(sub.topic === `device/${serial}/report` ? null : new Error('topic'), sub),
    authorizePublish: (client, packet, done) =>
      done(client && packet.topic !== `device/${serial}/request` ? new Error('topic') : null),
  });
  const report = (reply: Reply) =>
    broker.publish(
      {
        cmd: 'publish',
        topic: `device/${serial}/report`,
        payload: JSON.stringify(reply),
        qos: 0,
        retain: false,
        dup: false,
      },
      () => {},
    );
  broker.on('publish', (packet, client) => {
    if (!client || packet.topic !== `device/${serial}/request`) {
      return;
    }
    let message: Request;
    try {
      message = JSON.parse(packet.payload.toString());
    } catch {
      return;
    }
    const command = Object.values(message)[0]?.command;
    if (command !== 'pushall' && command !== 'get_version') {
      log('mqtt <-', JSON.stringify(message));
    }
    for (const reply of printer.handle(message, (path) => existsSync(join(dir, path)))) {
      report(reply);
    }
  });
  const mqtt = createServer(tls, broker.handle).listen(ports.mqtt, host);

  const ftp = new FtpSrv({
    url: `ftps://${host}:${ports.ftps}`,
    tls,
    pasv_url: '127.0.0.1',
    pasv_min: 50_000,
    pasv_max: 50_100,
    log: quiet,
  });
  ftp.on('login', ({username, password}, ok, fail) =>
    username === 'bblp' && password === token ? ok({root: dir}) : fail(new Error('Login incorrect')),
  );
  ftp.on('client-error', ({error}) => log('ftps error', error.message));
  await ftp.listen();

  const cameras = new Set<ReturnType<typeof setInterval>>();
  const camera = createServer(tls, (socket) => {
    let auth = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      if (auth.length >= 80) {
        return;
      }
      auth = Buffer.concat([auth, chunk]);
      if (auth.length < 80) {
        return;
      }
      // A printer refusing the access code sends nothing and closes.
      if (!authorized(auth, token)) {
        return socket.destroy();
      }
      const send = () => socket.write(packet(frame(printer, Date.now() / 1000)));
      send();
      const timer = setInterval(send, 1000);
      cameras.add(timer);
      socket.on('close', () => (clearInterval(timer), cameras.delete(timer)));
    });
  }).listen(ports.camera, host);

  let last = Date.now();
  let lastState = printer.state;
  const ticker = setInterval(() => {
    const now = Date.now();
    printer.tick((now - last) / 1000);
    last = now;
    if (printer.state !== lastState) {
      log('state', lastState, '->', printer.state, printer.subtask);
    }
    lastState = printer.state;
    report(printer.delta());
  }, 1000);

  const unannounce = config.ssdp ? announce(serial, config.model, models[config.model].name) : () => {};

  return {
    printer,
    config: {...config, dir},
    async stop() {
      unannounce();
      clearInterval(ticker);
      for (const timer of cameras) {
        clearInterval(timer);
      }
      await ftp.close();
      await new Promise((done) => broker.close(done));
      mqtt.close();
      camera.close();
    },
  };
}

/** The env bambu-printer-mcp needs to drive this simulator, including the stand-in X2D native helper. */
export function mcpEnv(config: Config) {
  // The X2D prints through Bambu's closed plug-in; the MCP runs this stand-in for it instead. Other models ignore these.
  return {
    PRINTER_HOST: '127.0.0.1',
    BAMBU_SERIAL: config.serial,
    BAMBU_TOKEN: config.token,
    BAMBU_MODEL: config.model,
    BAMBU_NATIVE_HELPER: fileURLToPath(new URL('../bin/native-helper', import.meta.url)),
    BAMBU_SIM_DIR: config.dir,
    BAMBU_SIM_MQTT_PORT: String(config.ports.mqtt),
  };
}

if (import.meta.main) {
  const env = process.env;
  const model = (env.BAMBU_MODEL || defaults.model) as Model;
  if (!(model in models)) {
    throw new Error(`BAMBU_MODEL must be one of ${Object.keys(models).join(', ')}`);
  }
  const config: Config = {
    ...defaults,
    model,
    serial: env.BAMBU_SERIAL || models[model].serial,
    token: env.BAMBU_TOKEN || defaults.token,
    host: env.SIM_HOST || defaults.host,
    dir: env.SIM_DIR || defaults.dir,
    jobSeconds: Number(env.SIM_JOB_SECONDS) || defaults.jobSeconds,
    ssdp: env.SIM_SSDP !== '0',
  };
  const {config: running} = await start(config);
  // oxlint-disable-next-line no-console
  console.log(`Simulated ${models[model].name} ${running.serial} on ${running.host}: mqtt ${running.ports.mqtt}, ftps ${running.ports.ftps}, camera ${running.ports.camera}
Storage: ${running.dir}
bambu-printer-mcp env:
${Object.entries(mcpEnv(running))
  .map(([k, v]) => `  ${k}=${v}`)
  .join('\n')}`);
}
