/**
 * A simulated Bambu printer (P1S, or X2D with an AMS 2 Pro): the state the firmware reports over MQTT and how
 * commands change it. Field names and shapes follow what bambu-printer-mcp and bambu-node read (OpenBambuAPI mqtt.md;
 * Bambu Studio DevExtruderSystem/DevNozzleSystem for the X2D's V2 `device` block).
 */
type Json = string | number | boolean | null | Array<Json> | {[key: string]: Json};
/** One section of a report the printer publishes. */
export type Report = {[field: string]: Json | undefined}; // undefined fields drop out of JSON
export type Reply = {print?: Report; info?: Report; system?: Report};
/** The fields of a request this simulation reads; the rest are ignored. */
export type Command = {
  command?: string;
  sequence_id?: string;
  param?: string;
  url?: string;
  subtask_name?: string;
  use_ams?: boolean;
  ams_mapping?: Array<number>;
  bed_type?: string;
  led_mode?: string;
  // X2D native controls
  temp?: number;
  target_temp?: number;
  extruder_index?: number;
  fan_index?: number;
  speed?: number;
  ams_id?: number;
};
export type Request = {print?: Command; info?: Command; system?: Command; pushing?: Command};

const ambient = 25;
// Bambu Studio's P1S has bed and nozzle heat rates of roughly these (°C per second).
const heatRate = {nozzle: 6, bed: 1.5};
const cooling = 0.03; // fraction of the gap to ambient lost each second

export type Model = 'p1s' | 'x2d';
export const models = {
  p1s: {name: 'Bambu Lab P1S', serial: '01P00A000000001'},
  // 20P is the X2D serial prefix the MCP and Bambu Studio read the model from.
  x2d: {name: 'Bambu Lab X2D', serial: '20P00A000000001'},
} as const;
export type Options = {model?: Model; serial?: string; jobSeconds: number; layers?: number};
/** X2D cancel: FAILED with fail_reason 0300400C "The task was canceled." */
const cancelled = 0x03_00_40_0c;

export class Printer {
  model: Model;
  serial: string;
  jobSeconds: number;
  totalLayers: number;
  state = 'IDLE';
  printType = 'idle';
  file = '';
  subtask = '';
  elapsed = 0; // seconds of RUNNING time in the current job
  nozzle = ambient;
  bed = ambient;
  nozzleTarget = 0;
  bedTarget = 0;
  fans = {part: 0, aux: 0, chamber: 0};
  speed = 2;
  light = 'on';
  printError = 0;
  failReason = 0;
  /** AMS 2 Pro drying: target °C, 0 when off. */
  drying = 0;
  amsTemp = ambient;
  hms: Array<{attr: number; code: number}> = [];
  sequence = 0;
  /** Job temperatures to reach before RUNNING; project_file leaves them to the sliced file, so these stand in. */
  jobTargets = {nozzle: 220, bed: 55};

  constructor({model = 'p1s', serial, jobSeconds, layers = 100}: Options) {
    this.model = model;
    this.serial = serial ?? models[model].serial;
    this.jobSeconds = jobSeconds;
    this.totalLayers = layers;
  }

  get progress() {
    return Math.min(1, this.elapsed / this.jobSeconds);
  }

  get layer() {
    return this.state === 'IDLE' ? 0 : Math.ceil(this.progress * this.totalLayers);
  }

  /** Advance the simulation by `dt` seconds. */
  tick(dt: number) {
    this.nozzle = approach(this.nozzle, this.nozzleTarget, heatRate.nozzle * dt, dt);
    this.bed = approach(this.bed, this.bedTarget, heatRate.bed * dt, dt);
    this.amsTemp = approach(this.amsTemp, this.drying, 0.5 * dt, dt);
    if (this.state === 'PREPARE' && this.nozzle >= this.nozzleTarget - 1 && this.bed >= this.bedTarget - 1) {
      this.state = 'RUNNING';
      this.fans.part = 100;
    }
    if (this.state !== 'RUNNING') {
      return;
    }
    // Speed levels 1-4 run at 50/100/124/166 % like the firmware.
    this.elapsed += dt * [0, 0.5, 1, 1.24, 1.66][this.speed];
    if (this.progress >= 1) {
      this.end('FINISH');
    }
  }

