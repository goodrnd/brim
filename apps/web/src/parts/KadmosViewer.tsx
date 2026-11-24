import {useEffect, useMemo, useRef} from 'react';
import {Kadmos, type KadmosViewer as Handle} from 'kadmos';
import {toStl} from '@brim/core/model.ts';
import {tokenColor} from '../lib/color.ts';

/** Trial: Kadmos (github.com/leicht-io/kadmos) viewer, fed the part as a blob-URL STL. */
export function KadmosViewer({
  positions,
  bed,
  theme,
}: {
  positions: Float32Array;
  bed: [number, number, number];
  theme: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Handle>(null);
  const mode = theme.endsWith('dark') ? 'dark' : 'light';
  // Each tokenColor call draws to a canvas, so resolve the accent once per theme.
  const accent = useMemo(() => tokenColor('--semantic-color-background-fill-primary', '#3a6ea5'), [theme]);

  useEffect(() => {
    viewer.current = Kadmos.mount(host.current!, {theme: mode});
    return () => viewer.current?.destroy();
  }, []);

  // Kadmos only parses hex, and uses the accent inside the 3D scene too, so resolve the tokens here.
  useEffect(() => {
    viewer.current?.setTheme(mode);
    viewer.current?.setAccent(accent);
  }, [mode, accent]);

  const plate = bed.join('x');
  // shortcut: Kadmos' setAccent skips the model, so a theme change reloads it (resetting camera/tools); drop `theme` here if Kadmos learns to recolour in place.
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([toStl(positions)]));
    // Kadmos renders the error in place; log it so failures stay diagnosable.
    viewer.current?.load(url, {plate, color: accent}).catch((error) => console.error('Kadmos load failed', error));
    return () => URL.revokeObjectURL(url);
  }, [positions, plate, accent]);

  return <div ref={host} className="viewer" />;
}
