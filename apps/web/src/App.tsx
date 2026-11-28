import {
  Button,
  EmptyState,
  SegmentedControl,
  SideNavigation,
  Sidebar,
  Tooltip,
  TopNavigation,
} from '@earendil-works/elanor-react';
import radiusCss from '@earendil-works/design-tokens/radius.css?url';
import elanorCss from '@earendil-works/design-tokens/elanor.css?url';
import lefosCss from '@earendil-works/design-tokens/lefos.css?url';
import {useEffect, useState} from 'react';
import {
  AccountCircleIcon,
  AutoFixHighIcon,
  BorderClearIcon,
  BorderOuterIcon,
  DarkModeIcon,
  HomeIcon,
  Inventory2Icon,
  LightModeIcon,
  PrintIcon,
  ScheduleIcon,
  SettingsIcon,
  ShelvesIcon,
} from './ui/icons.ts';
import {applyOps, describe, editMesh, finalize, parsePrompt, type Model} from '@brim/core/model.ts';
import {
  materials as stockMaterials,
  printers as stockPrinters,
  type Material,
  type Printer,
  type SliceSettings,
} from '@brim/core/slicer.ts';
import {Filaments} from './filament/Filaments.tsx';
import {Home} from './home/Home.tsx';
import {Jobs, type Job} from './jobs/Jobs.tsx';
import {Library} from './library/Library.tsx';
import {PartPage, sections} from './parts/Part.tsx';
import {Designer} from './designer/Designer.tsx';
import {Settings} from './settings/Settings.tsx';
import {AccountSettings, demoAccount, Login, type Account} from './settings/Account.tsx';
import {go, useRoute} from './lib/route.ts';
import {useStored} from './lib/store.ts';
import {parseMesh} from './lib/mesh.ts';
import {askLlm} from './lib/intent.ts';
import {
  count,
  autoName,
  itemsIn,
  projectsOf,
  removePart,
  removeProject,
  title,
  withProjects,
  type Entry,
  type Note,
  type Part,
  type Project,
  type Use,
} from './lib/library.ts';
import {ProjectPage} from './projects/Projects.tsx';

// Without the dev server (a static build) imported meshes are not saved, and thumbnails share the ~5 MB localStorage quota.
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

