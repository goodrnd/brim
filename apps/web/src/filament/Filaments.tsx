import {
  Button,
  ButtonLink,
  Checkbox,
  Dropdown,
  EmptyState,
  Heading,
  IconButton,
  PageHeader,
  Search,
  SegmentedControl,
  SelectionControlAndLabel,
  Stack,
  Text,
} from '@earendil-works/elanor-react';
import type {Catalog, Filament} from '@brim/store/filaments.ts';
import {useEffect, useRef, useState} from 'react';
import {count} from '../lib/library.ts';
import {api} from '../lib/server.ts';
import {AddIcon, OpenInNewIcon, RefreshIcon, RemoveIcon, ShelvesIcon} from '../ui/icons.ts';

const money = (price: number, currency: string) =>
  new Intl.NumberFormat(undefined, {style: 'currency', currency}).format(price);
const guides = [
  {
    url: 'https://eu.store.bambulab.com/products/pla-basic-filament',
    name: 'PLA Basic',
    use: 'rigid models',
    tip: 'For a desk organiser or a fit check, start with a standard 0.4 mm nozzle. A 0.2 mm nozzle can resolve finer lettering, but prints more slowly. Avoid PLA for parts that need to stay stiff in a hot car.',
  },
  {
    url: 'https://eu.store.bambulab.com/products/tpu-95a-hf',
    name: 'TPU 95A HF',
    use: 'flexible parts',
    tip: 'For a soft bumper or non-slip foot, start with a 0.4 mm nozzle rather than 0.2 mm. Dry the spool before printing: moisture can cause bubbles and stringing. Check feeder compatibility before loading flexible filament into an AMS.',
  },
  {
    url: 'https://eu.store.bambulab.com/products/asa-filament',
    name: 'ASA',
    use: 'outdoor parts',
    tip: 'For a UV-exposed garden label, a standard 0.4 mm nozzle works. Plan for a heated bed and an enclosure to limit warping, especially on larger parts. Use effective ventilation; an enclosure alone does not remove fumes.',
  },
  {
    url: 'https://eu.store.bambulab.com/products/pa6-cf',
    name: 'PA6-CF',
    use: 'stiff fixtures',
    tip: 'For a rigid drilling jig, carbon-fibre-filled nylon needs a wear-resistant nozzle. A hardened-steel 0.6 mm nozzle reduces clogging risk compared with a smaller opening. Dry the nylon before printing and keep it dry while feeding.',
  },
];

