import {
  Button,
  Dropdown,
  EmptyState,
  Heading,
  IconButton,
  PageHeader,
  Stack,
  Text,
  TextArea,
} from '@earendil-works/elanor-react';
import type {ReactNode} from 'react';
import {AddIcon, ArrowBackIcon, DeleteIcon} from './icons.ts';
import {count, edited, itemsIn, type Note, type Project, type Use} from './library.ts';

type Thumb = {id: string; thumb?: string; edited?: number};

/** Projects block at the top of the Library. */
export function ProjectList({
  projects,
  parts,
  notes,
  uses,
}: {
  projects: Array<Project>;
  parts: Array<Thumb>;
  notes: Array<Note>;
  uses: Array<Use>;
}) {
  if (!projects.length) {
    return null;
  }
  const sorted = [...projects].sort((a, b) => b.edited - a.edited);
  return (
    <Stack gap="small" align="stretch">
      <Heading level={2} size={5}>
        Projects
      </Heading>
      <ul className="model-list">
        {sorted.map((p) => {
          const ids = itemsIn(p.id, uses);
          const own = parts.filter((x) => ids.has(x.id));
          const thumb = [...own].sort((a, b) => (b.edited ?? 0) - (a.edited ?? 0)).find((x) => x.thumb)?.thumb;
          const href = `#/project/${p.id}`;
          return (
            <li key={p.id}>
              <a href={href} className="card-link" tabIndex={-1} aria-hidden>
                {thumb ? <img className="thumb" src={thumb} alt="" /> : <div className="thumb" />}
              </a>
              <Stack gap="xSmall" align="stretch">
                <Heading level={3} size={5}>
                  <a href={href} className="card-link">
                    {p.name}
                  </a>
                </Heading>
                <Text className="muted">
                  {[count(own.length, 'part'), count(notes.filter((n) => n.projectId === p.id).length, 'note')].join(
                    ' · ',
                  )}
                </Text>
                <Text className="muted">{edited(p.edited)}</Text>
              </Stack>
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}

/** One project: its parts (rendered by the caller) and notes. Files come with the backend. */
export function ProjectPage(props: {
  project: Project;
  partCount: number;
  parts: ReactNode;
  actions: ReactNode;
  partActions: ReactNode;
  notes: Array<Note>;
  setNotes: (f: (n: Array<Note>) => Array<Note>) => void;
}) {
  const {project, notes, setNotes} = props;
  const own = notes.filter((n) => n.projectId === project.id);
  const update = (id: string, body: string) =>
    setNotes((ns) => ns.map((n) => (n.id === id ? {...n, body, edited: Date.now()} : n)));
  const add = () =>
    setNotes((ns) => [...ns, {id: crypto.randomUUID(), projectId: project.id, body: '', edited: Date.now()}]);
  return (
    <Stack gap="xLarge" align="stretch">
      <div>
        <Button
          hierarchy="secondary"
          density="compact"
          iconStart={<ArrowBackIcon />}
          onClick={() => (location.hash = '/')}
        >
          Library
        </Button>
      </div>
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>{project.name}</PageHeader.Title>
          <PageHeader.Actions>{props.actions}</PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>
          {[count(props.partCount, 'part'), count(own.length, 'note'), edited(project.edited)].join(' · ')}
        </PageHeader.Description>
      </PageHeader.Root>

      <Stack gap="small" align="stretch">
        <Stack direction="row" gap="auto" align="center">
          <Heading level={2} size={5}>
            Parts
          </Heading>
          <Stack direction="row" gap="small">
            {props.partActions}
          </Stack>
        </Stack>
        {props.partCount ? (
          props.parts
        ) : (
          <EmptyState.Root>
            <EmptyState.Body>
              <EmptyState.Copy>
                <EmptyState.Title level={3}>No parts yet</EmptyState.Title>
                <EmptyState.Description>Create a part here, or add one from its page.</EmptyState.Description>
              </EmptyState.Copy>
            </EmptyState.Body>
          </EmptyState.Root>
        )}
      </Stack>

      <Stack gap="small" align="stretch">
        <Stack direction="row" gap="auto" align="center">
          <Heading level={2} size={5}>
            Notes
          </Heading>
          <Button hierarchy="secondary" density="compact" iconStart={<AddIcon />} onClick={add}>
            Add note
          </Button>
        </Stack>
        {own.map((n, i) => (
          <Stack key={n.id} direction="row" gap="small" align="start">
            <TextArea
              className="full"
              aria-label={`Note ${i + 1}`}
              autoFocus={!n.body && i === own.length - 1}
              placeholder="Measurements, print settings that worked, ideas…"
              value={n.body}
              onValueChange={(v) => update(n.id, v)}
            />
            <IconButton
              aria-label={`Delete note ${i + 1}`}
              onClick={() =>
                (!n.body || confirm('Delete this note?')) && setNotes((ns) => ns.filter((x) => x.id !== n.id))
              }
            >
              <DeleteIcon />
            </IconButton>
          </Stack>
        ))}
        {!own.length && (
          <Text className="muted">Notes are plain text: measurements, what worked, what to try next.</Text>
        )}
      </Stack>
    </Stack>
  );
}

const NEW = '\0new'; // sentinel item value; never a real project id

/** Picks the projects the current part is used in, or adds it to a new one. */
export function ProjectPicker({
  value,
  projects,
  onChange,
  onCreate,
}: {
  value: Array<string>;
  projects: Array<Project>;
  onChange: (ids: Array<string>) => void;
  onCreate: () => void;
}) {
  const label = (ids: Array<string>) =>
    ids.length === 0
      ? 'No project'
      : ids.length === 1
        ? (projects.find((p) => p.id === ids[0])?.name ?? 'No project')
        : count(ids.length, 'project');
  return (
    <Dropdown.Root multiple value={value} onValueChange={(v) => (v.includes(NEW) ? onCreate() : onChange(v))}>
      <Dropdown.Trigger aria-label="Projects" density="compact" className="picker">
        <Dropdown.Value>{label}</Dropdown.Value>
        <Dropdown.Icon />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Positioner>
          <Dropdown.Popup>
            <Dropdown.List>
              {projects.map((p) => (
                <Dropdown.Item key={p.id} value={p.id}>
                  {p.name}
                </Dropdown.Item>
              ))}
              <Dropdown.Separator />
              <Dropdown.Item value={NEW}>New project…</Dropdown.Item>
            </Dropdown.List>
          </Dropdown.Popup>
        </Dropdown.Positioner>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
