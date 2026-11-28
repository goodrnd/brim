import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {storeApi} from '../src/api.ts';
import {bambuEu, parseProduct} from '../src/bambu.ts';
import {bucket} from '../src/bucket.ts';
import {openDb} from '../src/db.ts';
import type {CatalogFilament} from '../src/filaments.ts';

// Product pages saved from the shop, cut down to the scripts the parser reads.
const fixture = (slug: string) => readFile(new URL(`fixtures/${slug}.html`, import.meta.url), 'utf8');

const page = (name: string, variants: Array<string>) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@type': 'ProductGroup',
    name,
    hasVariant: variants.map((v, i) => ({
      name: `${name} - ${v}`,
      image: 'https://cdn.test/a.png',
      offers: {url: `https://eu.store.bambulab.com/products/x?id=${i}`, price: 10 + i, priceCurrency: 'EUR'},
    })),
  })}</script>`;

void test('bambu: one Filament per colour code, with every packaging as an offer', async () => {
  const [pa, ...none] = parseProduct(await fixture('pa6-cf'));
  assert.equal(none.length, 0);
  assert.deepEqual(
    {...pa, image: !!pa.image, swatch: !!pa.swatch},
    {
      id: 'bambu-eu-72100',
      shop: 'bambu-eu',
      product: 'PA6-CF',
      color: 'Black',
      code: '72100',
      image: true,
      swatch: true,
      offers: pa.offers,
    },
  );
  assert.deepEqual(
    pa.offers.map((o) => o.label),
    ['Filament with spool / 0.5 kg', 'Filament with spool / 1 kg'],
  );
  assert.ok(pa.offers.every((o) => o.price > 0 && o.currency === 'EUR' && o.url.includes('/products/pa6-cf?id=')));

  // This page writes "Orange(30301)" without a space and puts the colour last.
  const tpu = parseProduct(await fixture('tpu-85a-tpu-90a'));
  assert.equal(tpu.length, 13);
  assert.equal(new Set(tpu.map((f) => f.code)).size, 13);
  assert.ok(
    tpu.every((f) => f.swatch && !/[(\d]/.test(f.color)),
    'colour names carry no code',
  );
  assert.ok(tpu.every((f) => f.offers.every((o) => /^TPU (85|90)A \/ 1 kg$/.test(o.label))));
});

void test('bambu: skips multi-packs, bundles and pages that are not products', () => {
  const pack = page('PLA Basic', ['Black (10101) / Refill / 1kg', 'Black (10101) / Refill / 1kg*10', 'Mystery Box']);
  const [black, ...none] = parseProduct(pack);
  assert.equal(none.length, 0);
  assert.deepEqual(
    black.offers.map((o) => [o.label, o.price, o.inStock]),
    [['Refill / 1 kg', 10, false]],
  );
  assert.equal(black.swatch, null, 'no chip on the page');
  assert.deepEqual(parseProduct('<html>Access denied</html>'), []);
  assert.deepEqual(parseProduct('<script type="application/ld+json">{not json</script>'), []);
});

void test('bambu: walks the collection pages, then each product once', async () => {
  const asked: Array<string> = [];
  const get = async (url: string) => {
    asked.push(url.replace('https://eu.store.bambulab.com', ''));
    return url.endsWith('?page=1')
      ? '<a href="/en/products/pla-basic?x=1"></a><a href="/en/products/pla-basic"></a><a href="/products/abs"></a>'
      : url.includes('/collections/')
        ? '<a href="/en/products/pla-basic"></a>'
        : page(url.endsWith('abs') ? 'ABS' : 'PLA Basic', [`Black (${url.endsWith('abs') ? 40_101 : 10_101}) / 1kg`]);
  };
  const found = [];
  const steps: Array<string> = [];
  for await (const batch of bambuEu(
    new AbortController().signal,
    (a) => steps.push(`${a.step}: ${a.done}/${a.total ?? '?'}`),
    get,
  )) {
    found.push(...batch.map((f) => f.id));
  }
  assert.deepEqual(steps, [
    'Finding products on collection page 1: 0/?',
    'Finding products on collection page 2: 2/?',
    'Reading pla basic: 0/2',
    'Reading abs: 1/2',
  ]);
  assert.deepEqual(found, ['bambu-eu-10101', 'bambu-eu-40101']);
  assert.deepEqual(asked, [
    '/collections/bambu-lab-3d-printer-filament?page=1',
    '/collections/bambu-lab-3d-printer-filament?page=2',
    '/products/pla-basic',
    '/products/abs',
  ]);
});

const filament = (code: string, price: number): CatalogFilament => ({
  id: `test-${code}`,
  shop: 'test',
  product: 'PLA Basic',
  color: `Colour ${code}`,
  code,
  image: null,
  swatch: null,
  offers: [{label: 'Refill / 1 kg', price, currency: 'EUR', inStock: true, url: 'https://shop.test/x'}],
});

void test('filaments: a sync fills the catalog and keeps the spools on hand', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'brim-filaments-'));
  const db = await openDb(join(dir, 'brim.db'));
  let shop: Array<Array<CatalogFilament>> | Error = [[filament('1', 10), filament('2', 10)]];
  const api = storeApi(db, bucket(join(dir, 'files')), async function* () {
    if (shop instanceof Error) {
      throw shop;
    }
    yield* shop;
  });
  const server = createServer((req, res) => api(req, res, () => res.end())).listen(0);
  t.after(async () => (server.close(), api.close(), await db.destroy(), await rm(dir, {recursive: true})));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/filaments`;
  const list = async () => (await fetch(base)).json();
  const sync = async () => {
    assert.equal((await fetch(`${base}/sync`, {method: 'POST'})).status, 202);
    for (;;) {
      const state = await list();
      if (!state.syncing) {
        return state;
      }
    }
  };
  const onHand = (id: string, body: unknown) =>
    fetch(`${base}/${id}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });

  assert.deepEqual(await list(), {filaments: [], syncing: false}, 'nothing is fetched until asked');

  const first = await sync();
  assert.deepEqual(
    first.filaments.map((f: CatalogFilament & {onHand: number}) => [f.id, f.onHand, f.offers[0].price]),
    [
      ['test-1', 0, 10],
      ['test-2', 0, 10],
    ],
  );
  assert.ok(first.filaments.every((f: {seen: number}) => f.seen === first.synced));

  assert.equal((await onHand('test-1', {onHand: 3})).status, 200);
  assert.equal((await onHand('test-1', {onHand: -1})).status, 400);
  assert.equal((await onHand('test-1', {onHand: 1.5})).status, 400);
  assert.equal((await onHand('test-1', {})).status, 400);
  assert.equal((await onHand('nope', {onHand: 1})).status, 404);

  // The shop drops one colour, reprices another and adds a third.
  shop = [[filament('1', 12), filament('3', 10)]];
  const second = await sync();
  assert.deepEqual(
    second.filaments.map((f: CatalogFilament & {onHand: number; seen: number}) => [
      f.id,
      f.onHand,
      f.offers[0].price,
      f.seen === second.synced,
    ]),
    [
      ['test-1', 3, 12, true],
      ['test-2', 0, 10, false],
      ['test-3', 0, 10, true],
    ],
  );

  // A shop that cannot be read, or reads as empty, changes nothing and says why.
  shop = new Error('The shop answered 503');
  const failed = await sync();
  assert.equal(failed.error, 'The shop answered 503');
  assert.equal(failed.synced, second.synced);
  assert.equal(failed.filaments.length, 3);
  shop = [[]];
  assert.match((await sync()).error, /listed no filament/);
  shop = [[filament('1', 12)]];
  assert.equal((await sync()).error, undefined);
});
