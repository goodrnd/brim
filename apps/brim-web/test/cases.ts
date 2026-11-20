import type {Current} from '../src/intent.ts';
import {parsePrompt, type Spec} from '../src/model.ts';

const vase = parsePrompt('twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs').spec;

/** README prompts, with the model state they are typed against. */
export const cases: {prompt: string; current?: Current}[] = [
  {prompt: 'twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs'},
  {prompt: 'gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole'},
  {prompt: 'box 80 x 50 x 30 with 2mm walls and 6mm corners'},
  {prompt: 'make it taller', current: {type: 'param', spec: vase}},
  {prompt: 'thicker walls', current: {type: 'param', spec: vase}},
  {prompt: 'scale to 80%', current: {type: 'param', spec: vase}},
  {prompt: 'flip it upside down', current: {type: 'mesh', name: 'benchy', size: [60, 31, 48]}},
];

/** Specs match when every number agrees to 0.1 mm (LLMs write 120 as 120.0, cm conversions round). */
export const sameSpec = (a: Spec, b: Spec) =>
  (Object.keys(a) as (keyof Spec)[]).every((k) => (typeof a[k] === 'number' ? Math.abs((a[k] as number) - (b[k] as number)) < 0.1 : a[k] === b[k]));
