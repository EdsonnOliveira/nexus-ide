import { ipcMain, shell } from 'electron';
import { projectStore } from '../services/projectStore';
import { taskCredentialStore } from '../services/taskCredentialStore';
import { saveTaskAttachment, saveTaskAttachmentFromDataUrl, readTaskAttachment } from '../services/taskAttachments';
import {
  addJiraIssueComment,
  completeJiraIssue,
  fetchJiraIssueDetail,
  getJiraAccountName,
  listJiraIssueTransitions,
  listJiraProjects,
  startJiraIssue,
  syncJiraTasks,
  testJiraConnection,
  transitionJiraIssue,
} from '../services/taskIntegrations/jira';
import {
  completeTrelloCard,
  listTrelloBoardLists,
  listTrelloBoards,
  moveTrelloCardToList,
  startTrelloCard,
  syncTrelloTasks,
  testTrelloConnection,
} from '../services/taskIntegrations/trello';
import {
  completeDeepcrmProject,
  fetchDeepcrmProjectDetail,
  getDeepcrmAccountName,
  listDeepcrmPipelineStages,
  listDeepcrmPipelines,
  startDeepcrmProject,
  syncDeepcrmTasks,
  testDeepcrmConnection,
  updateDeepcrmProjectStage,
} from '../services/taskIntegrations/deepcrm';
import type {
  TaskBoardColumnOption,
  TaskCredentialsPayload,
  TaskDetailData,
  TaskIntegrationConfig,
  TaskMoveResult,
  TaskSyncResult,
} from '../../types/task';

function getProjectOrThrow(projectId: string) {
  const project = projectStore.list().projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error('Projeto não encontrado');
  }

  return project;
}

function assertDeepcrmApiToken(projectId: string): void {
  const status = taskCredentialStore.getCredentialStatus(projectId);

  if (status.deepcrmApiToken === 'unreadable') {
    throw new Error(
      'Token da API do DeepCRM ilegível. Abra Integração de tarefas e salve o token novamente.',
    );
  }

  if (status.deepcrmApiToken !== 'readable') {
    throw new Error('Informe o token da API do DeepCRM');
  }
}

function assertJiraApiToken(projectId: string): void {
  const status = taskCredentialStore.getCredentialStatus(projectId);

  if (status.jiraApiToken === 'unreadable') {
    throw new Error(
      'API token do Jira ilegível. Abra Integração de tarefas e salve o token novamente.',
    );
  }

  if (status.jiraApiToken !== 'readable') {
    throw new Error('Informe o API token do Jira');
  }
}

