/**
 * The filament catalog and the spools on hand (docs/domain.md: Filament). Rows come from a shop through a `Crawl`.
 * `onHand` is the one column a person sets, and a sync never touches it.
 */
import {sql} from 'kysely';
import type {Db} from './db.ts';

/** One way to buy a Filament: a packaging and size at a price, bought on the shop's own page. */
export interface Offer {
  label: string; // e.g. "Refill / 1kg"
  price: number;
  currency: string;
  inStock: boolean;
  url: string;
}

/** A Filament as a shop lists it. */
export interface CatalogFilament {
  id: string;
  shop: string;
  product: string;
  color: string;
  code: string;
  image: string | null;
  swatch: string | null;
  offers: Array<Offer>;
}

/** A Filament as stored: `seen` is the start (ms) of the last sync that listed it, `onHand` the spools a person has. */
export type Filament = CatalogFilament & {seen: number; onHand: number};

/** What GET /api/filaments returns. A Filament with `seen` before `synced` is no longer in the shop. */
export interface Catalog {
  filaments: Array<Filament>;
  synced?: number; // start (ms) of the last sync that read the whole shop
  syncing: boolean;
  error?: string; // why the last sync failed
}

/** Reads a shop, one batch of Filaments per product. Throws when the shop cannot be read. */
export type Crawl = () => AsyncIterable<Array<CatalogFilament>>;

const hour = 3_600_000;
const syncedKey = 'filaments-synced';

export function filamentCatalog(db: Db, crawl: Crawl) {
  let syncing: Promise<void> | undefined;
  let error: string | undefined;

  /** Start (ms) of the last sync that read the whole shop. */
  const synced = async () => {
    const row = await db.selectFrom('settings').select('value').where('key', '=', syncedKey).executeTakeFirst();
    return row ? (JSON.parse(row.value) as number) : undefined;
  };

  async function run() {
    const started = Date.now();
    let count = 0;
    for await (const batch of crawl()) {
      for (const {offers, ...filament} of batch) {
        const row = {...filament, offers: JSON.stringify(offers), seen: started};
        await db
          .insertInto('filaments')
          .values(row)
          .onConflict((c) => c.column('id').doUpdateSet(row))
          .execute();
        count++;
      }
    }
    if (!count) {
      throw new Error('The shop listed no filament. Its pages may have changed.');
    }
    // Only a complete sync moves `synced`, so a failed one never makes the rows it missed look unlisted.
    const value = JSON.stringify(started);
    await db
      .insertInto('settings')
      .values({key: syncedKey, value})
      .onConflict((c) => c.column('key').doUpdateSet({value}))
      .execute();
  }

  /** Reads the shop again, unless a sync is already running. Rows appear as each product is read. */
  const sync = () =>
    (syncing ??= run()
      .then(
        () => void (error = undefined),
        (error_: Error) => void (error = error_.message),
      )
      .finally(() => void (syncing = undefined)));

  // A catalog a person has loaded stays fresh. A new install never fetches from a shop unasked.
  const refresh = async () => {
    const at = await synced();
    if (at && Date.now() - at > 24 * hour) {
      void sync();
    }
  };
  const check = () => void refresh().catch(() => {}); // the db is closed while the dev server restarts
  const timer = setInterval(check, hour);
  timer.unref();
  check();

  return {
    sync,
    /** Every Filament in shop order. */
    async list(): Promise<Catalog> {
      const rows = await db
        .selectFrom('filaments')
        .selectAll()
        .orderBy(sql`rowid`)
        .execute();
      return {
        filaments: rows.map((r) => ({...r, offers: JSON.parse(r.offers) as Array<Offer>})),
        synced: await synced(),
        syncing: !!syncing,
        error,
      };
    },
    /** False when there is no such Filament. */
    async setOnHand(id: string, onHand: number) {
      const r = await db.updateTable('filaments').set({onHand}).where('id', '=', id).executeTakeFirst();
      return r.numUpdatedRows > 0n;
    },
    close: () => clearInterval(timer),
  };
}
