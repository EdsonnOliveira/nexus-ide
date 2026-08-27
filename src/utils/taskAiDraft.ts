import {
  createAgentStreamJsonParserState,
  feedAgentStreamJsonChunk,
  hasMeaningfulStreamJsonTurnOutput,
} from '@/utils/agentStreamJsonParser';
import { registerAgentPrintPaneHandlers } from '@/utils/agentPrintBridge';
import { resolveDailyAgentFinalResponse } from '@/utils/dailyAgentResponse';
import { LOCAL_TASK_PRIORITY_OPTIONS } from '@/utils/taskLabels';

const TASK_AI_TIMEOUT_MS = 2 * 60 * 1000;
const ALLOWED_PRIORITIES = new Set<string>(
  LOCAL_TASK_PRIORITY_OPTIONS.map((option) => option.value),
);

export interface TaskAiDraft {
  title: string;
  description: string;
  priority: string;
  labels: string[];
  attachmentIndexes: number[];
}

export interface TaskAiDraftBundle {
  drafts: TaskAiDraft[];
}

export interface TaskAiAttachmentHint {
  index: number;
  name: string;
  kind: 'image' | 'audio' | 'video' | 'file';
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
): TaskAiDraft | null {
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
    priority: ALLOWED_PRIORITIES.has(priorityRaw) ? priorityRaw : '',
    labels,
    attachmentIndexes: parseAttachmentIndexes(parsed.attachmentIndexes, attachmentCount),
  };
}

export function parseTaskAiDraftBundle(
  content: string,
  attachmentCount: number,
): TaskAiDraftBundle {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() || content.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('A IA não retornou o JSON da tarefa');
  }

  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('A IA não retornou o JSON da tarefa');
  }

  const fromArray = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .filter(isRecord)
        .map((item) => parseDraftRecord(item, attachmentCount))
        .filter((item): item is TaskAiDraft => Boolean(item))
    : [];

  if (fromArray.length > 0) {
    return { drafts: fromArray };
  }

  const single = parseDraftRecord(parsed, attachmentCount);

  if (!single) {
    throw new Error('A IA não gerou um título');
  }

  return { drafts: [single] };
}

export function buildTaskAiDraftPrompt(input: {
  text: string;
  transcript: string;
  hasImages: boolean;
  hasVideos: boolean;
  hasAudio: boolean;
  hasFiles?: boolean;
  attachments: TaskAiAttachmentHint[];
}): string {
  const parts = [
    'Crie o conteúdo de tarefas a partir do material enviado.',
    'Se o material tiver assuntos independentes (vários prints, vídeos, áudios, arquivos ou pedidos distintos), separe em tarefas diferentes.',
    'Não edite arquivos, não rode comandos e não use ferramentas além de ler as imagens e arquivos anexados.',
    'Responda SOMENTE com JSON válido, sem markdown, neste formato:',
    '{"tasks":[{"title":"título curto","description":"o que precisa ser feito","priority":"Alta","labels":["tag"],"attachmentIndexes":[0]}]}',
    'priority deve ser uma de: Muito alta, Alta, Média, Baixa, Muito baixa, ou string vazia.',
    'attachmentIndexes usa os números da lista de anexos. Se a tarefa usa o material inteiro, pode omitir ou listar todos.',
    'Se for uma tarefa só, tasks tem 1 item.',
  ];

  if (input.text.trim()) {
    parts.push(`Texto do usuário:\n${input.text.trim()}`);
  }

  if (input.transcript.trim()) {
    parts.push(`Transcrição do áudio:\n${input.transcript.trim()}`);
  }

  if (input.attachments.length > 0) {
    parts.push(
      `Anexos numerados:\n${input.attachments
        .map((item) => `[${item.index}] ${item.name} (${item.kind})`)
        .join('\n')}`,
    );
  }

  if (input.hasImages) {
    parts.push('Há imagens anexadas no prompt. Use o que aparece nelas para definir as tarefas.');
  }

  if (input.hasVideos) {
    parts.push('Há vídeo anexado. Use o frame e o contexto enviado para definir as tarefas.');
  }

  if (input.hasAudio && !input.transcript.trim()) {
    parts.push(
      'Há áudio anexado, mas a transcrição não ficou disponível. Inferir as tarefas pelo restante do material.',
    );
  }

  if (input.hasFiles) {
    parts.push(
      'Há arquivos anexados (PDF, documento, planilha, etc). Leia o conteúdo desses arquivos para definir as tarefas.',
    );
  }

  return parts.join('\n\n');
}

