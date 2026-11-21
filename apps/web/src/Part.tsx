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
  Stack,
  Table,
  Tabs,
  Text,
  TextArea,
  Tooltip,
} from '@earendil-works/elanor-react';
import {useMemo, useState, type ReactNode} from 'react';
import {bounds, buildPositions, describe, fits, size, toStl, volume, type Model} from '@brim/core/model.ts';
import type {Material, Printer, slice, SliceResult, SliceSettings} from '@brim/core/slicer.ts';
import {
  ArrowBackIcon,
  AutoFixHighIcon,
  CloseIcon,
  ContentCopyIcon,
  DeleteIcon,
  DownloadIcon,
  HelpIcon,
  LayersIcon,
  PrintIcon,
  RestartAltIcon,
  ScheduleIcon,
  TuneIcon,
  UndoIcon,
} from './icons.ts';
import {hms} from './Jobs.tsx';
import {LayerPreview} from './LayerPreview.tsx';
import {count, edited, title, type Entry, type Part, type Project} from './library.ts';
import {ProjectPicker} from './Projects.tsx';
import {go} from './route.ts';
import {download, RenameButton} from './ui.tsx';
import {Viewer} from './Viewer.tsx';

const examples = [
  'twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs',
  'gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole',
  'box 80 x 50 x 30 with 2mm walls and 6mm corners',
  'keychain tag 50 x 20 x 3 with a hole',
  '5 point star 60 wide, 6 thick',
  'planter 90 wide 80 tall tapered',
];
const tweaks = [
  'make it taller',
  'thicker walls',
  'more ribs',
  'twist it more',
  'scale to 80%',
  'add a hole',
  'low poly',
  'no twist',
];

export const sections = ['design', 'refine', 'print'];
const slug = (m: Model) => (m.type === 'mesh' ? m.name : m.spec.kind + '-' + Math.round(m.spec.width) + 'mm');

const sliceOffThread = (...args: Parameters<typeof slice>) =>
  new Promise<SliceResult>((resolve, reject) => {
    const w = new Worker(new URL('./slice.worker.ts', import.meta.url), {type: 'module'});
    w.addEventListener('message', (e) => (resolve(e.data), w.terminate()));
    w.addEventListener('error', (e) => (reject(new Error(e.message)), w.terminate()));
    w.postMessage(args);
  });

