import { useEffect, useState } from 'react';

const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function formatClockLabel(date: Date): string {
  return date.toLocaleString('pt-BR', CLOCK_FORMAT).replace(/\./g, '');
}

function getMsUntilNextSecond(now: Date): number {
  return 1000 - now.getMilliseconds() + 50;
}

export function useTitleBarClock(enabled: boolean): string {
  const [label, setLabel] = useState(() => formatClockLabel(new Date()));

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timeoutId = 0;

    const schedule = () => {
      setLabel(formatClockLabel(new Date()));
      timeoutId = window.setTimeout(schedule, getMsUntilNextSecond(new Date()));
    };

    schedule();

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled]);

  return label;
}
