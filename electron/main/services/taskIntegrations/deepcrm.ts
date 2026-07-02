import https from 'node:https';
import type {
  DeepcrmProjectMilestone,
  DeepcrmProjectSubtask,
  ProjectTask,
  ProjectTaskDeepcrmMeta,
  TaskDetailData,
  TaskDetailDeepcrmData,
  TaskHistoryEntry,
  TaskIntegrationConfig,
} from '../../../types/task';
import type { TaskCredentialSecrets } from '../taskCredentialStore';

const DEEPCRM_BASE_URL = 'https://app.deepcrm.app/api';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_SYNC_TASKS = 50;
const PROJECTS_PAGE_SIZE = 100;

interface DeepcrmRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string>;
}

interface DeepcrmStageInfo {
  id: string;
  name: string;
  position?: number;
}

interface DeepcrmTaskCounts {
  pending: number;
  total: number;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function readNestedString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = readString(source[key]);

    if (direct) {
      return direct;
    }
  }

  for (const key of keys) {
    const nested = source[key];

    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      const name = readString(record.name) ?? readString(record.title) ?? readString(record.label);

      if (name) {
        return name;
      }
    }
  }

  return undefined;
}

function readTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }

  const text = readString(value);

  if (!text) {
    return Date.now();
  }

  const parsed = Date.parse(text);

  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function parseDeepcrmError(body: string, statusCode: number): Error {
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const errorBlock = payload.error;

    if (errorBlock && typeof errorBlock === 'object') {
      const message = readString((errorBlock as Record<string, unknown>).message);

      if (message) {
        return new Error(message);
      }
    }

    const message = readString(payload.message);

    if (message) {
      return new Error(message);
    }
  } catch {
    return new Error(`DeepCRM respondeu com status ${statusCode}`);
  }

  return new Error(`DeepCRM respondeu com status ${statusCode}`);
}

function buildAuthHeaders(apiToken: string): Record<string, string> {
  return { Authorization: `Bearer ${apiToken}` };
}

function buildRequestUrl(requestPath: string, query: Record<string, string> = {}): URL {
  const url = new URL(`${DEEPCRM_BASE_URL}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`);

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function deepcrmRequestOnce<T>(
  apiToken: string,
  requestPath: string,
  options: DeepcrmRequestOptions = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = buildRequestUrl(requestPath, options.query ?? {});
    const headers = {
      Accept: 'application/json',
      ...buildAuthHeaders(apiToken),
    };

    const request = https.request(
      url,
      {
        method: options.method ?? 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        headers,
      },
      (response) => {
        let body = '';

        response.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });

        response.on('end', () => {
          const statusCode = response.statusCode ?? 500;

          if (statusCode >= 400) {
            reject(parseDeepcrmError(body, statusCode));
            return;
          }

          if (!body.trim()) {
            resolve({} as T);
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Resposta inválida do DeepCRM'));
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Tempo esgotado ao conectar com o DeepCRM'));
    });

    request.on('error', reject);
    request.end();
  });
}

async function deepcrmRequest<T>(
  apiToken: string,
  requestPath: string,
  options: DeepcrmRequestOptions = {},
): Promise<T> {
  const trimmedToken = apiToken.trim();

  if (!trimmedToken) {
    throw new Error('Informe o token da API do DeepCRM');
  }

  return deepcrmRequestOnce<T>(trimmedToken, requestPath, options);
}

function extractListPayload<T extends Record<string, unknown>>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is T => Boolean(entry) && typeof entry === 'object');
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const root = payload as Record<string, unknown>;

  if (root.success === false) {
    const errorBlock = root.error;

    if (errorBlock && typeof errorBlock === 'object') {
      const message = readString((errorBlock as Record<string, unknown>).message);

      if (message) {
        throw new Error(message);
      }
    }
  }

  const data = root.data;

  if (Array.isArray(data)) {
    return data.filter((entry): entry is T => Boolean(entry) && typeof entry === 'object');
  }

  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;

    for (const key of ['projects', 'tasks', 'items', 'results', 'pipelines', 'stages', 'data']) {
      const value = nested[key];

      if (Array.isArray(value)) {
        return value.filter((entry): entry is T => Boolean(entry) && typeof entry === 'object');
      }
    }
  }

  for (const key of ['projects', 'tasks', 'items', 'results', 'pipelines', 'stages']) {
    const value = root[key];

    if (Array.isArray(value)) {
      return value.filter((entry): entry is T => Boolean(entry) && typeof entry === 'object');
    }
  }

  return [];
}

