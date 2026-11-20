import {Button, Field, Grid, Heading, IconButton, Input, PageHeader, Stack, Table, Text, TextArea} from '@earendil-works/elanor-react';
import {useState, type ReactNode} from 'react';
import * as I from './icons.ts';
import {go} from './route.ts';
import {materials as stockMaterials, printers as stockPrinters, type Material, type Printer} from '@brim/core/slicer.ts';

type Dict<T> = Record<string, T>;
type Kind = 'printer' | 'material';
type NumField = {key: string; label: string; min: number; max: number};
type Draft = Record<string, string>;

const printerNums: NumField[] = [
  {key: 'x', label: 'Bed X (mm)', min: 10, max: 2000},
  {key: 'y', label: 'Bed Y (mm)', min: 10, max: 2000},
  {key: 'z', label: 'Max Z (mm)', min: 10, max: 2000},
];
const materialNums: NumField[] = [
  {key: 'nozzle', label: 'Nozzle (°C)', min: 150, max: 350},
  {key: 'bed', label: 'Bed (°C)', min: 0, max: 150},
  {key: 'density', label: 'Density (g/cm³)', min: 0.5, max: 3},
  {key: 'fan', label: 'Fan (%)', min: 0, max: 100},
];
const newPrinter: Printer = {name: '', bed: [220, 220, 250], start: 'G28 ; home\nG1 Z5 F3000', end: 'G1 Z+10 F600\nM84'};
const newMaterial: Material = {name: '', nozzle: 215, bed: 60, density: 1.24, fan: 255};

const toDraft = (kind: Kind, v: Printer | Material): Draft =>
  kind === 'printer'
    ? ((p) => ({name: p.name, x: String(p.bed[0]), y: String(p.bed[1]), z: String(p.bed[2]), start: p.start, end: p.end}))(v as Printer)
    : ((m) => ({name: m.name, nozzle: String(m.nozzle), bed: String(m.bed), density: String(m.density), fan: String(Math.round((m.fan / 255) * 100))}))(v as Material);

/** Field key → message for anything missing or out of range. */
function validate(nums: NumField[], d: Draft) {
  const errors: Record<string, string> = {};
  if (!d.name.trim()) errors.name = 'Enter a name.';
  for (const f of nums) {
    const v = Number(d[f.key]);
    if (d[f.key].trim() === '' || !Number.isFinite(v) || v < f.min || v > f.max) errors[f.key] = `Enter a number from ${f.min} to ${f.max}.`;
  }
  return errors;
}

