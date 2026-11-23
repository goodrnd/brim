import {
  Button,
  Grid,
  Heading,
  Input,
  KeyboardKey,
  SegmentedControl,
  Separator,
  SkeletonText,
  Stack,
  Text,
  TextArea,
} from '@earendil-works/elanor-react';
import {useMemo, useState, type DragEvent} from 'react';
import {
  buildPositions,
  describe,
  fits,
  kindOf,
  parsePrompt,
  sizes,
  type Kind,
  type Size,
  type Spec,
} from '@brim/core/model.ts';
import type {Printer} from '@brim/core/slicer.ts';
import {AutoFixHighIcon, ExpandMoreIcon} from '../ui/icons.ts';
import {UploadButton, ListItem} from '../ui/controls.tsx';
import {askFeedback, askLlm} from '../lib/intent.ts';
import {edited, title, type Entry, type Part, type Project} from '../lib/library.ts';
import {Viewer} from '../parts/Viewer.tsx';
import {chips, withEdits, type Chip} from './fields.ts';
import {renderThumbs} from './render.ts';

const examples = [
  {name: 'Twisted vase', prompt: 'twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs'},
  {name: 'Spur gear', prompt: 'gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole'},
  {name: 'Storage box', prompt: 'box 80 x 50 x 30 with 2mm walls and 6mm corners'},
  {name: 'Keychain tag', prompt: 'keychain tag 50 x 20 x 3 with a hole'},
  {name: 'Star', prompt: '5 point star 60 wide, 6 thick'},
  {name: 'Planter', prompt: 'planter 90 wide 80 tall tapered'},
];

/** Text to part: nothing runs while typing. The user either creates straight away or asks for the plan first and tweaks it. */
export function Designer(props: {
  project?: Project;
  recent: Array<Part>;
  printer: Printer;
  theme: string;
  onCreate: (e: Entry) => void;
  onUpload: (f: File) => void;
}) {
  const {project, recent, printer, theme, onCreate, onUpload} = props;
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<Size>('medium'); // default size for dimensions the prompt leaves out
  const [plan, setPlan] = useState<{prompt: string; size: Size; spec?: Spec}>(); // spec unset: no shape understood
  const [feedback, setFeedback] = useState<{prompt: string; size: Size; spec: Spec; text?: string}>(); // text unset: no LLM answered
  const [busy, setBusy] = useState<'plan' | 'create'>(); // which button is waiting on the LLM
  const [edits, setEdits] = useState<{kind: Kind; values: Partial<Spec>}>();
  const [dragging, setDragging] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const text = prompt.trim();

  // Editing the prompt or size makes the plan stale, so it disappears until asked for again.
  const shown = plan?.prompt === text && plan.size === size ? plan : undefined;
  const spec = useMemo(() => shown?.spec && withEdits(shown.spec, edits), [shown, edits]);
  const positions = useMemo(() => spec && buildPositions(spec), [spec]);

  // The LLM's read, or the regex parser's when no LLM answers; undefined when no shape is named.
  const ask = async (by: 'plan' | 'create') => {
    setBusy(by);
    const r = await askLlm(text, undefined, size);
    setBusy(undefined);
    return r?.type === 'spec' ? r.spec : kindOf(text) ? parsePrompt(text, undefined, size).spec : undefined;
  };
  // Reviews the plan on screen (with chip edits), or plans first when there is none for this prompt.
  const review = async () => {
    if (!text || busy) {
      return;
    }
    const s = spec ?? (await ask('plan'));
    // Show the plan as chips and a preview; an already shown plan stays, so its chip edits survive.
    if (!shown) {
      setPlan({prompt: text, size, spec: s});
      setEdits(undefined);
    }
    if (!s) {
      return;
    }
    setBusy('plan');
    const t = await askFeedback(text, s);
    setBusy(undefined);
    setFeedback({prompt: text, size, spec: s, text: t});
  };
  const create = async () => {
    if (!text || busy) {
      return;
    }
    const s = spec ?? (await ask('create'));
    if (!s) {
      setPlan({prompt: text, size});
      return;
    }
    const tweaks = spec && edits?.kind === s.kind ? Object.keys(edits.values) : [];
    onCreate({
      prompt: text,
      changes: [describe(s), ...(tweaks.length ? [`adjusted ${tweaks.join(', ')}`] : [])],
      model: {type: 'param', spec: s},
    });
  };
  const type = (v: string) => {
    setPrompt(v);
    setEdits(undefined);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      onUpload(f);
    }
  };

  return (
    <div
      className={dragging ? 'designer dragging' : 'designer'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={drop}
      // ⌘↵ anywhere on the page, so it also works from a value chip.
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          void create();
        }
      }}
    >
      <Stack gap="xLarge" align="stretch">
        <Stack gap="small">
          <Heading level={1} variant="marketing" size={2}>
            What do you want to make?
          </Heading>
          <Text className="muted">
            {project ? `New part in ${project.name}. ` : ''}Describe it in words and watch it take shape, or drop in an
            STL, 3MF or OBJ.
          </Text>
        </Stack>

        <Grid.Root>
          <Grid.Item span={{base: 'full', medium: positions ? 5 : 'full'}}>
            <Stack gap="large" align="stretch">
              <div className="prompt-hero">
                <TextArea
                  autoFocus
                  aria-label="Describe the part"
                  placeholder="e.g. a twisted vase, 12 cm tall with thin walls"
                  value={prompt}
                  onValueChange={type}
                />
                {feedback &&
                  feedback.prompt === text &&
                  feedback.size === size &&
                  (!spec || feedback.spec === spec) && (
                    <Text className="muted" style={{whiteSpace: 'pre-line'}}>
                      {feedback.text ?? 'No feedback: the AI is unavailable.'}
                    </Text>
                  )}
                {busy === 'plan' && (
                  <Stack gap="small" align="stretch" aria-live="polite">
                    <Text className="muted">
                      <span className="pulse" />
                      Reviewing your plan…
                    </Text>
                    <Text>
                      <SkeletonText lines={3} />
                    </Text>
                  </Stack>
                )}
                {shown && !shown.spec && <Text className="muted">No shape named yet. Try vase, gear, box, tag…</Text>}
                <Separator />
                <Stack gap="xSmall">
                  <Text>Size</Text>
                  <SegmentedControl.Root
                    aria-label="Size"
                    density="compact"
                    value={[size]}
                    onValueChange={(v) => v[0] && setSize(v[0] as Size)}
                  >
                    {Object.keys(sizes).map((s) => (
                      <SegmentedControl.Item key={s} value={s}>
                        {s[0].toUpperCase() + s.slice(1)}
                      </SegmentedControl.Item>
                    ))}
                  </SegmentedControl.Root>
                </Stack>
                <Stack direction="row" gap="small">
                  <Button
                    hierarchy="secondary"
                    pending={busy === 'plan'}
                    disabled={!text || !!busy}
                    onClick={() => void review()}
                  >
                    Give feedback on plan
                  </Button>
                  <Button
                    iconStart={<AutoFixHighIcon />}
                    pending={busy === 'create'}
                    disabled={!text || !!busy}
                    onClick={() => void create()}
                  >
                    Create part
                  </Button>
                </Stack>
              </div>
              {spec && (
                <Stack gap="small" align="stretch">
                  <Text>
                    <strong className="kind">{spec.kind}</strong>
                  </Text>
                  <div className="chips">
                    {chips(spec).map((c) => (
                      <ChipInput
                        key={`${spec.kind}-${c.field}-${shown!.spec![c.field]}`}
                        chip={c}
                        onChange={(v) =>
                          setEdits((e) => ({
                            kind: spec.kind,
                            values: e?.kind === spec.kind ? {...e.values, [c.field]: v} : {[c.field]: v},
                          }))
                        }
                      />
                    ))}
                  </div>
                  <Text className="muted">
                    <KeyboardKey>⌘</KeyboardKey>
                    <KeyboardKey>↵</KeyboardKey> creates the part. Then refine it step by step.
                  </Text>
                </Stack>
              )}
              <Stack direction="row" gap="small">
                <UploadButton onFile={onUpload} />
                <Button
                  hierarchy="tertiary"
                  aria-expanded={showExamples}
                  iconEnd={<ExpandMoreIcon className={showExamples ? 'flip' : undefined} />}
                  onClick={() => setShowExamples((v) => !v)}
                >
                  Use example
                </Button>
              </Stack>
            </Stack>
          </Grid.Item>
          {positions && (
            <Grid.Item span={{base: 'full', medium: 7}}>
              <Stack gap="xSmall" align="stretch">
                <Viewer positions={positions} bed={[printer.bed[0], printer.bed[1]]} theme={theme} />
                <Text className={fits(positions, printer.bed) ? 'muted' : 'negative'}>
                  {fits(positions, printer.bed) ? 'Fits' : 'Too big for'} the {printer.name} bed
                </Text>
              </Stack>
            </Grid.Item>
          )}
        </Grid.Root>

        {showExamples && (
          <Gallery
            theme={theme}
            compact={!!positions}
            onPick={(p) => {
              type(p);
              setShowExamples(false);
            }}
          />
        )}

        {recent.length > 0 && (
          <Stack gap="small" align="stretch">
            <Heading level={2} size={5}>
              Recent parts
            </Heading>
            <ul className="model-list">
              {recent.map((p) => (
                <ListItem
                  key={p.id}
                  href={`#/part/${p.id}/refine`}
                  thumb={p.thumb}
                  title={title(p)}
                  lines={[edited(p.edited)].filter(Boolean)}
                />
              ))}
            </ul>
          </Stack>
        )}
      </Stack>
    </div>
  );
}

