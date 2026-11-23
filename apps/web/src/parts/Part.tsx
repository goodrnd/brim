import {
  Button,
  Field,
  Grid,
  Heading,
  IconButton,
  InlineCode,
  KeyboardKey,
  KeyValue,
  PageHeader,
  Stack,
  Table,
  Tabs,
  Text,
  TextArea,
} from '@earendil-works/elanor-react';
import {useMemo, useState, type ReactNode} from 'react';
import {buildPositions, describe, fits, size, toStl, volume, type Model} from '@brim/core/model.ts';
import type {Material, Printer, SliceResult, SliceSettings} from '@brim/core/slicer.ts';
import {
  ArrowBackIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ContentCopyIcon,
  DeleteIcon,
  DownloadIcon,
  PrintIcon,
  RestartAltIcon,
  TuneIcon,
  UndoIcon,
} from '../ui/icons.ts';
import {count, edited, title, type Entry, type Part, type Project} from '../lib/library.ts';
import {PrintPanel} from './Print.tsx';
import {ProjectPicker} from '../projects/Projects.tsx';
import {go} from '../lib/route.ts';
import {download} from '../lib/download.ts';
import {RenameButton} from '../ui/controls.tsx';
import {Viewer} from './Viewer.tsx';

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

export const sections = ['refine', 'print'];
const slug = (m: Model) => (m.type === 'mesh' ? m.name : m.spec.kind + '-' + Math.round(m.spec.width) + 'mm');
const build = (m: Model) => (m.type === 'param' ? buildPositions(m.spec) : m.positions);

/** One part: its overview, or its refine / print section. New parts start in the Designer. */
export function PartPage(props: {
  part: Part;
  /** Shown as a back link when the part is in exactly one project. */
  project?: Project;
  projects: Array<Project>;
  partProjects: Array<string>;
  section?: string;
  /** `touch` marks a design change or rename, which updates `edited`. */
  setPart: (f: (p: Part) => Part, touch?: boolean) => void;
  onPrompt: (prompt: string) => Promise<void>;
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
  const last = part.history.length - 1;
  // [step, history length]: a new entry makes it stale, so the view jumps back to the latest step.
  const [view, setView] = useState<[number, number]>();
  const step = section === 'refine' && view?.[1] === part.history.length ? view[0] : last;
  const setStep = (i: number) => setView([Math.max(0, Math.min(last, i)), part.history.length]);
  const shown = part.history[step];
  const positions = useMemo(() => build(current.model), [current]);
  const shownPositions = useMemo(
    () => (shown === current ? positions : build(shown.model)),
    [shown, current, positions],
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
              positions={shownPositions}
              bed={[printer.bed[0], printer.bed[1]]}
              theme={theme}
              onSnapshot={step === last ? (thumb) => setPart((p) => ({...p, thumb})) : undefined}
            />
            <ModelFacts positions={shownPositions} printer={printer} />
          </Stack>
        </Grid.Item>
        <Grid.Item span={{base: 'full', medium: 5}}>
          <Tabs.Root value={section} onValueChange={(v) => setSection(v as string)}>
            <Tabs.List aria-label="Workflow" className="sections">
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
            <Tabs.Panel value="refine" className="panel">
              <Stack gap="large" align="stretch">
                <PromptBox
                  key="refine"
                  label="What should change?"
                  placeholder="e.g. 20% bigger, thicker walls, add a 3mm hole"
                  action="Improve"
                  icon={<TuneIcon />}
                  chips={tweaks}
                  onSubmit={onPrompt}
                />
                <History
                  history={part.history}
                  step={step}
                  onStep={setStep}
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
  step,
  onStep,
  onUndo,
  onRestore,
}: {
  history: Array<Entry>;
  step: number;
  onStep: (i: number) => void;
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
      {history.length > 1 && (
        <Stack gap="xSmall" align="stretch">
          <Stack direction="row" gap="small" align="center">
            <IconButton aria-label="Previous step" disabled={step === 0} onClick={() => onStep(step - 1)}>
              <ChevronLeftIcon />
            </IconButton>
            <input
              type="range"
              className="steps"
              min={0}
              max={history.length - 1}
              value={step}
              onChange={(e) => onStep(e.currentTarget.valueAsNumber)}
              aria-label="Step"
              aria-valuetext={`Step ${step + 1} of ${history.length}`}
            />
            <IconButton aria-label="Next step" disabled={step === history.length - 1} onClick={() => onStep(step + 1)}>
              <ChevronRightIcon />
            </IconButton>
          </Stack>
          <Stack direction="row" gap="auto" align="center">
            <Text className="muted">
              Step {step + 1} of {history.length}
              {step === history.length - 1 ? ' · latest' : ''}
            </Text>
            {step < history.length - 1 && (
              <Stack direction="row" gap="xSmall">
                <Button hierarchy="secondary" density="compact" onClick={() => onStep(history.length - 1)}>
                  Back to latest
                </Button>
                <Button density="compact" iconStart={<RestartAltIcon />} onClick={() => onRestore(step)}>
                  Restore this step
                </Button>
              </Stack>
            )}
          </Stack>
        </Stack>
      )}
      <ol className="history" reversed>
        {history
          .map((h, i) => ({h, i}))
          .reverse()
          .map(({h, i}) => (
            <li key={i} className={i === step ? 'current' : undefined} aria-current={i === step ? 'step' : undefined}>
              <Stack direction="row" gap="auto" align="start">
                <Stack
                  gap="xSmall"
                  className="history-step"
                  role="button"
                  tabIndex={0}
                  aria-label={`Show step ${i + 1}`}
                  onClick={() => onStep(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onStep(i);
                    }
                  }}
                >
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
