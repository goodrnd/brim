import {useEffect, useRef} from 'react';
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
  const dark = theme.endsWith('dark');

  useEffect(() => {
    viewer.current = Kadmos.mount(host.current!, {theme: dark ? 'dark' : 'light'});
    return () => viewer.current?.destroy();
  }, []);

  // Kadmos only parses hex, and uses the accent inside the 3D scene too, so resolve the tokens here.
  useEffect(() => {
    viewer.current?.setTheme(dark ? 'dark' : 'light');
    viewer.current?.setAccent(tokenColor('--semantic-color-background-fill-primary', '#3a6ea5'));
  }, [theme]);

  const plate = bed.join('x');
  // shortcut: Kadmos' setAccent skips the model, so a theme change reloads it (resetting camera/tools); drop `theme` here if Kadmos learns to recolour in place.
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([toStl(positions)]));
    const color = tokenColor('--semantic-color-background-fill-primary', '#3a6ea5');
    viewer.current?.load(url, {plate, color}).catch(() => {}); // errors are shown in the viewer
    return () => URL.revokeObjectURL(url);
  }, [positions, plate, theme]);

  return <div ref={host} className="viewer" />;
}
