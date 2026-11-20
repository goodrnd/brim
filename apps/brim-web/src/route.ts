import {useEffect, useState} from 'react';

/** Current hash path split into parts, e.g. `#/model/abc/print` → ['model', 'abc', 'print']. */
export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

export const go = (path: string) => {
  location.hash = '/' + path;
};
