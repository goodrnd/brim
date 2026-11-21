import {
  Button,
  Card,
  Checkbox,
  CodeSnippet,
  CopyButton,
  Dropdown,
  EmptyState,
  Grid,
  IconButton,
  KeyValue,
  Meter,
  Modal,
  SegmentedControl,
  SelectionControlAndLabel,
  Stack,
  Text,
  Tooltip,
} from '@earendil-works/elanor-react';
import {useState} from 'react';
import {bounds, fits, toStl} from '@brim/core/model.ts';
import type {Material, Printer, slice, SliceResult, SliceSettings} from '@brim/core/slicer.ts';
import {CloseIcon, DownloadIcon, HelpIcon, LayersIcon, ScheduleIcon} from './icons.ts';
import {hms} from './lib/time.ts';
import {LayerPreview} from './LayerPreview.tsx';
import {download} from './ui.tsx';

const sliceOffThread = (...args: Parameters<typeof slice>) =>
  new Promise<SliceResult>((resolve, reject) => {
    const w = new Worker(new URL('./slice.worker.ts', import.meta.url), {type: 'module'});
    w.addEventListener('message', (e) => (resolve(e.data), w.terminate()));
    w.addEventListener('error', (e) => (reject(new Error(e.message)), w.terminate()));
    w.postMessage(args);
  });


