import { aiProviderLabel, isSelectableAiProviderId } from '@/constants/aiProviders';
import type { AgentTurn } from '@/types';
import {
  buildEditedFilesFromActivities,
  extractAgentFinalResponseText,
} from '@/utils/agentTurnSummary';

const MAX_HANDOFF_CHARS = 40_000;
const MAX_TURN_USER_CHARS = 4_000;
const MAX_TURN_ASSISTANT_CHARS = 8_000;
const MAX_EDITED_FILES = 20;

export interface AgentConversationHandoffTurn {
  userText: string;
  assistantText: string;
  providerLabel?: string;
  editedFiles?: string[];
}

function truncateHandoffText(value: string, maxChars: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function collectHandoffTurns(turns: AgentTurn[]): AgentConversationHandoffTurn[] {
  const collected: AgentConversationHandoffTurn[] = [];

  for (const turn of turns) {
    if (turn.running || turn.pendingFollowUp) {
      continue;
    }

    const userText = turn.user.content.trim();
    const assistantText =
      extractAgentFinalResponseText(turn.activities).trim() ||
      turn.summary?.responseLead?.trim() ||
      '';
    const editedFiles = (
      turn.summary?.editedFiles?.length
        ? turn.summary.editedFiles
        : buildEditedFilesFromActivities(turn.activities)
    )
      .map((file) => file.path.trim())
      .filter(Boolean)
      .slice(0, MAX_EDITED_FILES);
    const storedProvider = turn.user.aiProvider;
    const providerLabel =
      storedProvider && isSelectableAiProviderId(storedProvider)
        ? aiProviderLabel(storedProvider)
        : undefined;

    if (!userText && !assistantText && editedFiles.length === 0) {
      continue;
    }

    collected.push({
      userText,
      assistantText,
      ...(providerLabel ? { providerLabel } : {}),
      ...(editedFiles.length > 0 ? { editedFiles } : {}),
    });
  }

  return collected;
}

function formatHandoffTurn(turn: AgentConversationHandoffTurn, index: number): string {
  const blocks: string[] = [];
  const userHeading = turn.providerLabel
    ? `### ${index + 1}. Usuário (${turn.providerLabel})`
    : `### ${index + 1}. Usuário`;

  if (turn.userText) {
    blocks.push(`${userHeading}\n${truncateHandoffText(turn.userText, MAX_TURN_USER_CHARS)}`);
  } else {
    blocks.push(userHeading);
  }

  if (turn.assistantText) {
    blocks.push(
      `### ${index + 1}. Assistente\n${truncateHandoffText(
        turn.assistantText,
        MAX_TURN_ASSISTANT_CHARS,
      )}`,
    );
  }

  if (turn.editedFiles && turn.editedFiles.length > 0) {
    blocks.push(`Arquivos alterados:\n${turn.editedFiles.map((path) => `- ${path}`).join('\n')}`);
  }

  return blocks.join('\n\n');
}

export function buildConversationHandoffPrompt(
  turns: AgentConversationHandoffTurn[],
  currentPrompt: string,
): string {
  const current = currentPrompt.trim();

  if (!current || turns.length === 0) {
    return currentPrompt;
  }

  const selected: AgentConversationHandoffTurn[] = [];
  let usedChars = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];

    if (!turn) {
      continue;
    }

    const formatted = formatHandoffTurn(turn, index);
    const nextUsed = usedChars + formatted.length + 2;

    if (selected.length > 0 && nextUsed > MAX_HANDOFF_CHARS) {
      break;
    }

    selected.push(turn);
    usedChars = nextUsed;
  }

  selected.reverse();

  if (selected.length === 0) {
    return currentPrompt;
  }

  const omitted = turns.length - selected.length;
  const header = [
    'Esta é a continuação do mesmo agent no Nexus IDE.',
    'A conversa abaixo aconteceu neste mesmo agent, possivelmente com outra IA.',
    'Use esse contexto. Não peça de novo o que já está aqui.',
  ];

  if (omitted > 0) {
    header.push(
      `Trechos mais antigos foram omitidos (${omitted} turno${omitted === 1 ? '' : 's'}).`,
    );
  }

  const body = selected.map((turn, index) => formatHandoffTurn(turn, index)).join('\n\n');

  return `${header.join(' ')}\n\n## Conversa anterior\n\n${body}\n\n## Pedido atual\n${current}`;
}

export function wrapPromptWithAgentConversationHandoff(prompt: string, turns: AgentTurn[]): string {
  return buildConversationHandoffPrompt(collectHandoffTurns(turns), prompt);
}
