/**
 * The web app's state in the database, one collection at a time. The client replaces a whole collection on
 * save (as it did with localStorage), so each write is delete-all then insert, in one transaction.
 * Rows keep insertion order (rowid), which is the order the client sent.
 */
import {sql} from 'kysely';
import type {Transaction} from 'kysely';
import type {Database, Db} from './db.ts';

/** A JSON value as parsed from a request body. */
export type Json = string | number | boolean | null | Array<Json> | {[key: string]: Json};
type Row = {[key: string]: Json};
export const collections = ['parts', 'projects', 'notes', 'uses', 'jobs', 'printers', 'materials', 'slice'] as const;
export type Collection = (typeof collections)[number];

// Columns written per flat table; anything else the client sends is ignored.
const columns = {
  projects: ['id', 'name', 'edited'],
  notes: ['id', 'projectId', 'body', 'edited'],
  uses: ['projectId', 'itemId', 'qty'],
  jobs: ['id', 'partId', 'part', 'printer', 'material', 'layer', 'infill', 'seconds', 'grams', 'at', 'outcome', 'note'],
} as const;

const pick = <T>(row: Row, keys: ReadonlyArray<string>) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null])) as T;
/** Null columns come back as missing fields, matching the client's optional properties. */
const compact = <T extends {[key: string]: unknown}>(row: T) =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));
const byRowid = sql`rowid`;

function isRows(value: Json | undefined): value is Array<Row> {
  return Array.isArray(value) && value.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r));
}

/** Everything the web app loads at start. `imported` says whether browser storage was already brought over. */
export async function readState(db: Db) {
  const [parts, entries, projects, notes, uses, jobs, profiles, settings] = await Promise.all([
    db.selectFrom('parts').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('entries').selectAll().orderBy('partId').orderBy('seq').execute(),
    db.selectFrom('projects').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('notes').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('uses').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('jobs').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('profiles').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('settings').selectAll().execute(),
  ]);
  const history = Map.groupBy(entries, (e) => e.partId);
  const profilesOf = (kind: string) =>
    Object.fromEntries(profiles.filter((p) => p.kind === kind).map((p) => [p.id, JSON.parse(p.data)]));
  const setting = (key: string) => settings.find((s) => s.key === key)?.value;
  return {
    parts: parts.map((p) => ({
      ...compact(p),
      history: (history.get(p.id) ?? []).map((e) => ({
        prompt: e.prompt,
        changes: JSON.parse(e.changes),
        model: JSON.parse(e.model),
      })),
    })),
    projects,
    notes,
    uses,
    jobs: jobs.map(compact),
    printers: profiles.some((p) => p.kind === 'printer') ? profilesOf('printer') : undefined,
    materials: profiles.some((p) => p.kind === 'material') ? profilesOf('material') : undefined,
    slice: ((v) => v && JSON.parse(v))(setting('slice')),
    imported: setting('imported') !== undefined,
  };
}

/** Replaces one collection. Throws on a value of the wrong shape, leaving the old one in place. */
export const writeCollection = (db: Db, name: Collection, value: Json) =>
  db.transaction().execute((trx) => write(trx, name, value));

async function write(trx: Transaction<Database>, name: Collection, value: Json) {
  if (name === 'slice') {
    const json = JSON.stringify(value);
    await trx
      .insertInto('settings')
      .values({key: 'slice', value: json})
      .onConflict((c) => c.column('key').doUpdateSet({value: json}))
      .execute();
    return;
  }
  if (name === 'printers' || name === 'materials') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${name} must be an object`);
    }
    const kind = name === 'printers' ? 'printer' : 'material';
    await trx.deleteFrom('profiles').where('kind', '=', kind).execute();
    for (const [id, data] of Object.entries(value)) {
      await trx
        .insertInto('profiles')
        .values({kind, id, data: JSON.stringify(data)})
        .execute();
    }
    return;
  }
  if (!isRows(value)) {
    throw new Error(`${name} must be a list of objects`);
  }
  if (name === 'parts') {
    await trx.deleteFrom('entries').execute();
    await trx.deleteFrom('parts').execute();
    for (const p of value) {
      if (!isRows(p.history) || !p.history.length) {
        throw new Error('a part needs a history');
      }
      await trx
        .insertInto('parts')
        .values(pick<Database['parts']>(p, ['id', 'name', 'description', 'thumb', 'edited']))
        .execute();
      for (const [seq, e] of p.history.entries()) {
        await trx
          .insertInto('entries')
          .values({
            partId: p.id as string,
            seq,
            prompt: e.prompt as string,
            changes: JSON.stringify(e.changes ?? []),
            model: JSON.stringify(e.model),
          })
          .execute();
      }
    }
    return;
  }
  await trx.deleteFrom(name).execute();
  for (const row of value) {
    await trx.insertInto(name).values(pick<never>(row, columns[name])).execute();
  }
}

/**
 * Brings over the browser's localStorage once; later calls do nothing, so a second tab cannot overwrite.
 * All or nothing: one bad collection leaves the database as it was, still waiting for an import.
 */
export const importOnce = (db: Db, state: Partial<Record<Collection, Json>>) =>
  db.transaction().execute(async (trx) => {
    const done = await trx.selectFrom('settings').select('key').where('key', '=', 'imported').executeTakeFirst();
    if (done) {
      return false;
    }
    for (const name of collections) {
      if (state[name] != null) {
        await write(trx, name, state[name]);
      }
    }
    await trx
      .insertInto('settings')
      .values({key: 'imported', value: JSON.stringify(Date.now())})
      .execute();
    return true;
  });
