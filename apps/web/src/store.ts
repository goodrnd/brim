import {useEffect, useState, type Dispatch, type SetStateAction} from 'react';

const identity = <T>(v: T) => v;

/** useState persisted to localStorage. Missing, broken or empty-list values fall back to `fallback`. */
export function useStored<T>(
  key: string,
  fallback: () => T,
  toJson: (v: T) => T = identity,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (v != null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Object.keys(v).length)) {
        return v;
      }
    } catch {
      // broken JSON: use the fallback
    }
    return fallback();
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(toJson(value)));
    } catch (error) {
      // oxlint-disable-next-line no-console
      console.warn(`Could not save ${key}`, error); // quota full; keeps working in memory
    }
  }, [key, value, toJson]);
  return [value, setValue];
}
