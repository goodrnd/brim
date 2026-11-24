// The dev server's storage (@brim/store). Without it (a static build), the app keeps using localStorage.
import type {Model} from '@brim/core/model.ts';
import type {Material, Printer, SliceSettings} from '@brim/core/slicer.ts';
import type {Job} from '../jobs/Jobs.tsx';
import type {Entry, Note, Part, Project, Use} from './library.ts';

/** How a mesh Entry is stored: its triangles are a blob named by sha256. */
type StoredModel = Model | {type: 'mesh'; name: string; sha256: string};

/** What GET /api/state returns, meshes resolved. Profiles and slice settings are unset until first saved. */
export interface ServerState {
  parts: Array<Part>;
  projects: Array<Project>;
  notes: Array<Note>;
  uses: Array<Use>;
  jobs: Array<Job>;
  printers?: Record<string, Printer>;
  materials?: Record<string, Material>;
  slice?: SliceSettings;
  imported: boolean;
}

const keys = {
  parts: 'brim-parts',
  projects: 'brim-projects',
  notes: 'brim-notes',
  uses: 'brim-uses',
  jobs: 'brim-jobs',
  printers: 'brim-printers',
  materials: 'brim-materials',
  slice: 'brim-slice',
} as const;
export type Collection = keyof typeof keys;
export const collectionOf = (key: string) => (Object.keys(keys) as Array<Collection>).find((c) => keys[c] === key);

const sent = new WeakMap<Float32Array, string>(); // triangles already in the bucket, by sha256

async function putBlob(positions: Float32Array) {
  const known = sent.get(positions);
  if (known) {
    return known;
  }
  const r = await fetch('/api/blobs', {
    method: 'PUT',
    headers: {'content-type': 'application/octet-stream'},
    body: new Uint8Array(positions.buffer as ArrayBuffer, positions.byteOffset, positions.byteLength),
  });
  if (!r.ok) {
    throw new Error(`Could not save mesh: ${r.status}`);
  }
  const {sha256} = (await r.json()) as {sha256: string};
  sent.set(positions, sha256);
  return sha256;
}

async function getBlob(sha256: string) {
  const r = await fetch(`/api/blobs/${sha256}`);
  if (!r.ok) {
    throw new Error(`Missing mesh ${sha256}`);
  }
  const positions = new Float32Array(await r.arrayBuffer());
  sent.set(positions, sha256);
  return positions;
}

/** Parts as the server stores them: mesh triangles uploaded, Entries naming them by hash. */
export const partsToServer = (parts: Array<Part>) =>
  Promise.all(
    parts.map(async (p) => ({
      ...p,
      history: await Promise.all(
        p.history.map(async (e) =>
          e.model.type === 'mesh'
            ? {...e, model: {type: 'mesh', name: e.model.name, sha256: await putBlob(e.model.positions)}}
            : e,
        ),
      ),
    })),
  );

// shortcut: every mesh is fetched at start; load on demand if libraries get large.
type StoredPart = Omit<Part, 'history'> & {history: Array<Omit<Entry, 'model'> & {model: StoredModel}>};
const partsFromServer = (parts: Array<StoredPart>): Promise<Array<Part>> =>
  Promise.all(
    parts.map(async (p) => ({
      ...p,
      history: await Promise.all(
        p.history.map(async ({model, ...e}): Promise<Entry> => ({
          ...e,
          model: 'sha256' in model ? {type: 'mesh', name: model.name, positions: await getBlob(model.sha256)} : model,
        })),
      ),
    })),
  );

/**
 * Loads the server's state, first bringing over this browser's localStorage if the server has none yet.
 * Undefined when there is no server.
 */
export async function loadState(storage: Pick<Storage, 'getItem'>): Promise<ServerState | undefined> {
  type Stored = Omit<ServerState, 'parts'> & {parts: Array<StoredPart>};
  const get = () => fetch('/api/state').then((r) => (r.ok ? (r.json() as Promise<Stored>) : undefined));
  let state = await get().catch(() => undefined);
  if (!state) {
    return undefined;
  }
  if (!state.imported) {
    const local = Object.fromEntries(
      Object.entries(keys).map(([c, key]) => {
        try {
          return [c, JSON.parse(storage.getItem(key) ?? 'null')];
        } catch {
          return [c, null];
        }
      }),
    );
    const r = await fetch('/api/state/import', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(local),
    });
    if (!r.ok) {
      throw new Error(`Could not import browser storage: ${await r.text()}`);
    }
    state = (await get())!;
  }
  return {...state, parts: await partsFromServer(state.parts)};
}

/** Replaces one collection on the server. */
export async function save(collection: Collection, value: unknown) {
  const body = JSON.stringify(collection === 'parts' ? await partsToServer(value as Array<Part>) : value);
  const r = await fetch(`/api/state/${collection}`, {
    method: 'PUT',
    headers: {'content-type': 'application/json'},
    body,
    // A save on page close survives only as keepalive, which browsers cap at 64 KB.
    keepalive: body.length < 60_000,
  });
  if (!r.ok) {
    throw new Error(`${r.status} ${await r.text()}`);
  }
}
