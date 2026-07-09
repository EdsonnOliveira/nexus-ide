import type { MacParakeetSourceType, MacParakeetTranscriptionDetail } from '@/types';
import type { ProjectTask } from '@/types/task';

export const MAC_PARAKEET_SOURCE_FILTER_OPTIONS: Array<{
  value: MacParakeetSourceType | '';
  label: string;
}> = [
  { value: '', label: 'Todas' },
  { value: 'regular_call', label: 'Chamadas' },
  { value: 'interview', label: 'Entrevistas' },
];

export function resolveMacParakeetSourceLabel(sourceType: MacParakeetSourceType): string {
  switch (sourceType) {
    case 'interview':
      return 'Entrevista';
    default:
      return 'Chamada';
  }
}

export function resolveMacParakeetSourceAccent(sourceType: MacParakeetSourceType): string {
  switch (sourceType) {
    case 'interview':
      return '#f472b6';
    default:
      return '#34d399';
  }
}

export function formatMacParakeetDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs <= 0) {
    return '—';
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatMacParakeetDate(timestamp: number): string {
  if (!timestamp) {
    return '—';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(timestamp));
}

export function formatMacParakeetSegmentTime(timestamp: number): string {
  if (!timestamp) {
    return '—';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function buildTaskDraftFromTranscription(
  detail: MacParakeetTranscriptionDetail,
): ProjectTask {
  const speechSegments = detail.segments.filter((segment) => segment.kind === 'speech');
  const transcription =
    speechSegments.length > 0
      ? speechSegments
          .map((segment) => segment.content.trim())
          .filter(Boolean)
          .join('\n\n')
      : detail.transcript.trim();

  const conclusion = detail.conclusion?.trim() ?? '';
  const descriptionParts: string[] = [];

  if (transcription) {
    descriptionParts.push(transcription);
  }

  if (conclusion) {
    if (descriptionParts.length > 0) {
      descriptionParts.push('', '---', '', 'Conclusão', '');
    } else {
      descriptionParts.push('Conclusão', '');
    }

    descriptionParts.push(conclusion);
  }

  return {
    id: crypto.randomUUID(),
    source: 'local',
    title: detail.title,
    description: descriptionParts.join('\n'),
    attachments: [],
    updatedAt: Date.now(),
  };
}