function readStageFromPayload(value: unknown): DeepcrmStageInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const stageBlock =
    record.Stage && typeof record.Stage === 'object'
      ? (record.Stage as Record<string, unknown>)
      : record;
  const id = readString(stageBlock.id);
  const name = readString(stageBlock.name);
  const position =
    typeof stageBlock.position === 'number' && Number.isFinite(stageBlock.position)
      ? stageBlock.position
      : undefined;

  if (!id && !name) {
    return null;
  }

  return {
    id: id ?? name ?? '',
    name: name ?? id ?? '',
    position,
  };
}

function formatHealthLabel(healthScore?: string, healthScoreNumeric?: number): string | undefined {
  const normalized = healthScore?.trim().toLowerCase();

  if (normalized) {
    if (/healthy|saud|green|good|ok/.test(normalized)) {
      return 'Saudável';
    }

    if (/attention|atenc|warning|yellow|medium/.test(normalized)) {
      return 'Atenção';
    }

    if (/risk|at_risk|danger|red|critical|churn/.test(normalized)) {
      return 'Em risco';
    }

    return healthScore;
  }

  if (typeof healthScoreNumeric === 'number' && Number.isFinite(healthScoreNumeric)) {
    if (healthScoreNumeric >= 70) {
      return 'Saudável';
    }

    if (healthScoreNumeric >= 40) {
      return 'Atenção';
    }

    return 'Em risco';
  }

  return undefined;
}

function formatMrrLabel(mrr?: number): string | undefined {
  if (typeof mrr !== 'number' || !Number.isFinite(mrr)) {
    return undefined;
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(mrr);
}

function formatProjectStatusLabel(status?: string): string | undefined {
  const normalized = status?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === 'active') {
    return 'Ativo';
  }

  if (normalized === 'churned') {
    return 'Encerrado';
  }

  if (normalized === 'paused') {
    return 'Pausado';
  }

  return status;
}

function readProjectId(raw: Record<string, unknown>): string | undefined {
  return readString(raw.id) ?? readString(raw.uuid) ?? readString(raw._id);
}

function readPipelineId(raw: Record<string, unknown>): string | undefined {
  return readString(raw.pipeline_id) ?? readString(raw.pipelineId);
}

function readStageId(raw: Record<string, unknown>): string | undefined {
  return readString(raw.stage_id) ?? readString(raw.stageId);
}

function isTaskPending(status: unknown): boolean {
  const normalized = readString(status)?.toLowerCase();

  if (!normalized) {
    return true;
  }

  return !/complete|conclu|done|closed|finished|cancel/.test(normalized);
}

function countRecentTasks(recentTasks: unknown): DeepcrmTaskCounts {
  if (!Array.isArray(recentTasks)) {
    return { pending: 0, total: 0 };
  }

  const tasks = recentTasks.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
  );
  const pending = tasks.filter((task) => isTaskPending(task.status)).length;

  return {
    pending,
    total: tasks.length,
  };
}

function buildTaskProgressLabel(counts: DeepcrmTaskCounts): string {
  return `${counts.pending}/${counts.total} tarefas`;
}

async function fetchAllProjects(
  apiToken: string,
  pipelineId?: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const query: Record<string, string> = {
      limit: String(PROJECTS_PAGE_SIZE),
      offset: String(offset),
    };

    if (pipelineId) {
      query.pipeline_id = pipelineId;
    }

    const payload = await deepcrmRequest<unknown>(apiToken, '/projects', { query });
    const batch = extractListPayload<Record<string, unknown>>(payload);

    if (!batch.length) {
      break;
    }

    all.push(...batch);

    if (batch.length < PROJECTS_PAGE_SIZE) {
      break;
    }

    offset += batch.length;
  }

  return all;
}

async function fetchPipelineName(apiToken: string, pipelineId: string): Promise<string | undefined> {
  try {
    const payload = await deepcrmRequest<Record<string, unknown>>(apiToken, `/pipelines/${pipelineId}`);
    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : payload;
    const pipelineBlock =
      data.Pipeline && typeof data.Pipeline === 'object'
        ? (data.Pipeline as Record<string, unknown>)
        : data;

    return readString(pipelineBlock.name) ?? readString(pipelineBlock.title);
  } catch {
    return undefined;
  }
}

