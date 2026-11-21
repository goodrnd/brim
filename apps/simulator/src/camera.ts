import jpeg from 'jpeg-js';
import type {Printer} from './printer.ts';

const width = 320;
const height = 240;

/** A chamber-camera frame: the bed, a part growing with progress, and a nozzle that moves so frames differ. */
export function frame(printer: Printer, t: number): Buffer {
  const data = Buffer.alloc(width * height * 4);
  const hot = Math.min(1, (printer.nozzle - 25) / 200);
  const partHeight = Math.round(printer.progress * 120);
  const nozzleX = printer.state === 'RUNNING' ? 110 + Math.round(50 * (1 + Math.sin(t * 3))) : 160;
  const nozzleY = 190 - partHeight - 14;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb = [30, 30, 34]; // chamber
      if (y > 190 && y < 200 && x > 40 && x < 280) {
        rgb = [70, 70, 75];
      } // bed
      else if (y >= 190 - partHeight && y <= 190 && x > 120 && x < 200) {
        rgb = [230, 230, 225];
      } // part
      else if (Math.abs(x - nozzleX) < 12 && y > nozzleY - 20 && y < nozzleY + 10) {
        rgb = [40 + 200 * hot, 60, 60];
      } // toolhead
      if (printer.light === 'off') {
        rgb = rgb.map((c) => c / 4);
      }
      // Sensor noise: real frames never repeat byte for byte, and the MCP drops a repeated frame as stale.
      rgb = rgb.map((c) => Math.min(255, c + Math.random() * 6));
      data.set([...rgb, 255], (y * width + x) * 4);
    }
  }
  return Buffer.from(jpeg.encode({data, width, height}, 70).data);
}

/** The P1/A1 port-6000 wire format: a 16-byte header (payload size, itrack, flags, reserved) then the JPEG. */
export function packet(jpg: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(jpg.length, 0);
  return Buffer.concat([header, jpg]);
}

/** The 80-byte auth packet: 0x40, 0x3000, user "bblp" at 16, access code at 48. */
export function authorized(auth: Buffer, token: string): boolean {
  if (auth.length < 80 || auth.readUInt32LE(0) !== 0x40 || auth.readUInt32LE(4) !== 0x30_00) {
    return false;
  }
  const text = (start: number, end: number) => auth.subarray(start, end).toString('ascii').replace(/\0+$/, '');
  return text(16, 48) === 'bblp' && text(48, 80) === token;
}
