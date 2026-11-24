import {size as bounds, type Model, type Size, type Spec} from '@brim/core/model.ts';
import type {Current, Intent} from '@brim/core/intent.ts';

/** Asks the daemon's LLM; undefined when none is configured or it fails, so callers use the regex parser. */
export async function askLlm(prompt: string, m?: Model, size?: Size): Promise<Intent | undefined> {
  const current: Current | undefined = !m
    ? undefined
    : m.type === 'param'
      ? m
      : {type: 'mesh', name: m.name, size: bounds(m.positions)};
  try {
    const r = await fetch('/api/intent', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({prompt, current, size}),
    });
    if (r.ok) {
      return await r.json();
    }
    if (r.status !== 404) {
      // oxlint-disable-next-line no-console
      console.warn('brim: LLM intent failed, using the regex parser:', await r.text());
    }
  } catch {
    // offline, server down: fall back to the regex parser
  }
}

/** The LLM's review of a planned spec, or why there is none: `unavailable` when no LLM is configured. */
export async function askFeedback(prompt: string, spec: Spec): Promise<{text: string} | {error: string}> {
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({prompt, spec}),
    });
    if (r.ok) {
      return {text: await r.json()};
    }
    return {error: r.status === 404 ? 'unavailable' : (await r.text()) || `HTTP ${r.status}`};
  } catch (error) {
    return {error: (error as Error).message};
  }
}
