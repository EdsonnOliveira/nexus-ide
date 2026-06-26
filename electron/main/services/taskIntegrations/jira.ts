import https from 'node:https';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ProjectTask,
  TaskAttachment,
  TaskComment,
  TaskDetailData,
  TaskHistoryEntry,
  TaskIntegrationConfig,
} from '../../../types/task';
import type { TaskCredentialSecrets } from '../taskCredentialStore';
import { isImageAttachmentName } from '../../../types/task';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_REDIRECTS = 5;

interface JiraSearchResponse {
  issues?: JiraIssue[];
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
    issuetype?: { name?: string };
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
    issuetype?: { name?: string };
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

function mapJiraIssueToTask(issue: JiraIssueDetailResponse, attachments: TaskAttachment[]): ProjectTask {
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

function extractJiraDescription(description: unknown): string {
  if (typeof description === 'string') {
    return description;
  }

  if (!description || typeof description !== 'object') {
    return '';
  }

  const record = description as { content?: unknown[] };
  const parts: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    const entry = node as { type?: string; text?: string; content?: unknown[] };

    if (entry.type === 'text' && entry.text) {
      parts.push(entry.text);
    }

    if (Array.isArray(entry.content)) {
      entry.content.forEach(walk);
    }
  };

  if (Array.isArray(record.content)) {
    record.content.forEach(walk);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

async function downloadJiraAttachments(
  projectPath: string,
  taskId: string,
  siteUrl: string,
  email: string,
  apiToken: string,
  attachments: JiraAttachment[],
): Promise<TaskAttachment[]> {
  const targetDir = path.join(projectPath, '.nexus', 'tasks', taskId);
  await mkdir(targetDir, { recursive: true });

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
        labels: issue.fields?.labels ?? [],
        priority: issue.fields?.priority?.name,
      },
      updatedAt: Date.now(),
    });
  }

  return tasks;
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
