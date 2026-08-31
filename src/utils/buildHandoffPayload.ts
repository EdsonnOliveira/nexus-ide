import type { AgentTurn, AgentTurnSummary } from '@/types';
import type { MissionEdge, MissionHandoffPayload } from '@/types/mission';

function summarizeTurn(turn: AgentTurn | null | undefined): string {
  if (!turn) {
    return '';
  }

  const parts: string[] = [];
  const summary = turn.summary;

  if (summary?.responseLead) {
    parts.push(summary.responseLead);
  }

  const responseActivity = [...turn.activities]
    .reverse()
    .find((activity) => activity.kind === 'response' && activity.label?.trim());

  if (!summary?.responseLead && responseActivity?.label) {
    parts.push(responseActivity.label.trim().slice(0, 1200));
  }

  return parts.join('\n').trim();
}

function formatFiles(summary: AgentTurnSummary | undefined, changedOnly: boolean): string {
  if (!summary) {
    return '';
  }

  const files = changedOnly
    ? summary.editedFiles ?? []
    : [...(summary.editedFiles ?? []), ...(summary.exploredFiles ?? [])];

  if (files.length === 0) {
    return '';
  }

  return files
    .slice(0, 40)
    .map((file) => {
      const delta =
        typeof file.additions === 'number' || typeof file.deletions === 'number'
          ? ` (+${file.additions ?? 0}/-${file.deletions ?? 0})`
          : '';
      return `- ${file.path}${delta}`;
    })
    .join('\n');
}

function formatCommands(summary: AgentTurnSummary | undefined): string {
  if (!summary?.commands?.length) {
    return '';
  }

  return summary.commands
    .slice(0, 30)
    .map((entry) => `$ ${entry.command}`)
    .join('\n');
}

export function buildHandoffPayloadText(input: {
  edge: MissionEdge;
  sourceLabel: string;
  turn: AgentTurn | null | undefined;
  discoveries?: string[];
}): string {
  const payload: MissionHandoffPayload = input.edge.payload;
  const blocks: string[] = [`Origem: ${input.sourceLabel}`];

  if (payload.summary) {
    const summaryText = summarizeTurn(input.turn);

    if (summaryText) {
      blocks.push(`## Resumo\n${summaryText}`);
    }
  }

  if (payload.discoveries && input.discoveries?.length) {
    blocks.push(`## Descobertas\n${input.discoveries.map((item) => `- ${item}`).join('\n')}`);
  }

  if (payload.changedFiles) {
    const files = formatFiles(input.turn?.summary, true);

    if (files) {
      blocks.push(`## Arquivos alterados\n${files}`);
    }
  }

  if (payload.relatedFiles) {
    const files = formatFiles(input.turn?.summary, false);

    if (files) {
      blocks.push(`## Arquivos relacionados\n${files}`);
    }
  }

  if (payload.diff && input.turn?.summary) {
    blocks.push(
      `## Diff resumido\n+${input.turn.summary.additions} / -${input.turn.summary.deletions} em ${input.turn.summary.editedFileCount} arquivo(s)`,
    );
  }

  if (payload.commands) {
    const commands = formatCommands(input.turn?.summary);

    if (commands) {
      blocks.push(`## Comandos\n${commands}`);
    }
  }

  if (payload.conversation && input.turn) {
    const snippets = input.turn.activities
      .filter((activity) => activity.kind === 'response' || activity.kind === 'thought')
      .map((activity) => activity.label?.trim())
      .filter(Boolean)
      .slice(-4);

    if (snippets.length > 0) {
      blocks.push(`## Trechos da conversa\n${snippets.join('\n---\n')}`);
    }
  }

  if (payload.testResults && input.turn?.summary?.commands?.length) {
    const testCommands = input.turn.summary.commands.filter((entry) =>
      /test|spec|jest|vitest|pytest|maestro/i.test(entry.command),
    );

    if (testCommands.length > 0) {
      blocks.push(
        `## Resultados de testes (comandos)\n${testCommands
          .map((entry) => `$ ${entry.command}`)
          .join('\n')}`,
      );
    }
  }

  return blocks.join('\n\n').trim();
}
