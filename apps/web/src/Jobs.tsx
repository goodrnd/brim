import {
  Button,
  Card,
  Dropdown,
  EmptyState,
  Field,
  Grid,
  Heading,
  IconButton,
  KeyValue,
  PageHeader,
  Stack,
  Table,
  Text,
  TextArea,
} from '@earendil-works/elanor-react';
import {ArrowBackIcon, DeleteIcon, OpenInNewIcon, ScheduleIcon} from './icons.ts';
import {hms} from './lib/time.ts';
import {go} from './route.ts';

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
  /** Unset while queued. Firmware "finished" is not `ok`; a person decides. */
  outcome?: Outcome;
  note?: string;
}

export type Outcome = 'ok' | 'failed';
const outcomes = {queued: 'Queued', ok: 'Printed', failed: 'Failed'};

export function Jobs({
  jobs,
  setJobs,
  onOpen,
  job: jobId,
}: {
  jobs: Array<Job>;
  setJobs: (f: (j: Array<Job>) => Array<Job>) => void;
  onOpen?: (partId: string) => void;
  /** Show this job's details instead of the list. */
  job?: string;
}) {
  const queued = jobs.filter((j) => !j.outcome);
  const failed = jobs.filter((j) => j.outcome === 'failed').length;
  const sum = (js: Array<Job>, k: 'seconds' | 'grams') => js.reduce((a, j) => a + j[k], 0);
  const update = (id: string, patch: Partial<Job> | null) =>
    setJobs((js) => (patch ? js.map((j) => (j.id === id ? {...j, ...patch} : j)) : js.filter((j) => j.id !== id)));
  const job = jobId && jobs.find((j) => j.id === jobId);
  if (job) {
    return <JobDetail job={job} update={update} onOpen={onOpen} />;
  }

  return (
    <Stack gap="xLarge" align="stretch">
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>Jobs</PageHeader.Title>
        </PageHeader.Row>
        <PageHeader.Description>
          Every part you have sent to print. Mark each job printed or failed when it comes off the printer.
        </PageHeader.Description>
      </PageHeader.Root>
      <Grid.Root>
        <Grid.Item span={{base: 6, medium: 3}}>
          <Card
            label="Queued"
            value={queued.length}
            description={`${jobs.length - queued.length - failed} printed · ${failed} failed`}
          />
        </Grid.Item>
        <Grid.Item span={{base: 6, medium: 3}}>
          <Card label="Queue time" value={hms(sum(queued, 'seconds'))} description="Estimated" />
        </Grid.Item>
        <Grid.Item span={{base: 6, medium: 3}}>
          <Card label="Queued filament" value={`${sum(queued, 'grams').toFixed(0)} g`} description="Still to print" />
        </Grid.Item>
        <Grid.Item span={{base: 6, medium: 3}}>
          <Card
            label="Filament used"
            value={`${sum(
              jobs.filter((j) => j.outcome),
              'grams',
            ).toFixed(0)} g`}
            description="Printed and failed jobs"
          />
        </Grid.Item>
      </Grid.Root>
      {jobs.length ? (
        <>
          <JobTable title="Queued" jobs={queued} update={update} onOpen={onOpen} />
          <JobTable title="History" jobs={jobs.filter((j) => j.outcome)} update={update} onOpen={onOpen} />
        </>
      ) : (
        <EmptyState.Root>
          <EmptyState.Illustration>
            <ScheduleIcon size={48} />
          </EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>No jobs yet</EmptyState.Title>
              <EmptyState.Description>
                Slice a part under Print files, then choose “Add to queue”.
              </EmptyState.Description>
            </EmptyState.Copy>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
    </Stack>
  );
}

type Update = (id: string, patch: Partial<Job> | null) => void;

function OutcomeDropdown({job: j, update}: {job: Job; update: Update}) {
  return (
    <Dropdown.Root
      value={j.outcome ?? 'queued'}
      onValueChange={(v) =>
        update(
          j.id,
          v === 'queued'
            ? {outcome: undefined, note: undefined}
            : {
                outcome: v as Outcome,
                note: v === 'failed' ? prompt('What went wrong? (optional)')?.trim() || undefined : undefined,
              },
        )
      }
    >
      <Dropdown.Trigger aria-label={`Outcome of ${j.part}`} density="compact">
        <Dropdown.Value>{(v: keyof typeof outcomes) => outcomes[v]}</Dropdown.Value>
        <Dropdown.Icon />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Positioner>
          <Dropdown.Popup>
            <Dropdown.List>
              {Object.entries(outcomes).map(([k, n]) => (
                <Dropdown.Item key={k} value={k}>
                  {n}
                </Dropdown.Item>
              ))}
            </Dropdown.List>
          </Dropdown.Popup>
        </Dropdown.Positioner>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

function JobTable({
  title,
  jobs,
  update,
  onOpen,
}: {
  title: string;
  jobs: Array<Job>;
  update: Update;
  onOpen?: (partId: string) => void;
}) {
  return (
    <Stack gap="medium" align="stretch">
      <Heading level={2} size={5}>
        {title} ({jobs.length})
      </Heading>
      {jobs.length ? (
        <Table.Container>
          <Table.Root aria-label={`${title} jobs`}>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell scope="col">Outcome</Table.HeaderCell>
                <Table.HeaderCell scope="col">Part</Table.HeaderCell>
                <Table.HeaderCell scope="col">Printer</Table.HeaderCell>
                <Table.HeaderCell scope="col">Settings</Table.HeaderCell>
                <Table.HeaderCell scope="col" align="end">
                  Time
                </Table.HeaderCell>
                <Table.HeaderCell scope="col" align="end">
                  Filament
                </Table.HeaderCell>
                <Table.HeaderCell scope="col">
                  <span hidden>Actions</span>
                </Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {jobs.map((j) => (
                <Table.Row key={j.id}>
                  <Table.Cell>
                    <OutcomeDropdown job={j} update={update} />
                  </Table.Cell>
                  <Table.Cell>
                    <Table.CellPrimary>
                      <a href={`#/job/${j.id}`}>{j.part}</a>
                    </Table.CellPrimary>
                    <Table.CellSecondary>
                      {new Date(j.at).toLocaleString()}
                      {j.note && ` · ${j.note}`}
                    </Table.CellSecondary>
                  </Table.Cell>
                  <Table.Cell>{j.printer}</Table.Cell>
                  <Table.Cell>
                    {j.material} · {j.layer} mm · {j.infill}%
                  </Table.Cell>
                  <Table.Cell align="end">{hms(j.seconds)}</Table.Cell>
                  <Table.Cell align="end">{j.grams.toFixed(1)} g</Table.Cell>
                  <Table.Cell align="end">
                    <Stack direction="row" gap="xSmall">
                      {onOpen && (
                        <IconButton aria-label={`Open ${j.part}`} onClick={() => onOpen(j.partId)}>
                          <OpenInNewIcon />
                        </IconButton>
                      )}
                      <IconButton aria-label={`Remove ${j.part}`} onClick={() => update(j.id, null)}>
                        <DeleteIcon />
                      </IconButton>
                    </Stack>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.Container>
      ) : (
        <Text className="muted">None.</Text>
      )}
    </Stack>
  );
}

function JobDetail({job: j, update, onOpen}: {job: Job; update: Update; onOpen?: (partId: string) => void}) {
  return (
    <Stack gap="xLarge" align="stretch">
      <div>
        <Button hierarchy="secondary" density="compact" iconStart={<ArrowBackIcon />} onClick={() => go('jobs')}>
          Jobs
        </Button>
      </div>
      <PageHeader.Root>
        <PageHeader.Row>
          <PageHeader.Title level={1}>{j.part}</PageHeader.Title>
          <PageHeader.Actions>
            {onOpen && (
              <Button hierarchy="secondary" iconStart={<OpenInNewIcon />} onClick={() => onOpen(j.partId)}>
                Open part
              </Button>
            )}
            <Button hierarchy="secondary" iconStart={<DeleteIcon />} onClick={() => (update(j.id, null), go('jobs'))}>
              Remove
            </Button>
          </PageHeader.Actions>
        </PageHeader.Row>
        <PageHeader.Description>Queued {new Date(j.at).toLocaleString()}</PageHeader.Description>
      </PageHeader.Root>
      <KeyValue.Grid>
        <KeyValue.Key>Outcome</KeyValue.Key>
        <KeyValue.Value>
          <OutcomeDropdown job={j} update={update} />
        </KeyValue.Value>
        <KeyValue.Key>Printer</KeyValue.Key>
        <KeyValue.Value>{j.printer}</KeyValue.Value>
        <KeyValue.Key>Material</KeyValue.Key>
        <KeyValue.Value>{j.material}</KeyValue.Value>
        <KeyValue.Key>Layer height</KeyValue.Key>
        <KeyValue.Value>{j.layer} mm</KeyValue.Value>
        <KeyValue.Key>Infill</KeyValue.Key>
        <KeyValue.Value>{j.infill}%</KeyValue.Value>
        <KeyValue.Key>Estimated time</KeyValue.Key>
        <KeyValue.Value>{hms(j.seconds)}</KeyValue.Value>
        <KeyValue.Key>Filament</KeyValue.Key>
        <KeyValue.Value>{j.grams.toFixed(1)} g</KeyValue.Value>
      </KeyValue.Grid>
      {j.outcome && (
        <Field.Root name="note">
          <Field.Label>Note</Field.Label>
          <TextArea
            placeholder={j.outcome === 'failed' ? 'What went wrong?' : 'How did it come out?'}
            value={j.note ?? ''}
            onValueChange={(note) => update(j.id, {note: note || undefined})}
          />
        </Field.Root>
      )}
    </Stack>
  );
}
