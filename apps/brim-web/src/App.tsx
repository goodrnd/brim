import {
  Button,
  Card,
  Checkbox,
  CodeSnippet,
  CopyButton,
  Dropdown,
  EmptyState,
  Field,
  Grid,
  Heading,
  IconButton,
  InlineCode,
  KeyboardKey,
  KeyValue,
  Meter,
  Modal,
  PageHeader,
  SegmentedControl,
  SelectionControlAndLabel,
  SideNavigation,
  Sidebar,
  Stack,
  Table,
  Tabs,
  Text,
  TextArea,
  Tooltip,
  TopNavigation,
} from '@earendil-works/elanor-react';
import radiusCss from '@earendil-works/design-tokens/radius.css?url';
import elanorCss from '@earendil-works/design-tokens/elanor.css?url';
import lefosCss from '@earendil-works/design-tokens/lefos.css?url';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import * as I from './icons.ts';
import {LayerPreview} from './LayerPreview.tsx';
import {bounds, buildPositions, describe, editMesh, parsePrompt, toStl, volume, type Model} from './model.ts';
import {materials, printers, slice, type SliceResult, type SliceSettings} from './slicer.ts';
import {parseStl, Viewer} from './Viewer.tsx';

const examples = [
  'twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs',
  'gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole',
  'box 80 x 50 x 30 with 2mm walls and 6mm corners',
  'keychain tag 50 x 20 x 3 with a hole',
  '5 point star 60 wide, 6 thick',
  'planter 90 wide 80 tall tapered',
];
const tweaks = ['make it taller', 'thicker walls', 'more ribs', 'twist it more', 'scale to 80%', 'add a hole', 'low poly', 'no twist'];

interface Entry {
  prompt: string;
  changes: string[];
  model: Model;
}

// Stock Elanor token sets; pi and earendil are currently identical to radius, so they are left out.
const themes = {'1': radiusCss, '2': elanorCss, '3': lefosCss} as const;
type Theme = keyof typeof themes;
type Scheme = 'light' | 'dark';
const saved = <T extends string>(key: string, ok: readonly T[], fallback: T): T => {
  const v = localStorage.getItem(key) as T | null;
  return v && ok.includes(v) ? v : fallback;
};

/** Swaps the token stylesheet and colour scheme; returns a key that changes once the new tokens apply. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => saved('brim-theme', Object.keys(themes) as Theme[], '1'));
  const [scheme, setScheme] = useState<Scheme>(() =>
    saved('brim-scheme', ['light', 'dark'], matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const link = document.getElementById('theme-tokens') as HTMLLinkElement;
    const done = () => {
      document.documentElement.dataset.ready = '';
      setApplied(`${theme}-${scheme}`);
    };
    document.documentElement.dataset.colorScheme = scheme;
    localStorage.setItem('brim-theme', theme);
    localStorage.setItem('brim-scheme', scheme);
    if (link.getAttribute('href') === themes[theme]) return done();
    link.addEventListener('load', done, {once: true});
    link.href = themes[theme];
    return () => link.removeEventListener('load', done);
  }, [theme, scheme]);
  return {theme, setTheme, scheme, setScheme, applied};
}

/** Shows or hides the header and sidebar borders; remembered across visits. */
function useBorders() {
  const [borders, setBorders] = useState(() => localStorage.getItem('brim-borders') !== 'off');
  useEffect(() => {
    document.documentElement.dataset.borders = borders ? 'on' : 'off';
    localStorage.setItem('brim-borders', borders ? 'on' : 'off');
  }, [borders]);
  return [borders, setBorders] as const;
}

const download = (data: BlobPart, name: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], {type}));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
const slug = (m: Model) => (m.type === 'mesh' ? m.name : m.spec.kind + '-' + Math.round(m.spec.width) + 'mm');
const hms = (s: number) => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;

