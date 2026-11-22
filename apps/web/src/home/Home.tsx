import {Card, Grid, Heading, PageHeader, Stack, Text} from '@earendil-works/elanor-react';
import type {Printer} from '@brim/core/slicer.ts';
import {Camera, liveSummary, Spools, useLive} from '../settings/Connect.tsx';
import type {Job} from '../jobs/Jobs.tsx';
import {hms} from '../lib/time.ts';
import {count, type Part, type Project} from '../lib/library.ts';

const grams = (js: Array<Job>) => `${js.reduce((a, j) => a + j.grams, 0).toFixed(0)} g`;

/** One connected Bambu printer: camera, live status and loaded spools. */
function PrinterCard({printer}: {printer: Printer}) {
  const live = useLive(printer.serial, 0);
  return (
    <Card>
      <Stack gap="small" align="stretch">
        <Heading level={2} size={5}>
          {printer.name}
        </Heading>
        <Camera serial={printer.serial!} name={printer.name} />
        <Text className="muted">{liveSummary(live)}</Text>
        <Spools live={live} />
      </Stack>
    </Card>
  );
}

export function Home({
  parts,
  projects,
  jobs,
  printers,
}: {
  parts: Array<Part>;
  projects: Array<Project>;
  jobs: Array<Job>;
  printers: Record<string, Printer>;
}) {
  const connected = Object.entries(printers).filter(([, p]) => p.serial && p.bambuModel);
  const queued = jobs.filter((j) => !j.outcome);
  const printed = jobs.filter((j) => j.outcome === 'ok');
  const failed = jobs.filter((j) => j.outcome === 'failed').length;
  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Home</PageHeader.Title>
        </PageHeader.Row>
      </PageHeader.Root>
      <Grid.Root>
        <Grid.Item span={4}>
          <Card label="Parts" value={parts.length} description={count(projects.length, 'project')} />
        </Grid.Item>
        <Grid.Item span={4}>
          <Card
            label="Queued prints"
            value={queued.length}
            description={`${hms(queued.reduce((a, j) => a + j.seconds, 0))} · ${grams(queued)}`}
          />
        </Grid.Item>
        <Grid.Item span={4}>
          <Card
            label="Printed"
            value={printed.length}
            description={`${grams(printed)} of filament${failed ? ` · ${failed} failed` : ''}`}
          />
        </Grid.Item>
        {connected.map(([k, p]) => (
          <Grid.Item key={k} span={6}>
            <PrinterCard printer={p} />
          </Grid.Item>
        ))}
        {!connected.length && (
          <Grid.Item span={12}>
            <Card>
              <Text className="muted">
                No printers connected. <a href="#/settings">Find printers</a> to see their status and camera here.
              </Text>
            </Card>
          </Grid.Item>
        )}
      </Grid.Root>
    </Stack>
  );
}