/** One part: its overview, or one of the design / refine / print sections. */
export function PartPage(props: {
  part: Part;
  /** Shown as a back link when the part is in exactly one project. */
  project?: Project;
  projects: Array<Project>;
  partProjects: Array<string>;
  section?: string;
  /** `touch` marks a design change or rename, which updates `edited`. */
  setPart: (f: (p: Part) => Part, touch?: boolean) => void;
  onPrompt: (prompt: string, refine: boolean) => Promise<void>;
  onDuplicate: () => void;
  onDelete: () => void;
  onProjects: (ids: Array<string>) => void;
  onNewProject: () => void;
  printers: Record<string, Printer>;
  materials: Record<string, Material>;
  settings: SliceSettings;
  setSettings: (s: SliceSettings) => void;
  onQueue: (r: SliceResult) => void;
  theme: string;
}) {
  const {part, project, projects, partProjects, section, setPart, onPrompt, onDuplicate, onDelete} = props;
  const {onProjects, onNewProject, printers, materials, settings, setSettings, onQueue, theme} = props;
  const current = part.history.at(-1)!;
  const positions = useMemo(
    () => (current.model.type === 'param' ? buildPositions(current.model.spec) : current.model.positions),
    [current],
  );
  const printer = printers[settings.printer];
  const setSection = (s: string) => go(`part/${part.id}/${s}`);
  const setHistory = (f: (h: Array<Entry>) => Array<Entry>) => setPart((p) => ({...p, history: f(p.history)}), true);

  return section ? (
    <Stack gap="xLarge" align="stretch">
      <div>
        <Button
          hierarchy="secondary"
          density="compact"
          iconStart={<ArrowBackIcon />}
          onClick={() => go(`part/${part.id}`)}
        >
          {title(part)}
        </Button>
      </div>
      <Grid.Root>
        <Grid.Item span={{base: 'full', medium: 7}}>
          <Stack gap="small" align="stretch">
            <Viewer
              positions={positions}
              bed={[printer.bed[0], printer.bed[1]]}
              theme={theme}
              onSnapshot={(thumb) => setPart((p) => ({...p, thumb}))}
            />
            <ModelFacts positions={positions} printer={printer} />
          </Stack>
        </Grid.Item>
        <Grid.Item span={{base: 'full', medium: 5}}>
          <Tabs.Root value={section} onValueChange={(v) => setSection(v as string)}>
            <Tabs.List aria-label="Workflow" className="sections">
              <Tabs.Tab value="design">
                <AutoFixHighIcon />
                Design
              </Tabs.Tab>
              <Tabs.Tab value="refine">
                <TuneIcon />
                Refine
              </Tabs.Tab>
              <Tabs.Tab value="print">
                <PrintIcon />
                Print files
              </Tabs.Tab>
              <Tabs.Indicator className="sections-indicator" />
            </Tabs.List>
            <Tabs.Panel value="design" className="panel">
              <PromptBox
                key="design"
                label="Describe the part"
                placeholder="e.g. hex nut 20 wide 8 thick with a 10mm hole"
                action="Generate STL"
                icon={<AutoFixHighIcon />}
                chips={examples}
                onSubmit={(p) => onPrompt(p, false).then(() => setSection('refine'))}
              />
            </Tabs.Panel>
            <Tabs.Panel value="refine" className="panel">
              <Stack gap="large" align="stretch">
                <PromptBox
                  key="refine"
                  label="What should change?"
                  placeholder="e.g. 20% bigger, thicker walls, add a 3mm hole"
                  action="Improve"
                  icon={<TuneIcon />}
                  chips={tweaks}
                  onSubmit={(p) => onPrompt(p, true)}
                />
                <History
                  history={part.history}
                  onUndo={() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))}
                  onRestore={(i) =>
                    setHistory((h) => [...h, {...h[i], prompt: `Back to step ${i + 1}`, changes: [h[i].prompt]}])
                  }
                />
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="print" className="panel">
              <PrintPanel
                theme={theme}
                positions={positions}
                settings={settings}
                setSettings={setSettings}
                printers={printers}
                materials={materials}
                name={slug(current.model)}
                onQueue={onQueue}
              />
            </Tabs.Panel>
          </Tabs.Root>
        </Grid.Item>
      </Grid.Root>
    </Stack>
  ) : (
    <Stack gap="xLarge" align="stretch">
      {project && (
        <div>
          <Button
            hierarchy="secondary"
            density="compact"
            iconStart={<ArrowBackIcon />}
            onClick={() => go(`project/${project.id}`)}
          >
            {project.name}
          </Button>
        </div>
      )}
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>{title(part)}</PageHeader.Title>
          <PageHeader.Actions>
            <RenameButton
              key={part.id}
              what="part"
              name={title(part)}
              onRename={(name) => setPart((p) => ({...p, name}), true)}
            />
            <Button hierarchy="secondary" iconStart={<ContentCopyIcon />} onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button hierarchy="secondary" iconStart={<DeleteIcon />} onClick={onDelete}>
              Delete
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>
          {current.model.type === 'param'
            ? describe(current.model.spec)
            : `Imported mesh · ${size(positions)
                .map((v) => v.toFixed(0))
                .join(' × ')} mm`}
        </PageHeader.Description>
      </PageHeader.Root>

      <Grid.Root>
        <Grid.Item span={{base: 'full', medium: 7}}>
          <Viewer
            positions={positions}
            bed={[printer.bed[0], printer.bed[1]]}
            theme={theme}
            onSnapshot={(thumb) => setPart((p) => ({...p, thumb}))}
          />
        </Grid.Item>
        <Grid.Item span={{base: 'full', medium: 5}}>
          <Stack gap="large" align="stretch">
            <TextArea
              key={part.id}
              aria-label="Description"
              placeholder="What is it for, how it fits, what to watch when printing…"
              value={part.description ?? ''}
              onValueChange={(description) => setPart((p) => ({...p, description}))}
            />
            <Specs part={part} positions={positions} printer={printer} />
            <Stack direction="row" gap="small" wrap="wrap">
              <Button hierarchy="secondary" iconStart={<AutoFixHighIcon />} onClick={() => setSection('design')}>
                Design
              </Button>
              <Button hierarchy="secondary" iconStart={<TuneIcon />} onClick={() => setSection('refine')}>
                Refine
              </Button>
              <Button hierarchy="secondary" iconStart={<PrintIcon />} onClick={() => setSection('print')}>
                Print
              </Button>
            </Stack>
          </Stack>
        </Grid.Item>
      </Grid.Root>

      <Files positions={positions} name={slug(current.model)} />

      <Stack gap="small" align="stretch">
        <Stack direction="row" gap="auto" align="center">
          <Heading level={2} size={5}>
            Used in projects
          </Heading>
          <ProjectPicker value={partProjects} projects={projects} onChange={onProjects} onCreate={onNewProject} />
        </Stack>
        {partProjects.length ? (
          <Stack direction="row" gap="medium" wrap="wrap">
            {projects
              .filter((p) => partProjects.includes(p.id))
              .map((p) => (
                <a key={p.id} href={`#/project/${p.id}`}>
                  {p.name}
                </a>
              ))}
          </Stack>
        ) : (
          <Text className="muted">Not used in any project yet.</Text>
        )}
      </Stack>
    </Stack>
  );
}

