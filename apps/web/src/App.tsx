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
  Input,
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
import {
  AccountCircleIcon,
  AddIcon,
  ArrowBackIcon,
  AutoFixHighIcon,
  BorderClearIcon,
  BorderOuterIcon,
  CloseIcon,
  ContentCopyIcon,
  DarkModeIcon,
  DeleteIcon,
  DownloadIcon,
  EditIcon,
  FolderOpenIcon,
  HelpIcon,
  LayersIcon,
  LightModeIcon,
  PrintIcon,
  RestartAltIcon,
  ScheduleIcon,
  SettingsIcon,
  TuneIcon,
  UndoIcon,
  UploadFileIcon,
  ViewInArIcon,
} from './icons.ts';
import {LayerPreview} from './LayerPreview.tsx';
import {
  applyOps,
  bounds,
  buildPositions,
  describe,
  editMesh,
  parsePrompt,
  toStl,
  volume,
  type Model,
} from '@brim/core/model.ts';
import type {Current, Intent} from '@brim/core/intent.ts';
import {
  materials as stockMaterials,
  printers as stockPrinters,
  slice,
  type Material,
  type Printer,
  type SliceResult,
  type SliceSettings,
} from '@brim/core/slicer.ts';
import {hms, Jobs, type Job} from './Jobs.tsx';
import {Settings} from './Settings.tsx';
import {AccountSettings, demoAccount, Login, type Account} from './Account.tsx';
import {go, useRoute} from './route.ts';
import {useStored} from './store.ts';
import {parseStl, Viewer} from './Viewer.tsx';
import {count, edited, isLoose, removeProject, type Note, type Project} from './library.ts';
import {ProjectList, ProjectPage, ProjectPicker} from './Projects.tsx';

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

interface Entry {
  prompt: string;
  changes: Array<string>;
  model: Model;
}
interface Part {
  id: string;
  name?: string;
  thumb?: string; // webp data URL of the viewer
  history: Array<Entry>;
  edited?: number; // ms timestamp of the last design change or rename
  projectId?: string; // unset: a loose part
}

const sections = ['design', 'refine', 'print'];
const modelTitle = (m: Model) => (m.type === 'mesh' ? m.name : 'Untitled ' + m.spec.kind);
const title = (p: Part) => p.name || modelTitle(p.history.at(-1)!.model);

// shortcut: imported meshes are not saved and thumbnails share the ~5 MB localStorage quota; move to IndexedDB if people import a lot or keep hundreds of parts.
const storable = (ps: Array<Part>) =>
  ps.flatMap((p) => {
    const history = p.history.filter((e) => e.model.type === 'param');
    return history.length ? [{...p, history}] : [];
  });

// Stock Elanor token sets; pi and earendil are currently identical to radius, so they are left out.
const themes = {'1': radiusCss, '2': elanorCss, '3': lefosCss} as const;
type Theme = keyof typeof themes;
type Scheme = 'light' | 'dark';
const saved = <T extends string>(key: string, ok: ReadonlyArray<T>, fallback: T): T => {
  const v = localStorage.getItem(key) as T | null;
  return v && ok.includes(v) ? v : fallback;
};

/** Swaps the token stylesheet and colour scheme; returns a key that changes once the new tokens apply. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => saved('brim-theme', Object.keys(themes) as Array<Theme>, '1'));
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
    if (link.getAttribute('href') === themes[theme]) {
      return done();
    }
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
/** Asks the dev server's LLM; undefined when none is configured or it fails, so callers use the regex parser. */
async function askLlm(prompt: string, m?: Model): Promise<Intent | undefined> {
  const current: Current | undefined = !m
    ? undefined
    : m.type === 'param'
      ? m
      : {type: 'mesh', name: m.name, size: ((b) => b[1].map((v, k) => v - b[0][k]))(bounds(m.positions))};
  try {
    const r = await fetch('/api/intent', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({prompt, current}),
    });
    if (r.ok) {
      return await r.json();
    }
    if (r.status !== 404) {
      // oxlint-disable-next-line no-console
      console.warn('brim: LLM intent failed, using the regex parser:', await r.text());
    }
  } catch {
    // offline or server down: fall back to the regex parser
  }
}

