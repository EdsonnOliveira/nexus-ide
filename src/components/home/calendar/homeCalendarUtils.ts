export type HomeCalendarViewKind = 'day' | 'week' | 'month' | 'year';

export interface HomeCalendarDraft {
  title: string;
  startAt: number;
  endAt: number;
  calendarId: string;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
  alertMinutes: number;
  recurrence: 'none' | 'daily' | 'weekdays' | 'weekly';
}

const WEEKDAY_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];
const MONTH_NAMES_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

export function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  return addDays(start, -start.getDay());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function isToday(date: Date, now = new Date()): boolean {
  return isSameDay(date, now);
}

export function getViewRange(kind: HomeCalendarViewKind, focus: Date): { startAt: number; endAt: number } {
  if (kind === 'day') {
    const start = startOfDay(focus);
    return { startAt: start.getTime(), endAt: addDays(start, 1).getTime() };
  }

  if (kind === 'week') {
    const start = startOfWeek(focus);
    return { startAt: start.getTime(), endAt: addDays(start, 7).getTime() };
  }

  if (kind === 'month') {
    const monthStart = startOfMonth(focus);
    const gridStart = startOfWeek(monthStart);
    return { startAt: gridStart.getTime(), endAt: addDays(gridStart, 42).getTime() };
  }

  const yearStart = new Date(focus.getFullYear(), 0, 1);
  const yearEnd = new Date(focus.getFullYear() + 1, 0, 1);
  return { startAt: yearStart.getTime(), endAt: yearEnd.getTime() };
}

export function formatHeaderTitle(kind: HomeCalendarViewKind, focus: Date): string {
  if (kind === 'day') {
    return `${focus.getDate()} de ${MONTH_NAMES[focus.getMonth()]} de ${focus.getFullYear()}`;
  }

  if (kind === 'week' || kind === 'month') {
    return `${MONTH_NAMES[focus.getMonth()]} ${focus.getFullYear()}`;
  }

  return String(focus.getFullYear());
}

export function formatDaySubtitle(focus: Date): string {
  return WEEKDAY_LABELS[focus.getDay()];
}

export function formatTimeLabel(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function getMonthGridDays(focus: Date): Date[] {
  const monthStart = startOfMonth(focus);
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function getWeekDays(focus: Date): Date[] {
  const start = startOfWeek(focus);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function minutesFromDayStart(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

export function snapToHalfHour(ms: number): number {
  const date = new Date(ms);
  const minutes = date.getMinutes();
  const snapped = minutes < 15 ? 0 : minutes < 45 ? 30 : 60;
  date.setMinutes(snapped % 60, 0, 0);
  if (snapped === 60) {
    date.setHours(date.getHours() + 1);
  }
  return date.getTime();
}

export function createDefaultDraft(startAt: number, calendarId: string): HomeCalendarDraft {
  const start = snapToHalfHour(startAt);
  return {
    title: '',
    startAt: start,
    endAt: start + 30 * 60_000,
    calendarId,
    allDay: false,
    location: '',
    notes: '',
    url: '',
    alertMinutes: 15,
    recurrence: 'none',
  };
}

export { WEEKDAY_SHORT, WEEKDAY_LABELS, MONTH_NAMES, MONTH_NAMES_EN };
