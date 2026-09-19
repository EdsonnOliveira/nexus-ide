import type { WebAgentTurn } from '../store';

const MAX_HANDOFF_CHARS = 40_000;
const MAX_TURN_USER_CHARS = 4_000;
const MAX_TURN_ASSISTANT_CHARS = 8_000;
const MAX_EDITED_FILES = 20;

interface WebConversationHandoffTurn {
  userText: string;
  assistantText: string;
  editedFiles?: string[];
}

function truncateHandoffText(value: string, maxChars: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function collectEditedFiles(turn: WebAgentTurn): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const activity of turn.activities) {
    if (activity.kind !== 'file_edit') {
      continue;
    }

    const path = activity.filePath?.trim();

    if (!path) {
      continue;
    }

    const key = path.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    paths.push(path);

    if (paths.length >= MAX_EDITED_FILES) {
      break;
    }
  }

  return paths;
}

function collectHandoffTurns(turns: WebAgentTurn[]): WebConversationHandoffTurn[] {
  const collected: WebConversationHandoffTurn[] = [];

  for (const turn of turns) {
    if (turn.status === 'running') {
      continue;
    }

    const userText = turn.prompt.trim();
    const assistantText =
      turn.response.trim() ||
      [...turn.activities]
        .reverse()
        .find((activity) => activity.kind === 'response' && activity.label.trim())
        ?.label.trim() ||
      '';
    const editedFiles = collectEditedFiles(turn);

    if (!userText && !assistantText && editedFiles.length === 0) {
      continue;
    }

    collected.push({
      userText,
      assistantText,
      ...(editedFiles.length > 0 ? { editedFiles } : {}),
    });
  }

  return collected;
}

function formatHandoffTurn(turn: WebConversationHandoffTurn, index: number): string {
  const blocks: string[] = [];

  if (turn.userText) {
    blocks.push(
      `### ${index + 1}. Usuário\n${truncateHandoffText(turn.userText, MAX_TURN_USER_CHARS)}`,
    );
  } else {
    blocks.push(`### ${index + 1}. Usuário`);
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

export function wrapPromptWithWebAgentConversationHandoff(
  prompt: string,
  turns: WebAgentTurn[],
): string {
  const current = prompt.trim();
  const handoffTurns = collectHandoffTurns(turns);

  if (!current || handoffTurns.length === 0) {
    return prompt;
  }

  const selected: WebConversationHandoffTurn[] = [];
  let usedChars = 0;

  for (let index = handoffTurns.length - 1; index >= 0; index -= 1) {
    const turn = handoffTurns[index];

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
    return prompt;
  }

  const omitted = handoffTurns.length - selected.length;
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
