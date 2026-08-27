import { ollamaChat, isOllamaReachable } from './jarvis/ollamaClient';

const ALLOWED_PRIORITIES = ['Muito alta', 'Alta', 'Média', 'Baixa', 'Muito baixa'] as const;

export interface TaskAiDraftInput {
  text: string;
  transcript: string;
  attachmentCount?: number;
}

export interface TaskAiDraftResult {
  title: string;
  description: string;
  priority: string;
  labels: string[];
  attachmentIndexes: number[];
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAttachmentIndexes(value: unknown, attachmentCount: number): number[] {
  if (!Array.isArray(value) || attachmentCount <= 0) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => (typeof item === 'number' ? item : Number.parseInt(String(item), 10)))
        .filter((item) => Number.isInteger(item) && item >= 0 && item < attachmentCount),
    ),
  ];
}

function parseDraftRecord(
  parsed: Record<string, unknown>,
  attachmentCount: number,
): TaskAiDraftResult | null {
  const title = asTrimmedString(parsed.title);

  if (!title) {
    return null;
  }

  const priorityRaw = asTrimmedString(parsed.priority);
  const labels = Array.isArray(parsed.labels)
    ? parsed.labels
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    title: title.slice(0, 120),
    description: asTrimmedString(parsed.description),
    priority: ALLOWED_PRIORITIES.includes(priorityRaw as (typeof ALLOWED_PRIORITIES)[number])
      ? priorityRaw
      : '',
    labels,
    attachmentIndexes: parseAttachmentIndexes(parsed.attachmentIndexes, attachmentCount),
  };
}

function parseDraftPayload(raw: string, attachmentCount: number): TaskAiDraftResult[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('Resposta da IA sem JSON');
  }

  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('Resposta da IA sem JSON');
  }

  const fromArray = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .filter(isRecord)
        .map((item) => parseDraftRecord(item, attachmentCount))
        .filter((item): item is TaskAiDraftResult => Boolean(item))
    : [];

  if (fromArray.length > 0) {
    return fromArray;
  }

  const single = parseDraftRecord(parsed, attachmentCount);

  if (!single) {
    throw new Error('A IA não gerou um título');
  }

  return [single];
}

export async function generateTaskAiDraft(
  input: TaskAiDraftInput,
): Promise<{ tasks: TaskAiDraftResult[] }> {
  const reachable = await isOllamaReachable();

  if (!reachable) {
    throw new Error('Ollama indisponível');
  }

  const text = input.text.trim();
  const transcript = input.transcript.trim();
  const attachmentCount = Math.max(0, Math.floor(input.attachmentCount ?? 0));

  if (!text && !transcript) {
    throw new Error('Informe texto ou áudio para gerar a tarefa');
  }

  const content = await ollamaChat(
    [
      {
        role: 'system',
        content:
          'Você cria tarefas a partir do material. Se o conteúdo tiver assuntos independentes (vários prints, áudios, vídeos ou pedidos distintos), separe em tarefas diferentes. Responda somente JSON válido: {"tasks":[{"title":"...","description":"...","priority":"Alta","labels":["tag"],"attachmentIndexes":[0]}]}. description em português, clara e acionável. priority: Muito alta, Alta, Média, Baixa, Muito baixa, ou string vazia. attachmentIndexes são índices 0-based dos anexos que pertencem àquela tarefa. Se for uma tarefa só, tasks tem 1 item.',
      },
      {
        role: 'user',
        content: [
          text ? `Texto do usuário:\n${text}` : '',
          transcript ? `Transcrição do áudio:\n${transcript}` : '',
          attachmentCount > 0
            ? `Quantidade de anexos numerados de 0 a ${attachmentCount - 1}.`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
    { temperature: 0.2 },
  );

  return { tasks: parseDraftPayload(content, attachmentCount) };
}
