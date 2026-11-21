// One-time localStorage upgrades. Runs before the app reads storage; each step is a no-op once done.
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

const rename = ({projectId, model, ...j}: {projectId?: string; model?: string}) => ({
  ...j,
  partId: projectId,
  part: model,
});

export function migrate(s: Storage) {
  // Project → Part rename: library key and job fields.
  const models = s.getItem('brim-models');
  if (models !== null) {
    if (s.getItem('brim-parts') === null) {
      s.setItem('brim-parts', models);
    }
    s.removeItem('brim-models');
  }
  // Part.projectId → brim-uses, so a part can be in many projects.
  try {
    const parts = JSON.parse(s.getItem('brim-parts') ?? 'null');
    if (Array.isArray(parts) && parts.some((p) => 'projectId' in p)) {
      const uses = JSON.parse(s.getItem('brim-uses') ?? '[]');
      for (const p of parts) {
        if (p.projectId) {
          uses.push({projectId: p.projectId, itemId: p.id, qty: 1});
        }
      }
      s.setItem('brim-uses', JSON.stringify(uses));
      s.setItem('brim-parts', JSON.stringify(parts.map(({projectId: _, ...p}) => p)));
    }
  } catch {
    // broken JSON: useStored falls back to defaults
  }
  try {
    const jobs = JSON.parse(s.getItem('brim-jobs') ?? 'null');
    if (Array.isArray(jobs) && jobs.some((j) => 'projectId' in j)) {
      s.setItem('brim-jobs', JSON.stringify(jobs.map((j) => ('projectId' in j ? rename(j) : j))));
    }
  } catch {
    // broken JSON: useStored falls back to defaults
  }
  // Job.done → Job.outcome; old ticks meant "printed fine".
  try {
    const jobs = JSON.parse(s.getItem('brim-jobs') ?? 'null');
    if (Array.isArray(jobs) && jobs.some((j) => 'done' in j)) {
      s.setItem('brim-jobs', JSON.stringify(jobs.map(({done, ...j}) => (done ? {...j, outcome: 'ok'} : j))));
    }
  } catch {
    // broken JSON: useStored falls back to defaults
  }
}
