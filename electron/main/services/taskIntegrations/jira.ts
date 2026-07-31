import https from 'node:https';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ProjectTask,
  ProjectTaskJiraSubtask,
  TaskAttachment,
  TaskComment,
  TaskDetailData,
  TaskHistoryEntry,
  TaskIntegrationConfig,
} from '../../../types/task';
import type { TaskCredentialSecrets } from '../taskCredentialStore';
import { isImageAttachmentName } from '../../../types/task';
import { ensureNexusProjectDir } from '../nexusProjectGitignore';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_REDIRECTS = 5;

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

interface JiraIssueType {
  name?: string;
  subtask?: boolean;
}

interface JiraSubtaskIssue {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string; avatarUrls?: Record<string, string> } | null;
  };
}

interface JiraIssue {
  id: string;
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    attachment?: JiraAttachment[];
    parent?: {
      key?: string;
      fields?: { summary?: string };
    };
    assignee?: { displayName?: string; avatarUrls?: Record<string, string> } | null;
    issuetype?: JiraIssueType;
    subtasks?: JiraSubtaskIssue[];
    labels?: string[];
    priority?: { name?: string };
  };
}

interface JiraAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  content: string;
}

interface JiraProjectResponse {
  values?: Array<{ id: string; key: string; name: string }>;
}

interface JiraUser {
  displayName?: string;
  avatarUrls?: Record<string, string>;
}

interface JiraComment {
  id: string;
  author?: JiraUser;
  body?: unknown;
  created?: string;
}

interface JiraCommentsResponse {
  comments?: JiraComment[];
}

interface JiraChangelogItem {
  field: string;
  fromString?: string;
  toString?: string;
}

interface JiraChangelogHistory {
  id: string;
  author?: JiraUser;
  created?: string;
  items?: JiraChangelogItem[];
}

interface JiraIssueDetailResponse {
  id: string;
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    attachment?: JiraAttachment[];
    parent?: {
      key?: string;
      fields?: { summary?: string };
    };
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    issuetype?: JiraIssueType;
    subtasks?: JiraSubtaskIssue[];
    labels?: string[];
    priority?: { name?: string };
    created?: string;
    updated?: string;
    resolutiondate?: string;
    duedate?: string;
    comment?: {
      comments?: JiraComment[];
    };
  };
  changelog?: {
    histories?: JiraChangelogHistory[];
  };
}

function pickJiraAssigneeAvatarUrl(avatarUrls?: Record<string, string>): string | undefined {
  if (!avatarUrls) {
    return undefined;
  }

  return avatarUrls['24x24'] ?? avatarUrls['32x32'] ?? avatarUrls['48x48'] ?? avatarUrls['16x16'];
}

function pickJiraUserAvatarUrl(user?: JiraUser | null): string | undefined {
  return pickJiraAssigneeAvatarUrl(user?.avatarUrls);
}

const JIRA_FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  assignee: 'Responsável',
  priority: 'Prioridade',
  summary: 'Resumo',
  description: 'Descrição',
  labels: 'Categorias',
  resolution: 'Resolução',
  duedate: 'Data de entrega',
  parent: 'Pai',
  issuetype: 'Tipo',
  reporter: 'Relator',
  rank: 'Rank',
};

function mapJiraFieldLabel(field: string): string {
  return JIRA_FIELD_LABELS[field.trim().toLowerCase()] ?? field;
}

function mapHistoryAction(field: string): string {
  const key = field.trim().toLowerCase();
  const actions: Record<string, string> = {
    status: 'alterou o Status',
    priority: 'alterou a Prioridade',
    assignee: 'alterou o Responsável',
    rank: 'atualizou o Rank',
    resolution: 'atualizou a Resolução',
    summary: 'atualizou o Resumo',
    description: 'atualizou a Descrição',
    labels: 'atualizou as Categorias',
    duedate: 'atualizou a Data de entrega',
    parent: 'atualizou o Pai',
    issuetype: 'alterou o Tipo',
    reporter: 'alterou o Relator',
  };

  return actions[key] ?? `atualizou o ${mapJiraFieldLabel(field)}`;
}