async function fetchPipelineStages(
  apiToken: string,
  pipelineId: string,
): Promise<Map<string, string>> {
  const stageMap = new Map<string, string>();

  try {
    const payload = await deepcrmRequest<unknown>(apiToken, `/pipelines/${pipelineId}/stages`);
    const stages = extractListPayload<Record<string, unknown>>(payload);

    for (const entry of stages) {
      const stage = readStageFromPayload(entry);

      if (stage?.id && stage.name) {
        stageMap.set(stage.id, stage.name);
      }
    }
  } catch {
    return stageMap;
  }

  return stageMap;
}

async function buildStageNameMap(
  apiToken: string,
  pipelineIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  const uniqueIds = [...new Set(pipelineIds.filter(Boolean))];

  await Promise.all(
    uniqueIds.map(async (pipelineId) => {
      const stages = await fetchPipelineStages(apiToken, pipelineId);
      result.set(pipelineId, stages);
    }),
  );

  return result;
}

async function resolveKanbanName(
  apiToken: string,
  pipelineId: string,
  projectCount: number,
): Promise<string> {
  const pipelineName = await fetchPipelineName(apiToken, pipelineId);

  if (pipelineName) {
    return `${pipelineName} (${projectCount} projetos)`;
  }

  const stages = await fetchPipelineStages(apiToken, pipelineId);
  const stageNames = [...stages.values()].filter(Boolean);

  if (stageNames.length) {
    const summary =
      stageNames.length <= 3 ? stageNames.join(', ') : `${stageNames.slice(0, 3).join(', ')}…`;

    return `${summary} (${projectCount} projetos)`;
  }

  return `Kanban ${pipelineId} (${projectCount} projetos)`;
}

async function fetchProjectDetail(
  apiToken: string,
  projectId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const payload = await deepcrmRequest<Record<string, unknown>>(apiToken, `/projects/${projectId}`);
    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : payload;
    const projectBlock =
      data.Project && typeof data.Project === 'object'
        ? (data.Project as Record<string, unknown>)
        : data;

    return projectBlock;
  } catch {
    return null;
  }
}

function resolveProjectDescription(
  raw: Record<string, unknown>,
  detail: Record<string, unknown> | null,
): string {
  const companyName =
    readString(raw.company_name) ??
    readString(raw.companyName) ??
    readNestedString(raw, ['company']);

  if (companyName) {
    return companyName;
  }

  const recentTasks = detail?.recent_tasks ?? raw.recent_tasks;

  if (Array.isArray(recentTasks)) {
    const pendingTask = recentTasks.find((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      return isTaskPending((entry as Record<string, unknown>).status);
    });

    if (pendingTask && typeof pendingTask === 'object') {
      const taskText = readString((pendingTask as Record<string, unknown>).task);

      if (taskText) {
        return taskText;
      }
    }
  }

  return '';
}

function mapDeepcrmProjectMeta(
  raw: Record<string, unknown>,
  stageName?: string,
  taskCounts?: DeepcrmTaskCounts,
): ProjectTaskDeepcrmMeta {
  const healthScore = readString(raw.health_score) ?? readString(raw.healthScore);
  const healthScoreNumeric =
    typeof raw.health_score_numeric === 'number'
      ? raw.health_score_numeric
      : typeof raw.healthScoreNumeric === 'number'
        ? raw.healthScoreNumeric
        : undefined;
  const mrr = typeof raw.mrr === 'number' && Number.isFinite(raw.mrr) ? raw.mrr : undefined;
  const stageId = readStageId(raw);
  const projectStatus = readString(raw.status);
  const pipelineId = readPipelineId(raw);

  const labels: string[] = [];
  const healthLabel = formatHealthLabel(healthScore, healthScoreNumeric);

  if (healthLabel) {
    labels.push(healthLabel);
  }

  const mrrLabel = formatMrrLabel(mrr);

  if (mrrLabel) {
    labels.push(mrrLabel);
  }

  if (taskCounts) {
    labels.push(buildTaskProgressLabel(taskCounts));
  }

  return {
    assignee: readString(raw.user_name) ?? readNestedString(raw, ['user', 'owner', 'user_name']),
    healthScore,
    healthScoreNumeric,
    mrr,
    stageId,
    stageName,
    projectStatus,
    pendingTaskCount: taskCounts?.pending,
    totalTaskCount: taskCounts?.total,
    pipelineId,
    labels,
  };
}

