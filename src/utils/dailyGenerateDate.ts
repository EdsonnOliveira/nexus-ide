const DATE_LABEL_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function resolveDailyTargetDate(preset: 'today' | 'yesterday'): Date {
  const now = new Date();

  if (preset === 'today') {
    return startOfLocalDay(now);
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return startOfLocalDay(yesterday);
}

export function formatDailyTargetDateLabel(date: Date): string {
  const label = date.toLocaleDateString('pt-BR', DATE_LABEL_FORMAT);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function maskDailyDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function parseDailyDateInput(masked: string): Date | null {
  const match = masked.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return startOfLocalDay(parsed);
}
