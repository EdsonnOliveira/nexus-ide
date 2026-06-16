import { useEffect, useState } from 'react';

export function useNexusReady(): boolean {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.nexus);

  useEffect(() => {
    if (window.nexus) {
      setReady(true);
      return;
    }

    const intervalId = window.setInterval(() => {
      if (window.nexus) {
        setReady(true);
        window.clearInterval(intervalId);
      }
    }, 16);

    return () => window.clearInterval(intervalId);
  }, []);

  return ready;
}
