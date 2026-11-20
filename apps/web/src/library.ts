// Projects, notes and uses; see docs/domain.md. Kept as flat lists so they map 1:1 to the planned server tables.

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

/** A Library item used in a project. One item can be used in many projects. */
export interface Use {
  projectId: string;
  itemId: string;
  qty: number; // how many to print; no UI yet, always 1
}

export const projectsOf = (itemId: string, uses: Array<Use>) =>
  uses.flatMap((u) => (u.itemId === itemId ? [u.projectId] : []));

export const itemsIn = (projectId: string, uses: Array<Use>) =>
  new Set(uses.flatMap((u) => (u.projectId === projectId ? [u.itemId] : [])));

/** Makes `itemId` used in exactly `projectIds`, keeping the qty of uses that stay. */
export const withProjects = (itemId: string, projectIds: Array<string>, uses: Array<Use>): Array<Use> => [
  ...uses.filter((u) => u.itemId !== itemId || projectIds.includes(u.projectId)),
  ...projectIds.flatMap((projectId) =>
    uses.some((u) => u.itemId === itemId && u.projectId === projectId) ? [] : [{projectId, itemId, qty: 1}],
  ),
];

/** Deleting a project drops its uses and notes; Library items stay. */
export const removeProject = (id: string, s: {projects: Array<Project>; uses: Array<Use>; notes: Array<Note>}) => ({
  projects: s.projects.filter((p) => p.id !== id),
  uses: s.uses.filter((u) => u.projectId !== id),
  notes: s.notes.filter((n) => n.projectId !== id),
});

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const edited = (t?: number) =>
  t ? 'Edited ' + new Date(t).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '';
