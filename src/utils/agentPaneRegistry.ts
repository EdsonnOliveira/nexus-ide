import type {
  AgentFollowUp,
  AgentPromptSubmitOptions,
  AgentQuestionAnswers,
  AgentTurn,
} from '@/types';
import type { AgentContextUsageSnapshot } from '@/utils/agentContextUsageParser';

type AgentPaneSubmit = (
  prompt: string,
  options?: AgentPromptSubmitOptions,
) => boolean | Promise<boolean>;
type AgentPaneStop = () => boolean;
type AgentPaneWrite = (text: string) => boolean;
type AgentPaneRunCommand = (command: string) => boolean;
type AgentPaneRedo = (turnId: string) => boolean | Promise<boolean>;
type AgentPaneAttach = () => void;
type AgentPaneBool = () => boolean;
type AgentPaneIdAction = (id: string) => boolean | Promise<boolean> | void;

interface AgentPaneHandlers {
  submit: AgentPaneSubmit;
  stop: AgentPaneStop;
  write: AgentPaneWrite;
  runCommand: AgentPaneRunCommand;
  redo: AgentPaneRedo;
  editTurn?: AgentPaneIdAction;
  cancelEdit?: AgentPaneBool;
  flushFollowUp?: AgentPaneBool;
  sendFollowUpNow?: AgentPaneIdAction;
  removeFollowUp?: AgentPaneIdAction;
  editFollowUp?: AgentPaneIdAction;
  submitQuestion?: (
    activityId: string,
    answers: AgentQuestionAnswers,
  ) => boolean | Promise<boolean>;
  acceptPlan?: AgentPaneIdAction;
  rejectPlan?: AgentPaneIdAction;
  getLiveTranscript?: () => {
    turns: AgentTurn[];
    followUps: AgentFollowUp[];
    contextUsage?: AgentContextUsageSnapshot | null;
  };
}

interface AgentPaneAttachHandlers {
  image: AgentPaneAttach;
  file: AgentPaneAttach;
}

const handlersByPane = new Map<string, AgentPaneHandlers>();
const handlerStacksByPane = new Map<string, AgentPaneHandlers[]>();
const attachHandlersByPane = new Map<string, AgentPaneAttachHandlers>();

export function registerAgentPaneHandlers(paneId: string, handlers: AgentPaneHandlers): () => void {
  const stack = handlerStacksByPane.get(paneId) ?? [];
  stack.push(handlers);
  handlerStacksByPane.set(paneId, stack);
  handlersByPane.set(paneId, handlers);

  return () => {
    const current = handlerStacksByPane.get(paneId);
    if (!current) {
      return;
    }

    const index = current.lastIndexOf(handlers);
    if (index >= 0) {
      current.splice(index, 1);
    }

    if (current.length === 0) {
      handlerStacksByPane.delete(paneId);
      if (handlersByPane.get(paneId) === handlers) {
        handlersByPane.delete(paneId);
      }
      return;
    }

    handlerStacksByPane.set(paneId, current);
    handlersByPane.set(paneId, current[current.length - 1]!);
  };
}

export function registerAgentPaneSubmit(paneId: string, submit: AgentPaneSubmit | null): void {
  const existing = handlersByPane.get(paneId);

  if (!submit) {
    if (!existing) {
      return;
    }

    handlersByPane.set(paneId, {
      ...existing,
      submit: () => Promise.resolve(false),
    });
    return;
  }

  handlersByPane.set(paneId, {
    submit,
    stop: existing?.stop ?? (() => false),
    write: existing?.write ?? (() => false),
    runCommand: existing?.runCommand ?? (() => false),
    redo: existing?.redo ?? (() => false),
  });
}

export async function submitAgentPanePrompt(
  paneId: string,
  prompt: string,
  options?: AgentPromptSubmitOptions,
): Promise<boolean> {
  const result = handlersByPane.get(paneId)?.submit(prompt, options) ?? false;
  return result instanceof Promise ? result : result;
}

export function stopAgentPane(paneId: string): boolean {
  return handlersByPane.get(paneId)?.stop() ?? false;
}

export function writeAgentPaneDraft(paneId: string, text: string): boolean {
  return handlersByPane.get(paneId)?.write(text) ?? false;
}