export function App() {
  const {theme, setTheme, scheme, setScheme, applied} = useTheme();
  const [borders, setBorders] = useBorders();
  const [history, setHistory] = useState<Entry[]>(() => {
    const prompt = examples[0];
    const {spec, changes} = parsePrompt(prompt);
    return [{prompt, changes, model: {type: 'param', spec}}];
  });
  const [tab, setTab] = useState('design');
  const [settings, setSettings] = useState<SliceSettings>({printer: 'mk4', material: 'pla', layer: 0.2, infill: 15, speed: 60, vase: false});
  const current = history[history.length - 1];
  const positions = useMemo(
    () => (current.model.type === 'param' ? buildPositions(current.model.spec) : current.model.positions),
    [current],
  );
  const printer = printers[settings.printer];

  const generate = (prompt: string) => {
    const {spec, changes} = parsePrompt(prompt);
    setHistory((h) => [...h, {prompt, changes, model: {type: 'param', spec}}]);
  };
  const refine = (prompt: string) => {
    const m = current.model;
    if (m.type === 'param') {
      const {spec, changes} = parsePrompt(prompt, m.spec);
      setHistory((h) => [...h, {prompt, changes: changes.length ? changes : ['nothing I understood, so no change'], model: {type: 'param', spec}}]);
    } else {
      const {positions: p, changes} = editMesh(prompt, m.positions);
      setHistory((h) => [...h, {prompt, changes: changes.length ? changes : ['imported meshes support scale, taller, wider, flip and rotate'], model: {...m, positions: p}}]);
    }
  };
  const upload = async (file: File) => {
    try {
      const p = parseStl(await file.arrayBuffer());
      const {positions: fixed} = editMesh('', p);
      setHistory((h) => [...h, {prompt: `Imported ${file.name}`, changes: [`${fixed.length / 9} triangles`], model: {type: 'mesh', name: file.name.replace(/\.stl$/i, ''), positions: fixed}}]);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <>
      <TopNavigation.Root className="header">
        <TopNavigation.Identity>
          <Stack direction="row" gap="small" align="center">
            <I.ViewInArIcon size={24} />
            <Text render={<strong />}>Brim</Text>
          </Stack>
        </TopNavigation.Identity>
        <TopNavigation.Actions>
          <SegmentedControl.Root aria-label="Theme" density="compact" value={[theme]} onValueChange={(v) => v[0] && setTheme(v[0] as Theme)}>
            {Object.keys(themes).map((t) => (
              <SegmentedControl.Item key={t} value={t}>{t}</SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={<TopNavigation.ActionButton aria-label="Show borders" aria-pressed={borders} />}
              onClick={() => setBorders(!borders)}
            >
              {borders ? <I.BorderOuterIcon /> : <I.BorderClearIcon />}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>{borders ? 'Hide borders' : 'Show borders'}</Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={<TopNavigation.ActionButton aria-label={scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} />}
              onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}
            >
              {scheme === 'dark' ? <I.LightModeIcon /> : <I.DarkModeIcon />}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>{scheme === 'dark' ? 'Light mode' : 'Dark mode'}</Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </TopNavigation.Actions>
      </TopNavigation.Root>

      <div style={{display: 'flex'}}>
        <Sidebar.Root className="sidebar" render={<aside aria-label="Workspace sidebar" />}>
          {({collapsed}) => (
            <>
              <Sidebar.Header><Sidebar.Trigger /></Sidebar.Header>
              <Sidebar.Content>
                <SideNavigation.Root aria-label="Workflow" variant={collapsed ? 'compact' : 'default'}>
                  <SideNavigation.Group>
                    <SideNavigation.GroupLabel>Workflow</SideNavigation.GroupLabel>
                    <SideNavigation.List>
                      {([['design', '1 · Design', <I.AutoFixHighIcon />], ['refine', '2 · Refine', <I.TuneIcon />], ['print', '3 · Print files', <I.PrintIcon />]] as const).map(([v, label, icon]) => (
                        <SideNavigation.Item key={v}>
                          <SideNavigation.Link href="#" iconStart={icon} active={tab === v} onClick={(e) => (e.preventDefault(), setTab(v))}>{label}</SideNavigation.Link>
                        </SideNavigation.Item>
                      ))}
                    </SideNavigation.List>
                  </SideNavigation.Group>
                </SideNavigation.Root>
              </Sidebar.Content>
              <Sidebar.Footer>
                <SideNavigation.Root aria-label="Printer" variant={collapsed ? 'compact' : 'default'}>
                  <SideNavigation.List>
                    <SideNavigation.Item>
                      <SideNavigation.Link href="#" iconStart={<I.PrintIcon />} onClick={(e) => (e.preventDefault(), setTab('print'))}>{printer.name}</SideNavigation.Link>
                    </SideNavigation.Item>
                  </SideNavigation.List>
                </SideNavigation.Root>
              </Sidebar.Footer>
            </>
          )}
        </Sidebar.Root>

        <main className="main">
          <Stack gap="xLarge" align="stretch">
            <PageHeader.Root>
              <PageHeader.Row>
                <PageHeader.Title level={1}>{current.model.type === 'mesh' ? current.model.name : 'Untitled ' + current.model.spec.kind}</PageHeader.Title>
                <PageHeader.Actions>
                  <UploadButton onFile={upload} />
                  <Button hierarchy="secondary" iconStart={<I.DownloadIcon />} onClick={() => download(toStl(positions), slug(current.model) + '.stl', 'model/stl')}>STL</Button>
                  <Button iconStart={<I.PrintIcon />} onClick={() => setTab('print')}>Prepare print</Button>
                </PageHeader.Actions>
              </PageHeader.Row>
              <PageHeader.Description>
                {current.model.type === 'param' ? describe(current.model.spec) : 'Imported mesh'}
              </PageHeader.Description>
            </PageHeader.Root>

            <Grid.Root>
              <Grid.Item span={{base: 'full', medium: 7}}>
                <Stack gap="medium" align="stretch">
                  <Viewer positions={positions} bed={[printer.bed[0], printer.bed[1]]} theme={applied} />
                  <ModelStats positions={positions} bed={printer.bed} />
                </Stack>
              </Grid.Item>
              <Grid.Item span={{base: 'full', medium: 5}}>
                <Tabs.Root value={tab} onValueChange={(v) => setTab(v as string)}>
                  <Tabs.List aria-label="Workflow">
                    <Tabs.Tab value="design">Design</Tabs.Tab>
                    <Tabs.Tab value="refine">Refine</Tabs.Tab>
                    <Tabs.Tab value="print">Print files</Tabs.Tab>
                    <Tabs.Indicator />
                  </Tabs.List>
                  <Tabs.Panel value="design" className="panel">
                    <PromptBox
                      key="design"
                      label="Describe the part"
                      placeholder="e.g. hex nut 20 wide 8 thick with a 10mm hole"
                      action="Generate STL"
                      icon={<I.AutoFixHighIcon />}
                      chips={examples}
                      onSubmit={(p) => (generate(p), setTab('refine'))}
                    />
                  </Tabs.Panel>
                  <Tabs.Panel value="refine" className="panel">
                    <Stack gap="large" align="stretch">
                      <PromptBox
                        key="refine"
                        label="What should change?"
                        placeholder="e.g. 20% bigger, thicker walls, add a 3mm hole"
                        action="Improve"
                        icon={<I.TuneIcon />}
                        chips={tweaks}
                        onSubmit={refine}
                      />
                      <History history={history} onUndo={() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))} />
                    </Stack>
                  </Tabs.Panel>
                  <Tabs.Panel value="print" className="panel">
                    <PrintPanel theme={applied} positions={positions} settings={settings} setSettings={setSettings} name={slug(current.model)} />
                  </Tabs.Panel>
                </Tabs.Root>
              </Grid.Item>
            </Grid.Root>
          </Stack>
        </main>
      </div>
    </>
  );
}

function UploadButton({onFile}: {onFile: (f: File) => void}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept=".stl" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <Button hierarchy="secondary" iconStart={<I.UploadFileIcon />} onClick={() => input.current?.click()}>Import STL</Button>
    </>
  );
}