export function PrintPanel({
  theme,
  positions,
  settings,
  setSettings,
  printers,
  materials,
  name,
  onQueue,
}: {
  theme: string;
  positions: Float32Array;
  settings: SliceSettings;
  setSettings: (s: SliceSettings) => void;
  printers: Record<string, Printer>;
  materials: Record<string, Material>;
  name: string;
  onQueue: (r: SliceResult) => void;
}) {
  // A result is only valid for the inputs it was sliced from; anything else reads as null.
  const [sliced, setSliced] = useState<{result: SliceResult; inputs: Array<unknown>} | null>(null);
  const {printer, material, layer: layerHeight, infill, vase} = settings;
  const inputs = [positions, printers, materials, printer, material, layerHeight, infill, vase];
  const result = sliced?.inputs.every((v, i) => v === inputs[i]) ? sliced.result : null;
  const [busy, setBusy] = useState(false);
  const [layer, setLayer] = useState(0);
  const set = <K extends keyof SliceSettings>(k: K, v: SliceSettings[K]) => setSettings({...settings, [k]: v});
  const [min, max] = bounds(positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1]);
  const tooBig = !fits(positions, printers[settings.printer].bed);
  const run = async () => {
    setBusy(true);
    try {
      const r = await sliceOffThread(positions, settings, printers[printer], materials[material]);
      setSliced({result: r, inputs});
      setLayer(Math.floor(r.layers.length / 2));
    } catch (error) {
      alert(`Slicing failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = (label: string, key: 'printer' | 'material', options: Record<string, {name: string}>) => (
    <Dropdown.Root value={settings[key]} onValueChange={(v) => set(key, v as string)}>
      <Stack gap="xSmall" align="stretch">
        <Dropdown.Label>{label}</Dropdown.Label>
        <Dropdown.Trigger>
          <Dropdown.Value>{(v: string) => options[v].name}</Dropdown.Value>
          <Dropdown.Icon />
        </Dropdown.Trigger>
      </Stack>
      <Dropdown.Portal>
        <Dropdown.Positioner>
          <Dropdown.Popup>
            <Dropdown.List>
              {Object.entries(options).map(([k, o]) => (
                <Dropdown.Item key={k} value={k}>
                  {o.name}
                </Dropdown.Item>
              ))}
            </Dropdown.List>
          </Dropdown.Popup>
        </Dropdown.Positioner>
      </Dropdown.Portal>
    </Dropdown.Root>
  );

  return (
    <Stack gap="large" align="stretch">
      <Grid.Root>
        <Grid.Item span={6}>{pick('Printer', 'printer', printers)}</Grid.Item>
        <Grid.Item span={6}>{pick('Material', 'material', materials)}</Grid.Item>
      </Grid.Root>
      <Stack gap="xSmall">
        <Text>Layer height</Text>
        <SegmentedControl.Root
          aria-label="Layer height"
          value={[String(settings.layer)]}
          onValueChange={(v) => v[0] && set('layer', Number(v[0]))}
        >
          {['0.12', '0.2', '0.28'].map((l) => (
            <SegmentedControl.Item key={l} value={l}>
              {l} mm
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Stack>
      <Stack gap="xSmall">
        <Text>Infill</Text>
        <SegmentedControl.Root
          aria-label="Infill"
          value={[String(settings.infill)]}
          onValueChange={(v) => v[0] && set('infill', Number(v[0]))}
        >
          {['0', '15', '30', '60'].map((l) => (
            <SegmentedControl.Item key={l} value={l}>
              {l}%
            </SegmentedControl.Item>
          ))}
        </SegmentedControl.Root>
      </Stack>
      <SelectionControlAndLabel
        control={
          <Checkbox.Root checked={settings.vase} onCheckedChange={(c) => set('vase', c)}>
            <Checkbox.Indicator />
          </Checkbox.Root>
        }
      >
        Spiral vase mode (single wall, continuous Z)
      </SelectionControlAndLabel>
      <Stack direction="row" gap="small" align="center">
        <Button iconStart={<LayersIcon />} disabled={tooBig || busy} onClick={() => void run()}>
          {busy ? 'Slicing…' : 'Slice'}
        </Button>
        {tooBig && <Text className="negative">Part is larger than the {printers[settings.printer].name} bed.</Text>}
      </Stack>

      {result ? (
        <Stack gap="large" align="stretch">
          <KeyValue.Grid>
            <KeyValue.Key>Layers</KeyValue.Key>
            <KeyValue.Value>{result.layers.length}</KeyValue.Value>
            <KeyValue.Key>Print time</KeyValue.Key>
            <KeyValue.Value>≈ {hms(result.seconds)}</KeyValue.Value>
            <KeyValue.Key>Filament</KeyValue.Key>
            <KeyValue.Value>
              {(result.filamentMm / 1000).toFixed(2)} m · {result.grams.toFixed(1)} g
            </KeyValue.Value>
            <KeyValue.Key>Temps</KeyValue.Key>
            <KeyValue.Value>
              {materials[settings.material].nozzle} °C nozzle / {materials[settings.material].bed} °C bed
            </KeyValue.Value>
          </KeyValue.Grid>
          <Meter.Root value={(result.grams / 1000) * 100} semantic={result.grams > 800 ? 'warning' : 'neutral'}>
            <Stack gap="xSmall" align="stretch">
              <Stack direction="row" gap="auto">
                <Meter.Label>Of a 1 kg spool</Meter.Label>
                <Meter.Value />
              </Stack>
              <Meter.Track>
                <Meter.Indicator />
              </Meter.Track>
            </Stack>
          </Meter.Root>
          <Card>
            <Stack gap="small" align="stretch">
              <Stack direction="row" gap="auto" align="center">
                <Text>
                  Layer {layer + 1} / {result.layers.length} · z {result.layers[layer]?.z.toFixed(2)} mm
                </Text>
                <Tooltip.Root>
                  <Tooltip.Trigger render={<IconButton aria-label="About the preview" />}>
                    <HelpIcon />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Positioner>
                      <Tooltip.Popup>Walls in the accent colour, infill in grey</Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Stack>
              <input
                type="range"
                min={0}
                max={result.layers.length - 1}
                value={layer}
                onChange={(e) => setLayer(e.currentTarget.valueAsNumber)}
                aria-label="Layer"
              />
              <LayerPreview layer={result.layers[layer]} extent={extent} theme={theme} />
            </Stack>
          </Card>
          <Stack direction="row" gap="small" wrap="wrap">
            <Button iconStart={<ScheduleIcon />} onClick={() => onQueue(result)}>
              Add to queue
            </Button>
            <Button
              hierarchy="secondary"
              iconStart={<DownloadIcon />}
              onClick={() =>
                download(result.gcode, `${name}_${settings.material}_${settings.layer}mm.gcode`, 'text/x-gcode')
              }
            >
              Download G-code
            </Button>
            <Button
              hierarchy="secondary"
              iconStart={<DownloadIcon />}
              onClick={() => download(toStl(positions), name + '.stl', 'model/stl')}
            >
              Download STL
            </Button>
            <GcodeModal gcode={result.gcode} />
          </Stack>
        </Stack>
      ) : (
        <EmptyState.Root>
          <EmptyState.Illustration>
            <LayersIcon size={48} />
          </EmptyState.Illustration>
          <EmptyState.Body>
            <EmptyState.Copy>
              <EmptyState.Title level={2}>Not sliced yet</EmptyState.Title>
              <EmptyState.Description>
                Pick a printer and material, then slice to get G-code and a layer preview.
              </EmptyState.Description>
            </EmptyState.Copy>
          </EmptyState.Body>
        </EmptyState.Root>
      )}
    </Stack>
  );
}

function GcodeModal({gcode}: {gcode: string}) {
  const head = gcode.split('\n').slice(0, 40).join('\n');
  return (
    <Modal.Root>
      <Modal.Trigger render={<Button hierarchy="secondary" />}>View G-code</Modal.Trigger>
      <Modal.Portal>
        <Modal.Backdrop />
        <Modal.Viewport>
          <Modal.Popup>
            <Stack direction="row" align="start" gap="auto">
              <Modal.Title>G-code preview</Modal.Title>
              <Modal.Close render={<IconButton aria-label="Close" />}>
                <CloseIcon />
              </Modal.Close>
            </Stack>
            <Modal.Description>First 40 of {gcode.split('\n').length.toLocaleString()} lines.</Modal.Description>
            <Modal.Body>
              <CodeSnippet actions={<CopyButton value={gcode} aria-label="Copy all G-code" />}>{head}</CodeSnippet>
            </Modal.Body>
          </Modal.Popup>
        </Modal.Viewport>
      </Modal.Portal>
    </Modal.Root>
  );
}