/** The filament catalog and the spools on hand (docs/domain.md: Filament). Needs the dev server; without it, says so. */
export function Filaments() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState('');
  const [view, setView] = useState<'catalog' | 'mine'>('catalog');
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState('all');
  const [inStock, setInStock] = useState(false);

  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  // One writer per colour. Later clicks change the target; retrying an absolute count is safe.
  const targets = useRef(new Map<string, number>());
  const [pending, setPending] = useState(new Map<string, number>());
  const writing = useRef(new Set<string>());
  const results = useRef<HTMLParagraphElement>(null);
  const latestLoad = useRef(0);
  const load = () => {
    const request = ++latestLoad.current;
    return api('Could not load filaments', '/api/filaments')
      .then((r) => r.json())
      .then(
        (data: Catalog) => {
          if (request === latestLoad.current) {
            setCatalog(data);
            setError('');
          }
        },
        (error_: Error) => {
          if (request === latestLoad.current) {
            setError(error_.message);
          }
        },
      );
  };
  useEffect(() => void load(), []);
  // A sync fills the catalog one product at a time, so show it growing.
  useEffect(() => {
    const timer = catalog?.syncing ? setTimeout(() => void load(), 2000) : undefined;
    return () => clearTimeout(timer);
  }, [catalog]);

  const loadError = error && (
    <div>
      <Text role="alert">{error}</Text> <Button onClick={() => void load()}>Retry loading catalog</Button>
    </div>
  );
  if (error && !catalog) {
    return loadError;
  }
  if (!catalog) {
    return null;
  }

  const sync = () =>
    api('Could not refresh the catalog', '/api/filaments/sync', {method: 'POST'})
      .then(load)
      .catch((error_: Error) => setError(error_.message));
  async function save(f: Filament, delta: number) {
    const {id} = f;
    targets.current.set(id, Math.max(0, Math.min(9999, (targets.current.get(id) ?? f.onHand) + delta)));
    setPending(new Map(targets.current));
    if (writing.current.has(id)) {
      return;
    }
    writing.current.add(id);
    try {
      for (;;) {
        const onHand = targets.current.get(id)!;
        await api(`Could not save ${f.product} ${f.color}`, `/api/filaments/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({onHand}),
        });
        if (onHand !== targets.current.get(id)) {
          continue;
        }
        await load();
        if (onHand !== targets.current.get(id)) {
          continue;
        }
        targets.current.delete(id);
        setPending(new Map(targets.current));
        setCatalog((c) => c && {...c, filaments: c.filaments.map((row) => (row.id === id ? {...row, onHand} : row))});
        setSaved(`Saved: ${f.product} ${f.color}, ${count(onHand, 'spool')} on hand.`);
        setSaveErrors((prev) => ({...prev, [id]: ''}));
        break;
      }
    } catch (error_) {
      setSaveErrors((prev) => ({...prev, [id]: (error_ as Error).message}));
    } finally {
      writing.current.delete(id);
    }
  }

  function filterBy(value: string) {
    setProduct(value);
    setQuery('');
    setInStock(false);
  }

  // The last complete sync did not list it: the shop dropped it, so its prices are stale.
  const listed = (f: Filament) => f.seen >= (catalog.synced ?? 0);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = catalog.filaments.filter((f) => {
    const text = `${f.product} ${f.color} ${f.code}`.toLowerCase();
    return (
      (view === 'mine' ? f.onHand > 0 : listed(f) || f.onHand > 0) &&
      (product === 'all' || f.product === product) &&
      (!inStock || (listed(f) && f.offers.some((o) => o.inStock))) &&
      words.every((w) => text.includes(w))
    );
  });
  const products = [...new Set(catalog.filaments.map((f) => f.product))].sort();
  const spools = catalog.filaments.reduce((n, f) => n + f.onHand, 0);

  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Filament</PageHeader.Title>
          <PageHeader.Actions>
            {catalog.filaments.length > 0 && (
              <Button
                hierarchy="secondary"
                iconStart={<RefreshIcon />}
                pending={catalog.syncing}
                onClick={() => void sync()}
              >
                Refresh catalog
              </Button>
            )}
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>
          Colours and prices from the Bambu Lab EU shop, and the spools you have. Buying opens the shop’s own page.
        </PageHeader.Description>
      </PageHeader.Root>

      <details>
        <summary>Choosing a filament: uses, nozzle sizes and printer setup</summary>
        <p>
          Start with what the part needs to do. Nozzle size below means the diameter of the nozzle opening, not the
          thickness of the filament. These are starting points for the named Bambu products, not slicer presets.
        </p>
        <dl>
          {guides.map((g) => (
            <div key={g.name}>
              <dt>
                <a href={g.url}>{g.name}</a> · {g.use}
              </dt>
              <dd>
                {g.tip}{' '}
                {products.includes(g.name) && (
                  <Button
                    hierarchy="secondary"
                    density="compact"
                    onClick={() => {
                      filterBy(g.name);
                      setView('catalog');
                      results.current?.focus();
                    }}
                  >
                    Show {g.name} in catalog
                  </Button>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Follow the linked product’s guide for nozzle and bed temperatures, drying times and compatible build plates.
          Filled, flexible and high-flow variants can differ even within one filament family.
        </p>
      </details>

      {loadError}
      <span role="status">{saved}</span>
      {Object.entries(saveErrors).map(([id, message]) => {
        const f = catalog.filaments.find((row) => row.id === id);
        return (
          message &&
          f && (
            <div key={id}>
              <Text role="alert">{message}</Text>{' '}
              <Button onClick={() => void save(f, 0)}>
                Retry saving {f.product} {f.color}
              </Button>
            </div>
          )
        );
      })}
      {catalog.error && (
        <Text className="negative" role="alert">
          The catalog could not be refreshed: {catalog.error}
        </Text>
      )}
      {catalog.syncing ? (
        <Text className="muted" role="status">
          Reading the shop: {count(catalog.found ?? 0, 'colour')} found so far.
        </Text>
      ) : catalog.synced ? (
        <Text className="muted">
          Updated {new Date(catalog.synced).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}.
          Refreshed daily while Brim runs.
        </Text>
      ) : null}

      {catalog.filaments.length === 0 ? (
        catalog.syncing ? null : (
          <EmptyState.Root>
            <EmptyState.Illustration>
              <ShelvesIcon size={48} />
            </EmptyState.Illustration>
            <EmptyState.Body>
              <EmptyState.Copy>
                <EmptyState.Title level={2}>No catalog yet</EmptyState.Title>
                <EmptyState.Description>
                  Load every filament the Bambu Lab EU shop sells, with colours, prices and stock. Brim reads the shop’s
                  pages slowly, so this takes about four minutes.
                </EmptyState.Description>
              </EmptyState.Copy>
              <EmptyState.Actions>
                <Button iconStart={<RefreshIcon />} onClick={() => void sync()}>
                  Load catalog
                </Button>
              </EmptyState.Actions>
            </EmptyState.Body>
          </EmptyState.Root>
        )
      ) : (
        <>
          <Stack direction="row" gap="medium" align="center" className="filament-filters">
            <SegmentedControl.Root
              aria-label="Show"
              value={[view]}
              onValueChange={(v) => v[0] && setView(v[0] as typeof view)}
            >
              <SegmentedControl.Item value="catalog">Catalog</SegmentedControl.Item>
              <SegmentedControl.Item value="mine">My spools ({spools})</SegmentedControl.Item>
            </SegmentedControl.Root>
            <Search
              aria-label="Search filaments"
              placeholder="Search colour, product or code"
              value={query}
              onValueChange={(v) => setQuery(v)}
            />
            <Dropdown.Root value={product} onValueChange={(v) => setProduct(v as string)}>
              <Dropdown.Trigger aria-label="Product">
                <Dropdown.Value>{(v: string) => (v === 'all' ? 'All products' : v)}</Dropdown.Value>
                <Dropdown.Icon />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Positioner>
                  <Dropdown.Popup>
                    <Dropdown.List>
                      <Dropdown.Item value="all">All products</Dropdown.Item>
                      {products.map((p) => (
                        <Dropdown.Item key={p} value={p}>
                          {p}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.List>
                  </Dropdown.Popup>
                </Dropdown.Positioner>
              </Dropdown.Portal>
            </Dropdown.Root>
            <SelectionControlAndLabel
              control={
                <Checkbox.Root checked={inStock} onCheckedChange={(c) => setInStock(c)}>
                  <Checkbox.Indicator />
                </Checkbox.Root>
              }
            >
              In stock
            </SelectionControlAndLabel>
          </Stack>

          <div>
            <p ref={results} tabIndex={-1} aria-live="polite">
              {[
                count(shown.length, 'colour'),
                product !== 'all' && product,
                query.trim() && `“${query.trim()}”`,
                inStock && 'In stock',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {(product !== 'all' || query || inStock) && (
              <Button
                onClick={() => {
                  filterBy('all');
                  results.current?.focus();
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
          {shown.length === 0 ? (
            <Text className="muted">
              {view === 'mine' && !spools
                ? 'No spools yet. Find a filament in the catalog and press + for each spool you have.'
                : view === 'mine'
                  ? 'None of your spools match these filters.'
                  : 'No colours match these filters.'}
            </Text>
          ) : (
            <ul className="gallery filaments">
              {shown.map((f) => {
                const name = `${f.product} ${f.color}`;
                const guide = guides.find((g) => g.name === f.product);
                return (
                  <li key={f.id} className="filament">
                    {f.image ? <img src={f.image} alt="" loading="lazy" /> : <div className="gallery-empty" />}
                    <Stack direction="row" gap="small" align="center">
                      {f.swatch && <img className="swatch" src={f.swatch} alt="" loading="lazy" />}
                      <Heading level={2} size={5}>
                        {f.color}
                      </Heading>
                    </Stack>
                    <Text className="muted">
                      {f.product} · {f.code}
                    </Text>
                    {guide && (
                      <details>
                        <summary>{guide.name} nozzle and setup guide</summary>
                        <p>{guide.tip}</p>
                        <a href={guide.url}>Manufacturer’s guide</a>
                      </details>
                    )}
                    {listed(f) ? (
                      f.offers.map((o) => (
                        <ButtonLink
                          key={o.url}
                          href={o.url}
                          target="_blank"
                          rel="noreferrer"
                          hierarchy="secondary"
                          density="compact"
                          iconEnd={<OpenInNewIcon />}
                          aria-label={`Buy ${name}, ${o.label}, ${money(o.price, o.currency)}${o.inStock ? '' : ', out of stock'}`}
                        >
                          {o.label} · {money(o.price, o.currency)}
                          {o.inStock ? '' : ' · out of stock'}
                        </ButtonLink>
                      ))
                    ) : (
                      <Text className="muted">No longer in the shop.</Text>
                    )}
                    <Stack direction="row" gap="xSmall" align="center">
                      <IconButton
                        aria-label={`One spool fewer of ${name}`}
                        aria-disabled={!(pending.get(f.id) ?? f.onHand)}
                        onClick={() => (targets.current.get(f.id) ?? f.onHand) > 0 && void save(f, -1)}
                      >
                        <RemoveIcon />
                      </IconButton>
                      <Text>{f.onHand ? `${count(f.onHand, 'spool')} on hand` : 'None on hand'}</Text>
                      <IconButton
                        aria-label={`One spool more of ${name}`}
                        aria-disabled={(pending.get(f.id) ?? f.onHand) >= 9999}
                        onClick={() => (targets.current.get(f.id) ?? f.onHand) < 9999 && void save(f, 1)}
                      >
                        <AddIcon />
                      </IconButton>
                    </Stack>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Stack>
  );
}
