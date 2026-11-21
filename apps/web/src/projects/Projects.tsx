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
import {AddIcon, ArrowBackIcon, DeleteIcon} from '../ui/icons.ts';
import {PartList} from '../library/Library.tsx';
import {count, edited, type Note, type Part, type Project} from '../lib/library.ts';
import {go} from '../lib/route.ts';
import {RenameButton, UploadButton} from '../ui/controls.tsx';

/** One project: its parts and notes. Files come with the backend. */
export function ProjectPage(props: {
  project: Project;
  parts: Array<Part>;
  notes: Array<Note>;
  setNotes: (f: (n: Array<Note>) => Array<Note>) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpload: (f: File) => void;
}) {
  const {project, parts, notes, setNotes} = props;
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
          onClick={() => go('library/projects')}
        >
          Projects
        </Button>
      </div>
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>{project.name}</PageHeader.Title>
          <PageHeader.Actions>
            <RenameButton key={project.id} what="project" name={project.name} onRename={props.onRename} />
            <Button hierarchy="secondary" iconStart={<DeleteIcon />} onClick={props.onDelete}>
              Delete
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>
          {[count(parts.length, 'part'), count(own.length, 'note'), edited(project.edited)].join(' · ')}
        </PageHeader.Description>
      </PageHeader.Root>

      <Stack gap="small" align="stretch">
        <Stack direction="row" gap="auto" align="center">
          <Heading level={2} size={5}>
            Parts
          </Heading>
          <Stack direction="row" gap="small">
            <UploadButton compact onFile={props.onUpload} />
            <Button density="compact" iconStart={<AddIcon />} onClick={() => go(`new/${project.id}`)}>
              New part
            </Button>
          </Stack>
        </Stack>
        {parts.length ? (
          <PartList parts={parts} />
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

/** Edits the projects the current part is used in, or adds it to a new one. */
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
  return (
    <Dropdown.Root multiple value={value} onValueChange={(v) => (v.includes(NEW) ? onCreate() : onChange(v))}>
      <Dropdown.Trigger aria-label="Projects" density="compact" className="picker">
        <Dropdown.Value>{() => 'Edit projects'}</Dropdown.Value>
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