function buildJiraCommentBody(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function mapJiraComment(comment: JiraComment): TaskComment {
  return {
    id: comment.id,
    authorName: comment.author?.displayName?.trim() || 'Desconhecido',
    authorAvatarUrl: pickJiraUserAvatarUrl(comment.author),
    body: extractJiraDescription(comment.body),
    createdAt: comment.created ?? '',
  };
}

function mapJiraHistory(histories: JiraChangelogHistory[] | undefined): TaskHistoryEntry[] {
  const entries: TaskHistoryEntry[] = [];

  for (const history of histories ?? []) {
    const authorName = history.author?.displayName?.trim() || 'Desconhecido';
    const createdAt = history.created ?? '';

    for (const item of history.items ?? []) {
      entries.push({
        id: `${history.id}-${item.field}`,
        authorName,
        authorAvatarUrl: pickJiraUserAvatarUrl(history.author),
        createdAt,
        field: mapJiraFieldLabel(item.field),
        fieldKey: item.field,
        action: mapHistoryAction(item.field),
        from: item.fromString?.trim() || undefined,
        to: item.toString?.trim() || undefined,
      });
    }
  }

  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function mapJiraSubtasks(subtasks: JiraSubtaskIssue[] | undefined): ProjectTaskJiraSubtask[] {
  const mapped: ProjectTaskJiraSubtask[] = [];

  for (const subtask of subtasks ?? []) {
    const key = subtask.key?.trim();

    if (!key) {
      continue;
    }

    const assignee = subtask.fields?.assignee?.displayName?.trim();
    const assigneeAvatarUrl = pickJiraAssigneeAvatarUrl(subtask.fields?.assignee?.avatarUrls);
    const status = subtask.fields?.status?.name?.trim();

    mapped.push({
      key,
      title: subtask.fields?.summary?.trim() || key,
      ...(status ? { status } : {}),
      ...(assignee ? { assignee } : {}),
      ...(assigneeAvatarUrl ? { assigneeAvatarUrl } : {}),
    });
  }

  return mapped;
}

function mergeJiraSubtaskLists(
  remoteSubtasks: ProjectTaskJiraSubtask[] | undefined,
  localSubtasks: ProjectTaskJiraSubtask[] | undefined,
): ProjectTaskJiraSubtask[] | undefined {
  if (!remoteSubtasks || remoteSubtasks.length === 0) {
    return localSubtasks && localSubtasks.length > 0 ? localSubtasks : remoteSubtasks;
  }

  const localByKey = new Map((localSubtasks ?? []).map((subtask) => [subtask.key, subtask]));

  return remoteSubtasks.map((subtask) => {
    const local = localByKey.get(subtask.key);

    return {
      ...subtask,
      title: subtask.title || local?.title || subtask.key,
      status: subtask.status ?? local?.status,
      assignee: subtask.assignee ?? local?.assignee,
      assigneeAvatarUrl: subtask.assigneeAvatarUrl ?? local?.assigneeAvatarUrl,
    };
  });
}

function enrichJiraSubtasksWithAssignees(tasks: ProjectTask[]): ProjectTask[] {
  const byKey = new Map(
    tasks
      .filter((task) => Boolean(task.externalId))
      .map((task) => [task.externalId!, task] as const),
  );

  return tasks.map((task) => {
    const subtasks = task.jira?.subtasks;

    if (!subtasks || subtasks.length === 0) {
      return task;
    }

    return {
      ...task,
      jira: {
        ...task.jira,
        subtasks: subtasks.map((subtask) => {
          const related = byKey.get(subtask.key);

          return {
            ...subtask,
            title: related?.title ?? subtask.title,
            status: related?.status ?? subtask.status,
            assignee: related?.jira?.assignee ?? subtask.assignee,
            assigneeAvatarUrl: related?.jira?.assigneeAvatarUrl ?? subtask.assigneeAvatarUrl,
          };
        }),
      },
    };
  });
}

function isJiraIssueTypeSubtask(issueType?: JiraIssueType): boolean {
  if (issueType?.subtask === true) {
    return true;
  }

  const name = issueType?.name?.trim().toLowerCase() ?? '';

  if (!name) {
    return false;
  }

  return (
    name === 'sub-task' ||
    name === 'subtask' ||
    name === 'subtarefa' ||
    name.includes('sub-task') ||
    name.includes('subtask') ||
    name.includes('subtarefa')
  );
}

function mapJiraIssueToTask(issue: JiraIssueDetailResponse, attachments: TaskAttachment[]): ProjectTask {
  const mappedSubtasks = mapJiraSubtasks(issue.fields?.subtasks);

  return {
    id: issue.key,
    source: 'jira',
    externalId: issue.key,
    title: issue.fields?.summary?.trim() || issue.key,
    description: extractJiraDescription(issue.fields?.description),
    attachments,
    status: issue.fields?.status?.name,
    jira: {
      parentKey: issue.fields?.parent?.key,
      parentSummary: issue.fields?.parent?.fields?.summary,
      assignee: issue.fields?.assignee?.displayName,
      assigneeAvatarUrl: pickJiraUserAvatarUrl(issue.fields?.assignee),
      issueType: issue.fields?.issuetype?.name,
      isSubtask: isJiraIssueTypeSubtask(issue.fields?.issuetype),
      subtasks: mappedSubtasks.length > 0 ? mappedSubtasks : undefined,
      labels: issue.fields?.labels ?? [],
      priority: issue.fields?.priority?.name,
      reporter: issue.fields?.reporter?.displayName,
      reporterAvatarUrl: pickJiraUserAvatarUrl(issue.fields?.reporter),
      createdAt: issue.fields?.created,
      resolvedAt: issue.fields?.resolutiondate,
      dueDate: issue.fields?.duedate,
    },
    updatedAt: Date.now(),
  };
}

function normalizeJiraSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim();

  if (!trimmed) {
    return '';
  }

  try {
    const withProtocol =
      trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

function extractJiraProjectKeyFromUrl(siteUrl: string): string | undefined {
  const trimmed = siteUrl.trim();

  if (!trimmed.includes('/projects/') && !trimmed.includes('/browse/')) {
    return undefined;
  }

  try {
    const withProtocol =
      trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    const projectPathMatch = url.pathname.match(/\/projects\/([A-Z][A-Z0-9]+)/i);
    const browseMatch = url.pathname.match(/\/browse\/([A-Z][A-Z0-9]+)-\d+/i);

    if (projectPathMatch) {
      return projectPathMatch[1].toUpperCase();
    }

    if (browseMatch) {
      return browseMatch[1].toUpperCase();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parseJiraErrorBody(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { errorMessages?: string[]; message?: string };
    const message = parsed.errorMessages?.[0] ?? parsed.message;

    if (message) {
      return message;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function jiraAuthError(statusCode: number | undefined, body?: string): string {
  const remoteMessage = body ? parseJiraErrorBody(body) : undefined;

  if (statusCode === 401) {
    return 'E-mail ou API token do Jira inválidos';
  }

  if (statusCode === 403) {
    return 'Sem permissão para acessar este projeto no Jira';
  }

  if (statusCode === 404) {
    return 'URL do Jira não encontrada. Use apenas o domínio, ex: empresa.atlassian.net';
  }

  if (statusCode === 410) {
    return (
      remoteMessage ??
      'Endpoint de busca do Jira foi descontinuado. Atualize o Nexus IDE para usar /rest/api/3/search/jql'
    );
  }

  if (remoteMessage) {
    return remoteMessage;
  }

  return `Jira respondeu com status ${statusCode ?? 'desconhecido'}`;
}

interface JiraRequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

function jiraRequest<T>(
  siteUrl: string,
  email: string,
  apiToken: string,
  requestPath: string,
  options?: JiraRequestOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const base = normalizeJiraSiteUrl(siteUrl);
    const url = new URL(requestPath, `${base}/`);
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const method = options?.method ?? 'GET';
    const payload = options?.body ? JSON.stringify(options.body) : undefined;

    const request = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let body = '';

        response.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });

        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(jiraAuthError(response.statusCode, body)));
            return;
          }

          if (!body.trim()) {
            resolve({} as T);
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Resposta inválida do Jira'));
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Tempo esgotado ao conectar com o Jira'));
    });

    request.on('error', reject);

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

interface JiraTransitionStatus {
  id?: string;
  name?: string;
  statusCategory?: { key?: string; name?: string };
}

interface JiraTransition {
  id: string;
  name?: string;
  to?: JiraTransitionStatus;
}

interface JiraTransitionsResponse {
  transitions?: JiraTransition[];
}

function isJiraDoneStatus(status?: JiraTransitionStatus): boolean {
  const categoryKey = status?.statusCategory?.key?.trim().toLowerCase();

  if (categoryKey === 'done') {
    return true;
  }

  const name = status?.name?.trim().toLowerCase() ?? '';

  return (
    name === 'done' ||
    name === 'concluído' ||
    name === 'concluido' ||
    name === 'concluída' ||
    name === 'concluida' ||
    name === 'resolved' ||
    name === 'closed' ||
    name === 'fechado' ||
    name === 'fechada'
  );
}

function isJiraProgressStatus(status?: JiraTransitionStatus): boolean {
  const categoryKey = status?.statusCategory?.key?.trim().toLowerCase();

  if (categoryKey === 'indeterminate') {
    return true;
  }

  const name = status?.name?.trim().toLowerCase() ?? '';

  return (
    name === 'in progress' ||
    name === 'em andamento' ||
    name === 'em progresso' ||
    name.includes('andamento') ||
    name.includes('progress') ||
    name === 'doing'
  );
}

export async function listJiraIssueTransitions(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<Array<{ id: string; name: string; isDone: boolean; isProgress: boolean }>> {
  const response = await jiraRequest<JiraTransitionsResponse>(
    siteUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
  );

  return (response.transitions ?? [])
    .filter((transition) => Boolean(transition.id))
    .map((transition) => ({
      id: transition.id,
      name: transition.to?.name?.trim() || transition.name?.trim() || transition.id,
      isDone: isJiraDoneStatus(transition.to),
      isProgress: isJiraProgressStatus(transition.to),
    }));
}

export async function transitionJiraIssue(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
  transitionId: string,
): Promise<string> {
  const transitions = await listJiraIssueTransitions(siteUrl, email, apiToken, issueKey);
  const selected = transitions.find((item) => item.id === transitionId);

  if (!selected) {
    throw new Error('Transição indisponível para esta tarefa');
  }

  await jiraRequest(
    siteUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: 'POST',
      body: {
        transition: { id: transitionId },
      },
    },
  );

  return selected.name;
}

export async function completeJiraIssue(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<string> {
  const transitions = await listJiraIssueTransitions(siteUrl, email, apiToken, issueKey);
  const doneTransition =
    transitions.find((item) => item.isDone) ??
    transitions.find((item) => /done|conclu|resolv|fechad|closed/i.test(item.name));

  if (!doneTransition) {
    throw new Error('Nenhuma transição de conclusão disponível para esta tarefa');
  }

  return transitionJiraIssue(siteUrl, email, apiToken, issueKey, doneTransition.id);
}

export async function startJiraIssue(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<string> {
  const transitions = await listJiraIssueTransitions(siteUrl, email, apiToken, issueKey);
  const progressTransition =
    transitions.find((item) => item.isProgress) ??
    transitions.find((item) => /andamento|progress|doing/i.test(item.name));

  if (!progressTransition) {
    throw new Error('Nenhuma transição de andamento disponível para esta tarefa');
  }

  return transitionJiraIssue(siteUrl, email, apiToken, issueKey, progressTransition.id);
}

function isLikelyImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return true;
  }

  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return true;
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return true;
  }

  return false;
}

async function shouldReuseCachedAttachment(targetPath: string, filename: string): Promise<boolean> {
  try {
    const fileStat = await stat(targetPath);

    if (fileStat.size === 0) {
      return false;
    }

    if (!isImageAttachmentName(filename)) {
      return true;
    }

    const buffer = await readFile(targetPath);

    return isLikelyImageBuffer(buffer);
  } catch {
    return false;
  }
}

function jiraDownload(
  siteUrl: string,
  email: string,
  apiToken: string,
  downloadUrl: string,
  redirectCount = 0,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = new URL(downloadUrl);
    const jiraHost = new URL(normalizeJiraSiteUrl(siteUrl)).host;
    const useAuth = redirectCount === 0 || url.host === jiraHost;
    const headers: Record<string, string> = {};

    if (useAuth) {
      headers.Authorization = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
    }

    const request = https.request(
      url,
      {
        method: 'GET',
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const statusCode = response.statusCode ?? 500;
        const location = response.headers.location;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          location &&
          redirectCount < MAX_DOWNLOAD_REDIRECTS
        ) {
          response.resume();
          jiraDownload(siteUrl, email, apiToken, new URL(location, url).toString(), redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          if (statusCode >= 400) {
            reject(new Error(`Falha ao baixar anexo do Jira (${statusCode})`));
            return;
          }

          const buffer = Buffer.concat(chunks);

          if (buffer.length === 0) {
            reject(new Error('Anexo vazio retornado pelo Jira'));
            return;
          }

          resolve(buffer);
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Tempo esgotado ao baixar anexo do Jira'));
    });

    request.on('error', reject);
    request.end();
  });
}

interface AdfMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
}

function extractJiraDescription(description: unknown): string {
  if (typeof description === 'string') {
    return description.trim();
  }

  if (!description || typeof description !== 'object') {
    return '';
  }

  return convertAdfToMarkdown(description as AdfNode)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function convertAdfToMarkdown(
  node: AdfNode,
  listContext?: { ordered: boolean; index: number },
  depth = 0,
): string {
  if (depth > 64) {
    return '';
  }

  const type = node.type ?? '';
  const children = Array.isArray(node.content) ? node.content : [];
  const nextDepth = depth + 1;

  switch (type) {
    case 'doc':
      return children.map((child) => convertAdfToMarkdown(child, undefined, nextDepth)).join('');
    case 'paragraph':
      return `${children.map((child) => convertAdfInline(child)).join('')}\n\n`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 3) || 3));
      return `${'#'.repeat(level)} ${children.map((child) => convertAdfInline(child)).join('')}\n\n`;
    }
    case 'bulletList':
      return `${children
        .map((child) => convertAdfToMarkdown(child, { ordered: false, index: 0 }, nextDepth))
        .join('')}\n`;
    case 'orderedList':
      return `${children
        .map((child, index) =>
          convertAdfToMarkdown(child, { ordered: true, index: index + 1 }, nextDepth),
        )
        .join('')}\n`;
    case 'listItem': {
      const prefix = listContext?.ordered ? `${listContext.index}. ` : '- ';
      const parts: string[] = [];

      for (const child of children) {
        if (child.type === 'paragraph') {
          parts.push((child.content ?? []).map((entry) => convertAdfInline(entry)).join(''));
          continue;
        }

        if (child.type === 'bulletList' || child.type === 'orderedList' || child.type === 'taskList') {
          const nested = convertAdfToMarkdown(child, undefined, nextDepth)
            .trimEnd()
            .split('\n')
            .map((line) => (line ? `  ${line}` : line))
            .join('\n');
          parts.push(`\n${nested}`);
          continue;
        }

        parts.push(convertAdfToMarkdown(child, listContext, nextDepth).trimEnd());
      }

      return `${prefix}${parts.join('').trim()}\n`;
    }
    case 'taskList':
      return `${children.map((child) => convertAdfToMarkdown(child, undefined, nextDepth)).join('')}\n`;
    case 'taskItem': {
      const state = String(node.attrs?.state ?? 'TODO').toUpperCase();
      const checked = state === 'DONE' ? 'x' : ' ';
      const text = children
        .map((child) => {
          if (child.type === 'paragraph') {
            return (child.content ?? []).map((entry) => convertAdfInline(entry)).join('');
          }

          return convertAdfInline(child);
        })
        .join('')
        .trim();
      return `- [${checked}] ${text}\n`;
    }
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      const code = children
        .map((child) => (child.type === 'text' ? (child.text ?? '') : convertAdfInline(child)))
        .join('');
      return `\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
    case 'blockquote': {
      const inner = children
        .map((child) => convertAdfToMarkdown(child, undefined, nextDepth))
        .join('')
        .trim();
      return `${inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    }
    case 'rule':
      return '\n---\n\n';
    case 'hardBreak':
      return '\n';
    case 'table':
      return `${children.map((child) => convertAdfToMarkdown(child, undefined, nextDepth)).join('')}\n`;
    case 'tableRow': {
      const cells = children.map((child) =>
        convertAdfToMarkdown(child, undefined, nextDepth).replace(/\n+/g, ' ').trim(),
      );
      const row = `| ${cells.join(' | ')} |`;

      if (children.some((child) => child.type === 'tableHeader')) {
        const separator = `| ${cells.map(() => '---').join(' | ')} |`;
        return `${row}\n${separator}\n`;
      }

      return `${row}\n`;
    }
    case 'tableHeader':
    case 'tableCell':
      return children
        .map((child) => {
          if (child.type === 'paragraph') {
            return (child.content ?? []).map((entry) => convertAdfInline(entry)).join('');
          }

          return convertAdfToMarkdown(child, undefined, nextDepth).trim();
        })
        .join(' ');
    case 'mediaSingle':
    case 'mediaGroup':
    case 'expand':
    case 'panel':
      return children.map((child) => convertAdfToMarkdown(child, undefined, nextDepth)).join('');
    case 'text':
      return convertAdfInline(node);
    default:
      if (children.length > 0) {
        return children
          .map((child) => convertAdfToMarkdown(child, listContext, nextDepth))
          .join('');
      }

      return convertAdfInline(node);
  }
}

