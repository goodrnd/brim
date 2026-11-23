// What the Designer shows as editable "understood" chips for a spec, and how a chip edit applies.
import {normalize, round, type Kind, type NumField, type Spec} from '@brim/core/model.ts';

export type Chip = {field: NumField; label: string; value: number; unit: string};

const walled = new Set<Kind>(['vase', 'cup', 'tube', 'box']);
const holed = new Set<Kind>(['gear', 'hex', 'star', 'tag', 'plate', 'cylinder']);
const cornered = new Set<Kind>(['box', 'plate', 'tag']);

/** The fields that matter for this kind, plus any the prompt set away from neutral. */
export function chips(s: Spec): Array<Chip> {
  const r = round.has(s.kind);
  const out: Array<Chip | false> = [
    {field: 'width', label: r ? 'Diameter' : 'Width', value: s.width, unit: 'mm'},
    !r && {field: 'depth', label: 'Depth', value: s.depth, unit: 'mm'},
    s.kind !== 'sphere' && {field: 'height', label: 'Height', value: s.height, unit: 'mm'},
    (walled.has(s.kind) || s.wall > 0) && {field: 'wall', label: 'Wall', value: s.wall, unit: 'mm'},
    (holed.has(s.kind) || s.hole > 0) && {field: 'hole', label: 'Hole', value: s.hole, unit: 'mm'},
    s.kind === 'gear' && {field: 'teeth', label: 'Teeth', value: s.teeth, unit: ''},
    s.kind === 'star' && {field: 'points', label: 'Points', value: s.points, unit: ''},
    (s.kind === 'vase' || s.ribs > 0) && {field: 'ribs', label: 'Ribs', value: s.ribs, unit: ''},
    (s.kind === 'vase' || s.twist !== 0) && {field: 'twist', label: 'Twist', value: s.twist, unit: '°'},
    (cornered.has(s.kind) || s.corner > 0) && {field: 'corner', label: 'Corners', value: s.corner, unit: 'mm'},
  ];
  return out.filter((c): c is Chip => !!c);
}

/** Applies chip edits on top of `s`. Edits made for another kind are dropped, since the fields mean different things. */
export const withEdits = (s: Spec, edits?: {kind: Kind; values: Partial<Spec>}) =>
  edits?.kind === s.kind ? normalize({...s, ...edits.values}) : s;
