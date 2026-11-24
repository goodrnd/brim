/**
 * Brim's SQLite database: Kysely on Node's built-in node:sqlite, so there is no native module to build.
 * Schema changes are append-only entries in `migrations`; `openDb` runs the pending ones.
 */
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {Kysely, SqliteDialect, type SqliteDatabase} from 'kysely';
import {Migrator, type Migration} from 'kysely/migration';

/** A File (docs/domain.md): reference material kept as uploaded. Its bytes are in the bucket under `sha256`. */
export interface FileTable {
  id: string;
  name: string;
  type: string; // MIME type as uploaded
  size: number;
  sha256: string;
  created: number; // ms timestamp
}

// Library tables (docs/domain.md). Optional fields are null; JSON columns hold text.
export interface PartTable {
  id: string;
  name: string | null;
  description: string | null;
  thumb: string | null;
  edited: number | null;
}

/** One Entry of a Part's history, in order by `seq`. A mesh `model` names its triangles by sha256. */
export interface EntryTable {
  partId: string;
  seq: number;
  prompt: string;
  changes: string; // JSON string[]
  model: string; // JSON Model
}

export interface ProjectTable {
  id: string;
  name: string;
  edited: number;
}

export interface NoteTable {
  id: string;
  projectId: string;
  body: string;
  edited: number;
}

export interface UseTable {
  projectId: string;
  itemId: string;
  qty: number;
}

export interface JobTable {
  id: string;
  partId: string;
  part: string;
  printer: string;
  material: string;
  layer: number;
  infill: number;
  seconds: number;
  grams: number;
  at: number;
  outcome: string | null;
  note: string | null;
}

/** Printer and Material profiles, kept whole as JSON so the profile types can grow without a migration. */
export interface ProfileTable {
  kind: 'printer' | 'material';
  id: string;
  data: string;
}

export interface SettingTable {
  key: string;
  value: string; // JSON
}

export interface Database {
  files: FileTable;
  parts: PartTable;
  entries: EntryTable;
  projects: ProjectTable;
  notes: NoteTable;
  uses: UseTable;
  jobs: JobTable;
  profiles: ProfileTable;
  settings: SettingTable;
}

export type Db = Kysely<Database>;

// Never edit a shipped migration; add a new one.
const migrations = {
  '0001_files': {
    up: (db) =>
      db.schema
        .createTable('files')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('type', 'text', (c) => c.notNull())
        .addColumn('size', 'integer', (c) => c.notNull())
        .addColumn('sha256', 'text', (c) => c.notNull())
        .addColumn('created', 'integer', (c) => c.notNull())
        .execute(),
  },
  '0002_library': {
    async up(db) {
      const text = 'text' as const;
      await db.schema
        .createTable('parts')
        .addColumn('id', text, (c) => c.primaryKey())
        .addColumn('name', text)
        .addColumn('description', text)
        .addColumn('thumb', text)
        .addColumn('edited', 'integer')
        .execute();
      await db.schema
        .createTable('entries')
        .addColumn('partId', text, (c) => c.notNull())
        .addColumn('seq', 'integer', (c) => c.notNull())
        .addColumn('prompt', text, (c) => c.notNull())
        .addColumn('changes', text, (c) => c.notNull())
        .addColumn('model', text, (c) => c.notNull())
        .addPrimaryKeyConstraint('entries_pk', ['partId', 'seq'])
        .execute();
      await db.schema
        .createTable('projects')
        .addColumn('id', text, (c) => c.primaryKey())
        .addColumn('name', text, (c) => c.notNull())
        .addColumn('edited', 'integer', (c) => c.notNull())
        .execute();
      await db.schema
        .createTable('notes')
        .addColumn('id', text, (c) => c.primaryKey())
        .addColumn('projectId', text, (c) => c.notNull())
        .addColumn('body', text, (c) => c.notNull())
        .addColumn('edited', 'integer', (c) => c.notNull())
        .execute();
      await db.schema
        .createTable('uses')
        .addColumn('projectId', text, (c) => c.notNull())
        .addColumn('itemId', text, (c) => c.notNull())
        .addColumn('qty', 'integer', (c) => c.notNull())
        .addPrimaryKeyConstraint('uses_pk', ['projectId', 'itemId'])
        .execute();
      // No foreign keys: Jobs outlive their Part, and Uses point at Parts, Files or Components.
      await db.schema
        .createTable('jobs')
        .addColumn('id', text, (c) => c.primaryKey())
        .addColumn('partId', text, (c) => c.notNull())
        .addColumn('part', text, (c) => c.notNull())
        .addColumn('printer', text, (c) => c.notNull())
        .addColumn('material', text, (c) => c.notNull())
        .addColumn('layer', 'real', (c) => c.notNull())
        .addColumn('infill', 'real', (c) => c.notNull())
        .addColumn('seconds', 'real', (c) => c.notNull())
        .addColumn('grams', 'real', (c) => c.notNull())
        .addColumn('at', 'integer', (c) => c.notNull())
        .addColumn('outcome', text)
        .addColumn('note', text)
        .execute();
      await db.schema
        .createTable('profiles')
        .addColumn('kind', text, (c) => c.notNull())
        .addColumn('id', text, (c) => c.notNull())
        .addColumn('data', text, (c) => c.notNull())
        .addPrimaryKeyConstraint('profiles_pk', ['kind', 'id'])
        .execute();
      await db.schema
        .createTable('settings')
        .addColumn('key', text, (c) => c.primaryKey())
        .addColumn('value', text, (c) => c.notNull())
        .execute();
    },
  },
} satisfies Record<string, Migration>;

// node:sqlite takes parameters spread; Kysely passes an array.
const args = (p: ReadonlyArray<unknown>) => p as Array<SQLInputValue>;

/** Kysely's SqliteDialect expects better-sqlite3's shape; node:sqlite differs only in spread params and `reader`. */
function nodeSqlite(path: string): SqliteDatabase {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    close: () => db.close(),
    prepare(query) {
      const s = db.prepare(query);
      return {
        reader: s.columns().length > 0,
        all: (p) => s.all(...args(p)),
        run: (p) => s.run(...args(p)),
        iterate: (p) => s.iterate(...args(p)),
      };
    },
  };
}

/** Opens (or creates) the database at `path` and migrates it. `:memory:` works for tests. */
export async function openDb(path: string): Promise<Db> {
  const db = new Kysely<Database>({dialect: new SqliteDialect({database: nodeSqlite(path)})});
  const {error} = await new Migrator({db, provider: {getMigrations: async () => migrations}}).migrateToLatest();
  if (error) {
    await db.destroy();
    throw error;
  }
  return db;
}
