// Projects and notes; see docs/domain.md. Kept as flat lists so they map 1:1 to the planned server tables.

export interface Project {
  id: string;
  name: string;
  edited: number; // ms timestamp of creation or the last rename
}

/** Plain text in a project (markdown later). */
export interface Note {
  id: string;
  projectId: string;
  body: string;
  edited: number;
}

type InProject = {projectId?: string};

/** A part is loose when it has no project, or its project no longer exists. */
export const isLoose = (p: InProject, projects: Project[]) => !p.projectId || !projects.some((x) => x.id === p.projectId);

/** Deleting a project keeps its parts (now loose) and drops its notes. */
export function removeProject<P extends InProject>(id: string, s: {projects: Project[]; parts: P[]; notes: Note[]}) {
  return {
    projects: s.projects.filter((p) => p.id !== id),
    parts: s.parts.map((p) => (p.projectId === id ? {...p, projectId: undefined} : p)),
    notes: s.notes.filter((n) => n.projectId !== id),
  };
}

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const edited = (t?: number) => (t ? 'Edited ' + new Date(t).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '');
