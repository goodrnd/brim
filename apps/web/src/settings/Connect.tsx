import {Button, Field, Heading, Input, Modal, Stack, Table, Text} from '@earendil-works/elanor-react';
import {useEffect, useState} from 'react';
import {bambuModels, type BambuModel, type Printer} from '@brim/core/slicer.ts';
import type {discover, Found, Frame} from '@brim/printer/bambu.ts';

type Discovery = Awaited<ReturnType<typeof discover>>;
/** counterpart_print_progress and get_printer_filaments, the fields shown here. */
type Live = {
  progress: {
    state: string;
    job?: {name?: string; progress?: number; layer?: number; totalLayers?: number};
    temps?: {nozzle?: {actual: number}; bed?: {actual: number}};
    problems: Array<{message: string}>;
  };
  filaments?: {trays?: Array<{slot: number; loaded?: boolean; tray_type?: string; tray_color?: string}>};
};

const error = async (r: Response) =>
  ((await r.json().catch(() => null)) as {error?: string} | null)?.error ?? r.statusText;

/** Live status of one connected printer, polled; never stored (docs/domain.md). */
export function useLive(serial: string | undefined, connected: number) {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    if (!serial) {
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    // Next poll after this one returns: an unreachable printer takes ~8 s to answer.
    const poll = async () => {
      const r = await fetch(`/api/printers/${serial}`).catch(() => null);
      const next = r?.ok ? await r.json() : null;
      if (!stop) {
        setLive(next);
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => ((stop = true), clearTimeout(timer));
  }, [serial, connected]);
  return live;
}

export function liveSummary(live: Live | null) {
  if (!live) {
    return 'Not connected';
  }
  const {state, job, temps, problems} = live.progress;
  return [
    state,
    job?.progress != null && `${job.progress}%`,
    job?.layer != null && `layer ${job.layer}/${job.totalLayers ?? '?'}`,
    temps?.nozzle && `nozzle ${Math.round(temps.nozzle.actual)} °C`,
    temps?.bed && `bed ${Math.round(temps.bed.actual)} °C`,
    ...problems.map((p) => p.message),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function Spools({live}: {live: Live | null}) {
  const trays = live?.filaments?.trays?.filter((t) => t.loaded !== false && t.tray_type) ?? [];
  return trays.length ? (
    <Text className="muted">
      {trays.map((t) => (
        <span key={t.slot} className="spool">
          <span className="swatch" style={{background: `#${(t.tray_color ?? '888888').slice(0, 6)}`}} />
          {t.slot}: {t.tray_type}
        </span>
      ))}
    </Text>
  ) : null;
}

/** The printer's chamber camera as a long-polled JPEG stream; nothing when it has none or is not connected. */
export function Camera({serial, name}: {serial: string; name: string}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      let seq = 0;
      while (!abort.signal.aborted) {
        const r = await fetch(`/api/printers/${serial}/camera?since=${seq}`, {signal: abort.signal}).catch(() => null);
        const frame = r?.ok ? ((await r.json().catch(() => null)) as Frame | null) : null;
        if (frame?.status === 'frame' && frame.base64) {
          seq = frame.seq;
          setSrc(`data:image/jpeg;base64,${frame.base64}`);
        } else if (frame?.status !== 'unchanged') {
          // Not connected, no camera or an error: drop the stale picture and retry slowly.
          if (!abort.signal.aborted) {
            setSrc('');
          }
          seq = 0;
          await new Promise((done) => setTimeout(done, 5000));
        }
      }
    })();
    return () => abort.abort();
  }, [serial]);
  return src ? <img className="camera" src={src} alt={`${name} camera`} /> : null;
}

/**
 * Settings → Find printers: lists Bambu printers announcing on the LAN; connecting one asks for its access code and
 * creates or updates the Brim Printer with that serial. The code goes to the daemon only.
 */
