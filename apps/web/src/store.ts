import {useEffect, useState, type Dispatch, type SetStateAction} from 'react';

/** useState persisted to localStorage. Missing, broken or empty-list values fall back to `fallback`. */
export function useStored<T>(key: string, fallback: () => T, toJson: (v: T) => unknown = (v) => v): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (v != null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Object.keys(v).length)) return v;
    } catch {}
    return fallback();
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(toJson(value)));
    } catch (e) {
      console.warn(`Could not save ${key}`, e); // quota full; keeps working in memory
    }
  }, [key, value]);
  return [value, setValue];
}
