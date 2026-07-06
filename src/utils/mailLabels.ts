import type { MailMailboxRef } from '@/types';

export function formatMailDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  const date = new Date(timestamp);
  const dateLabel = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const timeLabel = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return `${dateLabel}, ${timeLabel}`;
}

const MAILBOX_ACCENTS = [
  '#60a5fa',
  '#34d399',
  '#c084fc',
  '#fbbf24',
  '#f472b6',
  '#fb7185',
  '#38bdf8',
  '#a78bfa',
  '#22d3ee',
  '#4ade80',
  '#f97316',
  '#eab308',
];

export function encodeMailboxKey(mailbox: MailMailboxRef): string {
  return `${mailbox.accountName}\u001d${mailbox.mailboxName.trim() || 'INBOX'}`;
}

function hashMailboxKey(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

export function resolveMailboxAccentFromKey(key: string, orderedKeys: string[]): string {
  const orderedIndex = orderedKeys.indexOf(key);

  if (orderedIndex >= 0) {
    return MAILBOX_ACCENTS[orderedIndex % MAILBOX_ACCENTS.length]!;
  }

  return MAILBOX_ACCENTS[hashMailboxKey(key) % MAILBOX_ACCENTS.length]!;
}

export function resolveMailboxAccent(
  mailbox: MailMailboxRef,
  orderedKeys: string[],
): string {
  return resolveMailboxAccentFromKey(encodeMailboxKey(mailbox), orderedKeys);
}
