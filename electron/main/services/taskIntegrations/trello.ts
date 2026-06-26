import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectTask, TaskAttachment, TaskIntegrationConfig } from '../../../types/task';
import type { TaskCredentialSecrets } from '../taskCredentialStore';
import { isImageAttachmentName } from '../../../types/task';

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

function trelloRequest<T>(requestPath: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath);

    const request = https.request(
      url,
      {
        method: 'GET',
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
  const targetDir = path.join(projectPath, '.nexus', 'tasks', taskId);
  await mkdir(targetDir, { recursive: true });

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
