import {Button, EmptyState, IconButton, Stack, Text} from '@earendil-works/elanor-react';
import {useEffect, useRef, useState} from 'react';
import {AddIcon, DeleteIcon, UploadFileIcon, ViewInArIcon} from '../ui/icons.ts';
import {meshFormats} from '../lib/mesh.ts';

/** A File (docs/domain.md): reference material kept as uploaded, in the server's bucket. */
export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  created: number;
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const isMesh = (name: string) => meshFormats.split(',').some((ext) => name.toLowerCase().endsWith(ext));

/** Fetches from the Files API; a failed response throws `what` with the server's reason. */
async function api(what: string, path: string, init?: RequestInit) {
  const r = await fetch(`/api/files${path}`, init);
  const type = r.headers.get('content-type') ?? '';
  // A static host answers with a page (404, or 200 with an SPA fallback), not the API.
  if (type.startsWith('text/html') && (r.ok || r.status === 404)) {
    throw new Error('Files need the Brim server.');
  }
  if (!r.ok) {
    throw new Error(`${what}: ${type.startsWith('application/json') ? (await r.json()).error : r.status}`);
  }
  return r;
}
const report = (error_: Error) => alert(error_.message);

/** The Library's Files tab. Needs the dev server; without it, says so. */
export function Files({onMakePart}: {onMakePart: (f: File) => void}) {
  const [files, setFiles] = useState<Array<StoredFile>>();
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const load = () =>
    api('Could not list files', '')
      .then((r) => r.json())
      .then(setFiles, (error_: Error) => setError(error_.message));
  useEffect(() => void load(), []);

  const upload = async (f: File) => {
    await api(`Could not upload ${f.name}`, `?name=${encodeURIComponent(f.name)}`, {
      method: 'POST',
      headers: {'content-type': f.type || 'application/octet-stream'},
      body: f,
    });
    await load();
  };
  const remove = async (f: StoredFile) => {
    if (confirm(`Delete “${f.name}”? This cannot be undone.`)) {
      await api(`Could not delete ${f.name}`, `/${f.id}`, {method: 'DELETE'});
      await load();
    }
  };
  const makePart = async (f: StoredFile) => {
    const r = await api(`Could not open ${f.name}`, `/${f.id}`);
    onMakePart(new File([await r.blob()], f.name));
  };

  if (error) {
    return <Text className="muted">{error}</Text>;
  }
  return (
    <Stack gap="medium" align="stretch">
      <div>
        <input
          ref={input}
          type="file"
          hidden
          aria-label="File to upload"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) {
              void upload(f).catch(report);
            }
          }}
        />
        <Button iconStart={<UploadFileIcon />} onClick={() => input.current?.click()}>
          Upload file
        </Button>
      </div>
      {!files ? null : files.length ? (
        <ul className="model-list file-list">
          {files.map((f) => (
            <li key={f.id}>
              <Stack gap="xSmall" align="stretch">
                <a href={`/api/files/${f.id}`} download={f.name} className="card-link">
                  <strong>{f.name}</strong>
                </a>
                <Text className="muted">
                  {kb(f.size)} · {new Date(f.created).toLocaleString()}
                </Text>
              </Stack>
              <Stack direction="row" gap="xSmall">
                {isMesh(f.name) && (
                  <Button
                    hierarchy="secondary"
                    density="compact"
                    iconStart={<ViewInArIcon />}
                    onClick={() => void makePart(f).catch(report)}
                  >
                    Make part
                  </Button>
                )}
                <IconButton aria-label={`Delete ${f.name}`} onClick={() => void remove(f).catch(report)}>
                  <DeleteIcon />
                </IconButton>
              </Stack>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState.Root>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>No files yet</EmptyState.Title>
              <EmptyState.Description>
                Keep photos, PDFs, datasheets and other people’s models here, exactly as uploaded.
              </EmptyState.Description>
            </EmptyState.Copy>
            <EmptyState.Actions>
              <Button iconStart={<AddIcon />} onClick={() => input.current?.click()}>
                Upload file
              </Button>
            </EmptyState.Actions>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
    </Stack>
  );
}