export function runAgentPaneCommand(paneId: string, command: string): boolean {
  return handlersByPane.get(paneId)?.runCommand(command) ?? false;
}

export async function redoAgentPaneTurn(paneId: string, turnId: string): Promise<boolean> {
  const result = handlersByPane.get(paneId)?.redo(turnId) ?? false;
  return result instanceof Promise ? result : result;
}

export function hasAgentPaneSubmit(paneId: string): boolean {
  return handlersByPane.has(paneId);
}

async function runPaneAction(
  result: boolean | Promise<boolean> | void | undefined,
): Promise<boolean> {
  if (result === undefined) {
    return false;
  }

  if (result instanceof Promise) {
    return result;
  }

  return result !== false;
}

export async function editAgentPaneTurn(paneId: string, turnId: string): Promise<boolean> {
  return runPaneAction(handlersByPane.get(paneId)?.editTurn?.(turnId));
}

export function cancelAgentPaneEdit(paneId: string): boolean {
  return handlersByPane.get(paneId)?.cancelEdit?.() ?? false;
}

export function flushAgentPaneFollowUp(paneId: string): boolean {
  return handlersByPane.get(paneId)?.flushFollowUp?.() ?? false;
}

export async function sendAgentPaneFollowUpNow(paneId: string, id: string): Promise<boolean> {
  return runPaneAction(handlersByPane.get(paneId)?.sendFollowUpNow?.(id));
}

export function removeAgentPaneFollowUp(paneId: string, id: string): boolean {
  const result = handlersByPane.get(paneId)?.removeFollowUp?.(id);
  return result !== false;
}

export function editAgentPaneFollowUp(paneId: string, id: string): boolean {
  const result = handlersByPane.get(paneId)?.editFollowUp?.(id);
  return result !== false;
}

export async function submitAgentPaneQuestion(
  paneId: string,
  activityId: string,
  answers: AgentQuestionAnswers,
): Promise<boolean> {
  return runPaneAction(handlersByPane.get(paneId)?.submitQuestion?.(activityId, answers));
}

export async function acceptAgentPanePlan(paneId: string, activityId: string): Promise<boolean> {
  return runPaneAction(handlersByPane.get(paneId)?.acceptPlan?.(activityId));
}

export function rejectAgentPanePlan(paneId: string, activityId: string): boolean {
  const result = handlersByPane.get(paneId)?.rejectPlan?.(activityId);
  return result !== false;
}

const liveTranscriptByPane = new Map<
  string,
  {
    turns: AgentTurn[];
    followUps: AgentFollowUp[];
    contextUsage?: AgentContextUsageSnapshot | null;
  }
>();

export function setAgentPaneLiveTranscript(
  paneId: string,
  transcript: {
    turns: AgentTurn[];
    followUps: AgentFollowUp[];
    contextUsage?: AgentContextUsageSnapshot | null;
  } | null,
): void {
  if (!transcript) {
    liveTranscriptByPane.delete(paneId);
    return;
  }

  liveTranscriptByPane.set(paneId, transcript);
}

export function getAgentPaneLiveTranscript(paneId: string): {
  turns: AgentTurn[];
  followUps: AgentFollowUp[];
  contextUsage?: AgentContextUsageSnapshot | null;
} | null {
  return (
    handlersByPane.get(paneId)?.getLiveTranscript?.() ?? liveTranscriptByPane.get(paneId) ?? null
  );
}

export {
  getAgentPaneLatestResponseText,
  isAgentPaneSettled,
  waitForAgentPaneSettled,
  waitForJarvisAgentAnswer,
} from '@/utils/jarvis/waitForAgentAnswer';

export function registerAgentPaneAttach(
  paneId: string,
  handlers: AgentPaneAttachHandlers | null,
): void {
  if (!handlers) {
    attachHandlersByPane.delete(paneId);
    return;
  }

  attachHandlersByPane.set(paneId, handlers);
}

export function attachAgentPaneImage(paneId: string): boolean {
  const handler = attachHandlersByPane.get(paneId)?.image;

  if (!handler) {
    return false;
  }

  handler();
  return true;
}

export function attachAgentPaneFile(paneId: string): boolean {
  const handler = attachHandlersByPane.get(paneId)?.file;

  if (!handler) {
    return false;
  }

  handler();
  return true;
}