function mapDeepcrmProject(
  raw: Record<string, unknown>,
  stageNameMap: Map<string, Map<string, string>>,
  detail: Record<string, unknown> | null,
  taskCounts: DeepcrmTaskCounts,
): ProjectTask | null {
  const projectId = readProjectId(raw);

  if (!projectId) {
    return null;
  }

  const title = readString(raw.name) ?? readString(raw.title) ?? 'Sem título';
  const pipelineId = readPipelineId(raw);
  const stageId = readStageId(raw);
  const stageName =
    (pipelineId && stageId ? stageNameMap.get(pipelineId)?.get(stageId) : undefined) ??
    readNestedString(raw, ['stage']);
  const projectStatus = readString(raw.status);
  const status = stageName ?? formatProjectStatusLabel(projectStatus);
  const description = resolveProjectDescription(raw, detail);
  const deepcrm = mapDeepcrmProjectMeta(raw, stageName, taskCounts);
  const mergedRaw = detail ? { ...raw, ...detail } : raw;

  return {
    id: projectId,
    source: 'deepcrm',
    externalId: `DC-P-${projectId}`,
    title,
    description,
    attachments: [],
    status,
    deepcrm,
    updatedAt: readTimestamp(
      mergedRaw.modified ??
        mergedRaw.updated_at ??
        mergedRaw.updatedAt ??
        mergedRaw.date_updated ??
        mergedRaw.modified_at,
    ),
  };
}

export async function testDeepcrmConnection(apiToken: string): Promise<void> {
  await deepcrmRequest(apiToken, '/projects', { query: { limit: '1' } });
}