function PromptBox(props: {label: string; placeholder: string; action: string; icon: ReactNode; chips: string[]; onSubmit: (p: string) => void}) {
  const [value, setValue] = useState('');
  const submit = (p: string) => p.trim() && (props.onSubmit(p.trim()), setValue(''));
  return (
    <Stack gap="medium" align="stretch">
      <Field.Root name="prompt">
        <Field.Label>{props.label}</Field.Label>
        <TextArea
          value={value}
          placeholder={props.placeholder}
          onValueChange={(v) => setValue(v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(value);
          }}
        />
        <Field.Description>
          Sizes in mm (cm and in work too). <KeyboardKey>⌘</KeyboardKey><KeyboardKey>↵</KeyboardKey> to submit.
        </Field.Description>
      </Field.Root>
      <Stack direction="row" gap="small">
        <Button iconStart={props.icon} disabled={!value.trim()} onClick={() => submit(value)}>{props.action}</Button>
      </Stack>
      <Stack direction="row" gap="xSmall" wrap="wrap">
        {props.chips.map((c) => (
          <Button key={c} hierarchy="secondary" density="compact" onClick={() => submit(c)}>{c}</Button>
        ))}
      </Stack>
    </Stack>
  );
}

function History({history, onUndo}: {history: Entry[]; onUndo: () => void}) {
  return (
    <Stack gap="small" align="stretch">
      <Stack direction="row" gap="auto" align="center">
        <Heading level={2} size={5}>History</Heading>
        <Button hierarchy="secondary" density="compact" iconStart={<I.UndoIcon />} disabled={history.length < 2} onClick={onUndo}>Undo</Button>
      </Stack>
      <ol className="history">
        {history.slice().reverse().map((h, i) => (
          <li key={history.length - i}>
            <Text><InlineCode>{h.prompt}</InlineCode></Text>
            <Text className="muted">{h.changes.join(' · ')}</Text>
          </li>
        ))}
      </ol>
    </Stack>
  );
}