/** One understood value: label, number, unit. Keeps its own draft so "1." can be typed. */
function ChipInput({chip, onChange}: {chip: Chip; onChange: (v: number) => void}) {
  const [draft, setDraft] = useState(String(Math.round(chip.value * 10) / 10));
  return (
    <label className="chip">
      <span className="muted">{chip.label}</span>
      <Input
        inputMode="decimal"
        value={draft}
        size={Math.max(2, draft.length)}
        onValueChange={(v) => {
          setDraft(v);
          const n = Number(v);
          if (v.trim() && Number.isFinite(n) && n >= 0) {
            onChange(n);
          }
        }}
      />
      {chip.unit && <span className="muted">{chip.unit}</span>}
    </label>
  );
}

/** Example cards with real renders. Rendered once per theme, off the main viewer's WebGL context. */
function Gallery({theme, compact, onPick}: {theme: string; compact?: boolean; onPick: (prompt: string) => void}) {
  // theme is a dependency because renderThumbs reads the theme's colour tokens.
  const urls = useMemo(
    () => (theme ? renderThumbs(examples.map((e) => buildPositions(parsePrompt(e.prompt).spec))) : []),
    [theme],
  );
  return (
    <ul className={compact ? 'gallery compact' : 'gallery'}>
      {examples.map((e, i) => (
        <li key={e.name}>
          <button type="button" className="gallery-card" onClick={() => onPick(e.prompt)}>
            {urls[i] ? <img src={urls[i]} alt="" /> : <span className="gallery-empty" />}
            <span className="gallery-name">{e.name}</span>
            {!compact && <span className="muted">{e.prompt}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
