import { useEffect, useState } from 'react';

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function formatDateLabel(date: Date): string {
  const label = date.toLocaleString('pt-BR', DATE_FORMAT);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatTimeLabel(date: Date): string {
  return date.toLocaleString('pt-BR', TIME_FORMAT).replace(/\./g, '');
}

function getMsUntilNextSecond(now: Date): number {
  return 1000 - now.getMilliseconds() + 50;
}

export function useHomeDashboardClock(): { dateLabel: string; timeLabel: string; nowMs: number } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId = 0;

    const schedule = () => {
      setNow(new Date());
      timeoutId = window.setTimeout(schedule, getMsUntilNextSecond(new Date()));
    };

    schedule();

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return {
    dateLabel: formatDateLabel(now),
    timeLabel: formatTimeLabel(now),
    nowMs: now.getTime(),
  };
}
