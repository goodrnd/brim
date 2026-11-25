/**
 * Storage end to end: the dev server with the daemon's API, its SQLite db and file bucket in a temp dir, driven by Chromium.
 * Checks what a person sees survive a reload, including imported meshes.
 * Needs Playwright's Chromium (`npx playwright install chromium`).
 */
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, type Page} from 'playwright';
import {createServer} from 'vite';

// A one-triangle binary STL.
function stl() {
  const buf = Buffer.alloc(84 + 50);
  buf.writeUInt32LE(1, 80);
  [0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((v, i) => buf.writeFloatLE(v, 84 + 12 + i * 4));
  return buf;
}

async function start(t: TestContext) {
  const data = await mkdtemp(join(tmpdir(), 'brim-e2e-store-'));
  t.after(() => rm(data, {recursive: true, force: true}));
  process.env.BRIM_DATA = data;
  // No LLM in tests: prompts go through the rule-based parser.
  process.env.BRIM_MODEL = 'none/none';
  const vite = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: {port: 0, host: '127.0.0.1'},
    logLevel: 'silent',
  });
  await vite.listen();
  t.after(() => vite.close());
  const url = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}/`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('Desk organiser') : d.accept()));
  return {data, url, page, browser};
}

async function signIn(page: Page) {
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill('brim');
  await page.getByRole('button', {name: 'Sign in'}).click();
  await page.getByRole('navigation', {name: 'Workflow'}).waitFor();
}

/** Waits for the debounced save to reach the server. */
const saved = (page: Page, collection: string) =>
  page.waitForResponse((r) => r.url().endsWith(`/api/state/${collection}`) && r.request().method() === 'PATCH');

void test('parts, imported meshes, projects, notes and files survive a reload', async (t) => {
  const {data, url, page} = await start(t);
  await page.goto(url);
  await signIn(page);

  // A generated part.
  await page.goto(`${url}#/design`);
  await page.getByLabel('Describe the part').fill('box 80 x 50 x 30 with 2mm walls');
  let save = saved(page, 'parts');
  await page.getByRole('button', {name: 'Create part'}).click();
  await page.waitForURL(/#\/part\/.+\/refine/);
  await save;
  const boxUrl = page.url();

  // An imported mesh: the case localStorage could not keep.
  await page.goto(`${url}#/library`);
  save = saved(page, 'parts');
  await page.locator('input[type=file]').setInputFiles({name: 'bracket.stl', mimeType: 'model/stl', buffer: stl()});
  await page.waitForURL(/#\/part\/.+\/refine/);
  await save;
  const meshUrl = page.url();

  // A project with a note.
  await page.goto(`${url}#/library/projects`);
  save = saved(page, 'projects');
  await page.getByRole('button', {name: 'New project'}).first().click();
  await page.waitForURL(/#\/project\//);
  await save;
  await page.getByRole('button', {name: 'Add note'}).click();
  save = saved(page, 'notes');
  await page.getByRole('textbox', {name: 'Note 1'}).fill('M3 screws, 12 mm');
  await save;

  // A file, kept as uploaded.
  await page.goto(`${url}#/library/files`);
  await page.getByRole('button', {name: 'Upload file'}).first().waitFor();
  const uploaded = page.waitForResponse((r) => r.url().includes('/api/files?name='));
  await page.getByLabel('File to upload').setInputFiles({
    name: 'datasheet.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 brim'),
  });
  assert.equal((await uploaded).status(), 201);
  await page.getByRole('link', {name: 'datasheet.pdf'}).waitFor();

  // A fresh browser profile: nothing comes from localStorage, everything from the server.
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto(url);
  await signIn(page);

  await page.goto(`${url}#/library`);
  await page.getByRole('tab', {name: 'Parts (2)'}).waitFor();
  await page.getByRole('link', {name: 'bracket'}).first().waitFor();
  await page.goto(meshUrl);
  await page.getByText('Imported bracket.stl').first().waitFor();
  assert.equal(await page.getByText('Part not found').count(), 0);
  await page.goto(boxUrl);
  assert.equal(await page.getByText('Part not found').count(), 0);

  await page.goto(`${url}#/library/projects`);
  await page.getByRole('link', {name: 'Desk organiser'}).click();
  assert.equal(await page.getByRole('textbox', {name: 'Note 1'}).inputValue(), 'M3 screws, 12 mm');

  await page.goto(`${url}#/library/files`);
  const download = page.waitForEvent('download');
  await page.getByRole('link', {name: 'datasheet.pdf'}).click();
  assert.equal((await download).suggestedFilename(), 'datasheet.pdf');

  // Deleting the File removes its bytes from the bucket.
  await page.getByRole('button', {name: 'Delete datasheet.pdf'}).click();
  await page.getByText('No files yet').waitFor();
  const blobs = (await readdir(join(data, 'files'), {recursive: true})).filter((f) => /[0-9a-f]{64}$/.test(f));
  assert.equal(blobs.length, 1, 'only the bracket mesh is left');
});

void test('a file becomes a part with "Make part"', async (t) => {
  const {url, page} = await start(t);
  await page.goto(url);
  await signIn(page);
  await page.goto(`${url}#/library/files`);
  await page.getByLabel('File to upload').setInputFiles({name: 'hook.stl', mimeType: 'model/stl', buffer: stl()});
  await page.getByRole('button', {name: 'Make part'}).click();
  await page.waitForURL(/#\/part\/.+\/refine/);
  await page.getByText('Imported hook.stl').first().waitFor();
  // The File stays as the original.
  await page.goto(`${url}#/library/files`);
  await page.getByRole('link', {name: 'hook.stl'}).waitFor();
});

void test('a save a closing page could not send is sent on the next visit', async (t) => {
  const {url, page} = await start(t);
  await page.goto(url);
  await signIn(page);
  // What `save` leaves behind when the body is too big for a keepalive request.
  await page.evaluate(() =>
    localStorage.setItem(
      'brim-unsent-projects',
      JSON.stringify({put: [{id: 'late', name: 'Late save', edited: 1}], remove: []}),
    ),
  );
  await page.goto(`${url}#/library/projects`);
  await page.reload();
  await page.getByRole('link', {name: 'Late save'}).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('brim-unsent-projects')), null);
});

void test('a storage error at start is shown, not papered over with browser storage', async (t) => {
  const {url, page} = await start(t);
  await page.route('**/api/state', (r) =>
    // A proxy or middleware error page, not the API's JSON: still an error, not "no server".
    r.fulfill({status: 500, contentType: 'text/html', body: '<h1>disk full</h1>'}),
  );
  await page.goto(url);
  await page.getByRole('alert').filter({hasText: 'disk full'}).waitFor();
});
