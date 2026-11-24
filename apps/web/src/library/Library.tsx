import {Button, EmptyState, PageHeader, Stack, Tabs} from '@earendil-works/elanor-react';
import {describe} from '@brim/core/model.ts';
import {AddIcon, DescriptionIcon, FolderOpenIcon, ViewInArIcon} from '../ui/icons.ts';
import {Files} from './Files.tsx';
import {count, edited, itemsIn, title, type Note, type Part, type Project, type Use} from '../lib/library.ts';
import {go} from '../lib/route.ts';
import {ListItem, UploadButton} from '../ui/controls.tsx';

/** Parts, Files and Projects, one tab at a time. Parts and Files are the things; Projects only reference them. */
export function Library(props: {
  tab: 'parts' | 'files' | 'projects';
  parts: Array<Part>;
  projects: Array<Project>;
  notes: Array<Note>;
  uses: Array<Use>;
  onUpload: (f: File) => void;
  onNewProject: () => void;
}) {
  const {tab, parts} = props;
  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Library</PageHeader.Title>
          <PageHeader.Actions>
            {tab === 'parts' ? (
              <>
                <UploadButton onFile={props.onUpload} />
                <Button iconStart={<AddIcon />} onClick={() => go('design')}>
                  New part
                </Button>
              </>
            ) : tab === 'files' ? null : (
              <Button iconStart={<AddIcon />} onClick={props.onNewProject}>
                New project
              </Button>
            )}
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>
          {tab === 'parts'
            ? 'Parts are the printable things, each with its own design history. One part can be used in many projects.'
            : tab === 'files'
              ? 'Files are reference material kept exactly as uploaded: photos, PDFs, datasheets, other people’s models.'
              : 'Projects group parts and notes for something you are making. They point to parts, not copies: editing a part changes it in every project.'}
        </PageHeader.Description>
      </PageHeader.Root>
      <Tabs.Root value={tab} onValueChange={(v) => go(v === 'parts' ? 'library' : `library/${v}`)}>
        <Tabs.List aria-label="Library" className="sections">
          <Tabs.Tab value="parts">
            <ViewInArIcon />
            Parts ({parts.length})
          </Tabs.Tab>
          <Tabs.Tab value="files">
            <DescriptionIcon />
            Files
          </Tabs.Tab>
          <Tabs.Tab value="projects">
            <FolderOpenIcon />
            Projects ({props.projects.length})
          </Tabs.Tab>
          <Tabs.Indicator className="sections-indicator" />
        </Tabs.List>
      </Tabs.Root>
      {tab === 'projects' ? (
        <ProjectList {...props} />
      ) : tab === 'files' ? (
        <Files onMakePart={props.onUpload} />
      ) : parts.length ? (
        <PartList parts={parts} />
      ) : (
        <EmptyState.Root>
          <EmptyState.Illustration>
            <ViewInArIcon size={48} />
          </EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>No parts yet</EmptyState.Title>
              <EmptyState.Description>
                Describe a part in plain words, or import an STL, 3MF or OBJ file.
              </EmptyState.Description>
            </EmptyState.Copy>
            <EmptyState.Actions>
              <Button iconStart={<AddIcon />} onClick={() => go('design')}>
                New part
              </Button>
            </EmptyState.Actions>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
    </Stack>
  );
}

const newestFirst = <T extends {edited?: number}>(xs: Array<T>) =>
  [...xs].sort((a, b) => (b.edited ?? 0) - (a.edited ?? 0));

export function PartList({parts}: {parts: Array<Part>}) {
  return (
    <ul className="model-list">
      {newestFirst(parts).map((p) => {
        const m = p.history.at(-1)!.model;
        return (
          <ListItem
            key={p.id}
            href={`#/part/${p.id}`}
            thumb={p.thumb}
            title={title(p)}
            lines={[
              m.type === 'param' ? describe(m.spec) : 'Imported mesh',
              [edited(p.edited), count(p.history.length, 'step')].filter(Boolean).join(' · '),
            ]}
          />
        );
      })}
    </ul>
  );
}

/** The Library's Projects tab: every project, newest first. */
function ProjectList({
  projects,
  parts,
  notes,
  uses,
  onNewProject,
}: {
  projects: Array<Project>;
  parts: Array<Part>;
  notes: Array<Note>;
  uses: Array<Use>;
  onNewProject: () => void;
}) {
  return projects.length ? (
    <ul className="model-list">
      {newestFirst(projects).map((p) => {
        const ids = itemsIn(p.id, uses);
        const own = parts.filter((x) => ids.has(x.id));
        return (
          <ListItem
            key={p.id}
            href={`#/project/${p.id}`}
            thumb={newestFirst(own).find((x) => x.thumb)?.thumb}
            title={p.name}
            lines={[
              [count(own.length, 'part'), count(notes.filter((n) => n.projectId === p.id).length, 'note')].join(' · '),
              edited(p.edited),
            ]}
          />
        );
      })}
    </ul>
  ) : (
    <EmptyState.Root>
      <EmptyState.Body>
        <EmptyState.Copy>
          <EmptyState.Title level={2}>No projects yet</EmptyState.Title>
          <EmptyState.Description>Group parts and notes for something you are making.</EmptyState.Description>
        </EmptyState.Copy>
        <EmptyState.Actions>
          <Button iconStart={<AddIcon />} onClick={onNewProject}>
            New project
          </Button>
        </EmptyState.Actions>
      </EmptyState.Body>
    </EmptyState.Root>
  );
}
