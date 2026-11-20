import {useEffect, useRef} from 'react';
import {tokenColor} from './color.ts';
import type {Layer} from '@brim/core/slicer.ts';

/** Draws one sliced layer (walls + infill) top-down. */
export function LayerPreview({layer, extent, theme}: {layer: Layer | undefined; extent: number; theme: string}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const size = c.clientWidth * devicePixelRatio;
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    if (!layer) {
      return;
    }
    const scale = (size * 0.9) / Math.max(extent, 1);
    ctx.setTransform(scale, 0, 0, -scale, size / 2, size / 2);
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const kind of ['infill', 'wall'] as const) {
      ctx.strokeStyle = tokenColor(
        kind === 'wall' ? '--semantic-color-background-fill-primary' : '--semantic-color-border-primary',
        '#888',
      );
      ctx.lineWidth = kind === 'wall' ? 0.45 : 0.3;
      ctx.beginPath();
      for (const p of layer.paths.filter((q) => q.kind === kind)) {
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      }
      ctx.stroke();
    }
  }, [layer, extent, theme]);
  return <canvas ref={ref} className="layer" aria-label={layer ? `Layer at ${layer.z.toFixed(2)} mm` : 'No layer'} />;
}