export function Settings(props: {
  printers: Dict<Printer>;
  setPrinters: (f: (p: Dict<Printer>) => Dict<Printer>) => void;
  materials: Dict<Material>;
  setMaterials: (f: (m: Dict<Material>) => Dict<Material>) => void;
  inUse: {printer: string; material: string};
  /** Rest of the URL after `settings`, e.g. ['printer', 'mk4'] or ['material', 'new']. */
  route: string[];
}) {
  const {printers, setPrinters, materials, setMaterials, inUse} = props;
  const [routeKind, routeKey] = props.route;
  const setEditing = (e: {kind: Kind; key: string | null} | null) => go(e ? `settings/${e.kind}/${e.key ?? 'new'}` : 'settings');
  // null key = adding a new one; an unknown key (deleted, typo) falls back to the list.
  const editing =
    routeKind === 'printer' || routeKind === 'material'
      ? routeKey === 'new'
        ? {kind: routeKind as Kind, key: null}
        : routeKey && (routeKind === 'printer' ? printers : materials)[routeKey]
          ? {kind: routeKind as Kind, key: routeKey}
          : null
      : null;
  const remove = (kind: Kind, k: string, name: string) => {
    if (!confirm(`Delete “${name}”?`)) return;
    const drop = <T,>(d: Dict<T>) => Object.fromEntries(Object.entries(d).filter(([key]) => key !== k));
    if (kind === 'printer') setPrinters(drop);
    else setMaterials(drop);
    setEditing(null);
  };

  if (editing) {
    const {kind, key} = editing;
    const dict: Dict<Printer | Material> = kind === 'printer' ? printers : materials;
    const current = key ? dict[key] : kind === 'printer' ? newPrinter : newMaterial;
    return (
      <Editor
        key={kind + key}
        kind={kind}
        initial={toDraft(kind, current)}
        isNew={!key}
        canDelete={!!key && key !== inUse[kind]}
        onCancel={() => setEditing(null)}
        onDelete={() => key && remove(kind, key, current.name)}
        onSave={(d) => {
          const k = key ?? crypto.randomUUID();
          const name = d.name.trim();
          if (kind === 'printer') setPrinters((ps) => ({...ps, [k]: {name, bed: [Number(d.x), Number(d.y), Number(d.z)], start: d.start, end: d.end}}));
          else setMaterials((ms) => ({...ms, [k]: {name, nozzle: Number(d.nozzle), bed: Number(d.bed), density: Number(d.density), fan: Math.round((Number(d.fan) / 100) * 255)}}));
          setEditing(null);
        }}
      />
    );
  }

  const section = <T extends Printer | Material>(kind: Kind, heading: string, dict: Dict<T>, cols: string[], cells: (v: T) => (string | number)[]) => (
    <Stack gap="small" align="stretch">
      <Stack direction="row" gap="auto" align="center">
        <Heading level={2} size={5}>{heading}</Heading>
        <Button hierarchy="secondary" density="compact" iconStart={<I.AddIcon />} onClick={() => setEditing({kind, key: null})}>Add {kind}</Button>
      </Stack>
      <Table.Container>
        <Table.Root aria-label={heading}>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell scope="col">Name</Table.HeaderCell>
              {cols.map((c) => <Table.HeaderCell key={c} scope="col">{c}</Table.HeaderCell>)}
              <Table.HeaderCell scope="col"><span hidden>Actions</span></Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {Object.entries(dict).map(([k, v]) => (
              <Table.Row key={k}>
                <Table.Cell>
                  <a href="#" className="card-link" onClick={(e) => (e.preventDefault(), setEditing({kind, key: k}))}>{v.name}</a>
                  {k === inUse[kind] && <Text className="muted"> · in use</Text>}
                </Table.Cell>
                {cells(v).map((c, i) => <Table.Cell key={i}>{c}</Table.Cell>)}
                <Table.Cell align="end">
                  <Stack direction="row" gap="xSmall">
                    <IconButton aria-label={`Edit ${v.name}`} onClick={() => setEditing({kind, key: k})}><I.EditIcon /></IconButton>
                    <IconButton aria-label={`Delete ${v.name}`} disabled={k === inUse[kind]} onClick={() => remove(kind, k, v.name)}><I.DeleteIcon /></IconButton>
                  </Stack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.Container>
    </Stack>
  );

  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Printers & materials</PageHeader.Title>
          <PageHeader.Actions>
            <Button
              hierarchy="secondary"
              iconStart={<I.RestartAltIcon />}
              onClick={() => confirm('Replace all printers and materials with the presets?') && (setPrinters(() => stockPrinters), setMaterials(() => stockMaterials))}
            >
              Reset to presets
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>Used for the bed check, slicing and G-code. The one in use cannot be deleted.</PageHeader.Description>
      </PageHeader.Root>
      {section('printer', 'Printers', printers, ['Bed (mm)', 'Max Z (mm)'], (p) => [`${p.bed[0]} × ${p.bed[1]}`, p.bed[2]])}
      {section('material', 'Materials', materials, ['Nozzle', 'Bed', 'Density', 'Fan'], (m) => [`${m.nozzle} °C`, `${m.bed} °C`, `${m.density} g/cm³`, `${Math.round((m.fan / 255) * 100)}%`])}
    </Stack>
  );
}

function Editor(props: {kind: Kind; initial: Draft; isNew: boolean; canDelete: boolean; onCancel: () => void; onDelete: () => void; onSave: (d: Draft) => void}) {
  const {kind, isNew} = props;
  const nums = kind === 'printer' ? printerNums : materialNums;
  const [draft, setDraft] = useState(props.initial);
  const [tried, setTried] = useState(false);
  const errors = validate(nums, draft);
  const shown = tried ? errors : {};
  const set = (k: string) => (v: string) => setDraft((d) => ({...d, [k]: v}));
  const save = () => (setTried(true), Object.keys(errors).length === 0 && props.onSave(draft));
  const label = kind === 'printer' ? 'printer' : 'material';

  const field = (k: string, text: string, control: ReactNode) => (
    <Field.Root name={k} invalid={!!shown[k]}>
      <Field.Label>{text}</Field.Label>
      {control}
      {shown[k] && <Field.Error match>{shown[k]}</Field.Error>}
    </Field.Root>
  );

  return (
    <Stack gap="xLarge" align="stretch">
      <div>
        <Button hierarchy="secondary" density="compact" iconStart={<I.ArrowBackIcon />} onClick={props.onCancel}>Printers & materials</Button>
      </div>
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>{isNew ? `New ${label}` : props.initial.name}</PageHeader.Title>
          {!isNew && (
            <PageHeader.Actions>
              <Button hierarchy="secondary" iconStart={<I.DeleteIcon />} disabled={!props.canDelete} onClick={props.onDelete}>Delete</Button>
            </PageHeader.Actions>
          )}
        </PageHeader.Row>
        {!isNew && !props.canDelete && <PageHeader.Description>In use for printing, so it cannot be deleted.</PageHeader.Description>}
      </PageHeader.Root>

      <form className="editor" onSubmit={(e) => (e.preventDefault(), save())}>
        <Stack gap="large" align="stretch">
          {field('name', 'Name', <Input value={draft.name} onValueChange={set('name')} autoFocus={isNew} />)}
          <Grid.Root>
            {nums.map((f) => (
              <Grid.Item key={f.key} span={{base: 'full', small: kind === 'printer' ? 4 : 6}}>
                {field(f.key, f.label, <Input inputMode="decimal" value={draft[f.key]} onValueChange={set(f.key)} />)}
              </Grid.Item>
            ))}
          </Grid.Root>
          {kind === 'printer' && (
            <>
              {field('start', 'Start G-code', <TextArea className="mono" value={draft.start} onValueChange={set('start')} />)}
              {field('end', 'End G-code', <TextArea className="mono" value={draft.end} onValueChange={set('end')} />)}
            </>
          )}
          <Stack direction="row" gap="small">
            <Button type="submit">{isNew ? `Add ${label}` : 'Save'}</Button>
            <Button type="button" hierarchy="secondary" onClick={props.onCancel}>Cancel</Button>
          </Stack>
        </Stack>
      </form>
    </Stack>
  );
}
