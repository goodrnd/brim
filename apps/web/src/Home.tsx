import {Card, Grid, PageHeader, Stack} from '@earendil-works/elanor-react';
import type {Job} from './jobs/Jobs.tsx';
import {hms} from './lib/time.ts';
import {count, type Part, type Project} from './lib/library.ts';

const grams = (js: Array<Job>) => `${js.reduce((a, j) => a + j.grams, 0).toFixed(0)} g`;

// TODO: decide what else belongs on Home.
export function Home({parts, projects, jobs}: {parts: Array<Part>; projects: Array<Project>; jobs: Array<Job>}) {
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
      </Grid.Root>
    </Stack>
  );
}