export async function getDeepcrmAccountName(apiToken: string): Promise<string | undefined> {
  for (const requestPath of ['/users/me', '/auth/me']) {
    try {
      const payload = await deepcrmRequest<Record<string, unknown>>(apiToken, requestPath);
      const data =
        payload.data && typeof payload.data === 'object'
          ? (payload.data as Record<string, unknown>)
          : payload;
      const userBlock = data.User && typeof data.User === 'object' ? (data.User as Record<string, unknown>) : data;
      const name =
        readString(userBlock.username) ??
        readString(userBlock.name) ??
        readString(userBlock.full_name) ??
        readString(userBlock.email);

      if (name) {
        return name;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function listDeepcrmPipelines(
  apiToken: string,
): Promise<Array<{ id: string; name: string }>> {
  const projects = await fetchAllProjects(apiToken);
  const grouped = new Map<string, number>();

  for (const project of projects) {
    const pipelineId = readPipelineId(project);

    if (!pipelineId) {
      continue;
    }

    grouped.set(pipelineId, (grouped.get(pipelineId) ?? 0) + 1);
  }

  const entries = await Promise.all(
    [...grouped.entries()].map(async ([pipelineId, count]) => {
      const name = await resolveKanbanName(apiToken, pipelineId, count);
      return { id: pipelineId, name };
    }),
  );

  return entries.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

export async function syncDeepcrmTasks(
  _projectPath: string,
  config: TaskIntegrationConfig,
  secrets: TaskCredentialSecrets,
): Promise<ProjectTask[]> {
  const apiToken = secrets.deepcrmApiToken?.trim() ?? '';
  const pipelineId = config.deepcrmPipelineId?.trim() ?? '';

  if (!apiToken) {
    throw new Error('Informe o token da API do DeepCRM');
  }

  const rawProjects = await fetchAllProjects(apiToken, pipelineId || undefined);
  const projectsToSync = rawProjects.slice(0, MAX_SYNC_TASKS);
  const pipelineIds = projectsToSync
    .map((project) => readPipelineId(project))
    .filter((id): id is string => Boolean(id));
  const stageNameMap = await buildStageNameMap(apiToken, pipelineIds);

  const details = await Promise.all(
    projectsToSync.map(async (project) => {
      const projectId = readProjectId(project);

      if (!projectId) {
        return null;
      }

      return fetchProjectDetail(apiToken, projectId);
    }),
  );

  const tasks = projectsToSync
    .map((raw, index) => {
      const detail = details[index];
      const recentTasks = detail?.recent_tasks ?? raw.recent_tasks;
      const taskCounts = countRecentTasks(recentTasks);

      return mapDeepcrmProject(raw, stageNameMap, detail, taskCounts);
    })
    .filter((task): task is ProjectTask => Boolean(task));

  return tasks.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_SYNC_TASKS);
}

function parseDeepcrmProjectId(externalId: string): string | null {
  const match = externalId.trim().match(/^DC-P-(\d+)$/i);

  return match ? match[1] : null;
}

function mapDeepcrmTaskStatus(status?: string): string {
  const normalized = status?.trim().toLowerCase();

  if (normalized === 'todo') {
    return 'A fazer';
  }

  if (normalized === 'doing') {
    return 'Fazendo';
  }

  if (normalized === 'done') {
    return 'Concluído';
  }

  return status ?? 'A fazer';
}

function readTaskProjectId(raw: Record<string, unknown>): string | undefined {
  return readString(raw.project_id) ?? readString(raw.projectId);
}

function mapDeepcrmSubtask(raw: Record<string, unknown>): DeepcrmProjectSubtask | null {
  const id = readString(raw.id);

  if (!id) {
    return null;
  }

  const title = readString(raw.task) ?? readString(raw.title);

  if (!title) {
    return null;
  }

  return {
    id,
    title,
    status: mapDeepcrmTaskStatus(readString(raw.task_status) ?? readString(raw.status)),
    dueDate: readString(raw.date) ?? readString(raw.due_date) ?? readString(raw.dueDate),
    description: readString(raw.description),
    createdAt: readString(raw.created) ?? readString(raw.created_at),
  };
}

function mapDeepcrmMilestone(raw: Record<string, unknown>): DeepcrmProjectMilestone | null {
  const id = readString(raw.id);
  const title = readString(raw.title) ?? readString(raw.name);

  if (!id && !title) {
    return null;
  }

  return {
    id: id ?? title ?? '',
    title: title ?? id ?? '',
    dueDate: readString(raw.due_date) ?? readString(raw.dueDate) ?? readString(raw.date),
    status: readString(raw.status),
  };
}

function readInstallmentsSummary(
  raw: unknown,
): { paidCount: number; pendingCount: number } | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const paidCount =
    typeof record.paid_count === 'number'
      ? record.paid_count
      : typeof record.paidCount === 'number'
        ? record.paidCount
        : typeof record.paid === 'number'
          ? record.paid
          : undefined;
  const pendingCount =
    typeof record.pending_count === 'number'
      ? record.pending_count
      : typeof record.pendingCount === 'number'
        ? record.pendingCount
        : typeof record.pending === 'number'
          ? record.pending
          : undefined;

  if (paidCount === undefined && pendingCount === undefined) {
    return undefined;
  }

  return {
    paidCount: paidCount ?? 0,
    pendingCount: pendingCount ?? 0,
  };
}

async function fetchTaskDetail(
  apiToken: string,
  taskId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const payload = await deepcrmRequest<Record<string, unknown>>(apiToken, `/tasks/${taskId}`);
    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : payload;
    const taskBlock =
      data.Task && typeof data.Task === 'object'
        ? (data.Task as Record<string, unknown>)
        : data;

    return taskBlock;
  } catch {
    return null;
  }
}

async function fetchTasksList(apiToken: string): Promise<Record<string, unknown>[]> {
  const payload = await deepcrmRequest<unknown>(apiToken, '/tasks', { query: { limit: '200' } });

  return extractListPayload<Record<string, unknown>>(payload);
}

function buildDeepcrmProjectTimeline(
  projectDetail: Record<string, unknown>,
  subtasks: DeepcrmProjectSubtask[],
  userName?: string,
): TaskHistoryEntry[] {
  const entries: TaskHistoryEntry[] = [];
  const authorName = userName ?? 'DeepCRM';
  const projectId = readProjectId(projectDetail);
  const createdAt = readString(projectDetail.created);

  if (createdAt) {
    entries.push({
      id: `project-created-${projectId ?? 'unknown'}`,
      authorName,
      createdAt,
      field: 'Projeto',
      action: 'criou o projeto',
    });
  }

  for (const subtask of subtasks) {
    if (!subtask.createdAt) {
      continue;
    }

    entries.push({
      id: `task-created-${subtask.id}`,
      authorName,
      createdAt: subtask.createdAt,
      field: 'Tarefa',
      action: 'adicionou a tarefa',
      to: subtask.title,
    });
  }

  const modifiedAt = readString(projectDetail.modified);

  if (modifiedAt && modifiedAt !== createdAt) {
    entries.push({
      id: `project-updated-${projectId ?? 'unknown'}`,
      authorName,
      createdAt: modifiedAt,
      field: 'Projeto',
      action: 'atualizou o projeto',
    });
  }

  return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function fetchDeepcrmProjectDetail(
  apiToken: string,
  externalId: string,
  localTask?: ProjectTask,
): Promise<TaskDetailData> {
  const projectId = parseDeepcrmProjectId(externalId);
  const trimmedToken = apiToken.trim();

  if (!projectId) {
    throw new Error('ID de projeto DeepCRM inválido');
  }

  if (!trimmedToken) {
    throw new Error('Informe o token da API do DeepCRM');
  }

  const projectDetail = await fetchProjectDetail(trimmedToken, projectId);

  if (!projectDetail) {
    throw new Error('Projeto não encontrado no DeepCRM');
  }

  const pipelineId = readPipelineId(projectDetail);
  const stageId = readStageId(projectDetail);
  let stageName: string | undefined;

  if (pipelineId && stageId) {
    const stageMap = await fetchPipelineStages(trimmedToken, pipelineId);
    stageName = stageMap.get(stageId);
  }

  const subtaskMap = new Map<string, DeepcrmProjectSubtask>();
  const recentTasksRaw = projectDetail.recent_tasks;

  if (Array.isArray(recentTasksRaw)) {
    for (const entry of recentTasksRaw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const mapped = mapDeepcrmSubtask(entry as Record<string, unknown>);

      if (mapped) {
        subtaskMap.set(mapped.id, mapped);
      }
    }
  }

  const tasksList = await fetchTasksList(trimmedToken);
  const taskIds = tasksList
    .map((item) => readString(item.id))
    .filter((id): id is string => Boolean(id));
  const taskDetails = await Promise.all(taskIds.map((id) => fetchTaskDetail(trimmedToken, id)));

  for (const taskDetail of taskDetails) {
    if (!taskDetail) {
      continue;
    }

    const taskProjectId = readTaskProjectId(taskDetail);

    if (taskProjectId !== projectId) {
      continue;
    }

    const id = readString(taskDetail.id);

    if (!id || subtaskMap.has(id)) {
      continue;
    }

    const mapped = mapDeepcrmSubtask(taskDetail);

    if (mapped) {
      subtaskMap.set(id, mapped);
    }
  }

  const subtasks = [...subtaskMap.values()].sort((left, right) => {
    const leftDate = left.dueDate ?? left.createdAt ?? '';
    const rightDate = right.dueDate ?? right.createdAt ?? '';

    return leftDate.localeCompare(rightDate);
  });

  const milestones: DeepcrmProjectMilestone[] = [];
  const milestonesRaw = projectDetail.milestones;

  if (Array.isArray(milestonesRaw)) {
    for (const entry of milestonesRaw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const mapped = mapDeepcrmMilestone(entry as Record<string, unknown>);

      if (mapped) {
        milestones.push(mapped);
      }
    }
  }

  const userName = readString(projectDetail.user_name);
  const deepcrmDetail: TaskDetailDeepcrmData = {
    subtasks,
    milestones,
    paymentModel: readString(projectDetail.payment_model),
    renewalDate: readString(projectDetail.renewal_date),
    startDate: readString(projectDetail.start_date),
    companyName: readString(projectDetail.company_name),
    contactName: readString(projectDetail.contact_name),
    contactEmail: readString(projectDetail.contact_email),
    installmentsSummary: readInstallmentsSummary(projectDetail.installments_summary),
  };

  const completedCount = subtasks.filter((subtask) => subtask.status === 'Concluído').length;
  const taskCounts: DeepcrmTaskCounts = {
    pending: subtasks.length - completedCount,
    total: subtasks.length,
  };
  const deepcrmMeta = mapDeepcrmProjectMeta(projectDetail, stageName, taskCounts);
  const title = readString(projectDetail.name) ?? localTask?.title ?? 'Sem título';
  const description = resolveProjectDescription(projectDetail, projectDetail);
  const projectStatus = readString(projectDetail.status);
  const status = stageName ?? formatProjectStatusLabel(projectStatus);
  const updatedAt = readTimestamp(
    projectDetail.modified ??
      projectDetail.updated_at ??
      projectDetail.updatedAt ??
      projectDetail.modified_at,
  );

  const task: ProjectTask = localTask
    ? {
        ...localTask,
        title,
        description,
        status,
        deepcrm: {
          ...localTask.deepcrm,
          ...deepcrmMeta,
        },
        updatedAt,
      }
    : {
        id: projectId,
        source: 'deepcrm',
        externalId: `DC-P-${projectId}`,
        title,
        description,
        attachments: [],
        status,
        deepcrm: deepcrmMeta,
        updatedAt,
      };

  return {
    task,
    createdAt: readString(projectDetail.created),
    updatedAt: readString(projectDetail.modified),
    comments: [],
    history: buildDeepcrmProjectTimeline(projectDetail, subtasks, userName),
    deepcrm: deepcrmDetail,
  };
}
