import { useEffect, useState } from 'react';
import { formatLocalDayKey } from '@/utils/projectActivitySignals';

export function useLocalDayKey(nowMs = Date.now()): string {
  const [dayKey, setDayKey] = useState(() => formatLocalDayKey(nowMs));

  useEffect(() => {
    const sync = () => {
      const next = formatLocalDayKey(Date.now());
      setDayKey((prev) => (prev === next ? prev : next));
    };

    sync();

    const intervalId = window.setInterval(sync, 60_000);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return dayKey;
}
