import {Button, Field, Heading, Input, Modal, Stack, Text} from '@earendil-works/elanor-react';
import {useRef, useState} from 'react';
import {EditIcon, UploadFileIcon} from './icons.ts';
import {meshFormats} from '../lib/mesh.ts';

export const download = (data: BlobPart, name: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], {type}));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** One row of a `.model-list`: thumbnail, title link and muted lines. */
export function ListItem({
  href,
  thumb,
  title,
  lines,
}: {
  href: string;
  thumb?: string;
  title: string;
  lines: Array<string>;
}) {
  return (
    <li>
      {/* Image link is a mouse shortcut; the title link is the one keyboard and screen reader users get. */}
      <a href={href} className="card-link" tabIndex={-1} aria-hidden>
        {thumb ? <img className="thumb" src={thumb} alt="" /> : <div className="thumb" />}
      </a>
      <Stack gap="xSmall" align="stretch">
        <Heading level={3} size={5}>
          <a href={href} className="card-link">
            {title}
          </a>
        </Heading>
        {lines.map((l, i) => (
          <Text key={i} className="muted">
            {l}
          </Text>
        ))}
      </Stack>
    </li>
  );
}

export function RenameButton({what, name, onRename}: {what: string; name: string; onRename: (name: string) => void}) {
  const [value, setValue] = useState(name);
  const [open, setOpen] = useState(false);
  const save = () => value.trim() && (onRename(value.trim()), setOpen(false));
  return (
    <Modal.Root open={open} onOpenChange={(o) => (setOpen(o), setValue(name))}>
      <Modal.Trigger render={<Button hierarchy="secondary" iconStart={<EditIcon />} />}>Rename</Modal.Trigger>
      <Modal.Portal>
        <Modal.Backdrop />
        <Modal.Viewport>
          <Modal.Popup>
            <Modal.Title>Rename {what}</Modal.Title>
            <Modal.Body>
              <Field.Root name="name">
                <Field.Label>Name</Field.Label>
                <Input
                  value={value}
                  onValueChange={(v) => setValue(v)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                />
              </Field.Root>
            </Modal.Body>
            <Modal.Actions>
              <Modal.Close render={<Button hierarchy="secondary" />}>Cancel</Modal.Close>
              <Button disabled={!value.trim()} onClick={save}>
                Save
              </Button>
            </Modal.Actions>
          </Modal.Popup>
        </Modal.Viewport>
      </Modal.Portal>
    </Modal.Root>
  );
}

export function UploadButton({onFile, compact}: {onFile: (f: File) => void; compact?: boolean}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={meshFormats}
        hidden
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <Button
        hierarchy="secondary"
        density={compact ? 'compact' : undefined}
        iconStart={<UploadFileIcon />}
        onClick={() => input.current?.click()}
      >
        Import model
      </Button>
    </>
  );
}
