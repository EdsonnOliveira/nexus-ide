import type { GitDiffLine } from '@/utils/gitDiffLines';

export interface AgentGitFilePromptTurn {
  prompt: string;
  changeCount: number;
  completedAt: number;
}

function createPromptLine(prompt: string): GitDiffLine {
  return {
    kind: 'prompt',
    content: prompt,
    oldLineNumber: null,
    newLineNumber: null,
  };
}

function insertPromptBeforeEachChange(
  lines: GitDiffLine[],
  turns: AgentGitFilePromptTurn[],
): GitDiffLine[] {
  const result: GitDiffLine[] = [];
  let turnIndex = 0;

  for (const line of lines) {
    if ((line.kind === 'add' || line.kind === 'remove') && turnIndex < turns.length) {
      result.push(createPromptLine(turns[turnIndex].prompt));
      turnIndex += 1;
    }

    result.push(line);
  }

  return result;
}

function insertPromptsBeforeFirstChange(
  lines: GitDiffLine[],
  turns: AgentGitFilePromptTurn[],
): GitDiffLine[] {
  const result: GitDiffLine[] = [];
  let inserted = false;

  for (const line of lines) {
    if (!inserted && (line.kind === 'add' || line.kind === 'remove')) {
      for (const turn of turns) {
        result.push(createPromptLine(turn.prompt));
      }
      inserted = true;
    }

    result.push(line);
  }

  return result;
}

export function injectAgentPromptsIntoDiffLines(
  lines: GitDiffLine[],
  turns: AgentGitFilePromptTurn[],
): GitDiffLine[] {
  if (turns.length === 0) {
    return lines;
  }

  const changeLineCount = lines.filter((line) => line.kind === 'add' || line.kind === 'remove').length;
  const turnChangeCount = turns.reduce((sum, turn) => sum + turn.changeCount, 0);

  if (turns.length === 1) {
    return insertPromptsBeforeFirstChange(lines, turns);
  }

  if (turns.length === changeLineCount && changeLineCount > 0) {
    return insertPromptBeforeEachChange(lines, turns);
  }

  if (turnChangeCount !== changeLineCount || turnChangeCount === 0) {
    return insertPromptsBeforeFirstChange(lines, turns);
  }

  const result: GitDiffLine[] = [];
  let turnIndex = 0;
  let changesInTurn = 0;
  let promptInserted = false;

  for (const line of lines) {
    if (line.kind === 'add' || line.kind === 'remove') {
      const currentTurn = turns[turnIndex];

      if (!promptInserted && currentTurn) {
        result.push(createPromptLine(currentTurn.prompt));
        promptInserted = true;
      }

      result.push(line);
      changesInTurn += 1;

      if (currentTurn && changesInTurn >= currentTurn.changeCount) {
        turnIndex += 1;
        changesInTurn = 0;
        promptInserted = false;
      }

      continue;
    }

    result.push(line);
  }

  return result;
}
