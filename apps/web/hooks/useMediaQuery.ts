'use client';

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function useIsMobilePhone() {
  return useMediaQuery('(max-width: 767px)');
}

/** Detail di bawah tabel (bukan sidebar kanan); pakai popup, sama dengan breakpoint dashboard di page.module.css. */
export function useIsStackedDashboard() {
  return useMediaQuery('(max-width: 1279px)');
}
