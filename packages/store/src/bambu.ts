/**
 * The Bambu Lab EU shop as a filament `Crawl`. The shop has no public API, so this reads its pages: the filament
 * collection lists the products, and each product page carries a schema.org ProductGroup with one variant per
 * colour and packaging.
 */
import {setTimeout as sleep} from 'node:timers/promises';
import type {CatalogFilament, Offer} from './filaments.ts';

const shop = 'bambu-eu';
const base = 'https://eu.store.bambulab.com';

/** The fields read from the page's JSON. Nothing in it is trusted: each is checked before use. */
type Variant = {
  name?: unknown;
  image?: unknown;
  offers?: {url?: unknown; price?: unknown; priceCurrency?: unknown; availability?: unknown};
};

// The shop's CDN resizes on request, so the browser loads each image at the size it is shown.
const sized = (url: unknown, width: number) =>
  typeof url === 'string' && url.startsWith('https://')
    ? `${url}__op__resize,m_lfit,w_${width}__op__format,f_auto__op__quality,q_80`
    : null;

/** The Filaments on one product page. Empty for a page that sells no single colour (packs, accessories). */
export function parseProduct(html: string): Array<CatalogFilament> {
  const group = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => {
      try {
        return JSON.parse(m[1]) as {'@type'?: unknown; name?: unknown; hasVariant?: unknown};
      } catch {
        return null;
      }
    })
    .find((j) => j?.['@type'] === 'ProductGroup');
  if (!group || typeof group.name !== 'string' || !Array.isArray(group.hasVariant)) {
    return [];
  }
  // Colour chips are only in the page's Next.js payload, which is JSON inside a string: hence the escaped quotes.
  const chips = new Map(
    [
      ...html
        .replaceAll(String.raw`\"`, '"')
        .matchAll(/"propertyValue":"([^"]+)","position":\d+,"colorUrl":"(https:\/\/[^"]+)"/g),
    ].map((m) => [m[1], m[2]]),
  );
  const prefix = `${group.name} - `;
  const byCode = new Map<string, CatalogFilament>();
  for (const v of group.hasVariant as Array<Variant>) {
    const {url, price, priceCurrency, availability} = v.offers ?? {};
    if (
      typeof v.name !== 'string' ||
      typeof url !== 'string' ||
      !url.startsWith(`${base}/`) ||
      typeof price !== 'number' ||
      typeof priceCurrency !== 'string' ||
      !/^[A-Z]{3}$/.test(priceCurrency)
    ) {
      continue;
    }
    // "PLA Basic - Jade White (10100) / Refill / 1kg"; a few products put the colour last.
    const parts = (v.name.startsWith(prefix) ? v.name.slice(prefix.length) : v.name).split(' / ');
    const named = parts.map((p) => /^(.*?)\s*\((\d+)\)$/.exec(p)).find(Boolean);
    // No colour code is a mixed pack or an accessory. `*` is a multi-pack of a colour its own product page lists.
    if (!named || parts.some((p) => p.includes('*'))) {
      continue;
    }
    const [whole, color, code] = named;
    const offer: Offer = {
      // The shop writes both "1kg" and "1 kg".
      label: parts
        .filter((p) => p !== whole)
        .map((p) => p.replace(/(\d)\s*kg$/, '$1 kg'))
        .join(' / '),
      price,
      currency: priceCurrency,
      inStock: availability === 'https://schema.org/InStock',
      url,
    };
    const known = byCode.get(code);
    if (known) {
      known.offers.push(offer);
    } else {
      byCode.set(code, {
        id: `${shop}-${code}`,
        shop,
        product: group.name,
        color,
        code,
        image: sized(v.image, 320),
        swatch: sized(chips.get(whole), 128),
        offers: [offer],
      });
    }
  }
  return [...byCode.values()];
}

async function fetchPage(url: string) {
  for (let attempt = 0; ; attempt++) {
    // The shop answers 429 after a few dozen requests in a row, so each request waits its turn.
    await sleep(attempt ? 30_000 : 2000);
    const r = await fetch(url, {headers: {'user-agent': 'Brim filament catalog'}, signal: AbortSignal.timeout(30_000)});
    if (r.status === 429 && attempt < 3) {
      await r.body?.cancel();
    } else if (r.ok) {
      return r.text();
    } else {
      throw new Error(`The Bambu Lab shop answered ${r.status} for ${url}`);
    }
  }
}

/** Every filament the shop lists, one product page at a time: about 65 requests over four minutes. */
export async function* bambuEu(get: (url: string) => Promise<string> = fetchPage) {
  const slugs = new Set<string>();
  // The collection is paged; a page past the end repeats or lists nothing.
  for (let page = 1, before = -1; page <= 20 && slugs.size > before; page++) {
    before = slugs.size;
    const html = await get(`${base}/collections/bambu-lab-3d-printer-filament?page=${page}`);
    for (const m of html.matchAll(/href="(?:\/[a-z]{2})?\/products\/([a-z0-9-]+)/g)) {
      slugs.add(m[1]);
    }
  }
  for (const slug of slugs) {
    yield parseProduct(await get(`${base}/products/${slug}`));
  }
}
