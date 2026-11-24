import {useEffect, useState, type Dispatch, type SetStateAction} from 'react';
import {collectionOf, save, type ServerState} from './server.ts';

const identity = <T>(v: T) => v;
const empty = (v: unknown) =>
  v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Object.keys(v).length);

let server: ServerState | undefined;
/** Called once before render: from then on, keys the server stores are read from and saved to it. */
export const setServer = (state: ServerState | undefined) => void (server = state);

const pending = new Map<string, Promise<void>>(); // one save in flight per key, so an older one cannot land last

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
    const store = () => {
      if (collection) {
        const run = (pending.get(key) ?? Promise.resolve()).then(() => save(collection, value));
        pending.set(
          key,
          run.catch((error) => {
            // oxlint-disable-next-line no-console
            console.warn(`Could not save ${key}`, error); // server down; keeps working in memory
          }),
        );
        return;
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