export function NewPart({project, onSubmit}: {project?: Project; onSubmit: (prompt: string) => Promise<void>}) {
  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>New part</PageHeader.Title>
        </PageHeader.Row>
        <PageHeader.Description>
          {project ? `In ${project.name}. ` : ''}Describe what you want to print, or start from an example.
        </PageHeader.Description>
      </PageHeader.Root>
      <div className="editor">
        <PromptBox
          autoFocus
          label="Describe the part"
          placeholder="e.g. hex nut 20 wide 8 thick with a 10mm hole"
          action="Generate part"
          icon={<AutoFixHighIcon />}
          chips={examples}
          onSubmit={onSubmit}
        />
      </div>
    </Stack>
  );
}

function PromptBox(props: {
  autoFocus?: boolean;
  label: string;
  placeholder: string;
  action: string;
  icon: ReactNode;
  chips: Array<string>;
  onSubmit: (p: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (p: string) => {
    if (!p.trim() || busy) {
      return;
    }
    setBusy(true);
    void props
      .onSubmit(p.trim())
      .then(() => setValue(''))
      .finally(() => setBusy(false));
  };
  return (
    <Stack gap="medium" align="stretch">
      <Field.Root name="prompt">
        <Field.Label>{props.label}</Field.Label>
        <TextArea
          autoFocus={props.autoFocus}
          value={value}
          placeholder={props.placeholder}
          onValueChange={(v) => setValue(v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              submit(value);
            }
          }}
        />
        <Field.Description>
          Sizes in mm (cm and in work too). <KeyboardKey>⌘</KeyboardKey>
          <KeyboardKey>↵</KeyboardKey> to submit.
        </Field.Description>
      </Field.Root>
      <Stack direction="row" gap="small">
        <Button iconStart={props.icon} disabled={!value.trim() || busy} onClick={() => submit(value)}>
          {busy ? 'Thinking…' : props.action}
        </Button>
      </Stack>
      <Stack direction="row" gap="xSmall" wrap="wrap">
        {props.chips.map((c) => (
          <Button key={c} hierarchy="secondary" density="compact" disabled={busy} onClick={() => submit(c)}>
            {c}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
}

function History({
  history,
  onUndo,
  onRestore,
}: {
  history: Array<Entry>;
  onUndo: () => void;
  onRestore: (i: number) => void;
}) {
  return (
    <Stack gap="small" align="stretch">
      <Stack direction="row" gap="auto" align="center">
        <Heading level={2} size={5}>
          History
        </Heading>
        <Button
          hierarchy="secondary"
          density="compact"
          iconStart={<UndoIcon />}
          disabled={history.length < 2}
          onClick={onUndo}
        >
          Undo
        </Button>
      </Stack>
      <ol className="history" reversed>
        {history
          .map((h, i) => ({h, i}))
          .reverse()
          .map(({h, i}) => (
            <li key={i}>
              <Stack direction="row" gap="auto" align="start">
                <Stack gap="xSmall">
                  <Text>
                    <InlineCode>{h.prompt}</InlineCode>
                  </Text>
                  <Text className="muted">{h.changes.join(' · ')}</Text>
                </Stack>
                {i < history.length - 1 && (
                  <Button
                    hierarchy="secondary"
                    density="compact"
                    iconStart={<RestartAltIcon />}
                    onClick={() => onRestore(i)}
                  >
                    Restore
                  </Button>
                )}
              </Stack>
            </li>
          ))}
      </ol>
    </Stack>
  );
}

/** One line of geometry facts under the viewer; the size is in the page header. */
function ModelFacts({positions, printer}: {positions: Float32Array; printer: Printer}) {
  const ok = fits(positions, printer.bed);
  return (
    <Text className="muted">
      <span className={ok ? undefined : 'negative'}>
        {ok ? 'Fits' : 'Too big for'} the {printer.name} bed
      </span>
      {[
        '',
        `${(Math.abs(volume(positions)) / 1000).toFixed(1)} cm³`,
        `${(positions.length / 9).toLocaleString()} triangles`,
      ].join(' · ')}
    </Text>
  );
}

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

/** The part's key facts, shown on its overview. */
function Specs({part, positions, printer}: {part: Part; positions: Float32Array; printer: Printer}) {
  const dims = size(positions);
  const ok = fits(positions, printer.bed);
  return (
    <KeyValue.Grid>
      <KeyValue.Key>Size</KeyValue.Key>
      <KeyValue.Value>{dims.map((v) => v.toFixed(1)).join(' × ')} mm</KeyValue.Value>
      <KeyValue.Key>Volume</KeyValue.Key>
      <KeyValue.Value>{(Math.abs(volume(positions)) / 1000).toFixed(1)} cm³</KeyValue.Value>
      <KeyValue.Key>Triangles</KeyValue.Key>
      <KeyValue.Value>{(positions.length / 9).toLocaleString()}</KeyValue.Value>
      <KeyValue.Key>Bed</KeyValue.Key>
      <KeyValue.Value>
        <span className={ok ? undefined : 'negative'}>
          {ok ? 'Fits' : 'Too big for'} the {printer.name}
        </span>
      </KeyValue.Value>
      <KeyValue.Key>History</KeyValue.Key>
      <KeyValue.Value>
        {[count(part.history.length, 'step'), edited(part.edited)].filter(Boolean).join(' · ')}
      </KeyValue.Value>
    </KeyValue.Grid>
  );
}

/** The files a part can be downloaded as, with format and size. */
// shortcut: only the STL is listed; add the original upload and sliced G-code once they are stored with the part.
function Files({positions, name}: {positions: Float32Array; name: string}) {
  const file = `${name}.stl`;
  return (
    <Stack gap="small" align="stretch">
      <Heading level={2} size={5}>
        Files
      </Heading>
      <Table.Container>
        <Table.Root aria-label="Files">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell scope="col">Name</Table.HeaderCell>
              <Table.HeaderCell scope="col">Format</Table.HeaderCell>
              <Table.HeaderCell scope="col">Size</Table.HeaderCell>
              <Table.HeaderCell scope="col">
                <span hidden>Actions</span>
              </Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            <Table.Row>
              <Table.Cell>{file}</Table.Cell>
              <Table.Cell>STL (binary)</Table.Cell>
              {/* Binary STL: 84-byte header plus 50 bytes per triangle. */}
              <Table.Cell>{bytes(84 + (positions.length / 9) * 50)}</Table.Cell>
              <Table.Cell align="end">
                <IconButton
                  aria-label={`Download ${file}`}
                  onClick={() => download(toStl(positions), file, 'model/stl')}
                >
                  <DownloadIcon />
                </IconButton>
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Table.Container>
    </Stack>
  );
}

function PrintPanel({
  theme,
  positions,
  settings,
  setSettings,
  printers,
  materials,
  name,
  onQueue,
}: {
  theme: string;
  positions: Float32Array;
  settings: SliceSettings;
  setSettings: (s: SliceSettings) => void;
  printers: Record<string, Printer>;
  materials: Record<string, Material>;
  name: string;
  onQueue: (r: SliceResult) => void;
}) {
  // A result is only valid for the inputs it was sliced from; anything else reads as null.
  const [sliced, setSliced] = useState<{result: SliceResult; inputs: Array<unknown>} | null>(null);
  const {printer, material, layer: layerHeight, infill, vase} = settings;
  const inputs = [positions, printers, materials, printer, material, layerHeight, infill, vase];
  const result = sliced?.inputs.every((v, i) => v === inputs[i]) ? sliced.result : null;
  const [busy, setBusy] = useState(false);
  const [layer, setLayer] = useState(0);
  const set = <K extends keyof SliceSettings>(k: K, v: SliceSettings[K]) => setSettings({...settings, [k]: v});
  const [min, max] = bounds(positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1]);
  const tooBig = !fits(positions, printers[settings.printer].bed);
  const run = async () => {
    setBusy(true);
    try {
      const r = await sliceOffThread(positions, settings, printers[printer], materials[material]);
      setSliced({result: r, inputs});
      setLayer(Math.floor(r.layers.length / 2));
    } catch (error) {
      alert(`Slicing failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

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
              {Object.entries(options).map(([k, o]) => (
                <Dropdown.Item key={k} value={k}>
                  {o.name}
                </Dropdown.Item>
              ))}
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
        <SegmentedControl.Root
          aria-label="Layer height"
          value={[String(settings.layer)]}
          onValueChange={(v) => v[0] && set('layer', Number(v[0]))}
        >
          {['0.12', '0.2', '0.28'].map((l) => (
            <SegmentedControl.Item key={l} value={l}>
              {l} mm
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Stack>
      <Stack gap="xSmall">
        <Text>Infill</Text>
        <SegmentedControl.Root
          aria-label="Infill"
          value={[String(settings.infill)]}
          onValueChange={(v) => v[0] && set('infill', Number(v[0]))}
        >
          {['0', '15', '30', '60'].map((l) => (
            <SegmentedControl.Item key={l} value={l}>
              {l}%
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Stack>
      <SelectionControlAndLabel
        control={
          <Checkbox.Root checked={settings.vase} onCheckedChange={(c) => set('vase', c)}>
            <Checkbox.Indicator />
          </Checkbox.Root>
        }
      >
        Spiral vase mode (single wall, continuous Z)
      </SelectionControlAndLabel>
      <Stack direction="row" gap="small" align="center">
        <Button iconStart={<LayersIcon />} disabled={tooBig || busy} onClick={() => void run()}>
          {busy ? 'Slicing…' : 'Slice'}
        </Button>
        {tooBig && <Text className="negative">Part is larger than the {printers[settings.printer].name} bed.</Text>}
      </Stack>

      {result ? (
        <Stack gap="large" align="stretch">
          <KeyValue.Grid>
            <KeyValue.Key>Layers</KeyValue.Key>
            <KeyValue.Value>{result.layers.length}</KeyValue.Value>
            <KeyValue.Key>Print time</KeyValue.Key>
            <KeyValue.Value>≈ {hms(result.seconds)}</KeyValue.Value>
            <KeyValue.Key>Filament</KeyValue.Key>
            <KeyValue.Value>
              {(result.filamentMm / 1000).toFixed(2)} m · {result.grams.toFixed(1)} g
            </KeyValue.Value>
            <KeyValue.Key>Temps</KeyValue.Key>
            <KeyValue.Value>
              {materials[settings.material].nozzle} °C nozzle / {materials[settings.material].bed} °C bed
            </KeyValue.Value>
          </KeyValue.Grid>
          <Meter.Root value={(result.grams / 1000) * 100} semantic={result.grams > 800 ? 'warning' : 'neutral'}>
            <Stack gap="xSmall" align="stretch">
              <Stack direction="row" gap="auto">
                <Meter.Label>Of a 1 kg spool</Meter.Label>
                <Meter.Value />
              </Stack>
              <Meter.Track>
                <Meter.Indicator />
              </Meter.Track>
            </Stack>
          </Meter.Root>
          <Card>
            <Stack gap="small" align="stretch">
              <Stack direction="row" gap="auto" align="center">
                <Text>
                  Layer {layer + 1} / {result.layers.length} · z {result.layers[layer]?.z.toFixed(2)} mm
                </Text>
                <Tooltip.Root>
                  <Tooltip.Trigger render={<IconButton aria-label="About the preview" />}>
                    <HelpIcon />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner>
                      <Tooltip.Popup>Walls in the accent colour, infill in grey</Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Stack>
              <input
                type="range"
                min={0}
                max={result.layers.length - 1}
                value={layer}
                onChange={(e) => setLayer(e.currentTarget.valueAsNumber)}
                aria-label="Layer"
              />
              <LayerPreview layer={result.layers[layer]} extent={extent} theme={theme} />
            </Stack>
          </Card>
          <Stack direction="row" gap="small" wrap="wrap">
            <Button iconStart={<ScheduleIcon />} onClick={() => onQueue(result)}>
              Add to queue
            </Button>
            <Button
              hierarchy="secondary"
              iconStart={<DownloadIcon />}
              onClick={() =>
                download(result.gcode, `${name}_${settings.material}_${settings.layer}mm.gcode`, 'text/x-gcode')
              }
            >
              Download G-code
            </Button>
            <Button
              hierarchy="secondary"
              iconStart={<DownloadIcon />}
              onClick={() => download(toStl(positions), name + '.stl', 'model/stl')}
            >
              Download STL
            </Button>
            <GcodeModal gcode={result.gcode} />
          </Stack>
        </Stack>
      ) : (
        <EmptyState.Root>
          <EmptyState.Illustration>
            <LayersIcon size={48} />
          </EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>Not sliced yet</EmptyState.Title>
              <EmptyState.Description>
                Pick a printer and material, then slice to get G-code and a layer preview.
              </EmptyState.Description>
            </EmptyState.Copy>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
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
              <Modal.Close render={<IconButton aria-label="Close" />}>
                <CloseIcon />
              </Modal.Close>
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
