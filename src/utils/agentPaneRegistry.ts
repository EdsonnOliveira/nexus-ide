import type { AgentPromptSubmitOptions } from '@/types';

type AgentPaneSubmit = (
  prompt: string,
  options?: AgentPromptSubmitOptions,
) => boolean | Promise<boolean>;
type AgentPaneStop = () => boolean;
type AgentPaneWrite = (text: string) => boolean;
type AgentPaneRunCommand = (command: string) => boolean;
type AgentPaneRedo = (turnId: string) => boolean | Promise<boolean>;
type AgentPaneAttach = () => void;

interface AgentPaneHandlers {
  submit: AgentPaneSubmit;
  stop: AgentPaneStop;
  write: AgentPaneWrite;
  runCommand: AgentPaneRunCommand;
  redo: AgentPaneRedo;
}

interface AgentPaneAttachHandlers {
  image: AgentPaneAttach;
  file: AgentPaneAttach;
}

const handlersByPane = new Map<string, AgentPaneHandlers>();
const attachHandlersByPane = new Map<string, AgentPaneAttachHandlers>();

export function registerAgentPaneHandlers(
  paneId: string,
  handlers: AgentPaneHandlers,
): () => void {
  handlersByPane.set(paneId, handlers);

  return () => {
    if (handlersByPane.get(paneId) === handlers) {
      handlersByPane.delete(paneId);
    }
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
