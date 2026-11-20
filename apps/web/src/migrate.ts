// One-time localStorage upgrades. Runs before the app reads storage; each step is a no-op once done.
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

const rename = ({projectId, model, ...j}: {projectId?: string; model?: string}) => ({...j, partId: projectId, part: model});

export function migrate(s: Storage) {
  // Project → Part rename: library key and job fields.
  const models = s.getItem('brim-models');
  if (models !== null) {
    if (s.getItem('brim-parts') === null) {s.setItem('brim-parts', models);}
    s.removeItem('brim-models');
  }
  try {
    const jobs = JSON.parse(s.getItem('brim-jobs') ?? 'null');
    if (Array.isArray(jobs) && jobs.some((j) => 'projectId' in j)) {
      s.setItem('brim-jobs', JSON.stringify(jobs.map((j) => ('projectId' in j ? rename(j) : j))));
    }
  } catch {
    // broken JSON: useStored falls back to defaults
  }
}