/** Resolves a prompt to the next history entry, via the LLM when available. */
async function resolve(prompt: string, m?: Model): Promise<Entry> {
  const intent = await askLlm(prompt, m);
  if (intent?.type === 'spec') {
    return {prompt, changes: [describe(intent.spec)], model: {type: 'param', spec: intent.spec}};
  }
  if (intent && m) {
    return {prompt, ...applyOps(m, intent.ops)};
  }
  if (!m) {
    const {spec, changes} = parsePrompt(prompt);
    return {prompt, changes, model: {type: 'param', spec}};
  }
  if (m.type === 'param') {
    const {spec, changes} = parsePrompt(prompt, m.spec);
    return {
      prompt,
      changes: changes.length ? changes : ['nothing I understood, so no change'],
      model: {type: 'param', spec},
    };
  }
  const {positions: p, changes} = editMesh(prompt, m.positions);
  return {
    prompt,
    changes: changes.length
      ? changes
      : ['imported meshes support scale, taller, wider, flip, rotate and drilling a hole'],
    model: {...m, positions: p},
  };
}

const slug = (m: Model) => (m.type === 'mesh' ? m.name : m.spec.kind + '-' + Math.round(m.spec.width) + 'mm');

export function App() {
  const {theme, setTheme, scheme, setScheme, applied} = useTheme();
  const [borders, setBorders] = useBorders();
  const [account, setAccount] = useStored<Account>('brim-account', () => demoAccount);
  const [signedIn, setSignedIn] = useStored('brim-session', () => false);
  const [parts, setParts] = useStored<Array<Part>>('brim-parts', () => [], storable);
  const [jobs, setJobs] = useStored<Array<Job>>('brim-jobs', () => []);
  const [printers, setPrinters] = useStored<Record<string, Printer>>('brim-printers', () => stockPrinters);
  const [materials, setMaterials] = useStored<Record<string, Material>>('brim-materials', () => stockMaterials);
  const [projects, setProjects] = useStored<Array<Project>>('brim-projects', () => []);
  const [notes, setNotes] = useStored<Array<Note>>('brim-notes', () => []);
  const route = useRoute();
  const page = route[0] === 'model' ? 'part' : (route[0] ?? 'library'); // old #/model/ links still open
  const part = page === 'part' ? parts.find((p) => p.id === route[1]) : undefined;
  const project = projects.find((p) => p.id === (page === 'project' || page === 'new' ? route[1] : part?.projectId));
  // shortcut: window.prompt for the name; swap for a Modal like RenameButton if it feels rough.
  const newProject = (movePartId?: string) => {
    const name = prompt('Project name')?.trim();
    if (!name) {
      return;
    }
    // oxlint-disable-next-line react/purity -- event handler, not render
    const p: Project = {id: crypto.randomUUID(), name, edited: Date.now()};
    setProjects((ps) => [p, ...ps]);
    if (movePartId) {
      patch(movePartId, (x) => ({...x, projectId: p.id}));
    } else {
      go(`project/${p.id}`);
    }
  };
  const deleteProject = (p: Project) => {
    const n = parts.filter((x) => x.projectId === p.id).length;
    if (
      !confirm(
        `Delete project “${p.name}”? Its ${count(n, 'part')} stay in the Library; its ${count(notes.filter((x) => x.projectId === p.id).length, 'note')} are deleted.`,
      )
    ) {
      return;
    }
    const r = removeProject(p.id, {projects, parts, notes});
    setProjects(r.projects);
    setParts(r.parts);
    setNotes(r.notes);
    go('');
  };
  const section = sections.includes(route[2]) ? route[2] : 'design';
  const setSection = (s: string) => part && go(`part/${part.id}/${s}`);
  const patch = (id: string, f: (p: Part) => Part) => setParts((ps) => ps.map((p) => (p.id === id ? f(p) : p)));
  const edit = (f: (p: Part) => Part) => part && patch(part.id, (p) => ({...f(p), edited: Date.now()}));
  const setHistory = (f: (h: Array<Entry>) => Array<Entry>) => edit((p) => ({...p, history: f(p.history)}));
  const create = (p: Omit<Part, 'id' | 'edited' | 'projectId'> & {projectId?: string}) => {
    // oxlint-disable-next-line react/purity -- event handler, not render
    const next = {...p, id: crypto.randomUUID(), edited: Date.now()};
    setParts((ps) => [next, ...ps]);
    go(`part/${next.id}/refine`);
  };
  const duplicate = () => part && create({...part, name: title(part) + ' copy'});
  const remove = () => {
    if (!part || !confirm(`Delete “${title(part)}”? This cannot be undone.`)) {
      return;
    }
    setParts((ps) => ps.filter((p) => p.id !== part.id));
    go('');
  };
  const [settings, setSettings] = useStored<SliceSettings>('brim-slice', () => ({
    printer: 'mk4',
    material: 'pla',
    layer: 0.2,
    infill: 15,
    speed: 60,
    vase: false,
  }));
  // Fall back when the chosen printer or material was deleted or reset away.
  const sliceSettings = {
    ...settings,
    printer: printers[settings.printer] ? settings.printer : Object.keys(printers)[0],
    material: materials[settings.material] ? settings.material : Object.keys(materials)[0],
  };
  const current = part?.history.at(-1);
  const positions = useMemo(
    () =>
      !current
        ? new Float32Array()
        : current.model.type === 'param'
          ? buildPositions(current.model.spec)
          : current.model.positions,
    // oxlint-disable-next-line react/preserve-manual-memoization -- React Compiler is not used; the memo keeps Viewer from rebuilding each render
    [current],
  );
  const printer = printers[sliceSettings.printer];

  const generate = async (prompt: string) => {
    const e = await resolve(prompt);
    if (part) {
      setHistory((h) => [...h, e]);
    } else {
      create({history: [e], projectId: project?.id});
    }
  };
  const refine = async (prompt: string) => {
    const e = await resolve(prompt, current?.model);
    setHistory((h) => [...h, e]);
  };
  const upload = async (file: File, projectId?: string) => {
    try {
      const p = parseStl(await file.arrayBuffer());
      const {positions: fixed} = editMesh('', p);
      const entry: Entry = {
        prompt: `Imported ${file.name}`,
        changes: [`${fixed.length / 9} triangles`],
        model: {type: 'mesh', name: file.name.replace(/\.stl$/i, ''), positions: fixed},
      };
      create({history: [entry], projectId});
    } catch (error) {
      alert((error as Error).message);
    }
  };

  if (!signedIn) {
    return <Login account={account} onLogin={() => setSignedIn(true)} />;
  }

  return (
    <>
      <TopNavigation.Root className="header">
        <TopNavigation.Identity>
          <Stack direction="row" gap="small" align="center">
            <ViewInArIcon size={24} />
            <Text render={<strong />}>Brim</Text>
          </Stack>
        </TopNavigation.Identity>
        <TopNavigation.Actions>
          <SegmentedControl.Root
            aria-label="Theme"
            density="compact"
            value={[theme]}
            onValueChange={(v) => v[0] && setTheme(v[0] as Theme)}
          >
            {Object.keys(themes).map((t) => (
              <SegmentedControl.Item key={t} value={t}>
                {t}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={<TopNavigation.ActionButton aria-label="Show borders" aria-pressed={borders} />}
              onClick={() => setBorders(!borders)}
            >
              {borders ? <BorderOuterIcon /> : <BorderClearIcon />}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>{borders ? 'Hide borders' : 'Show borders'}</Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <TopNavigation.ActionButton
                  aria-label={scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                />
              }
              onClick={() => setScheme(scheme === 'dark' ? 'light' : 'dark')}
            >
              {scheme === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
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
              <Sidebar.Header>
                <Sidebar.Trigger />
              </Sidebar.Header>
              <Sidebar.Content>
                <SideNavigation.Root aria-label="Workflow" variant={collapsed ? 'compact' : 'default'}>
                  <SideNavigation.List>
                    {(
                      [
                        ['library', 'Library', FolderOpenIcon],
                        [
                          'queue',
                          `Print queue${jobs.some((j) => !j.done) ? ` (${jobs.filter((j) => !j.done).length})` : ''}`,
                          ScheduleIcon,
                        ],
                        ['settings', 'Printers & materials', SettingsIcon],
                      ] as const
                    ).map(([v, label, Icon]) => (
                      <SideNavigation.Item key={v}>
                        <SideNavigation.Link
                          href={`#/${v === 'library' ? '' : v}`}
                          iconStart={<Icon />}
                          active={
                            page === v || (v === 'library' && (page === 'part' || page === 'new' || page === 'project'))
                          }
                        >
                          {label}
                        </SideNavigation.Link>
                      </SideNavigation.Item>
                    ))}
                  </SideNavigation.List>
                </SideNavigation.Root>
              </Sidebar.Content>
              <Sidebar.Footer>
                <SideNavigation.Root aria-label="Printer" variant={collapsed ? 'compact' : 'default'}>
                  <SideNavigation.List>
                    <SideNavigation.Item>
                      <SideNavigation.Link
                        href={`#/settings/printer/${sliceSettings.printer}`}
                        iconStart={<PrintIcon />}
                      >
                        {printer.name}
                      </SideNavigation.Link>
                    </SideNavigation.Item>
                    <SideNavigation.Item>
                      <SideNavigation.Link
                        href="#/account"
                        iconStart={<AccountCircleIcon />}
                        active={page === 'account'}
                      >
                        {account.name}
                      </SideNavigation.Link>
                    </SideNavigation.Item>
                  </SideNavigation.List>
                </SideNavigation.Root>
              </Sidebar.Footer>
            </>
          )}
        </Sidebar.Root>

        <main className="main">
          {page === 'new' ? (
            <NewPart project={project} onSubmit={generate} />
          ) : page === 'project' ? (
            project ? (
              <ProjectPage
                key={project.id}
                project={project}
                notes={notes}
                setNotes={setNotes}
                partCount={parts.filter((p) => p.projectId === project.id).length}
                parts={<PartList parts={parts.filter((p) => p.projectId === project.id)} />}
                actions={
                  <>
                    <RenameButton
                      key={project.id}
                      what="project"
                      name={project.name}
                      onRename={(name) =>
                        setProjects((ps) => ps.map((p) => (p.id === project.id ? {...p, name, edited: Date.now()} : p)))
                      }
                    />
                    <Button hierarchy="secondary" iconStart={<DeleteIcon />} onClick={() => deleteProject(project)}>
                      Delete
                    </Button>
                  </>
                }
                partActions={
                  <>
                    <UploadButton compact onFile={(f) => upload(f, project.id)} />
                    <Button density="compact" iconStart={<AddIcon />} onClick={() => go(`new/${project.id}`)}>
                      New part
                    </Button>
                  </>
                }
              />
            ) : (
              <EmptyState.Root>
                <EmptyState.Body>
                  <EmptyState.Copy>
                    <EmptyState.Title level={1}>Project not found</EmptyState.Title>
                  </EmptyState.Copy>
                  <EmptyState.Actions>
                    <Button onClick={() => go('')}>Back to Library</Button>
                  </EmptyState.Actions>
                </EmptyState.Body>
              </EmptyState.Root>
            )
          ) : page === 'queue' ? (
            <Jobs
              jobs={jobs}
              setJobs={setJobs}
              onOpen={(id) => parts.some((p) => p.id === id) && go(`part/${id}/print`)}
            />
          ) : page === 'account' ? (
            <AccountSettings account={account} setAccount={setAccount} onLogout={() => (setSignedIn(false), go(''))} />
          ) : page === 'settings' ? (
            <Settings
              printers={printers}
              setPrinters={setPrinters}
              materials={materials}
              setMaterials={setMaterials}
              inUse={sliceSettings}
              route={route.slice(1)}
            />
          ) : !part || !current ? (
            page === 'part' ? (
              <EmptyState.Root>
                <EmptyState.Body>
                  <EmptyState.Copy>
                    <EmptyState.Title level={1}>Part not found</EmptyState.Title>
                    <EmptyState.Description>
                      It may have been deleted, or it was an imported STL from an earlier visit.
                    </EmptyState.Description>
                  </EmptyState.Copy>
                  <EmptyState.Actions>
                    <Button onClick={() => go('')}>Back to Library</Button>
                  </EmptyState.Actions>
                </EmptyState.Body>
              </EmptyState.Root>
            ) : (
              <Library
                parts={parts}
                projects={projects}
                notes={notes}
                onUpload={(f) => upload(f)}
                onNewProject={() => newProject()}
              />
            )
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
                    <ProjectPicker
                      value={project?.id}
                      projects={projects}
                      onChange={(projectId) => patch(part.id, (p) => ({...p, projectId}))}
                      onCreate={() => newProject(part.id)}
                    />
                    <RenameButton
                      key={part.id}
                      what="part"
                      name={title(part)}
                      onRename={(name) => edit((p) => ({...p, name}))}
                    />
                    <Button hierarchy="secondary" iconStart={<ContentCopyIcon />} onClick={duplicate}>
                      Duplicate
                    </Button>
                    <Button hierarchy="secondary" iconStart={<DeleteIcon />} onClick={remove}>
                      Delete
                    </Button>
                    <Button
                      hierarchy="secondary"
                      iconStart={<DownloadIcon />}
                      onClick={() => download(toStl(positions), slug(current.model) + '.stl', 'model/stl')}
                    >
                      STL
                    </Button>
                    <Button iconStart={<PrintIcon />} onClick={() => setSection('print')}>
                      Prepare print
                    </Button>
                  </PageHeader.Actions>
                </PageHeader.Row>
                <PageHeader.Description>
                  {current.model.type === 'param' ? describe(current.model.spec) : 'Imported mesh'}
                </PageHeader.Description>
              </PageHeader.Root>

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
                <Grid.Root>
                  <Grid.Item span={{base: 'full', medium: 7}}>
                    <Stack gap="medium" align="stretch">
                      <Viewer
                        positions={positions}
                        bed={[printer.bed[0], printer.bed[1]]}
                        theme={applied}
                        onSnapshot={(thumb) => patch(part.id, (p) => ({...p, thumb}))}
                      />
                      <ModelStats positions={positions} bed={printer.bed} />
                    </Stack>
                  </Grid.Item>
                  <Grid.Item span={{base: 'full', medium: 5}}>
                    <Tabs.Panel value="design" className="panel">
                      <PromptBox
                        key="design"
                        label="Describe the part"
                        placeholder="e.g. hex nut 20 wide 8 thick with a 10mm hole"
                        action="Generate STL"
                        icon={<AutoFixHighIcon />}
                        chips={examples}
                        onSubmit={(p) => generate(p).then(() => setSection('refine'))}
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
                          onSubmit={refine}
                        />
                        <History
                          history={part.history}
                          onUndo={() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))}
                          onRestore={(i) =>
                            setHistory((h) => [
                              ...h,
                              {...h[i], prompt: `Back to step ${i + 1}`, changes: [h[i].prompt]},
                            ])
                          }
                        />
                      </Stack>
                    </Tabs.Panel>
                    <Tabs.Panel value="print" className="panel">
                      <PrintPanel
                        theme={applied}
                        positions={positions}
                        settings={sliceSettings}
                        setSettings={setSettings}
                        printers={printers}
                        materials={materials}
                        name={slug(current.model)}
                        onQueue={(r) => {
                          const s = sliceSettings;
                          setJobs((js) => [
                            {
                              id: crypto.randomUUID(),
                              partId: part.id,
                              part: title(part),
                              printer: printers[s.printer].name,
                              material: materials[s.material].name,
                              layer: s.layer,
                              infill: s.infill,
                              seconds: r.seconds,
                              grams: r.grams,
                              at: Date.now(),
                              done: false,
                            },
                            ...js,
                          ]);
                          go('queue');
                        }}
                      />
                    </Tabs.Panel>
                  </Grid.Item>
                </Grid.Root>
              </Tabs.Root>
            </Stack>
          )}
        </main>
      </div>
    </>
  );
}