function convertAdfInline(node: AdfNode): string {
  const type = node.type ?? '';

  if (type === 'hardBreak') {
    return '\n';
  }

  if (type === 'mention') {
    const mentionText = typeof node.attrs?.text === 'string' ? node.attrs.text.trim() : '';

    if (mentionText) {
      return mentionText.startsWith('@') ? mentionText : `@${mentionText}`;
    }

    return `@${String(node.attrs?.id ?? 'user')}`;
  }

  if (type === 'emoji') {
    if (typeof node.attrs?.text === 'string' && node.attrs.text.trim()) {
      return node.attrs.text;
    }

    if (typeof node.attrs?.shortName === 'string' && node.attrs.shortName.trim()) {
      return node.attrs.shortName;
    }

    return '';
  }

  if (type === 'inlineCard') {
    return typeof node.attrs?.url === 'string' ? node.attrs.url : '';
  }

  if (type === 'status') {
    return typeof node.attrs?.text === 'string' ? node.attrs.text : '';
  }

  if (type !== 'text') {
    if (Array.isArray(node.content) && node.content.length > 0) {
      return node.content.map((child) => convertAdfInline(child)).join('');
    }

    return '';
  }

  let text = node.text ?? '';

  if (!text) {
    return '';
  }

  const marks = Array.isArray(node.marks) ? node.marks : [];
  const markTypes = new Set(
    marks.map((mark) => mark.type).filter((value): value is string => Boolean(value)),
  );

  if (markTypes.has('code')) {
    return `\`${text.replace(/`/g, '\\`')}\``;
  }

  const linkMark = marks.find((mark) => mark.type === 'link');
  const href = typeof linkMark?.attrs?.href === 'string' ? linkMark.attrs.href : '';

  if (href) {
    text = `[${text}](${href})`;
  }

  if (markTypes.has('strong') || markTypes.has('bold')) {
    text = `**${text}**`;
  }

  if (markTypes.has('em') || markTypes.has('italic')) {
    text = `*${text}*`;
  }

  if (markTypes.has('strike')) {
    text = `~~${text}~~`;
  }

  return text;
}