export function BambuPrinters({
  printers,
  onConnected,
}: {
  printers: Record<string, Printer>;
  onConnected: (found: Found & {model: BambuModel}) => void;
}) {
  // Bumped on connect so status rows re-poll at once.
  const [connected, setConnected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Discovery | null>(null);
  const [problem, setProblem] = useState('');
  const [target, setTarget] = useState<Found | null>(null);

  const find = async () => {
    setBusy(true);
    setProblem('');
    const r = await fetch('/api/printers/discover').catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      return setProblem(r ? await error(r) : 'The Brim server is not running.');
    }
    setFound(await r.json());
  };
  const known = (serial: string) => Object.values(printers).find((p) => p.serial === serial)?.name;

  return (
    <Stack gap="small" align="stretch">
      <Stack direction="row" gap="auto" align="center">
        <Heading level={2} size={5}>
          Bambu printers on this network
        </Heading>
        <Button hierarchy="secondary" density="compact" disabled={busy} onClick={find}>
          {busy ? 'Looking…' : 'Find printers'}
        </Button>
      </Stack>
      {problem && <Text>{problem}</Text>}
      {found?.network === 'unavailable' && (
        <Text>Another app holds the discovery port (UDP 2021). Close Bambu Studio and try again.</Text>
      )}
      {found?.network === 'complete' && !found.printers.length && (
        <Text className="muted">No printers answered. Check the printer is on and on the same network.</Text>
      )}
      {!!found?.printers.length && (
        <Table.Container>
          <Table.Root aria-label="Printers found">
            <Table.Head>
              <Table.Row>
                {['Name', 'Model', 'Serial', 'Address'].map((c) => (
                  <Table.HeaderCell key={c} scope="col">
                    {c}
                  </Table.HeaderCell>
                ))}
                <Table.HeaderCell scope="col">
                  <span hidden>Actions</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {found.printers.map((p) => (
                <Table.Row key={`${p.serial}@${p.host}`}>
                  <Table.Cell>
                    {p.name}
                    {known(p.serial) && <Text className="muted"> · {known(p.serial)}</Text>}
                  </Table.Cell>
                  <Table.Cell>{p.model ? bambuModels[p.model as BambuModel] : 'Unsupported'}</Table.Cell>
                  <Table.Cell>{p.serial}</Table.Cell>
                  <Table.Cell>{p.host}</Table.Cell>
                  <Table.Cell align="end">
                    <Button density="compact" disabled={!p.model} onClick={() => setTarget(p)}>
                      Connect
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.Container>
      )}
      {target && (
        <AccessCode
          printer={target}
          onClose={() => setTarget(null)}
          onConnected={() => (
            onConnected({...target, model: target.model as BambuModel}),
            setTarget(null),
            setConnected((n) => n + 1)
          )}
        />
      )}
      {Object.entries(printers)
        .filter(([, p]) => p.serial && p.bambuModel)
        .map(([k, p]) => (
          <Status key={k} printer={p} connected={connected} />
        ))}
    </Stack>
  );
}

function Status({printer, connected}: {printer: Printer; connected: number}) {
  const live = useLive(printer.serial, connected);
  return (
    <Stack gap="xSmall" align="stretch">
      <Text>
        <strong>{printer.name}</strong> <Text className="muted">· {liveSummary(live)}</Text>
      </Text>
      <Spools live={live} />
    </Stack>
  );
}

function AccessCode({printer, onClose, onConnected}: {printer: Found; onClose: () => void; onConnected: () => void}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const submit = async () => {
    setBusy(true);
    setProblem('');
    const r = await fetch(`/api/printers/${printer.serial}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({host: printer.host, model: printer.model, token: token.trim()}),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      return onConnected();
    }
    setProblem(r ? await error(r) : 'The Brim server is not running.');
  };
  return (
    <Modal.Root open onOpenChange={(o) => !o && onClose()}>
      <Modal.Portal>
        <Modal.Backdrop />
        <Modal.Viewport>
          <Modal.Popup>
            <Modal.Title>Connect {printer.name}</Modal.Title>
            <Modal.Body>
              <form id="access-code" onSubmit={(e) => (e.preventDefault(), submit())}>
                <Field.Root name="token" invalid={!!problem}>
                  <Field.Label>Access code</Field.Label>
                  <Input type="password" autoComplete="off" autoFocus value={token} onValueChange={setToken} />
                  <Field.Description>
                    On the printer: Settings → Network (LAN only). Brim keeps it on the server until it restarts.
                  </Field.Description>
                  {problem && <Field.Error match>{problem}</Field.Error>}
                </Field.Root>
              </form>
            </Modal.Body>
            <Modal.Actions>
              <Modal.Close render={<Button hierarchy="secondary" />}>Cancel</Modal.Close>
              <Button type="submit" form="access-code" disabled={busy || !token.trim()}>
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
            </Modal.Actions>
          </Modal.Popup>
        </Modal.Viewport>
      </Modal.Portal>
    </Modal.Root>
  );
}
