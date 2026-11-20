import {Button, Card, Checkbox, EmptyState, Grid, IconButton, PageHeader, Stack, Table} from '@earendil-works/elanor-react';
import * as I from './icons.ts';

export interface Job {
  id: string;
  partId: string;
  part: string; // part title when queued
  printer: string;
  material: string;
  layer: number;
  infill: number;
  seconds: number;
  grams: number;
  at: number;
  done: boolean;
}

export const hms = (s: number) => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;

export function Jobs({jobs, setJobs, onOpen}: {jobs: Job[]; setJobs: (f: (j: Job[]) => Job[]) => void; onOpen?: (partId: string) => void}) {
  const queued = jobs.filter((j) => !j.done);
  const sum = (js: Job[], k: 'seconds' | 'grams') => js.reduce((a, j) => a + j[k], 0);
  const update = (id: string, patch: Partial<Job> | null) =>
    setJobs((js) => (patch ? js.map((j) => (j.id === id ? {...j, ...patch} : j)) : js.filter((j) => j.id !== id)));

  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Print queue</PageHeader.Title>
          <PageHeader.Actions>
            <Button hierarchy="secondary" iconStart={<I.DeleteIcon />} disabled={jobs.length === queued.length} onClick={() => setJobs((js) => js.filter((j) => !j.done))}>Clear printed</Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>Sliced jobs you have queued. Tick them off once printed.</PageHeader.Description>
      </PageHeader.Root>
      <Grid.Root>
        <Grid.Item span={{base: 6, medium: 3}}><Card label="Queued" value={queued.length} description={`${jobs.length - queued.length} printed`} /></Grid.Item>
        <Grid.Item span={{base: 6, medium: 3}}><Card label="Queue time" value={hms(sum(queued, 'seconds'))} description="Estimated" /></Grid.Item>
        <Grid.Item span={{base: 6, medium: 3}}><Card label="Queued filament" value={`${sum(queued, 'grams').toFixed(0)} g`} description="Still to print" /></Grid.Item>
        <Grid.Item span={{base: 6, medium: 3}}><Card label="Filament used" value={`${sum(jobs.filter((j) => j.done), 'grams').toFixed(0)} g`} description="All printed jobs" /></Grid.Item>
      </Grid.Root>
      {jobs.length ? (
        <Table.Container>
          <Table.Root aria-label="Print jobs">
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell scope="col">Printed</Table.HeaderCell>
                <Table.HeaderCell scope="col">Part</Table.HeaderCell>
                <Table.HeaderCell scope="col">Printer</Table.HeaderCell>
                <Table.HeaderCell scope="col">Settings</Table.HeaderCell>
                <Table.HeaderCell scope="col" align="end">Time</Table.HeaderCell>
                <Table.HeaderCell scope="col" align="end">Filament</Table.HeaderCell>
                <Table.HeaderCell scope="col"><span hidden>Actions</span></Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {jobs.map((j) => (
                <Table.Row key={j.id}>
                  <Table.Cell>
                    <Checkbox.Root aria-label={`Mark ${j.part} printed`} checked={j.done} onCheckedChange={(done) => update(j.id, {done})}><Checkbox.Indicator /></Checkbox.Root>
                  </Table.Cell>
                  <Table.Cell><Table.CellPrimary>{j.part}</Table.CellPrimary><Table.CellSecondary>{new Date(j.at).toLocaleString()}</Table.CellSecondary></Table.Cell>
                  <Table.Cell>{j.printer}</Table.Cell>
                  <Table.Cell>{j.material} · {j.layer} mm · {j.infill}%</Table.Cell>
                  <Table.Cell align="end">{hms(j.seconds)}</Table.Cell>
                  <Table.Cell align="end">{j.grams.toFixed(1)} g</Table.Cell>
                  <Table.Cell align="end">
                    <Stack direction="row" gap="xSmall">
                      {onOpen && <IconButton aria-label={`Open ${j.part}`} onClick={() => onOpen(j.partId)}><I.OpenInNewIcon /></IconButton>}
                      <IconButton aria-label={`Remove ${j.part}`} onClick={() => update(j.id, null)}><I.DeleteIcon /></IconButton>
                    </Stack>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.Container>
      ) : (
        <EmptyState.Root>
          <EmptyState.Illustration><I.ScheduleIcon size={48} /></EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>Nothing queued</EmptyState.Title>
              <EmptyState.Description>Slice a part under Print files, then choose “Add to queue”.</EmptyState.Description>
            </EmptyState.Copy>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
    </Stack>
  );
}
