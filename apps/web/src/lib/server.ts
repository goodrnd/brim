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

/** Fetches from the dev server's API; a failed response throws `what` with the server's reason. */
export async function api(what: string, url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const type = r.headers.get('content-type') ?? '';
  // A static host answers with a page (404, or 200 with an SPA fallback), not the API.
  if (type.startsWith('text/html') && (r.ok || r.status === 404)) {
    throw new Error('This needs the Brim server.');
  }
  if (!r.ok) {
    throw new Error(`${what}: ${type.startsWith('application/json') ? (await r.json()).error : r.status}`);
  }
  return r;
}

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

/** Loads the server's state. Undefined when there is no server (a static build). */
export async function loadState(storage: Pick<Storage, 'getItem' | 'removeItem'>): Promise<ServerState | undefined> {
  type Stored = Omit<ServerState, 'parts'> & {parts: Array<StoredPart>};
  const first = await fetch('/api/state');
  // A static host has no such route, or answers every path with the app's page.
  const json = first.headers.get('content-type')?.startsWith('application/json');
  if (!json && (first.status === 404 || first.ok)) {
    return undefined;
  }
  const read = async (r: Response) => {
    if (!r.ok) {
      throw new Error(`Could not load storage: ${r.status} ${await r.text()}`);
    }
    return (await r.json()) as Stored;
  };
  let state = await read(first);
  let changed = false;
  // Saves a closing page could not send (see `save`).
  for (const collection of Object.keys(keys) as Array<Collection>) {
    const body = storage.getItem(unsent(collection));
    if (body !== null) {
      await put(collection, body, false);
      storage.removeItem(unsent(collection));
      changed = true;
    }
  }
  if (changed) {
    state = await read(await fetch('/api/state'));
  }
  return {...state, parts: await partsFromServer(state.parts)};
}

const unsent = (collection: Collection) => `brim-unsent-${collection}`;

async function put(collection: Collection, body: string, keepalive: boolean) {
  const r = await fetch(`/api/state/${collection}`, {
    method: 'PUT',
    headers: {'content-type': 'application/json'},
    body,
    keepalive,
  });
  if (!r.ok) {
    throw Object.assign(new Error(`Could not save ${collection}: ${r.status} ${await r.text()}`), {status: r.status});
  }
}

let closingBytes = 0; // keepalive bodies in flight

/**
 * Replaces one collection on the server. `closing` is a save from a page that is going away: only a keepalive
 * request outlives the page, and browsers cap those at 64 KB in total, so a larger one waits in localStorage
 * for `loadState` on the next visit.
 * shortcut: a mesh imported in the moment before closing is lost with that save, its upload cannot outlive the page.
 */
export async function save(collection: Collection, value: unknown, closing = false) {
  const body = JSON.stringify(collection === 'parts' ? await partsToServer(value as Array<Part>) : value);
  if (!closing) {
    await put(collection, body, false);
    // A page restored from the back/forward cache may have parked an older save.
    return localStorage.removeItem(unsent(collection));
  }
  const size = new Blob([body]).size;
  if (closingBytes + size > 60_000) {
    return localStorage.setItem(unsent(collection), body);
  }
  closingBytes += size;
  await put(collection, body, true).finally(() => (closingBytes -= size));
}
