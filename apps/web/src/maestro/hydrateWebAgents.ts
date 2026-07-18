import type { AgentSessionBundle } from '@nexus/supabase';
import type { WebAgentSession, WebAgentTerminal, WebAgentTurn } from '../store';
import { collectWebShellTerminalsFromEvents } from './webShellTerminal';
import { createWebStreamJsonState, feedWebStreamJson } from './webStreamJson';

function mapSessionStatus(status: string, hasRunningExecution: boolean): WebAgentSession['status'] {
  if (hasRunningExecution || status === 'running' || status === 'waiting_user') {
    return 'running';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'done';
}

function mapExecutionStatus(status: string): WebAgentTurn['status'] {
  if (status === 'running' || status === 'pending') {
    return 'running';
  }
  if (status === 'failed') {
    return 'error';
  }
  return 'done';
}

export function hydrateWebAgentsFromBundles(bundles: AgentSessionBundle[]): WebAgentSession[] {
  return bundles.map((bundle) => {
    const { session, project, executions, messages } = bundle;
    const messagesByExecution = new Map<string, string>();
    for (const message of messages) {
      if (message.role !== 'assistant' || !message.execution_id) {
        continue;
      }
      messagesByExecution.set(message.execution_id, message.content);
    }

    let cursorSessionId = session.cursor_chat_id;
    const terminals: WebAgentTerminal[] = [];
    const turns: WebAgentTurn[] = executions.map((execution) => {
      const stream = messagesByExecution.get(execution.id) ?? '';
      const parser = createWebStreamJsonState();
      const parsed = stream ? feedWebStreamJson(parser, stream) : null;
      if (parsed?.sessionId) {
        cursorSessionId = parsed.sessionId;
      }
      if (parsed?.shellToolEvents?.length) {
        terminals.push(...collectWebShellTerminalsFromEvents(parsed.shellToolEvents));
      }
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
        status: mapExecutionStatus(execution.status),
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
      deviceId: session.device_id,
      projectName: project?.name ?? 'Projeto',
      projectColor: project?.color || '#8b5cf6',
      logoUrl: project?.logo_url ?? null,
      cursorSessionId,
      modelId: session.model_id || 'auto',
      modeId: 'agent',
      stream: '',
      status: mapSessionStatus(session.status, hasRunningExecution),
      createdAt: new Date(session.created_at).getTime(),
      turns,
      terminals,
    };
  });
}
