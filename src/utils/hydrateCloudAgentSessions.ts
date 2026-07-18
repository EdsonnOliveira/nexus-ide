import type { AgentSessionBundle } from '@nexus/supabase';
import type { CloudAgentSession, CloudAgentTurn, CloudAgentTurnStatus } from '@/types/cloudAgent';
import {
  createCloudAgentStreamState,
  feedCloudAgentStreamChunk,
} from '@/utils/cloudAgentStreamParser';

function mapCloudSessionStatus(status: string, hasRunningExecution: boolean): CloudAgentTurnStatus {
  if (hasRunningExecution || status === 'running' || status === 'waiting_user') {
    return 'running';
  }

  if (status === 'error') {
    return 'error';
  }

  return 'done';
}

function mapCloudExecutionStatus(status: string): CloudAgentTurnStatus {
  if (status === 'running' || status === 'pending') {
    return 'running';
  }

  if (status === 'failed') {
    return 'error';
  }

  return 'done';
}

export function hydrateCloudAgentSessions(bundles: AgentSessionBundle[]): CloudAgentSession[] {
  return bundles.map((bundle) => {
    const { session, project, executions, messages } = bundle;
    const messagesByExecution = new Map<string, string>();

    for (const message of messages) {
      if (message.role !== 'assistant' || !message.execution_id) {
        continue;
      }

      messagesByExecution.set(message.execution_id, message.content);
    }

    const turns: CloudAgentTurn[] = executions.map((execution) => {
      const stream = messagesByExecution.get(execution.id) ?? '';
      const state = createCloudAgentStreamState();
      const parsed = stream ? feedCloudAgentStreamChunk(state, stream) : null;
      const createdAt = execution.started_at
        ? new Date(execution.started_at).getTime()
        : new Date(execution.created_at).getTime();
      const endedAt = execution.completed_at
        ? new Date(execution.completed_at).getTime()
        : undefined;

      return {
        id: execution.id,
        prompt: execution.prompt ?? session.title ?? '',
        thought: parsed?.thought ?? '',
        thoughtStreaming: false,
        response: parsed?.response ?? '',
        status: mapCloudExecutionStatus(execution.status),
        createdAt,
        endedAt,
        commandId: execution.command_id ?? execution.id,
      };
    });

    const lastExecution = executions[executions.length - 1] ?? null;
    const hasRunningExecution = executions.some(
      (execution) => execution.status === 'running' || execution.status === 'pending',
    );

    return {
      id: session.id,
      commandId: lastExecution?.command_id ?? lastExecution?.id ?? session.id,
      prompt: lastExecution?.prompt ?? session.title ?? '',
      projectId: session.project_id,
      projectPath: project?.local_path ?? null,
      projectName: project?.name ?? 'Projeto',
      projectColor: project?.color || '#8b5cf6',
      logoUrl: project?.logo_url ?? null,
      deviceId: session.device_id,
      status: mapCloudSessionStatus(session.status, hasRunningExecution),
      createdAt: new Date(session.created_at).getTime(),
      turns,
    };
  });
}