function ModelStats({positions, bed}: {positions: Float32Array; bed: [number, number, number]}) {
  const [min, max] = bounds(positions);
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  const fits = size.every((v, k) => v <= bed[k]);
  return (
    <Grid.Root>
      <Grid.Item span={{base: 6, medium: 3}}><Card label="Size (mm)" value={size.map((v) => v.toFixed(0)).join(' × ')} description={fits ? 'Fits the bed' : 'Too big for the bed'} /></Grid.Item>
      <Grid.Item span={{base: 6, medium: 3}}><Card label="Volume" value={`${(Math.abs(volume(positions)) / 1000).toFixed(1)} cm³`} description="Solid model" /></Grid.Item>
      <Grid.Item span={{base: 6, medium: 3}}><Card label="Triangles" value={(positions.length / 9).toLocaleString()} description="Binary STL" /></Grid.Item>
      <Grid.Item span={{base: 6, medium: 3}}><Card label="STL size" value={`${((84 + (positions.length / 9) * 50) / 1024).toFixed(0)} KB`} description="Download from the header" /></Grid.Item>
    </Grid.Root>
  );
}

function PrintPanel({theme, positions, settings, setSettings, name}: {theme: string; positions: Float32Array; settings: SliceSettings; setSettings: (s: SliceSettings) => void; name: string}) {
  const [result, setResult] = useState<SliceResult | null>(null);
  const [layer, setLayer] = useState(0);
  const set = <K extends keyof SliceSettings>(k: K, v: SliceSettings[K]) => (setSettings({...settings, [k]: v}), setResult(null));
  useEffect(() => setResult(null), [positions]);
  const [min, max] = bounds(positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1]);
  const bed = printers[settings.printer].bed;
  const tooBig = max[0] - min[0] > bed[0] || max[1] - min[1] > bed[1] || max[2] - min[2] > bed[2];

  const pick = (label: string, key: 'printer' | 'material', options: Record<string, {name: string}>) => (
    <Dropdown.Root value={settings[key]} onValueChange={(v) => set(key, v as string)}>
      <Stack gap="xSmall" align="stretch">
        <Dropdown.Label>{label}</Dropdown.Label>
        <Dropdown.Trigger>
          <Dropdown.Value>{(v: string) => options[v].name}</Dropdown.Value>
          <Dropdown.Icon />
        </Dropdown.Trigger>
      </Stack>
      <Dropdown.Portal>
        <Dropdown.Positioner>
          <Dropdown.Popup>
            <Dropdown.List>
              {Object.entries(options).map(([k, o]) => <Dropdown.Item key={k} value={k}>{o.name}</Dropdown.Item>)}
            </Dropdown.List>
          </Dropdown.Popup>
        </Dropdown.Positioner>
      </Dropdown.Portal>
    </Dropdown.Root>
  );

  return (
    <Stack gap="large" align="stretch">
      <Grid.Root>
        <Grid.Item span={6}>{pick('Printer', 'printer', printers)}</Grid.Item>
        <Grid.Item span={6}>{pick('Material', 'material', materials)}</Grid.Item>
      </Grid.Root>
      <Stack gap="xSmall">
        <Text>Layer height</Text>
        <SegmentedControl.Root aria-label="Layer height" value={[String(settings.layer)]} onValueChange={(v) => v[0] && set('layer', Number(v[0]))}>
          {['0.12', '0.2', '0.28'].map((l) => <SegmentedControl.Item key={l} value={l}>{l} mm</SegmentedControl.Item>)}
        </SegmentedControl.Root>
      </Stack>
      <Stack gap="xSmall">
        <Text>Infill</Text>
        <SegmentedControl.Root aria-label="Infill" value={[String(settings.infill)]} onValueChange={(v) => v[0] && set('infill', Number(v[0]))}>
          {['0', '15', '30', '60'].map((l) => <SegmentedControl.Item key={l} value={l}>{l}%</SegmentedControl.Item>)}
        </SegmentedControl.Root>
      </Stack>
      <SelectionControlAndLabel control={<Checkbox.Root checked={settings.vase} onCheckedChange={(c) => set('vase', c)}><Checkbox.Indicator /></Checkbox.Root>}>
        Spiral vase mode (single wall, continuous Z)
      </SelectionControlAndLabel>
      <Stack direction="row" gap="small" align="center">
        <Button iconStart={<I.LayersIcon />} disabled={tooBig} onClick={() => { const r = slice(positions, settings); setResult(r); setLayer(Math.floor(r.layers.length / 2)); }}>
          Slice
        </Button>
        {tooBig && <Text className="negative">Model is larger than the {printers[settings.printer].name} bed.</Text>}
      </Stack>

      {result ? (
        <Stack gap="large" align="stretch">
          <KeyValue.Grid>
            <KeyValue.Key>Layers</KeyValue.Key><KeyValue.Value>{result.layers.length}</KeyValue.Value>
            <KeyValue.Key>Print time</KeyValue.Key><KeyValue.Value>≈ {hms(result.seconds)}</KeyValue.Value>
            <KeyValue.Key>Filament</KeyValue.Key><KeyValue.Value>{(result.filamentMm / 1000).toFixed(2)} m · {result.grams.toFixed(1)} g</KeyValue.Value>
            <KeyValue.Key>Temps</KeyValue.Key><KeyValue.Value>{materials[settings.material].nozzle} °C nozzle / {materials[settings.material].bed} °C bed</KeyValue.Value>
          </KeyValue.Grid>
          <Meter.Root value={(result.grams / 1000) * 100} semantic={result.grams > 800 ? 'warning' : 'neutral'}>
            <Stack gap="xSmall" align="stretch">
              <Stack direction="row" gap="auto"><Meter.Label>Of a 1 kg spool</Meter.Label><Meter.Value /></Stack>
              <Meter.Track><Meter.Indicator /></Meter.Track>
            </Stack>
          </Meter.Root>
          <Card>
            <Stack gap="small" align="stretch">
              <Stack direction="row" gap="auto" align="center">
                <Text>Layer {layer + 1} / {result.layers.length} · z {result.layers[layer]?.z.toFixed(2)} mm</Text>
                <Tooltip.Root>
                  <Tooltip.Trigger render={<IconButton aria-label="About the preview" />}><I.HelpIcon /></Tooltip.Trigger>
                  <Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>Walls in the accent colour, infill in grey</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
                </Tooltip.Root>
              </Stack>
              <input type="range" min={0} max={result.layers.length - 1} value={layer} onChange={(e) => setLayer(e.currentTarget.valueAsNumber)} aria-label="Layer" />
              <LayerPreview layer={result.layers[layer]} extent={extent} theme={theme} />
            </Stack>
          </Card>
          <Stack direction="row" gap="small" wrap="wrap">
            <Button iconStart={<I.DownloadIcon />} onClick={() => download(result.gcode, `${name}_${settings.material}_${settings.layer}mm.gcode`, 'text/x-gcode')}>Download G-code</Button>
            <Button hierarchy="secondary" iconStart={<I.DownloadIcon />} onClick={() => download(toStl(positions), name + '.stl', 'model/stl')}>Download STL</Button>
            <GcodeModal gcode={result.gcode} />
          </Stack>
        </Stack>
      ) : (
        <EmptyState.Root>
          <EmptyState.Illustration><I.LayersIcon size={48} /></EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>Not sliced yet</EmptyState.Title>
              <EmptyState.Description>Pick a printer and material, then slice to get G-code and a layer preview.</EmptyState.Description>
            </EmptyState.Copy>
          </EmptyState.Body>
        </EmptyState.Root>
      )}

      <Table.Container>
        <Table.Root aria-label="Material presets">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell scope="col">Material</Table.HeaderCell>
              <Table.HeaderCell scope="col">Nozzle</Table.HeaderCell>
              <Table.HeaderCell scope="col">Bed</Table.HeaderCell>
              <Table.HeaderCell scope="col">Fan</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {Object.entries(materials).map(([k, m]) => (
              <Table.Row key={k}>
                <Table.Cell><Table.CellPrimary>{m.name}</Table.CellPrimary><Table.CellSecondary>{m.density} g/cm³</Table.CellSecondary></Table.Cell>
                <Table.Cell>{m.nozzle} °C</Table.Cell>
                <Table.Cell>{m.bed} °C</Table.Cell>
                <Table.Cell>{Math.round((m.fan / 255) * 100)}%</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.Container>
    </Stack>
  );
}

function GcodeModal({gcode}: {gcode: string}) {
  const head = gcode.split('\n').slice(0, 40).join('\n');
  return (
    <Modal.Root>
      <Modal.Trigger render={<Button hierarchy="secondary" />}>View G-code</Modal.Trigger>
      <Modal.Portal>
        <Modal.Backdrop />
        <Modal.Viewport>
          <Modal.Popup>
            <Stack direction="row" align="start" gap="auto">
              <Modal.Title>G-code preview</Modal.Title>
              <Modal.Close render={<IconButton aria-label="Close" />}><I.CloseIcon /></Modal.Close>
            </Stack>
            <Modal.Description>First 40 of {gcode.split('\n').length.toLocaleString()} lines.</Modal.Description>
            <Modal.Body>
              <CodeSnippet actions={<CopyButton value={gcode} aria-label="Copy all G-code" />}>{head}</CodeSnippet>
            </Modal.Body>
          </Modal.Popup>
        </Modal.Viewport>
      </Modal.Portal>
    </Modal.Root>
  );
}
