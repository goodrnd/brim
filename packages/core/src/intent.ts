// LLM intent layer: prompt + current model → Spec or Op[]. Runs server-side (vite.config.ts); the LLM never returns mesh data.
import {type AssistantMessage, type Context, type Tool, validateToolCall} from '@earendil-works/pi-ai';
import {arr, num, obj, oneOf, opt} from '@earendil-works/pi-schema';
import {kinds, newSpec, numFields, type Op, type Spec} from './model.ts';

/** What the client sends: the current model, if any. Meshes are summarised; their triangles stay in the browser. */
export type Current = {type: 'param'; spec: Spec} | {type: 'mesh'; name: string; size: number[]};
export type Intent = {type: 'spec'; spec: Spec} | {type: 'ops'; ops: Op[]};

const n = (description: string) => opt(num({description}));
const shape = {
      kind: oneOf(kinds),
      width: n('mm; diameter for round kinds (vase, cup, cylinder, tube, cone, sphere, gear, hex, star)'),
      depth: n('mm; box, plate and tag only'),
      height: n('mm; "thick" means height for flat parts'),
      wall: n('mm wall thickness; 0 = solid'),
      hole: n('mm through-hole diameter; 0 = none'),
      teeth: n('gear teeth'),
      points: n('star points'),
      ribs: n('vertical ribs'),
      twist: n('degrees over full height'),
      taper: n('top scale; 1 = straight, <1 narrower top, >1 flared'),
      corner: n('mm corner radius'),
      segments: n('round resolution; 96 default, 192 smooth, 8 low poly'),
};
export const tools: Tool[] = [
  {
    name: 'new_shape',
    description: 'Create a new parametric shape, or replace the current one with a different kind. Omitted fields use defaults.',
    parameters: obj(shape),
  },
  {
    name: 'edit',
    description: 'Edit the current model with an ordered list of ops.',
    parameters: obj({
      ops: arr(
        obj({
          op: oneOf(['set', 'scale', 'rotate', 'add', 'subtract'] as const),
          field: opt(oneOf(numFields, {description: 'set: the spec field to change'})),
          value: n('set: new absolute value'),
          x: n('scale: factor along X (width); 1 = unchanged'),
          y: n('scale: factor along Y (depth)'),
          z: n('scale: factor along Z (height)'),
          axis: opt(oneOf(['x', 'y', 'z'] as const)),
          degrees: n('rotate: angle'),
          part: opt(obj(shape, {description: 'add/subtract: the shape to join or cut away'})),
          at: opt(arr(num(), {minItems: 3, maxItems: 3, description: 'add/subtract: [x, y, z] mm from the model\'s bottom centre to the part\'s bottom centre'})),
        }),
        {minItems: 1},
      ),
    }),
  },
];

export const systemPrompt = `You turn requests for 3D-printable parts into tool calls. Always call exactly one tool.
Units are mm; convert cm (×10) and inches (×25.4).
Kinds: ${kinds.join(', ')}. Mug/planter/pot/bowl → cup. Pipe/ring/sleeve/spacer → tube. Keychain/label → tag. Coaster/tile/sign → plate. Tray/cube/block/container → box. Puck/disc/peg → cylinder. Cog → gear.
Without a current model, call new_shape. With one, call edit, unless the request names a different kind (then new_shape, carrying over sizes).
Only set what the user says; never invent values. Conventions for words without numbers:
- twisted: twist 90; more twist: +45; no twist: 0
- ribbed/fluted: 12 ribs; more ribs: +4
- tapered: taper 0.7; flared: 1.3
- hollow/open: wall 2; solid: wall 0; thicker walls: wall +1; thinner walls: wall −0.5
- a hole without a size: hole 4
- bigger: scale 1.25; smaller: 0.8; taller: z 1.25; shorter: z 0.8; wider: x and y 1.2; narrower: 0.85
- "scale to 80%": scale 0.8 on all axes; "20% bigger": 1.2
- low poly: segments 8; smoother: 192
- more teeth: +4; more points: +1
For relative changes to fields (walls, teeth, ribs, twist), compute the new absolute value from the current model and use set.
Imported meshes support scale, rotate (flip upside down = rotate 180 about x; stand up/lay flat = rotate 90 about x), add and subtract.
add joins a part, subtract cuts it away (holes: a cylinder taller than the model, at z -1). Parts are parametric shapes placed by "at".`;

export function buildContext(prompt: string, current?: Current): Context {
  const state = current ? `Current model: ${JSON.stringify(current)}` : 'No current model.';
  return {systemPrompt, tools, messages: [{role: 'user', content: `${state}\nRequest: ${prompt}`, timestamp: Date.now()}]};
}

/** Validates the model's tool call and turns it into an Intent. Throws with a reason when it does not check out. */
export function readIntent(msg: AssistantMessage): Intent {
  if (msg.stopReason === 'error' || msg.stopReason === 'aborted') throw new Error(msg.errorMessage ?? msg.stopReason);
  const call = msg.content.find((b) => b.type === 'toolCall');
  if (!call) throw new Error('model did not call a tool');
  const args = validateToolCall(tools, call);
  if (call.name === 'new_shape') {
    return {type: 'spec', spec: toSpec(args)};
  }
  return {type: 'ops', ops: (args.ops as Record<string, any>[]).map(toOp)};
}

function toSpec(args: Record<string, any>): Spec {
  const {kind, ...rest} = args as Partial<Spec> & {kind: Spec['kind']};
  for (const [k, v] of Object.entries(rest)) if (!(v >= 0)) throw new Error(`${k} must be ≥ 0`);
  return newSpec(kind, rest);
}

function toOp(o: Record<string, any>): Op {
  const need = (...keys: string[]) => keys.forEach((k) => { if (o[k] === undefined) throw new Error(`${o.op} needs ${k}`); });
  if (o.op === 'set') {
    need('field', 'value');
    if (!(o.value >= 0)) throw new Error(`${o.field} must be ≥ 0`);
    return {op: 'set', field: o.field, value: o.value};
  }
  if (o.op === 'scale') {
    const [x, y, z] = [o.x ?? 1, o.y ?? 1, o.z ?? 1];
    if (![x, y, z].every((f) => f > 0 && f <= 100)) throw new Error('scale factors must be in (0, 100]');
    return {op: 'scale', x, y, z};
  }
  if (o.op === 'add' || o.op === 'subtract') {
    need('part', 'at');
    if (!o.at.every((v: number) => Math.abs(v) <= 1000)) throw new Error('at must be within 1 m');
    return {op: o.op, part: toSpec(o.part), at: o.at};
  }
  need('axis', 'degrees');
  return {op: 'rotate', axis: o.axis, degrees: o.degrees};
}