/** Resolves a prompt to the next history entry, via the LLM when available. */
async function resolve(prompt: string, m?: Model): Promise<Entry> {
  const intent = await askLlm(prompt, m);
  if (intent?.type === 'spec') {
    return {prompt, changes: [describe(intent.spec)], model: {type: 'param', spec: intent.spec}};
  }
  if (intent && m) {
    return {prompt, ...(await applyOps(m, intent.ops))};
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
  const r = await editMesh(prompt, m);
  return {
    prompt,
    changes: r.changes.length
      ? r.changes
      : ['imported meshes support scale, taller, wider, flip, rotate and drilling a hole'],
    model: r.model,
  };
}

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
  const [uses, setUses] = useStored<Array<Use>>('brim-uses', () => []);
  const route = useRoute();
  // Old #/model/, #/queue, #/projects and #/new links still open.
  const old = {model: 'part', queue: 'jobs', projects: 'library', new: 'design'};
  const page = (Object.hasOwn(old, route[0] ?? '') ? old[route[0] as keyof typeof old] : route[0]) ?? 'home';
  const libraryTab =
    route[0] === 'projects' || (page === 'library' && route[1] === 'projects')
      ? 'projects'
      : page === 'library' && route[1] === 'files'
        ? 'files'
        : 'parts';
  const part = page === 'part' ? parts.find((p) => p.id === route[1]) : undefined;
  const partProjects = part ? projectsOf(part.id, uses).filter((id) => projects.some((p) => p.id === id)) : [];
  // A part page links back to its project only when there is just one.
  const project = projects.find(
    (p) => p.id === (page === 'project' || page === 'design' ? route[1] : partProjects.length === 1 && partProjects[0]),
  );
  const projectParts = (id: string) => ((ids) => parts.filter((p) => ids.has(p.id)))(itemsIn(id, uses));
  // shortcut: window.prompt for the name; swap for a Modal like RenameButton if it feels rough.
  const newProject = (addPartId?: string) => {
    const name = prompt('Project name')?.trim();
    if (!name) {
      return;
    }
    const p: Project = {id: crypto.randomUUID(), name, edited: Date.now()};
    setProjects((ps) => [p, ...ps]);
    if (addPartId) {
      setUses((us) => [...us, {projectId: p.id, itemId: addPartId, qty: 1}]);
    } else {
      go(`project/${p.id}`);
    }
  };
  const deleteProject = (p: Project) => {
    const n = projectParts(p.id).length;
    if (
      !confirm(
        `Delete project “${p.name}”? Its ${count(n, 'part')} stay in the Library; its ${count(notes.filter((x) => x.projectId === p.id).length, 'note')} are deleted.`,
      )
    ) {
      return;
    }
    const r = removeProject(p.id, {projects, uses, notes});
    setProjects(r.projects);
    setUses(r.uses);
    setNotes(r.notes);
    go('library/projects');
  };
  const section = sections.includes(route[2]) ? route[2] : undefined; // none: the part overview
  const setPart = (id: string, f: (p: Part) => Part, touch?: boolean) =>
    setParts((ps) => ps.map((p) => (p.id === id ? {...f(p), ...(touch && {edited: Date.now()})} : p)));
  const create = (p: Omit<Part, 'id' | 'edited'>, projectIds: Array<string> = []) => {
    const mesh = p.history[0].model.type === 'mesh';
    // oxlint-disable-next-line react/purity -- event handler, not render
    const next = {...p, name: p.name ?? (mesh ? undefined : autoName()), id: crypto.randomUUID(), edited: Date.now()};
    setParts((ps) => [next, ...ps]);
    setUses((us) => withProjects(next.id, projectIds, us));
    go(`part/${next.id}/refine`);
  };
  const duplicate = () => part && create({...part, name: title(part) + ' copy'}, partProjects);
  const remove = () => {
    const used = partProjects.length ? ` It is used in ${count(partProjects.length, 'project')}.` : '';
    if (!part || !confirm(`Delete “${title(part)}”?${used} This cannot be undone.`)) {
      return;
    }
    const r = removePart(part.id, {parts, uses});
    setParts(r.parts);
    setUses(r.uses);
    go('library');
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
  const printer = printers[sliceSettings.printer];

  /** A refinement of the open part. */
  const onPrompt = async (prompt: string) => {
    if (part) {
      const e = await resolve(prompt, part.history.at(-1)!.model);
      setPart(part.id, (p) => ({...p, history: [...p.history, e]}), true);
    }
  };
  const upload = async (file: File, projectId?: string) => {
    try {
      const positions = finalize(parseMesh(file.name, await file.arrayBuffer()));
      const entry: Entry = {
        prompt: `Imported ${file.name}`,
        changes: [`${positions.length / 9} triangles`],
        model: {type: 'mesh', name: file.name.replace(/\.[^.]+$/, ''), positions},
      };
      create({history: [entry]}, projectId ? [projectId] : []);
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
          <a href="#/" className="brand">
            <img
              className="brand-mark"
              src={`${import.meta.env.BASE_URL}brim-mark.png`}
              width={32}
              height={32}
              alt=""
            />
            <strong>Brim</strong>
          </a>
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
                        ['home', 'Home', HomeIcon],
                        ['design', 'Designer', AutoFixHighIcon],
                        ['library', 'Library', Inventory2Icon],
                        ['filament', 'Filament', ShelvesIcon],
                        [
                          'jobs',
                          `Jobs${jobs.some((j) => !j.outcome) ? ` (${jobs.filter((j) => !j.outcome).length})` : ''}`,
                          ScheduleIcon,
                        ],
                        ['settings', 'Printers & materials', SettingsIcon],
                      ] as const
                    ).map(([v, label, Icon]) => (
                      <SideNavigation.Item key={v}>
                        <SideNavigation.Link
                          href={`#/${v === 'home' ? '' : v}`}
                          iconStart={<Icon />}
                          active={
                            page === v ||
                            (v === 'jobs' && page === 'job') ||
                            (v === 'library' && (page === 'part' || page === 'project'))
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
          {page === 'design' ? (
            <Designer
              project={project}
              recent={[...parts].sort((a, b) => (b.edited ?? 0) - (a.edited ?? 0)).slice(0, 3)}
              printer={printer}
              theme={applied}
              onCreate={(e) => create({history: [e]}, project ? [project.id] : [])}
              onUpload={(f) => upload(f, project?.id)}
            />
          ) : page === 'project' ? (
            project ? (
              <ProjectPage
                key={project.id}
                project={project}
                parts={projectParts(project.id)}
                notes={notes}
                setNotes={setNotes}
                onRename={(name) =>
                  setProjects((ps) => ps.map((p) => (p.id === project.id ? {...p, name, edited: Date.now()} : p)))
                }
                onDelete={() => deleteProject(project)}
                onUpload={(f) => upload(f, project.id)}
              />
            ) : (
              <EmptyState.Root>
                <EmptyState.Body>
                  <EmptyState.Copy>
                    <EmptyState.Title level={1}>Project not found</EmptyState.Title>
                  </EmptyState.Copy>
                  <EmptyState.Actions>
                    <Button onClick={() => go('library/projects')}>Back to Projects</Button>
                  </EmptyState.Actions>
                </EmptyState.Body>
              </EmptyState.Root>
            )
          ) : page === 'jobs' || page === 'job' ? (
            <Jobs
              jobs={jobs}
              setJobs={setJobs}
              onOpen={(id) => parts.some((p) => p.id === id) && go(`part/${id}/print`)}
              job={page === 'job' ? route[1] : undefined}
            />
          ) : page === 'filament' ? (
            <Filaments />
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
          ) : !part ? (
            page === 'part' ? (
              <EmptyState.Root>
                <EmptyState.Body>
                  <EmptyState.Copy>
                    <EmptyState.Title level={1}>Part not found</EmptyState.Title>
                    <EmptyState.Description>It may have been deleted.</EmptyState.Description>
                  </EmptyState.Copy>
                  <EmptyState.Actions>
                    <Button onClick={() => go('library')}>Back to Library</Button>
                  </EmptyState.Actions>
                </EmptyState.Body>
              </EmptyState.Root>
            ) : page === 'home' ? (
              <Home parts={parts} projects={projects} jobs={jobs} printers={printers} />
            ) : (
              <Library
                tab={libraryTab}
                parts={parts}
                projects={projects}
                notes={notes}
                uses={uses}
                onUpload={(f) => upload(f)}
                onNewProject={() => newProject()}
              />
            )
          ) : (
            <PartPage
              key={part.id}
              part={part}
              project={project}
              projects={projects}
              partProjects={partProjects}
              section={section}
              setPart={(f, touch) => setPart(part.id, f, touch)}
              onPrompt={onPrompt}
              onDuplicate={duplicate}
              onDelete={remove}
              onProjects={(ids) => setUses((us) => withProjects(part.id, ids, us))}
              onNewProject={() => newProject(part.id)}
              printers={printers}
              materials={materials}
              settings={sliceSettings}
              setSettings={setSettings}
              theme={applied}
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
                  },
                  ...js,
                ]);
                go('jobs');
              }}
            />
          )}
        </main>
      </div>
    </>
  );
}