function Library({
  parts,
  projects,
  notes,
  onUpload,
  onNewProject,
}: {
  parts: Array<Part>;
  projects: Array<Project>;
  notes: Array<Note>;
  onUpload: (f: File) => void;
  onNewProject: () => void;
}) {
  const loose = parts.filter((p) => isLoose(p, projects));
  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Library</PageHeader.Title>
          <PageHeader.Actions>
            <UploadButton onFile={onUpload} />
            <Button hierarchy="secondary" iconStart={<FolderOpenIcon />} onClick={onNewProject}>
              New project
            </Button>
            <Button iconStart={<AddIcon />} onClick={() => go('new')}>
              New part
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>
          {[projects.length ? count(projects.length, 'project') : '', count(parts.length, 'part')]
            .filter(Boolean)
            .join(' · ')}
          , saved in this browser.
        </PageHeader.Description>
      </PageHeader.Root>
      <ProjectList projects={projects} parts={parts} notes={notes} />
      {loose.length ? (
        <Stack gap="small" align="stretch">
          {projects.length > 0 && (
            <Heading level={2} size={5}>
              Loose parts
            </Heading>
          )}
          <PartList parts={loose} />
        </Stack>
      ) : projects.length ? null : (
        <EmptyState.Root>
          <EmptyState.Illustration>
            <ViewInArIcon size={48} />
          </EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>No parts yet</EmptyState.Title>
              <EmptyState.Description>Describe a part in plain words, or import an STL.</EmptyState.Description>
            </EmptyState.Copy>
            <EmptyState.Actions>
              <Button iconStart={<AddIcon />} onClick={() => go('new')}>
                New part
              </Button>
            </EmptyState.Actions>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
    </Stack>
  );
}

function PartList({parts}: {parts: Array<Part>}) {
  const sorted = [...parts].sort((a, b) => (b.edited ?? 0) - (a.edited ?? 0));
  return (
    <ul className="model-list">
      {sorted.map((p) => {
        const m = p.history.at(-1)!.model;
        const href = `#/part/${p.id}/design`;
        return (
          <li key={p.id}>
            {/* Image link is a mouse shortcut; the title link is the one keyboard and screen reader users get. */}
            <a href={href} className="card-link" tabIndex={-1} aria-hidden>
              {p.thumb ? <img className="thumb" src={p.thumb} alt="" /> : <div className="thumb" />}
            </a>
            <Stack gap="xSmall" align="stretch">
              <Heading level={3} size={5}>
                <a href={href} className="card-link">
                  {title(p)}
                </a>
              </Heading>
              <Text className="muted">{m.type === 'param' ? describe(m.spec) : 'Imported mesh · not saved'}</Text>
              <Text className="muted">
                {[edited(p.edited), `${p.history.length} ${p.history.length === 1 ? 'step' : 'steps'}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Stack>
          </li>
        );
      })}
    </ul>
  );
}

function NewPart({project, onSubmit}: {project?: Project; onSubmit: (prompt: string) => Promise<void>}) {
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

function RenameButton({what, name, onRename}: {what: string; name: string; onRename: (name: string) => void}) {
  const [value, setValue] = useState(name);
  const [open, setOpen] = useState(false);
  const save = () => value.trim() && (onRename(value.trim()), setOpen(false));
  return (
    <Modal.Root open={open} onOpenChange={(o) => (setOpen(o), setValue(name))}>
      <Modal.Trigger render={<Button hierarchy="secondary" iconStart={<EditIcon />} />}>Rename</Modal.Trigger>
      <Modal.Portal>
        <Modal.Backdrop />
        <Modal.Viewport>
          <Modal.Popup>
            <Modal.Title>Rename {what}</Modal.Title>
            <Modal.Body>
              <Field.Root name="name">
                <Field.Label>Name</Field.Label>
                <Input
                  value={value}
                  onValueChange={(v) => setValue(v)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                />
              </Field.Root>
            </Modal.Body>
            <Modal.Actions>
              <Modal.Close render={<Button hierarchy="secondary" />}>Cancel</Modal.Close>
              <Button disabled={!value.trim()} onClick={save}>
                Save
              </Button>
            </Modal.Actions>
          </Modal.Popup>
        </Modal.Viewport>
      </Modal.Portal>
    </Modal.Root>
  );
}

function UploadButton({onFile, compact}: {onFile: (f: File) => void; compact?: boolean}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".stl"
        hidden
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button
        hierarchy="secondary"
        density={compact ? 'compact' : undefined}
        iconStart={<UploadFileIcon />}
        onClick={() => input.current?.click()}
      >
        Import STL
      </Button>
    </>
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

function ModelStats({positions, bed}: {positions: Float32Array; bed: [number, number, number]}) {
  const [min, max] = bounds(positions);
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  const fits = size.every((v, k) => v <= bed[k]);
  return (
    <Grid.Root>
      <Grid.Item span={{base: 6, medium: 3}}>
        <Card
          label="Size (mm)"
          value={size.map((v) => v.toFixed(0)).join(' × ')}
          description={fits ? 'Fits the bed' : 'Too big for the bed'}
        />
      </Grid.Item>
      <Grid.Item span={{base: 6, medium: 3}}>
        <Card
          label="Volume"
          value={`${(Math.abs(volume(positions)) / 1000).toFixed(1)} cm³`}
          description="Solid model"
        />
      </Grid.Item>
      <Grid.Item span={{base: 6, medium: 3}}>
        <Card label="Triangles" value={(positions.length / 9).toLocaleString()} description="Binary STL" />
      </Grid.Item>
      <Grid.Item span={{base: 6, medium: 3}}>
        <Card
          label="STL size"
          value={`${((84 + (positions.length / 9) * 50) / 1024).toFixed(0)} KB`}
          description="Download from the header"
        />
      </Grid.Item>
    </Grid.Root>
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
  const [sliced, setSliced] = useState<{result: SliceResult; inputs: Array<object>} | null>(null);
  const inputs = [positions, printers, materials];
  const result = sliced?.inputs.every((v, i) => v === inputs[i]) ? sliced.result : null;
  const setResult = (result: SliceResult | null) => setSliced(result && {result, inputs});
  const [layer, setLayer] = useState(0);
  const set = <K extends keyof SliceSettings>(k: K, v: SliceSettings[K]) => (
    setSettings({...settings, [k]: v}),
    setResult(null)
  );
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
        <Button
          iconStart={<LayersIcon />}
          disabled={tooBig}
          onClick={() => {
            const r = slice(positions, settings, printers[settings.printer], materials[settings.material]);
            setResult(r);
            setLayer(Math.floor(r.layers.length / 2));
          }}
        >
          Slice
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