async function downloadJiraAttachments(
  projectPath: string,
  taskId: string,
  siteUrl: string,
  email: string,
  apiToken: string,
  attachments: JiraAttachment[],
): Promise<TaskAttachment[]> {
  const targetDir = await ensureNexusProjectDir(projectPath, 'tasks', taskId);

  const saved: TaskAttachment[] = [];

  for (const attachment of attachments) {
    const safeName = attachment.filename.replace(/[^\w.\-()+\s]/g, '_');
    const targetPath = path.join(targetDir, safeName);

    try {
      if (await shouldReuseCachedAttachment(targetPath, attachment.filename)) {
        saved.push({
          id: randomUUID(),
          name: attachment.filename,
          kind: isImageAttachmentName(attachment.filename) ? 'image' : 'file',
          path: targetPath,
          mimeType: attachment.mimeType,
        });
        continue;
      }
    } catch {
      // download below
    }

    try {
      await unlink(targetPath).catch(() => undefined);

      const buffer = await jiraDownload(siteUrl, email, apiToken, attachment.content);

      if (isImageAttachmentName(attachment.filename) && !isLikelyImageBuffer(buffer)) {
        continue;
      }

      await writeFile(targetPath, buffer);

      saved.push({
        id: randomUUID(),
        name: attachment.filename,
        kind: isImageAttachmentName(attachment.filename) ? 'image' : 'file',
        path: targetPath,
        mimeType: attachment.mimeType,
      });
    } catch {
      continue;
    }
  }

  return saved;
}