export async function generateTaskAiDraftWithAgent(options: {
  projectPath: string;
  prompt: string;
  imagePaths: string[];
  filePaths?: string[];
  attachmentCount: number;
}): Promise<TaskAiDraftBundle> {
  if (!window.nexus?.agentPrint) {
    throw new Error('Agent indisponível');
  }

  const runToken = crypto.randomUUID();
  const paneId = `task-draft:${runToken}`;
  const parserState = createAgentStreamJsonParserState();
  const mentionPaths = [...options.imagePaths, ...(options.filePaths ?? [])]
    .map((filePath) => filePath.trim())
    .filter(Boolean);
  const mentions = [...new Set(mentionPaths)].map((filePath) =>
    filePath.startsWith('@') ? filePath : `@${filePath}`,
  );
  const prompt = [options.prompt.trim(), ...mentions].filter(Boolean).join('\n');

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (error: Error | null, bundle?: TaskAiDraftBundle) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      unregister();
      window.nexus.agentPrint.stop(paneId);

      if (error) {
        reject(error);
        return;
      }

      if (!bundle || bundle.drafts.length === 0) {
        reject(new Error('Não foi possível gerar a tarefa'));
        return;
      }

      resolve(bundle);
    };

    const completeFromParser = (fallbackError?: string) => {
      feedAgentStreamJsonChunk(parserState, '');
      const content = resolveDailyAgentFinalResponse(parserState);

      if (!content.trim()) {
        settle(new Error(fallbackError ?? 'Não foi possível gerar a tarefa'));
        return;
      }

      try {
        settle(null, parseTaskAiDraftBundle(content, options.attachmentCount));
      } catch (error) {
        settle(error instanceof Error ? error : new Error('Não foi possível ler a resposta da IA'));
      }
    };

    const unregister = registerAgentPrintPaneHandlers(paneId, {
      onData: (_incomingPaneId, data, incomingRunToken) => {
        if (settled || incomingRunToken !== runToken) {
          return;
        }

        const streamUpdate = feedAgentStreamJsonChunk(parserState, data);

        if (
          streamUpdate.shouldFinalize ||
          (parserState.shouldFinalize && hasMeaningfulStreamJsonTurnOutput(parserState))
        ) {
          completeFromParser();
        }
      },
      onDone: (_incomingPaneId, payload) => {
        if (settled || payload.runToken !== runToken) {
          return;
        }

        completeFromParser(payload.error);
      },
    });

    const timeoutId = window.setTimeout(() => {
      completeFromParser('A geração demorou demais e foi interrompida.');
    }, TASK_AI_TIMEOUT_MS);

    void window.nexus.agentPrint
      .start({
        paneId,
        cwd: options.projectPath,
        prompt,
        runToken,
      })
      .catch((error: unknown) => {
        settle(error instanceof Error ? error : new Error('Não foi possível iniciar o agent'));
      });
  });
}

export async function generateTaskAiDraft(input: {
  projectPath: string;
  text: string;
  transcript: string;
  imagePaths: string[];
  filePaths?: string[];
  hasVideos: boolean;
  hasAudio?: boolean;
  attachments: TaskAiAttachmentHint[];
}): Promise<TaskAiDraftBundle> {
  const hasImages = input.imagePaths.length > 0;
  const filePaths = (input.filePaths ?? []).filter((filePath) => filePath.trim());
  const hasFiles = filePaths.length > 0;
  const attachmentCount = input.attachments.length;

  if (!hasImages && !input.hasVideos && !hasFiles) {
    try {
      const result = await window.nexus.tasks.generateAiDraft({
        text: input.text,
        transcript: input.transcript,
        attachmentCount,
      });

      const drafts = (result.tasks ?? [])
        .filter((item) => item.title.trim())
        .map((item) => ({
          title: item.title,
          description: item.description,
          priority: ALLOWED_PRIORITIES.has(item.priority) ? item.priority : '',
          labels: item.labels,
          attachmentIndexes: item.attachmentIndexes.filter(
            (index) => Number.isInteger(index) && index >= 0 && index < attachmentCount,
          ),
        }));

      if (drafts.length > 0) {
        return { drafts };
      }
    } catch {}
  }

  return generateTaskAiDraftWithAgent({
    projectPath: input.projectPath,
    prompt: buildTaskAiDraftPrompt({
      text: input.text,
      transcript: input.transcript,
      hasImages,
      hasVideos: input.hasVideos,
      hasAudio: Boolean(input.hasAudio),
      hasFiles,
      attachments: input.attachments,
    }),
    imagePaths: input.imagePaths,
    filePaths,
    attachmentCount,
  });
}
