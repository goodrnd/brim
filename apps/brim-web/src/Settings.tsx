import {Button, Heading, IconButton, Input, PageHeader, Stack, Table} from '@earendil-works/elanor-react';
import * as I from './icons.ts';
import {materials as stockMaterials, printers as stockPrinters, type Material, type Printer} from './slicer.ts';

type Dict<T> = Record<string, T>;

/** Text field that keeps numbers in range; bad input leaves the old value. */
function Num({label, value, min, max, onChange}: {label: string; value: number; min: number; max: number; onChange: (v: number) => void}) {
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      defaultValue={String(value)}
      onBlur={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
        else e.currentTarget.value = String(value);
      }}
    />
  );
}

export function Settings(props: {
  printers: Dict<Printer>;
  setPrinters: (f: (p: Dict<Printer>) => Dict<Printer>) => void;
  materials: Dict<Material>;
  setMaterials: (f: (m: Dict<Material>) => Dict<Material>) => void;
  inUse: {printer: string; material: string};
}) {
  const {printers, setPrinters, materials, setMaterials, inUse} = props;
  const patch = <T,>(set: (f: (d: Dict<T>) => Dict<T>) => void, k: string, p: Partial<T> | null) =>
    set((d) => {
      const next = {...d};
      if (p) next[k] = {...d[k], ...p};
      else delete next[k];
      return next;
    });
  const pr = (k: string, p: Partial<Printer> | null) => patch(setPrinters, k, p);
  const mt = (k: string, p: Partial<Material> | null) => patch(setMaterials, k, p);
  const bed = (k: string, i: number, v: number) => pr(k, {bed: printers[k].bed.map((b, j) => (j === i ? v : b)) as Printer['bed']});

  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Printers & materials</PageHeader.Title>
          <PageHeader.Actions>
            <Button hierarchy="secondary" iconStart={<I.RestartAltIcon />} onClick={() => (setPrinters(() => stockPrinters), setMaterials(() => stockMaterials))}>Reset to presets</Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>Used for the bed check, slicing and G-code. Changes save as you leave a field.</PageHeader.Description>
      </PageHeader.Root>

      <Stack gap="small" align="stretch">
        <Stack direction="row" gap="auto" align="center">
          <Heading level={2} size={5}>Printers</Heading>
          <Button hierarchy="secondary" density="compact" iconStart={<I.AddIcon />} onClick={() => pr(crypto.randomUUID(), {name: 'My printer', bed: [220, 220, 250], start: 'G28 ; home\nG1 Z5 F3000', end: 'G1 Z+10 F600\nM84'})}>Add printer</Button>
        </Stack>
        <Table.Container>
          <Table.Root aria-label="Printers">
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell scope="col">Name</Table.HeaderCell>
                <Table.HeaderCell scope="col">Bed X (mm)</Table.HeaderCell>
                <Table.HeaderCell scope="col">Bed Y (mm)</Table.HeaderCell>
                <Table.HeaderCell scope="col">Max Z (mm)</Table.HeaderCell>
                <Table.HeaderCell scope="col"><span hidden>Actions</span></Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {Object.entries(printers).map(([k, p]) => (
                <Table.Row key={k + JSON.stringify(p)}>
                  <Table.Cell><Input aria-label="Printer name" defaultValue={p.name} onBlur={(e) => e.currentTarget.value.trim() && pr(k, {name: e.currentTarget.value.trim()})} /></Table.Cell>
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <Table.Cell key={axis}><Num label={`${p.name} bed ${axis}`} value={p.bed[i]} min={10} max={2000} onChange={(v) => bed(k, i, v)} /></Table.Cell>
                  ))}
                  <Table.Cell align="end">
                    <IconButton aria-label={`Remove ${p.name}`} disabled={k === inUse.printer} onClick={() => pr(k, null)}><I.DeleteIcon /></IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.Container>
      </Stack>

      <Stack gap="small" align="stretch">
        <Stack direction="row" gap="auto" align="center">
          <Heading level={2} size={5}>Materials</Heading>
          <Button hierarchy="secondary" density="compact" iconStart={<I.AddIcon />} onClick={() => mt(crypto.randomUUID(), {name: 'My filament', nozzle: 215, bed: 60, density: 1.24, fan: 255})}>Add material</Button>
        </Stack>
        <Table.Container>
          <Table.Root aria-label="Materials">
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell scope="col">Name</Table.HeaderCell>
                <Table.HeaderCell scope="col">Nozzle °C</Table.HeaderCell>
                <Table.HeaderCell scope="col">Bed °C</Table.HeaderCell>
                <Table.HeaderCell scope="col">Density g/cm³</Table.HeaderCell>
                <Table.HeaderCell scope="col">Fan %</Table.HeaderCell>
                <Table.HeaderCell scope="col"><span hidden>Actions</span></Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {Object.entries(materials).map(([k, m]) => (
                <Table.Row key={k + JSON.stringify(m)}>
                  <Table.Cell><Input aria-label="Material name" defaultValue={m.name} onBlur={(e) => e.currentTarget.value.trim() && mt(k, {name: e.currentTarget.value.trim()})} /></Table.Cell>
                  <Table.Cell><Num label={`${m.name} nozzle`} value={m.nozzle} min={150} max={350} onChange={(nozzle) => mt(k, {nozzle})} /></Table.Cell>
                  <Table.Cell><Num label={`${m.name} bed`} value={m.bed} min={0} max={150} onChange={(bed) => mt(k, {bed})} /></Table.Cell>
                  <Table.Cell><Num label={`${m.name} density`} value={m.density} min={0.5} max={3} onChange={(density) => mt(k, {density})} /></Table.Cell>
                  <Table.Cell><Num label={`${m.name} fan`} value={Math.round((m.fan / 255) * 100)} min={0} max={100} onChange={(f) => mt(k, {fan: Math.round((f / 100) * 255)})} /></Table.Cell>
                  <Table.Cell align="end">
                    <IconButton aria-label={`Remove ${m.name}`} disabled={k === inUse.material} onClick={() => mt(k, null)}><I.DeleteIcon /></IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.Container>
      </Stack>
    </Stack>
  );
}
