import https from 'node:https';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectTask, TaskAttachment, TaskIntegrationConfig } from '../../../types/task';
import type { TaskCredentialSecrets } from '../taskCredentialStore';
import { isImageAttachmentName } from '../../../types/task';
import { ensureNexusProjectDir } from '../nexusProjectGitignore';

const REQUEST_TIMEOUT_MS = 30_000;

interface TrelloBoard {
  id: string;
  name: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  dateLastActivity: string;
}

interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  mimeType?: string | null;
}

interface TrelloList {
  id: string;
  name: string;
}

function trelloRequest<T>(
  requestPath: string,
  method: 'GET' | 'PUT' | 'POST' = 'GET',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath);

    const request = https.request(
      url,
      {
        method,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let body = '';

        response.on('data', (chunk: Buffer | string) => {
          body += chunk.toString();
        });

        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Trello respondeu com status ${response.statusCode ?? 'desconhecido'}`));
            return;
          }

          if (!body.trim()) {
            resolve({} as T);
            return;
          }

          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Resposta inválida do Trello'));
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Tempo esgotado ao conectar com o Trello'));
    });

    request.on('error', reject);
    request.end();
  });
}

function isTrelloDoneListName(name: string): boolean {
  const normalized = name.trim().toLowerCase();

  return (
    normalized === 'done' ||
    normalized === 'concluído' ||
    normalized === 'concluido' ||
    normalized === 'concluída' ||
    normalized === 'concluida' ||
    normalized === 'complete' ||
    normalized === 'completed' ||
    normalized === 'fechado' ||
    normalized === 'finalizado'
  );
}

function isTrelloProgressListName(name: string): boolean {
  const normalized = name.trim().toLowerCase();

  return (
    normalized === 'in progress' ||
    normalized === 'em andamento' ||
    normalized === 'em progresso' ||
    normalized.includes('andamento') ||
    normalized.includes('progress') ||
    normalized === 'doing'
  );
}

function downloadBinary(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Falha ao baixar anexo do Trello (${response.statusCode ?? 'desconhecido'})`));
            return;
          }

          resolve(Buffer.concat(chunks));
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Tempo esgotado ao baixar anexo do Trello'));
    });

    request.on('error', reject);
    request.end();
  });
}

function buildTrelloUrl(
  requestPath: string,
  apiKey: string,
  token: string,
  extraParams: Record<string, string> = {},
): string {
  const url = new URL(`https://api.trello.com/1${requestPath}`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('token', token);

  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

async function downloadTrelloAttachments(
  projectPath: string,
  taskId: string,
  attachments: TrelloAttachment[],
): Promise<TaskAttachment[]> {
  const targetDir = await ensureNexusProjectDir(projectPath, 'tasks', taskId);

  const saved: TaskAttachment[] = [];

  for (const attachment of attachments) {
    const buffer = await downloadBinary(attachment.url);
    const safeName = attachment.name.replace(/[^\w.\-()+\s]/g, '_');
    const targetPath = path.join(targetDir, safeName);
    await writeFile(targetPath, buffer);

    saved.push({
      id: randomUUID(),
      name: attachment.name,
      kind: isImageAttachmentName(attachment.name) ? 'image' : 'file',
      path: targetPath,
      mimeType: attachment.mimeType ?? undefined,
    });
  }

  return saved;
}

export async function testTrelloConnection(apiKey: string, token: string): Promise<void> {
  await trelloRequest(buildTrelloUrl('/members/me', apiKey, token));
}

export async function listTrelloBoards(
  apiKey: string,
  token: string,
): Promise<Array<{ id: string; name: string }>> {
  const boards = await trelloRequest<TrelloBoard[]>(
    buildTrelloUrl('/members/me/boards', apiKey, token, { filter: 'open' }),
  );

  return boards.map((board) => ({ id: board.id, name: board.name }));
}

export async function listTrelloBoardLists(
  apiKey: string,
  token: string,
  boardId: string,
): Promise<Array<{ id: string; name: string; isDone: boolean; isProgress: boolean }>> {
  const lists = await trelloRequest<TrelloList[]>(
    buildTrelloUrl(`/boards/${boardId}/lists`, apiKey, token, { filter: 'open' }),
  );

  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    isDone: isTrelloDoneListName(list.name),
    isProgress: isTrelloProgressListName(list.name),
  }));
}

export async function moveTrelloCardToList(
  apiKey: string,
  token: string,
  cardId: string,
  listId: string,
): Promise<string> {
  await trelloRequest<TrelloCard>(
    buildTrelloUrl(`/cards/${cardId}`, apiKey, token, { idList: listId }),
    'PUT',
  );

  const list = await trelloRequest<TrelloList>(buildTrelloUrl(`/lists/${listId}`, apiKey, token));

  return list.name.trim() || listId;
}

export async function completeTrelloCard(
  apiKey: string,
  token: string,
  cardId: string,
  boardId: string,
): Promise<string> {
  const lists = await listTrelloBoardLists(apiKey, token, boardId);
  const doneList =
    lists.find((item) => item.isDone) ??
    lists.find((item) => /done|conclu|complete|fechad|finaliz/i.test(item.name));

  if (!doneList) {
    throw new Error('Nenhuma lista de conclusão encontrada neste board');
  }

  return moveTrelloCardToList(apiKey, token, cardId, doneList.id);
}

export async function startTrelloCard(
  apiKey: string,
  token: string,
  cardId: string,
  boardId: string,
): Promise<string> {
  const lists = await listTrelloBoardLists(apiKey, token, boardId);
  const progressList =
    lists.find((item) => item.isProgress) ??
    lists.find((item) => /andamento|progress|doing/i.test(item.name));

  if (!progressList) {
    throw new Error('Nenhuma lista de andamento encontrada neste board');
  }

  return moveTrelloCardToList(apiKey, token, cardId, progressList.id);
}

export async function syncTrelloTasks(
  projectPath: string,
  config: TaskIntegrationConfig,
  secrets: TaskCredentialSecrets,
): Promise<ProjectTask[]> {
  const apiKey = secrets.trelloApiKey?.trim() ?? '';
  const token = secrets.trelloToken?.trim() ?? '';
  const boardId = config.trelloBoardId?.trim() ?? '';

  if (!apiKey || !token || !boardId) {
    throw new Error('Configuração do Trello incompleta');
  }

  const [cards, lists] = await Promise.all([
    trelloRequest<TrelloCard[]>(
      buildTrelloUrl(`/boards/${boardId}/cards`, apiKey, token, {
        fields: 'name,desc,idList,dateLastActivity',
      }),
    ),
    trelloRequest<TrelloList[]>(buildTrelloUrl(`/boards/${boardId}/lists`, apiKey, token)),
  ]);

  const listNameById = new Map(lists.map((list) => [list.id, list.name]));
  const tasks: ProjectTask[] = [];

  for (const card of cards) {
    const cardAttachments = await trelloRequest<TrelloAttachment[]>(
      buildTrelloUrl(`/cards/${card.id}/attachments`, apiKey, token),
    ).catch(() => [] as TrelloAttachment[]);
    const downloaded = await downloadTrelloAttachments(projectPath, card.id, cardAttachments);

    tasks.push({
      id: card.id,
      source: 'trello',
      externalId: card.id,
      title: card.name.trim() || 'Sem título',
      description: card.desc.trim(),
      attachments: downloaded,
      status: listNameById.get(card.idList),
      updatedAt: Date.parse(card.dateLastActivity) || Date.now(),
    });
  }

  return tasks;
}
