import {useEffect, useState, type Dispatch, type SetStateAction} from 'react';
import {collectionOf, save, type Collection, type ServerState} from './server.ts';

const identity = <T>(v: T) => v;
const empty = (v: unknown) =>
  v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Object.keys(v).length);

let server: ServerState | undefined;
/** Called once before render: from then on, keys the server stores are read from and saved to it. */
export const setServer = (state: ServerState | undefined) => void (server = state);

const pending = new Map<string, Promise<void>>(); // one save in flight per key, so an older one cannot land last
const latest = new Map<string, unknown>();
const failed = new Set<string>();

/** Saves `value` after the save before it, and retries a failed save while the value is still the newest. */
function queue(key: string, collection: Collection, value: unknown) {
  latest.set(key, value);
  const run = (pending.get(key) ?? Promise.resolve()).then(() => save(collection, value));
  pending.set(
    key,
    run.then(
      () => void failed.delete(key),
      (error: Error) => {
        // oxlint-disable-next-line no-console
        console.warn(`Could not save ${key}`, error);
        const first = !failed.size;
        failed.add(key);
        setTimeout(() => latest.get(key) === value && queue(key, collection, value), 5000);
        if (first) {
          alert(`${error.message}\n\nYour changes are only in this tab until Brim can save them. It keeps trying.`);
        }
      },
    ),
  );
}

/**
 * useState persisted to the dev server's database when it runs, else to localStorage.
 * Missing, broken or empty-list values fall back to `fallback`. `toJson` applies to localStorage only.
 */
export function useStored<T>(
  key: string,
  fallback: () => T,
  toJson: (v: T) => T = identity,
): [T, Dispatch<SetStateAction<T>>] {
  const collection = server && collectionOf(key);
  const [value, setValue] = useState<T>(() => {
    if (collection) {
      const v = server![collection];
      return empty(v) ? fallback() : (v as T);
    }
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (!empty(v)) {
        return v;
      }
    } catch {
      // broken JSON: use the fallback
    }
    return fallback();
  });
  const [loaded] = useState(value);
  useEffect(() => {
    if (collection && value === loaded) {
      return; // just read from the server
    }
    const store = (closing?: Event) => {
      if (collection && closing) {
        // The page is going away: no waiting for the save in flight, and nobody left to tell if it fails.
        return void save(collection, value, true).catch(() => {});
      }
      if (collection) {
        return queue(key, collection, value);
      }
      try {
        localStorage.setItem(key, JSON.stringify(toJson(value)));
      } catch (error) {
        // oxlint-disable-next-line no-console
        console.warn(`Could not save ${key}`, error); // quota full; keeps working in memory
      }
    };
    // Debounced so typing does not re-serialise every part per keystroke; pagehide flushes a pending save.
    const timer = setTimeout(() => (removeEventListener('pagehide', store), store()), 300);
    addEventListener('pagehide', store);
    return () => {
      clearTimeout(timer);
      removeEventListener('pagehide', store);
    };
  }, [key, value, toJson, collection, loaded]);
  return [value, setValue];
}