  /** Handle one message from device/<serial>/request. `hasFile` checks the FTPS storage. */
  handle(message: Request, hasFile: (path: string) => boolean): Array<Reply> {
    if (message.pushing?.command === 'pushall') {
      return [this.full()];
    }
    if (message.info?.command === 'get_version') {
      return [this.version(message.info.sequence_id)];
    }
    const print = message.print;
    if (print) {
      return this.command(print, hasFile);
    }
    if (message.system?.command === 'ledctrl') {
      this.light = String(message.system.led_mode);
      return [{system: {...message.system, result: 'success'}}];
    }
    return [];
  }

  private command(print: Command, hasFile: (path: string) => boolean): Array<Reply> {
    const ok = (extra: Report = {}) => [
      {
        print: {
          command: print.command,
          sequence_id: print.sequence_id,
          param: print.param,
          result: 'success',
          err_code: 0,
          ...extra,
        },
      },
    ];
    const refuse = (reason: string) => [
      {print: {command: print.command, sequence_id: print.sequence_id, result: 'fail', reason, err_code: 1}},
    ];
    switch (print.command) {
      case 'project_file':
      case 'gcode_file': {
        if (!['IDLE', 'FINISH', 'FAILED'].includes(this.state)) {
          return refuse(`printer is ${this.state}`);
        }
        // project_file sends url file:///sdcard/<path> or ftp:///<path>; gcode_file sends param <path>.
        const source = String(print.command === 'project_file' ? print.url : print.param);
        const path = '/' + source.replace(/^(file|ftp):\/\//, '').replace(/^\/?(sdcard\/)?/, '');
        if (!hasFile(path)) {
          return refuse(`file not found: ${path}`);
        }
        this.file = path.split('/').pop()!;
        this.subtask = String(print.subtask_name || this.file.replace(/(\.gcode)?\.3mf$|\.gcode$/, ''));
        this.state = 'PREPARE';
        this.printType = 'local';
        this.elapsed = 0;
        this.printError = 0;
        this.failReason = 0;
        this.nozzleTarget = this.jobTargets.nozzle;
        this.bedTarget = this.jobTargets.bed;
        return [...ok(), this.delta()];
      }
      case 'pause':
        if (this.state !== 'RUNNING') {
          return refuse('not printing');
        }
        this.state = 'PAUSE';
        return [...ok(), this.delta()];
      case 'resume':
        if (this.state !== 'PAUSE') {
          return refuse('not paused');
        }
        this.state = 'RUNNING';
        return [...ok(), this.delta()];
      case 'stop':
        if (!['PREPARE', 'RUNNING', 'PAUSE'].includes(this.state)) {
          return refuse('no job');
        }
        // A P1S keeps FAILED with print_type idle after a user stop (bambu-printer-mcp issue #87).
        this.end('FAILED');
        if (this.model === 'x2d') {
          this.failReason = cancelled;
        }
        return [...ok(), this.delta()];
      case 'gcode_line':
        for (const line of String(print.param).split('\n')) {
          this.gcode(line.trim());
        }
        return [...ok(), this.delta()];
      case 'print_speed':
        this.speed = Math.min(4, Math.max(1, Number(print.param) || 2));
        return [...ok(), this.delta()];
      // X2D native controls send these instead of gcode_line.
      case 'set_bed_temp':
        this.bedTarget = Number(print.temp) || 0;
        return [...ok(), this.delta()];
      case 'set_nozzle_temp':
        this.nozzleTarget = Number(print.target_temp) || 0;
        return [...ok(), this.delta()];
      case 'set_fan': {
        const fan = ({1: 'part', 2: 'aux', 3: 'chamber'} as const)[Number(print.fan_index) as 1 | 2 | 3];
        if (fan) {
          this.fans[fan] = Number(print.speed) || 0;
        }
        return [...ok(), this.delta()];
      }
      case 'ams_control':
        if (print.param === 'start_drying' || print.param === 'stop_drying') {
          this.drying = print.param === 'start_drying' ? 55 : 0;
        }
        return [...ok(), this.delta()];
      case 'clean_print_error':
        this.printError = 0;
        this.hms = [];
        return [...ok(), this.delta()];
      default:
        // ams_control, skip_objects, set_airduct and friends: accept without simulating them.
        return ok();
    }
  }

  private gcode(line: string) {
    const word = (letter: string) => Number(line.match(new RegExp(`\\b${letter}(-?[\\d.]+)`))?.[1]);
    const s = word('S');
    if (/^M10[49]\b/.test(line) && s >= 0) {
      this.nozzleTarget = s;
    } else if (/^M1(40|90)\b/.test(line) && s >= 0) {
      this.bedTarget = s;
    } else if (/^M106\b/.test(line) && s >= 0) {
      const fan = (['part', 'aux', 'chamber'] as const)[(word('P') || 1) - 1] ?? 'part';
      this.fans[fan] = Math.round((s / 255) * 100);
    } else if (/^M107\b/.test(line)) {
      this.fans.part = 0;
    }
  }

  private end(state: 'FINISH' | 'FAILED') {
    this.state = state;
    this.printType = 'idle';
    this.nozzleTarget = 0;
    this.bedTarget = 0;
    this.fans.part = 0;
  }

  private next() {
    return String(++this.sequence);
  }

  /** What changes while printing; P1 firmware pushes small deltas like this between full reports. */
  delta(): Reply {
    return {
      print: {
        command: 'push_status',
        msg: 1,
        sequence_id: this.next(),
        gcode_state: this.state,
        print_type: this.printType,
        gcode_file: this.file,
        subtask_name: this.subtask,
        mc_percent: Math.floor(this.progress * 100),
        mc_remaining_time: this.remainingMinutes(),
        layer_num: this.layer,
        total_layer_num: this.state === 'IDLE' ? 0 : this.totalLayers,
        nozzle_temper: round(this.nozzle),
        nozzle_target_temper: this.nozzleTarget,
        bed_temper: round(this.bed),
        bed_target_temper: this.bedTarget,
        cooling_fan_speed: fanStep(this.fans.part),
        big_fan1_speed: fanStep(this.fans.aux),
        big_fan2_speed: fanStep(this.fans.chamber),
        spd_lvl: this.speed,
        spd_mag: [0, 50, 100, 124, 166][this.speed],
        stg_cur: {IDLE: -1, PREPARE: 2, RUNNING: 0, PAUSE: 16}[this.state] ?? -1,
        print_error: this.printError,
        fail_reason: String(this.failReason),
        hms: this.hms,
        device: this.model === 'x2d' ? this.device() : undefined,
      },
    };
  }

  /** The answer to pushall: everything, as an idle P1S with an AMS reports it. */
  full(): Reply {
    return {
      print: {
        ...this.delta().print,
        msg: 0,
        gcode_file_prepare_percent: this.state === 'IDLE' ? '0' : '100',
        mc_print_stage: this.state === 'RUNNING' ? '2' : '1',
        mc_print_sub_stage: 0,
        mc_print_error_code: '0',
        mc_print_line_number: '0',
        print_gcode_action: 0,
        print_real_action: 0,
        subtask_id: '0',
        task_id: '0',
        project_id: '0',
        profile_id: '0',
        queue_number: 0,
        chamber_temper: ambient,
        frame_temper: ambient,
        heatbreak_fan_speed: this.nozzle > 50 ? '15' : '0',
        ...(this.model === 'x2d'
          ? {
              vir_slot: [
                {id: '254', ...tray('PLA', 'Generic PLA', 'GFL99', 'FFFFFFFF')},
                {id: '255', ...tray('PETG', 'Generic PETG', 'GFG99', '161616FF')},
              ],
            }
          : {nozzle_diameter: '0.4', nozzle_type: 'stainless_steel'}),
        wifi_signal: '-44dBm',
        home_flag: 256, // bit 8: SD card present and normal
        sdcard: true,
        hw_switch_state: 0,
        force_upgrade: false,
        lifecycle: 'product',
        stg: [],
        s_obj: [],
        filam_bak: [],
        lights_report: [{node: 'chamber_light', mode: this.light}],
        online: {ahb: false, rfid: false, version: 7},
        ipcam: {
          ipcam_dev: '1',
          ipcam_record: 'enable',
          timelapse: 'disable',
          resolution: '720p',
          tutk_server: 'disable',
          mode_bits: 2,
        },
        xcam: {
          allow_skip_parts: false,
          buildplate_marker_detector: true,
          first_layer_inspector: false,
          halt_print_sensitivity: 'medium',
          print_halt: true,
          printing_monitor: true,
          spaghetti_detector: true,
        },
        upload: {status: 'idle', progress: 0, message: ''},
        upgrade_state: {
          sequence_id: 0,
          progress: '',
          status: '',
          consistency_request: false,
          dis_state: 0,
          err_code: 0,
          force_upgrade: false,
          message: '',
          module: '',
          new_version_state: 2,
          new_ver_list: [],
        },
        ams_status: 0,
        ams_rfid_status: 0,
        ams: {
          ams: [
            {
              id: '0',
              humidity: '4',
              temp: String(round(this.amsTemp)),
              tray: amsTrays,
              // AMS 2 Pro: a heated unit that reports its drying state.
              dry_time: this.model === 'x2d' ? (this.drying ? 480 : 0) : undefined,
              humidity_raw: this.model === 'x2d' ? '18' : undefined,
            },
          ],
          ams_exist_bits: '1',
          tray_exist_bits: 'f',
          tray_is_bbl_bits: 'f',
          tray_read_done_bits: 'f',
          tray_reading_bits: '0',
          tray_now: '0',
          tray_pre: '0',
          tray_tar: '0',
          version: 4,
          insert_flag: true,
          power_on_flag: false,
        },
        vt_tray: {id: '254', ...tray('PLA', 'Generic PLA', 'GFL99', 'FFFFFFFF')},
      },
    };
  }

  /**
   * The X2D's dual-nozzle V2 `device` block. Nozzle 0 is the right (main) one; extruder.state bits 4-7 name the
   * active nozzle, and each extruder packs its temperature as actual | target << 16.
   */
  private device() {
    const nozzle = (id: number) => ({id, diameter: 0.4, type: 'HS01', stat: 0, sn: `N${this.serial.slice(-6)}${id}`});
    return {
      nozzle: {info: [nozzle(0), nozzle(1)]},
      extruder: {
        state: 0,
        info: [
          {id: 0, temp: packed(this.nozzle, this.nozzleTarget)},
          {id: 1, temp: packed(ambient, 0)},
        ],
      },
      ctc: {info: {temp: ambient}},
    } satisfies Report;
  }

  version(sequenceId: string | undefined): Reply {
    const module = (name: string, sw: string, hw: string) => ({
      name,
      product_name: models[this.model].name,
      sw_ver: sw,
      sw_new_ver: '',
      hw_ver: hw,
      sn: this.serial,
      flag: 0,
    });
    return {
      info: {
        command: 'get_version',
        sequence_id: sequenceId,
        result: 'success',
        reason: '',
        module: [
          module('ota', '01.08.00.00', 'OTA'),
          module('mc', '00.00.31.42', 'MC07'),
          module('th', '00.00.08.13', 'TH09'),
          // n3f is the AMS 2 Pro module name.
          this.model === 'x2d' ? module('n3f/0', '00.00.07.89', 'N3F05') : module('ams/0', '00.00.06.49', 'AMS08'),
        ],
      },
    };
  }

  private remainingMinutes() {
    return ['IDLE', 'FINISH', 'FAILED'].includes(this.state)
      ? 0
      : Math.ceil(((1 - this.progress) * this.jobSeconds) / 60);
  }
}

function tray(type: string, brand: string, idx: string, color: string) {
  const temps = type === 'PETG' ? ['230', '260'] : ['190', '230'];
  // state 11: a spool is in the slot and the AMS has read it.
  return {
    state: 11,
    tray_type: type,
    tray_sub_brands: brand,
    tray_info_idx: idx,
    tray_color: color,
    nozzle_temp_min: temps[0],
    nozzle_temp_max: temps[1],
    tray_weight: '1000',
    remain: 80,
    k: 0.02,
    n: 1,
  };
}

const amsTrays = [
  {id: '0', ...tray('PLA', 'PLA Basic', 'GFA00', 'FFFFFFFF')},
  {id: '1', ...tray('PLA', 'PLA Basic', 'GFA00', '000000FF')},
  {id: '2', ...tray('PETG', 'PETG HF', 'GFG02', 'FF6A13FF')},
  {id: '3', ...tray('PLA', 'PLA Matte', 'GFA01', '0086D6FF')},
];

function approach(current: number, target: number, step: number, dt: number) {
  const goal = Math.max(target, ambient);
  if (current < goal) {
    return Math.min(goal, current + step);
  }
  return current - (current - goal) * Math.min(1, cooling * dt);
}

/** V2 reports pack a temperature as actual | target << 16. */
const packed = (actual: number, target: number) => Math.round(actual) + target * 65_536;
const round = (n: number) => Math.round(n * 10) / 10;
/** Fan speeds are reported as 0-15 steps. */
const fanStep = (percent: number) => String(Math.round((percent / 100) * 15));
