/**
 * The web app's state in the database, one collection at a time. A client loads everything, then saves only the
 * items it changed (`patchCollection`), so two clients editing different items keep both edits. On the same
 * item the last save wins.
 */
import {sql} from 'kysely';
import type {Transaction} from 'kysely';
import type {Database, Db} from './db.ts';

/** A JSON value as parsed from a request body. */
export type Json = string | number | boolean | null | Array<Json> | {[key: string]: Json};
type Row = {[key: string]: Json};
export const collections = ['parts', 'projects', 'notes', 'uses', 'jobs', 'printers', 'materials', 'slice'] as const;
export type Collection = (typeof collections)[number];

// Per flat table: the columns that name a row, and the columns written. Anything else the client sends is ignored.
const tables = {
  projects: {key: ['id'], columns: ['id', 'name', 'edited']},
  notes: {key: ['id'], columns: ['id', 'projectId', 'body', 'edited']},
  uses: {key: ['projectId', 'itemId'], columns: ['projectId', 'itemId', 'qty']},
  jobs: {
    key: ['id'],
    columns: [
      'id',
      'partId',
      'part',
      'printer',
      'material',
      'layer',
      'infill',
      'seconds',
      'grams',
      'at',
      'outcome',
      'note',
    ],
  },
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

/** Everything the web app loads at start. */
export async function readState(db: Db) {
  const [parts, entries, projects, notes, uses, jobs, profiles, settings] = await Promise.all([
    // Newest first, as the client lists them. Notes keep the order they were added in.
    db.selectFrom('parts').selectAll().orderBy('edited', 'desc').orderBy(byRowid).execute(),
    db.selectFrom('entries').selectAll().orderBy('partId').orderBy('seq').execute(),
    db.selectFrom('projects').selectAll().orderBy('edited', 'desc').orderBy(byRowid).execute(),
    db.selectFrom('notes').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('uses').selectAll().orderBy(byRowid).execute(),
    db.selectFrom('jobs').selectAll().orderBy('at', 'desc').orderBy(byRowid).execute(),
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
  };
}

/**
 * Saves the changed items of one collection: `{put, remove}`.
 *
 *   parts, projects, notes, jobs   put: the items, matched by `id`; remove: ids
 *   uses                           put: the uses, matched by project and item; remove: `{projectId, itemId}`
 *   printers, materials            put: `{id: profile}`; remove: ids
 *   slice                          put: the settings, whole
 *
 * Throws on a patch of the wrong shape, leaving the collection as it was.
 */
export const patchCollection = (db: Db, name: Collection, patch: Json) =>
  db.transaction().execute((trx) => apply(trx, name, patch));

async function apply(trx: Transaction<Database>, name: Collection, patch: Json) {
  const shaped = patch !== null && typeof patch === 'object' && !Array.isArray(patch);
  if (!shaped || patch.put === undefined || !Array.isArray(patch.remove)) {
    throw new Error('send {put, remove}');
  }
  const {put, remove} = patch;
  if (name === 'slice') {
    const json = JSON.stringify(put);
    await trx
      .insertInto('settings')
      .values({key: 'slice', value: json})
      .onConflict((c) => c.column('key').doUpdateSet({value: json}))
      .execute();
    return;
  }
  if (name === 'printers' || name === 'materials') {
    if (put === null || typeof put !== 'object' || Array.isArray(put)) {
      throw new Error(`${name}.put must be an object`);
    }
    const kind = name === 'printers' ? 'printer' : 'material';
    for (const id of remove) {
      await trx.deleteFrom('profiles').where('kind', '=', kind).where('id', '=', String(id)).execute();
    }
    for (const [id, value] of Object.entries(put)) {
      const data = JSON.stringify(value);
      await trx
        .insertInto('profiles')
        .values({kind, id, data})
        .onConflict((c) => c.columns(['kind', 'id']).doUpdateSet({data}))
        .execute();
    }
    return;
  }
  if (!isRows(put)) {
    throw new Error(`${name}.put must be a list of objects`);
  }
  if (name === 'parts') {
    for (const id of remove) {
      await trx.deleteFrom('entries').where('partId', '=', String(id)).execute();
      await trx.deleteFrom('parts').where('id', '=', String(id)).execute();
    }
    for (const p of put) {
      if (typeof p.id !== 'string' || !isRows(p.history) || !p.history.length) {
        throw new Error('a part needs an id and a history');
      }
      const part = pick<Database['parts']>(p, ['id', 'name', 'description', 'thumb', 'edited']);
      await trx
        .insertInto('parts')
        .values(part)
        .onConflict((c) => c.column('id').doUpdateSet(part))
        .execute();
      await trx.deleteFrom('entries').where('partId', '=', p.id).execute();
      for (const [seq, e] of p.history.entries()) {
        await trx
          .insertInto('entries')
          .values({
            partId: p.id,
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
  const {key, columns} = tables[name];
  // What names a row: every key column, as text.
  const named = (row: Json) =>
    key.map((k) => {
      const v = typeof row === 'string' ? row : (row as Row | null)?.[k];
      if (typeof v !== 'string' || (typeof row === 'string' && key.length > 1)) {
        throw new Error(`${name} are named by ${key.join(' and ')}`);
      }
      return v;
    });
  for (const gone of remove) {
    let query = trx.deleteFrom(name);
    for (const [i, v] of named(gone).entries()) {
      query = query.where(key[i] as never, '=', v as never);
    }
    await query.execute();
  }
  for (const row of put) {
    named(row);
    const values = pick<never>(row, columns);
    await trx
      .insertInto(name)
      .values(values)
      // Updating in place keeps the row's position, so an edited note stays where it was.
      .onConflict((c) => c.columns(key as never).doUpdateSet(values))
      .execute();
  }
}
