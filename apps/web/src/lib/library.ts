// Parts, projects, notes and uses; see docs/domain.md. Kept as flat lists so they map 1:1 to the planned server tables.
import {joyful} from 'joyful';
import type {Model} from '@brim/core/model.ts';

/** One step in a part's history: a full snapshot. */
export interface Entry {
  prompt: string;
  changes: Array<string>;
  model: Model;
}

export interface Part {
  id: string;
  name?: string;
  description?: string; // user's own notes on what the part is for
  thumb?: string; // webp data URL of the viewer
  history: Array<Entry>;
  edited?: number; // ms timestamp of the last design change or rename
}

/** Random friendly name for a new part, e.g. "Jumping fox". */
export const autoName = () => {
  const n = joyful({pattern: ['adjective', 'animal'], separator: ' '});
  return n[0].toUpperCase() + n.slice(1);
};

export const title = (p: Part) =>
  p.name || ((m) => (m.type === 'mesh' ? m.name : 'Untitled ' + m.spec.kind))(p.history.at(-1)!.model);

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

/** Deleting a part drops its uses; projects stay. */
export const removePart = (id: string, s: {parts: Array<Part>; uses: Array<Use>}) => ({
  parts: s.parts.filter((p) => p.id !== id),
  uses: s.uses.filter((u) => u.itemId !== id),
});

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const edited = (t?: number) =>
  t ? 'Edited ' + new Date(t).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : '';
