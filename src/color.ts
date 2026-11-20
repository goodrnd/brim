/** Resolves any CSS colour token (oklch, var(), …) to a hex string via a 1×1 canvas. */
export function tokenColor(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const ctx = document.createElement('canvas').getContext('2d', {willReadFrequently: true})!;
  ctx.fillStyle = fallback;
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
