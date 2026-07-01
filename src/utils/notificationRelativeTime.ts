export function formatNotificationRelativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return 'agora';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours} h`;
  }

  const diffDays = Math.floor(diffHours / 24);

  return `${diffDays} d`;
}

export function getRecentSystemNotificationCount(
  items: Array<{ deliveredAt: number }>,
  maxAgeMs = 24 * 60 * 60 * 1000,
): number {
  const threshold = Date.now() - maxAgeMs;

  return items.filter((item) => item.deliveredAt >= threshold).length;
}
