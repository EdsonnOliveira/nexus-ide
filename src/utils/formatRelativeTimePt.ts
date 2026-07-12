export function formatRelativeTimePt(timestamp: number, now = Date.now()): string {
  const deltaMs = Math.max(0, now - timestamp);
  const seconds = Math.floor(deltaMs / 1000);

  if (seconds < 45) {
    return 'agora';
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return minutes === 1 ? 'há 1 min' : `há ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return hours === 1 ? 'há 1 hora' : `há ${hours} horas`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  }

  return new Date(timestamp).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
