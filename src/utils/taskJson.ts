import type { ProjectTask, TaskAttachment } from '@/types/task';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';

const PROMPT_VERSION = 1;

export const LOCAL_TASK_STATUS_PENDING = 'Pendente';
export const LOCAL_TASK_STATUS_DONE = 'Concluído';

export interface TaskJsonAttachmentV1 {
  name: string;
  kind: 'image' | 'file';
  relativePath: string;
}

export interface TaskJsonV1 {
  version: typeof PROMPT_VERSION;
  title: string;
  description?: string;
  status?: string;
  dueDate?: string;
  priority?: string;
  labels?: string[];
  attachments?: TaskJsonAttachmentV1[];
}

export type TaskJsonParseResult =
  | { ok: true; task: ProjectTask }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStatusValue(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === 'done' ||
    normalized === 'concluído' ||
    normalized === 'concluido' ||
    normalized === 'concluída' ||
    normalized === 'concluida'
  ) {
    return LOCAL_TASK_STATUS_DONE;
  }

  if (normalized === 'pendente' || normalized === 'pending' || normalized === 'open') {
    return LOCAL_TASK_STATUS_PENDING;
  }

  return value.trim();
}

export function isLocalTaskCompleted(task: ProjectTask): boolean {
  if (task.source !== 'local') {
    return false;
  }

  const status = task.status?.trim();

  if (!status) {
    return false;
  }

  return normalizeStatusValue(status) === LOCAL_TASK_STATUS_DONE;
}

function joinProjectPath(projectPath: string, relativePath: string): string | null {
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!relative || relative.includes('..')) {
    return null;
  }

  const absolute = `${root}/${relative}`;

  if (absolute !== root && !absolute.startsWith(`${root}/`)) {
    return null;
  }

  return absolute;
}

function isPathInsideProject(projectPath: string, filePath: string): boolean {
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const entry = filePath.replace(/\\/g, '/');

  return entry === root || entry.startsWith(`${root}/`);
}

function stripAttachmentForJson(
  attachment: TaskAttachment,
  projectPath: string,
): TaskJsonAttachmentV1 | null {
  if (!isPathInsideProject(projectPath, attachment.path)) {
    return null;
  }

  return {
    name: attachment.name,
    kind: attachment.kind,
    relativePath: toProjectRelativePath(projectPath, attachment.path),
  };
}

function parseAttachment(
  raw: unknown,
  index: number,
  projectPath: string,
): TaskAttachment | null {
  if (!isRecord(raw)) {
    throw new Error(`O anexo ${index + 1} é inválido.`);
  }

  const name = raw.name;
  const kind = raw.kind;
  const relativePath = raw.relativePath;

  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`O anexo ${index + 1} precisa de "name".`);
  }

  if (kind !== 'image' && kind !== 'file') {
    throw new Error(`O anexo ${index + 1} tem "kind" inválido.`);
  }

  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`O anexo ${index + 1} precisa de "relativePath".`);
  }

  const path = joinProjectPath(projectPath, relativePath);

  if (!path) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    kind,
    path,
  };
}

export function serializeLocalTaskJson(task: ProjectTask, projectPath: string): string {
  if (task.source !== 'local') {
    throw new Error('Somente tarefas locais podem ser exportadas como JSON.');
  }

  const payload: TaskJsonV1 = {
    version: PROMPT_VERSION,
    title: task.title,
  };

  if (task.description.trim()) {
    payload.description = task.description;
  }

  const status = normalizeStatusValue(task.status);

  if (status) {
    payload.status = status;
  }

  if (task.local?.dueDate) {
    payload.dueDate = task.local.dueDate;
  }

  if (task.local?.priority?.trim()) {
    payload.priority = task.local.priority.trim();
  }

  if (task.local?.labels && task.local.labels.length > 0) {
    payload.labels = task.local.labels;
  }

  const attachments = task.attachments
    .map((attachment) => stripAttachmentForJson(attachment, projectPath))
    .filter((attachment): attachment is TaskJsonAttachmentV1 => Boolean(attachment));

  if (attachments.length > 0) {
    payload.attachments = attachments;
  }

  return JSON.stringify(payload, null, 2);
}

export function parseLocalTaskJson(text: string, projectPath: string): TaskJsonParseResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return { ok: false, error: 'Cole um JSON válido.' };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'O conteúdo não é um JSON válido.' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'O JSON deve ser um objeto.' };
  }

  if (parsed.version !== PROMPT_VERSION) {
    return { ok: false, error: 'Versão do JSON não suportada.' };
  }

  const title = parsed.title;

  if (typeof title !== 'string' || !title.trim()) {
    return { ok: false, error: 'O campo "title" é obrigatório.' };
  }

  const description =
    typeof parsed.description === 'string' ? parsed.description.trim() : '';

  let status: string | undefined;

  if (parsed.status !== undefined && parsed.status !== null) {
    if (typeof parsed.status !== 'string') {
      return { ok: false, error: 'O campo "status" deve ser texto.' };
    }

    status = normalizeStatusValue(parsed.status);
  }

  let dueDate: string | undefined;

  if (parsed.dueDate !== undefined && parsed.dueDate !== null) {
    if (typeof parsed.dueDate !== 'string' || !parsed.dueDate.trim()) {
      return { ok: false, error: 'O campo "dueDate" deve ser texto.' };
    }

    dueDate = parsed.dueDate.trim();
  }

  let priority: string | undefined;

  if (parsed.priority !== undefined && parsed.priority !== null) {
    if (typeof parsed.priority !== 'string' || !parsed.priority.trim()) {
      return { ok: false, error: 'O campo "priority" deve ser texto.' };
    }

    priority = parsed.priority.trim();
  }

  let labels: string[] | undefined;

  if (parsed.labels !== undefined && parsed.labels !== null) {
    if (!Array.isArray(parsed.labels)) {
      return { ok: false, error: 'O campo "labels" deve ser uma lista.' };
    }

    const nextLabels = parsed.labels
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);

    if (nextLabels.length > 0) {
      labels = nextLabels;
    }
  }

  const attachments: TaskAttachment[] = [];

  if (parsed.attachments !== undefined) {
    if (!Array.isArray(parsed.attachments)) {
      return { ok: false, error: 'O campo "attachments" deve ser uma lista.' };
    }

    try {
      for (let index = 0; index < parsed.attachments.length; index += 1) {
        const attachment = parseAttachment(parsed.attachments[index], index, projectPath);

        if (attachment) {
          attachments.push(attachment);
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Anexos inválidos.',
      };
    }
  }

  const localMeta =
    dueDate || priority || labels
      ? {
          ...(dueDate ? { dueDate } : {}),
          ...(priority ? { priority } : {}),
          ...(labels ? { labels } : {}),
        }
      : undefined;

  return {
    ok: true,
    task: {
      id: crypto.randomUUID(),
      source: 'local',
      title: title.trim(),
      description,
      status,
      local: localMeta,
      attachments,
      updatedAt: Date.now(),
    },
  };
}

export const TASK_JSON_PLACEHOLDER = `{
  "version": 1,
  "title": "Implementar login",
  "description": "Critérios de aceite...",
  "status": "Pendente",
  "attachments": [
    {
      "name": "mock.png",
      "kind": "image",
      "relativePath": ".nexus/tasks/{taskId}/..."
    }
  ]
}`;