export async function getJiraAccountName(
  siteUrl: string,
  email: string,
  apiToken: string,
): Promise<string | undefined> {
  const response = await jiraRequest<{ displayName?: string }>(
    siteUrl,
    email,
    apiToken,
    '/rest/api/3/myself',
  );

  return response.displayName?.trim() || undefined;
}

export async function testJiraConnection(
  siteUrl: string,
  email: string,
  apiToken: string,
): Promise<void> {
  await getJiraAccountName(siteUrl, email, apiToken);
}

export async function listJiraProjects(
  siteUrl: string,
  email: string,
  apiToken: string,
): Promise<Array<{ id: string; key: string; name: string }>> {
  const response = await jiraRequest<JiraProjectResponse>(
    siteUrl,
    email,
    apiToken,
    '/rest/api/3/project/search?maxResults=50',
  );

  return (response.values ?? []).map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
  }));
}

export async function syncJiraTasks(
  projectPath: string,
  config: TaskIntegrationConfig,
  secrets: TaskCredentialSecrets,
): Promise<ProjectTask[]> {
  const siteUrl = normalizeJiraSiteUrl(config.jiraSiteUrl?.trim() ?? '');
  const email = config.jiraEmail?.trim() ?? '';
  const projectKey =
    config.jiraProjectKey?.trim() ||
    extractJiraProjectKeyFromUrl(config.jiraSiteUrl?.trim() ?? '') ||
    '';
  const apiToken = secrets.jiraApiToken?.trim() ?? '';

  if (!siteUrl || !email || !projectKey || !apiToken) {
    throw new Error('Configuração do Jira incompleta');
  }

  const response = await jiraRequest<JiraSearchResponse>(
    siteUrl,
    email,
    apiToken,
    '/rest/api/3/search/jql',
    {
      method: 'POST',
      body: {
        jql: `project = "${projectKey}" ORDER BY updated DESC`,
        maxResults: 50,
        fields: [
          'summary',
          'description',
          'status',
          'attachment',
          'parent',
          'assignee',
          'issuetype',
          'subtasks',
          'labels',
          'priority',
        ],
      },
    },
  );

  const tasks: ProjectTask[] = [];

  for (const issue of response.issues ?? []) {
    const taskId = issue.key;
    const attachments = await downloadJiraAttachments(
      projectPath,
      taskId,
      siteUrl,
      email,
      apiToken,
      issue.fields?.attachment ?? [],
    );
    const mappedSubtasks = mapJiraSubtasks(issue.fields?.subtasks);

    tasks.push({
      id: issue.key,
      source: 'jira',
      externalId: issue.key,
      title: issue.fields?.summary?.trim() || issue.key,
      description: extractJiraDescription(issue.fields?.description),
      attachments,
      status: issue.fields?.status?.name,
      jira: {
        parentKey: issue.fields?.parent?.key,
        parentSummary: issue.fields?.parent?.fields?.summary,
        assignee: issue.fields?.assignee?.displayName,
        assigneeAvatarUrl: pickJiraAssigneeAvatarUrl(issue.fields?.assignee?.avatarUrls),
        issueType: issue.fields?.issuetype?.name,
        isSubtask: isJiraIssueTypeSubtask(issue.fields?.issuetype),
        subtasks: mappedSubtasks.length > 0 ? mappedSubtasks : undefined,
        labels: issue.fields?.labels ?? [],
        priority: issue.fields?.priority?.name,
      },
      updatedAt: Date.now(),
    });
  }

  const enrichedTasks = enrichJiraSubtasksWithAssignees(tasks);
  const missingSubtaskKeys = Array.from(
    new Set(
      enrichedTasks.flatMap((task) =>
        (task.jira?.subtasks ?? [])
          .filter((subtask) => !subtask.assignee)
          .map((subtask) => subtask.key),
      ),
    ),
  ).slice(0, 50);

  if (missingSubtaskKeys.length === 0) {
    return enrichedTasks;
  }

  const subtaskDetails = await jiraRequest<JiraSearchResponse>(
    siteUrl,
    email,
    apiToken,
    '/rest/api/3/search/jql',
    {
      method: 'POST',
      body: {
        jql: `key in (${missingSubtaskKeys.map((key) => `"${key.replace(/"/g, '\\"')}"`).join(', ')})`,
        maxResults: missingSubtaskKeys.length,
        fields: ['summary', 'status', 'assignee', 'parent', 'issuetype'],
      },
    },
  );

  const detailByKey = new Map<string, ProjectTaskJiraSubtask>();

  for (const issue of subtaskDetails.issues ?? []) {
    const key = issue.key?.trim();

    if (!key) {
      continue;
    }

    detailByKey.set(key, {
      key,
      title: issue.fields?.summary?.trim() || key,
      status: issue.fields?.status?.name?.trim() || undefined,
      assignee: issue.fields?.assignee?.displayName?.trim() || undefined,
      assigneeAvatarUrl: pickJiraAssigneeAvatarUrl(issue.fields?.assignee?.avatarUrls),
    });
  }

  return enrichedTasks.map((task) => {
    const subtasks = task.jira?.subtasks;

    if (!subtasks || subtasks.length === 0) {
      return task;
    }

    return {
      ...task,
      jira: {
        ...task.jira,
        subtasks: subtasks.map((subtask) => {
          const detail = detailByKey.get(subtask.key);

          if (!detail) {
            return subtask;
          }

          return {
            ...subtask,
            title: detail.title || subtask.title,
            status: detail.status ?? subtask.status,
            assignee: detail.assignee ?? subtask.assignee,
            assigneeAvatarUrl: detail.assigneeAvatarUrl ?? subtask.assigneeAvatarUrl,
          };
        }),
      },
    };
  });
}