export function registerTaskHandlers(): void {
  ipcMain.handle(
    'tasks:saveCredentials',
    (_event, projectId: string, credentials: TaskCredentialsPayload) => {
      taskCredentialStore.saveSecrets(projectId, credentials);
    },
  );

  ipcMain.handle('tasks:getCredentialStatus', (_event, projectId: string) => {
    return taskCredentialStore.getCredentialStatus(projectId);
  });

  ipcMain.handle('tasks:getCredentials', (_event, projectId: string): TaskCredentialsPayload => {
    return taskCredentialStore.getSecrets(projectId);
  });

  ipcMain.handle('tasks:clearCredentials', (_event, projectId: string) => {
    taskCredentialStore.clearSecrets(projectId);
  });

  ipcMain.handle('tasks:openExternalUrl', async (_event, url: string) => {
    const trimmed = url.trim();

    if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
      throw new Error('URL inválida');
    }

    await shell.openExternal(trimmed);
  });

  ipcMain.handle(
    'tasks:testConnection',
    async (_event, projectId: string, config: TaskIntegrationConfig, credentials: TaskCredentialsPayload) => {
      taskCredentialStore.saveSecrets(projectId, credentials);
      const secrets = taskCredentialStore.getSecrets(projectId);

      if (config.platform === 'jira') {
        assertJiraApiToken(projectId);
        const email = config.jiraEmail?.trim() ?? '';
        const apiToken = secrets.jiraApiToken?.trim() ?? '';

        if (!email) {
          throw new Error('Informe o e-mail da conta Atlassian');
        }

        if (!apiToken) {
          throw new Error('Informe o API token do Jira');
        }

        await testJiraConnection(config.jiraSiteUrl ?? '', email, apiToken);
        return;
      }

      if (config.platform === 'deepcrm') {
        assertDeepcrmApiToken(projectId);
        const deepcrmApiToken = secrets.deepcrmApiToken?.trim() ?? '';

        if (!deepcrmApiToken) {
          throw new Error('Informe o token da API do DeepCRM');
        }

        await testDeepcrmConnection(deepcrmApiToken);
        return;
      }

      const trelloApiKey = secrets.trelloApiKey?.trim() ?? '';
      const trelloToken = secrets.trelloToken?.trim() ?? '';

      if (!trelloApiKey || !trelloToken) {
        throw new Error('Informe a API Key e o Token do Trello');
      }

      await testTrelloConnection(trelloApiKey, trelloToken);
    },
  );

  ipcMain.handle('tasks:listJiraProjects', async (_event, projectId: string, config: TaskIntegrationConfig) => {
    const secrets = taskCredentialStore.getSecrets(projectId);
    const apiToken = secrets.jiraApiToken ?? '';

    return listJiraProjects(config.jiraSiteUrl ?? '', config.jiraEmail ?? '', apiToken);
  });

  ipcMain.handle('tasks:listTrelloBoards', async (_event, projectId: string) => {
    const secrets = taskCredentialStore.getSecrets(projectId);

    return listTrelloBoards(secrets.trelloApiKey ?? '', secrets.trelloToken ?? '');
  });

  ipcMain.handle('tasks:listDeepcrmPipelines', async (_event, projectId: string) => {
    const secrets = taskCredentialStore.getSecrets(projectId);
    const apiToken = secrets.deepcrmApiToken ?? '';

    return listDeepcrmPipelines(apiToken);
  });

  ipcMain.handle('tasks:sync', async (_event, projectId: string): Promise<TaskSyncResult> => {
    const project = getProjectOrThrow(projectId);
    const config = project.taskIntegration;

    if (!config?.syncEnabled || !config.platform) {
      return { tasks: [] };
    }

    const secrets = taskCredentialStore.getSecrets(projectId);

    if (config.platform === 'jira') {
      const siteUrl = config.jiraSiteUrl ?? '';
      const email = config.jiraEmail ?? '';
      const apiToken = secrets.jiraApiToken ?? '';
      const jiraAccountName = await getJiraAccountName(siteUrl, email, apiToken);
      const tasks = await syncJiraTasks(project.path, config, secrets);

      return {
        tasks,
        jiraAccountName,
      };
    }

    if (config.platform === 'deepcrm') {
      assertDeepcrmApiToken(projectId);
      const apiToken = secrets.deepcrmApiToken ?? '';
      const deepcrmAccountName = await getDeepcrmAccountName(apiToken);
      const tasks = await syncDeepcrmTasks(project.path, config, secrets);

      return {
        tasks,
        deepcrmAccountName,
      };
    }

    return {
      tasks: await syncTrelloTasks(project.path, config, secrets),
    };
  });

  ipcMain.handle(
    'tasks:saveAttachment',
    async (_event, projectId: string, taskId: string, sourcePath: string) => {
      const project = getProjectOrThrow(projectId);
      return saveTaskAttachment(project.path, taskId, sourcePath);
    },
  );

  ipcMain.handle(
    'tasks:saveAttachmentFromDataUrl',
    async (_event, projectId: string, taskId: string, dataUrl: string) => {
      const project = getProjectOrThrow(projectId);
      return saveTaskAttachmentFromDataUrl(project.path, taskId, dataUrl);
    },
  );

  ipcMain.handle('tasks:readAttachment', async (_event, filePath: string) => {
    const buffer = await readTaskAttachment(filePath);
    return buffer.toString('base64');
  });

  ipcMain.handle(
    'tasks:getDetail',
    async (_event, projectId: string, externalId: string): Promise<TaskDetailData> => {
      const project = getProjectOrThrow(projectId);
      const config = project.taskIntegration;
      const secrets = taskCredentialStore.getSecrets(projectId);
      const key = externalId.trim();
      const localTask = project.tasks?.find((item) => item.externalId === key);

      if (config?.platform === 'jira' && key) {
        const siteUrl = config.jiraSiteUrl ?? '';
        const email = config.jiraEmail ?? '';
        const apiToken = secrets.jiraApiToken ?? '';

        return fetchJiraIssueDetail(project.path, siteUrl, email, apiToken, key, localTask);
      }

      if (config?.platform === 'deepcrm' && key.startsWith('DC-P-')) {
        const apiToken = secrets.deepcrmApiToken ?? '';

        return fetchDeepcrmProjectDetail(apiToken, key, localTask);
      }

      throw new Error('Detalhe disponível apenas para tarefas do Jira ou projetos DeepCRM');
    },
  );

  ipcMain.handle(
    'tasks:addComment',
    async (_event, projectId: string, externalId: string, body: string) => {
      const project = getProjectOrThrow(projectId);
      const config = project.taskIntegration;
      const secrets = taskCredentialStore.getSecrets(projectId);
      const key = externalId.trim();

      if (config?.platform !== 'jira' || !key) {
        throw new Error('Comentários disponíveis apenas para tarefas do Jira');
      }

      return addJiraIssueComment(
        config.jiraSiteUrl ?? '',
        config.jiraEmail ?? '',
        secrets.jiraApiToken ?? '',
        key,
        body,
      );
    },
  );

  ipcMain.handle(
    'tasks:listBoardColumns',
    async (_event, projectId: string, externalId: string): Promise<TaskBoardColumnOption[]> => {
      const project = getProjectOrThrow(projectId);
      const config = project.taskIntegration;
      const secrets = taskCredentialStore.getSecrets(projectId);
      const key = externalId.trim();

      if (!config?.platform || !key) {
        throw new Error('Integração de tarefas não configurada');
      }

      if (config.platform === 'jira') {
        return listJiraIssueTransitions(
          config.jiraSiteUrl ?? '',
          config.jiraEmail ?? '',
          secrets.jiraApiToken ?? '',
          key,
        );
      }

      if (config.platform === 'trello') {
        const boardId = config.trelloBoardId?.trim() ?? '';

        if (!boardId) {
          throw new Error('Board do Trello não configurado');
        }

        return listTrelloBoardLists(
          secrets.trelloApiKey ?? '',
          secrets.trelloToken ?? '',
          boardId,
        );
      }

      if (config.platform === 'deepcrm') {
        const localTask = project.tasks?.find((item) => item.externalId === key);
        const pipelineId =
          localTask?.deepcrm?.pipelineId?.trim() || config.deepcrmPipelineId?.trim() || '';

        if (!pipelineId) {
          throw new Error('Kanban do DeepCRM não configurado');
        }

        return listDeepcrmPipelineStages(secrets.deepcrmApiToken ?? '', pipelineId);
      }

      throw new Error('Plataforma de tarefas não suportada');
    },
  );

  ipcMain.handle(
    'tasks:moveBoardColumn',
    async (
      _event,
      projectId: string,
      externalId: string,
      columnId: string,
    ): Promise<TaskMoveResult> => {
      const project = getProjectOrThrow(projectId);
      const config = project.taskIntegration;
      const secrets = taskCredentialStore.getSecrets(projectId);
      const key = externalId.trim();
      const targetColumnId = columnId.trim();

      if (!config?.platform || !key || !targetColumnId) {
        throw new Error('Não foi possível mover a tarefa');
      }

      if (config.platform === 'jira') {
        const status = await transitionJiraIssue(
          config.jiraSiteUrl ?? '',
          config.jiraEmail ?? '',
          secrets.jiraApiToken ?? '',
          key,
          targetColumnId,
        );

        return { status };
      }

      if (config.platform === 'trello') {
        const status = await moveTrelloCardToList(
          secrets.trelloApiKey ?? '',
          secrets.trelloToken ?? '',
          key,
          targetColumnId,
        );

        return { status };
      }

      if (config.platform === 'deepcrm') {
        const result = await updateDeepcrmProjectStage(
          secrets.deepcrmApiToken ?? '',
          key,
          targetColumnId,
        );

        return {
          status: result.status,
          stageId: result.stageId,
          stageName: result.stageName,
        };
      }

      throw new Error('Plataforma de tarefas não suportada');
    },
  );

  ipcMain.handle(
    'tasks:completeExternal',
    async (_event, projectId: string, externalId: string): Promise<TaskMoveResult> => {
      const project = getProjectOrThrow(projectId);
      const config = project.taskIntegration;
      const secrets = taskCredentialStore.getSecrets(projectId);
      const key = externalId.trim();

      if (!config?.platform || !key) {
        throw new Error('Não foi possível concluir a tarefa');
      }

      if (config.platform === 'jira') {
        const status = await completeJiraIssue(
          config.jiraSiteUrl ?? '',
          config.jiraEmail ?? '',
          secrets.jiraApiToken ?? '',
          key,
        );

        return { status };
      }

      if (config.platform === 'trello') {
        const boardId = config.trelloBoardId?.trim() ?? '';

        if (!boardId) {
          throw new Error('Board do Trello não configurado');
        }

        const status = await completeTrelloCard(
          secrets.trelloApiKey ?? '',
          secrets.trelloToken ?? '',
          key,
          boardId,
        );

        return { status };
      }

      if (config.platform === 'deepcrm') {
        const result = await completeDeepcrmProject(secrets.deepcrmApiToken ?? '', key);

        return {
          status: result.status,
          stageId: result.stageId,
          stageName: result.stageName,
        };
      }

      throw new Error('Plataforma de tarefas não suportada');
    },
  );

  ipcMain.handle(
    'tasks:startExternal',
    async (_event, projectId: string, externalId: string): Promise<TaskMoveResult> => {
      const project = getProjectOrThrow(projectId);
      const config = project.taskIntegration;
      const secrets = taskCredentialStore.getSecrets(projectId);
      const key = externalId.trim();

      if (!config?.platform || !key) {
        throw new Error('Não foi possível iniciar a tarefa');
      }

      if (config.platform === 'jira') {
        const status = await startJiraIssue(
          config.jiraSiteUrl ?? '',
          config.jiraEmail ?? '',
          secrets.jiraApiToken ?? '',
          key,
        );

        return { status };
      }

      if (config.platform === 'trello') {
        const boardId = config.trelloBoardId?.trim() ?? '';

        if (!boardId) {
          throw new Error('Board do Trello não configurado');
        }

        const status = await startTrelloCard(
          secrets.trelloApiKey ?? '',
          secrets.trelloToken ?? '',
          key,
          boardId,
        );

        return { status };
      }

      if (config.platform === 'deepcrm') {
        const result = await startDeepcrmProject(secrets.deepcrmApiToken ?? '', key);

        return {
          status: result.status,
          stageId: result.stageId,
          stageName: result.stageName,
        };
      }

      throw new Error('Plataforma de tarefas não suportada');
    },
  );
}
