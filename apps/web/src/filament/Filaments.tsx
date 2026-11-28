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
import {useEffect, useState} from 'react';
import {count} from '../lib/library.ts';
import {api} from '../lib/server.ts';
import {AddIcon, OpenInNewIcon, RefreshIcon, RemoveIcon, ShelvesIcon} from '../ui/icons.ts';

const money = (price: number, currency: string) =>
  new Intl.NumberFormat(undefined, {style: 'currency', currency}).format(price);
const report = (error_: Error) => alert(error_.message);

/** The filament catalog and the spools on hand (docs/domain.md: Filament). Needs the dev server; without it, says so. */
export function Filaments() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState('');
  const [view, setView] = useState<'catalog' | 'mine'>('catalog');
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState('all');
  const [inStock, setInStock] = useState(false);

  const load = () =>
    api('Could not load filaments', '/api/filaments')
      .then((r) => r.json())
      .then(setCatalog, (error_: Error) => setError(error_.message));
  useEffect(() => void load(), []);
  // A sync fills the catalog one product at a time, so show it growing.
  useEffect(() => {
    const timer = catalog?.syncing ? setTimeout(() => void load(), 2000) : undefined;
    return () => clearTimeout(timer);
  }, [catalog]);

  if (error) {
    return <Text className="muted">{error}</Text>;
  }
  if (!catalog) {
    return null;
  }

  const sync = () =>
    api('Could not refresh the catalog', '/api/filaments/sync', {method: 'POST'}).then(load).catch(report);
  const setOnHand = (f: Filament, onHand: number) =>
    api(`Could not save ${f.color}`, `/api/filaments/${encodeURIComponent(f.id)}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({onHand}),
    })
      .then(load)
      .catch(report);

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

      {catalog.error && (
        <Text className="negative" role="alert">
          The catalog could not be refreshed: {catalog.error}
        </Text>
      )}
      {catalog.syncing ? (
        <Text className="muted" role="status">
          Reading the shop, which takes about four minutes. Filaments appear here as they are read.
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

          {shown.length === 0 ? (
            <Text className="muted">
              {view === 'mine' && !spools
                ? 'No spools yet. Find a filament in the catalog and press + for each spool you have.'
                : 'No filament matches.'}
            </Text>
          ) : (
            <ul className="gallery filaments">
              {shown.map((f) => {
                const name = `${f.product} ${f.color}`;
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
                        disabled={!f.onHand}
                        onClick={() => void setOnHand(f, f.onHand - 1)}
                      >
                        <RemoveIcon />
                      </IconButton>
                      <Text>{f.onHand ? `${count(f.onHand, 'spool')} on hand` : 'None on hand'}</Text>
                      <IconButton
                        aria-label={`One spool more of ${name}`}
                        onClick={() => void setOnHand(f, f.onHand + 1)}
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