export async function fetchJiraIssueComments(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<TaskComment[]> {
  const response = await jiraRequest<JiraCommentsResponse>(
    siteUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
  );

  return (response.comments ?? []).map(mapJiraComment).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function addJiraIssueComment(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
  body: string,
): Promise<TaskComment> {
  const trimmed = body.trim();

  if (!trimmed) {
    throw new Error('Comentário vazio');
  }

  const response = await jiraRequest<JiraComment>(
    siteUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
    {
      method: 'POST',
      body: {
        body: buildJiraCommentBody(trimmed),
      },
    },
  );

  return mapJiraComment(response);
}

export async function fetchJiraIssueChangelog(
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
): Promise<TaskHistoryEntry[]> {
  const response = await jiraRequest<JiraIssueDetailResponse>(
    siteUrl,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?expand=changelog&fields=summary`,
  );

  return mapJiraHistory(response.changelog?.histories);
}

export async function fetchJiraIssueDetail(
  projectPath: string,
  siteUrl: string,
  email: string,
  apiToken: string,
  issueKey: string,
  localTask?: ProjectTask,
): Promise<TaskDetailData> {
  const normalizedSite = normalizeJiraSiteUrl(siteUrl);
  const key = issueKey.trim();

  if (!normalizedSite || !email.trim() || !apiToken.trim() || !key) {
    throw new Error('Configuração do Jira incompleta');
  }

  const response = await jiraRequest<JiraIssueDetailResponse>(
    normalizedSite,
    email,
    apiToken,
    `/rest/api/3/issue/${encodeURIComponent(key)}?expand=changelog&fields=${[
      'summary',
      'description',
      'status',
      'attachment',
      'parent',
      'assignee',
      'reporter',
      'issuetype',
      'subtasks',
      'labels',
      'priority',
      'created',
      'updated',
      'resolutiondate',
      'duedate',
      'comment',
    ].join(',')}`,
  );

  const attachments = await downloadJiraAttachments(
    projectPath,
    key,
    normalizedSite,
    email,
    apiToken,
    response.fields?.attachment ?? [],
  );

  const remoteTask = mapJiraIssueToTask(response, attachments);
  const task: ProjectTask = localTask
    ? {
        ...localTask,
        title: remoteTask.title,
        description: remoteTask.description,
        status: remoteTask.status,
        attachments: attachments.length > 0 ? attachments : localTask.attachments,
        jira: {
          ...localTask.jira,
          ...remoteTask.jira,
          subtasks: mergeJiraSubtaskLists(remoteTask.jira?.subtasks, localTask.jira?.subtasks),
        },
        updatedAt: Date.now(),
      }
    : remoteTask;

  const comments = (response.fields?.comment?.comments ?? [])
    .map(mapJiraComment)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    task,
    reporter: response.fields?.reporter?.displayName,
    reporterAvatarUrl: pickJiraUserAvatarUrl(response.fields?.reporter),
    createdAt: response.fields?.created,
    updatedAt: response.fields?.updated,
    resolvedAt: response.fields?.resolutiondate,
    dueDate: response.fields?.duedate,
    comments,
    history: mapJiraHistory(response.changelog?.histories),
  };
}
