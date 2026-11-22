/**
 * Brim's connection to Bambu printers: runs bambu-printer-mcp as a child process and calls its tools.
 * Server-side only (Node). The printer's host, serial and access code stay in the env given here, never in Brim's
 * data (docs/domain.md). Results are the MCP's own JSON; Brim does not reshape them.
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const server = fileURLToPath(import.meta.resolve('bambu-printer-mcp'));

type Json = string | number | boolean | null | Array<Json> | {[key: string]: Json};
/** Tool arguments and results are JSON. */
export type Args = {[name: string]: Json | undefined};

export type Env = {
  PRINTER_HOST: string;
  BAMBU_SERIAL: string;
  BAMBU_TOKEN: string;
  BAMBU_MODEL: string;
  [name: string]: string;
};

/**
 * The MCP asks a person before a print or heating step ("confirm the physical spool labels").
 * Brim must route that question to the user; `confirm` returns their answer.
 */
export type Confirm = (message: string) => Promise<boolean>;

export class ToolError extends Error {}

/** Runs the MCP with only the env given here. */
export async function connect(env: Env, confirm: Confirm) {
  const client = new Client({name: 'brim', version: '0'}, {capabilities: {elicitation: {}}});
  client.setRequestHandler(ElicitRequestSchema, async (request) => ({
    action: (await confirm(String(request.params.message))) ? 'accept' : 'decline',
    content: {},
  }));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env},
    // The MCP loads a .env from its cwd; a neutral cwd keeps a stray one from configuring a printer.
    cwd: tmpdir(),
    stderr: process.env.BRIM_MCP_DEBUG ? 'inherit' : 'ignore',
  });
  await client.connect(transport);

  /** Call one MCP tool; returns its text and structured result. Throws ToolError on a tool error. */
  async function raw(name: string, args: Args = {}) {
    const result = await client.callTool({name, arguments: args}, undefined, {timeout: 600_000});
    const text = (result.content as Array<{type: string; text?: string}>)
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    if (result.isError) {
      throw new ToolError(text.replace(/^Error:\s*/, ''));
    }
    return {text, structured: result.structuredContent};
  }
  /** Call one MCP tool; returns its structured result, or its JSON text parsed. */
  async function call<T = Json>(name: string, args: Args = {}): Promise<T> {
    const {text, structured} = await raw(name, args);
    return (structured ?? JSON.parse(text)) as T;
  }

  return {
    call,
    close: () => client.close(),
    /** Slice an STL or 3MF for this printer with the MCP's slicer; returns the sliced 3MF path. */
    slice: async (path: string, args: Args = {}) =>
      (await raw('slice_stl', {stl_path: path, bambu_model: env.BAMBU_MODEL, ...args})).text.split('\n')[0].trim(),
    /** Start a checked print of a sliced 3MF. `slots` are absolute AMS trays, one per filament the plate uses. */
    print: (path: string, slots: Array<number>, args: Args = {}) =>
      call('print_3mf', {
        three_mf_path: path,
        bambu_model: env.BAMBU_MODEL,
        ams_slots: slots,
        ...args,
      }),
    progress: () => call<Progress>('counterpart_print_progress'),
    filaments: () => call('get_printer_filaments'),
    pause: () => call('pause_print'),
    resume: () => call('resume_print', {bambu_model: env.BAMBU_MODEL}),
    cancel: () => call('cancel_print'),
  };
}

export type Printer = Awaited<ReturnType<typeof connect>>;

/** A Bambu printer heard on the LAN. It never connects or authenticates; the access code comes from a person. */
export type Found = {host: string; serial: string; name: string; model?: string; firmware?: string};

/**
 * Bambu printers announcing themselves over SSDP (UDP 2021), via counterpart_discover_printers.
 * `network: 'unavailable'` means another app (Bambu Studio) holds the port.
 */
export async function discover(ms = 4000) {
  // Discovery needs no printer; the MCP reads unset vars as empty.
  const mcp = await connect({PRINTER_HOST: '', BAMBU_SERIAL: '', BAMBU_TOKEN: '', BAMBU_MODEL: ''}, async () => false);
  try {
    const {network, printers} = await mcp.call<{network: 'complete' | 'unavailable'; printers: Array<Found>}>(
      'counterpart_discover_printers',
      {duration_ms: ms},
    );
    return {network, printers: printers.filter((p) => p.serial)};
  } finally {
    await mcp.close();
  }
}

/** counterpart_print_progress, the fields Brim reads. */
export type Progress = {
  state: 'idle' | 'preparing' | 'printing' | 'paused' | 'finished' | 'failed' | 'cancelled' | 'busy' | 'offline';
  job?: {name?: string; progress?: number; layer?: number; totalLayers?: number; remainingSec?: number};
  temps?: {nozzle?: {actual: number; target: number}; bed?: {actual: number; target: number}; chamber?: number};
  activeFilament?: {slot: string; material?: string; color?: string};
  problems: Array<{code?: string; severity: string; message: string}>;
};
