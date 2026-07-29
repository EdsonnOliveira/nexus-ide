import type { JarvisIntent, Project } from '@/types';
import { useProjectStore } from '@/stores/useProjectStore';
import { executeAgentPrompt } from '@/utils/executeAgentPrompt';
import { findPaneTab } from '@/utils/tabGroups';
import { waitForJarvisAgentAnswer } from '@/utils/jarvis/waitForAgentAnswer';
import {
  playJarvisRequestFinishSound,
  playJarvisRequestStartSound,
} from '@/utils/jarvisNotificationSound';
import { jarvisUiVoice } from '@/utils/jarvis/jarvisUiVoice';

interface RunJarvisIntentDeps {
  addAgentTab: (command: string) => Promise<void>;
  selectPane: (paneId: string) => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        (matrix[i - 1]![j] ?? 0) + 1,
        (matrix[i]![j - 1] ?? 0) + 1,
        (matrix[i - 1]![j - 1] ?? 0) + cost,
      );
    }
  }

  return matrix[a.length]![b.length] ?? 99;
}

const COMMON_PROJECT_TYPOS: Record<string, string> = {
  fisqal: 'fiscal',
  fiscall: 'fiscal',
  fisical: 'fiscal',
  fical: 'fiscal',
};

function correctProjectTypo(token: string): string {
  const normalized = normalizeToken(token);
  return COMMON_PROJECT_TYPOS[normalized] ?? token;
}

function scoreProject(query: string, project: Project): number {
  const needle = normalizeToken(query);
  const name = normalizeToken(project.name);
  const pathToken = normalizeToken(project.path.split(/[/\\]/).filter(Boolean).at(-1) ?? '');

  if (!needle) {
    return Number.POSITIVE_INFINITY;
  }

  if (name === needle || pathToken === needle) {
    return 0;
  }

  if (name.includes(needle) || needle.includes(name)) {
    return 1;
  }

  if (pathToken.includes(needle) || needle.includes(pathToken)) {
    return 2;
  }

  const nameDistance = levenshtein(needle, name);
  const pathDistance = pathToken ? levenshtein(needle, pathToken) : 99;
  return Math.min(nameDistance, pathDistance) + 10;
}

export function resolveProjectByQuery(projectQuery: string | null): Project | null {
  const projects = useProjectStore.getState().projects;
  if (!projectQuery?.trim()) {
    return useProjectStore.getState().getActiveProject() ?? projects[0] ?? null;
  }

  const corrected = correctProjectTypo(projectQuery.trim());
  const needle = normalizeToken(corrected);
  if (!needle) {
    return useProjectStore.getState().getActiveProject() ?? projects[0] ?? null;
  }

  let best: Project | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const project of projects) {
    const score = scoreProject(corrected, project);
    const name = normalizeToken(project.name);
    const threshold = Math.max(2, Math.min(3, Math.floor(name.length / 3))) + 10;

    if (score <= 2) {
      return project;
    }

    if (score <= threshold && score < bestScore) {
      bestScore = score;
      best = project;
    }
  }

  return best;
}

function buildQuestionPrompt(agentPrompt: string): string {
  return [
    'Responda em português de forma objetiva e clara.',
    'Não edite arquivos nem rode comandos destrutivos.',
    'Pergunta:',
    agentPrompt.trim(),
  ].join('\n');
}

export async function runJarvisIntent(
  intent: JarvisIntent,
  deps: RunJarvisIntentDeps,
): Promise<void> {
  if (intent.mode === 'ping') {
    playJarvisRequestStartSound();
    playJarvisRequestFinishSound();
    await window.nexus.jarvis.notifyFinished(true);
    return;
  }

  playJarvisRequestStartSound();

  try {
    const projectMatch = resolveProjectByQuery(intent.projectQuery);
    if (!projectMatch) {
      await window.nexus.jarvis.speak(jarvisUiVoice.projectNotFound());
      playJarvisRequestFinishSound();
      await window.nexus.jarvis.notifyFinished(false, 'Projeto não encontrado');
      return;
    }

    if (useProjectStore.getState().activeProjectId !== projectMatch.id) {
      await useProjectStore.getState().selectProject(projectMatch.id);
    }

    const project =
      useProjectStore.getState().projects.find((entry) => entry.id === projectMatch.id) ??
      projectMatch;

    const prompt =
      intent.mode === 'question'
        ? buildQuestionPrompt(intent.agentPrompt)
        : intent.agentPrompt.trim();

    if (!prompt) {
      await window.nexus.jarvis.speak(jarvisUiVoice.emptyPrompt());
      playJarvisRequestFinishSound();
      await window.nexus.jarvis.notifyFinished(false, 'Prompt vazio');
      return;
    }

    const submitted = await executeAgentPrompt({
      project,
      prompt,
      createNew: intent.mode === 'question',
      addAgentTab: deps.addAgentTab,
      selectPane: deps.selectPane,
    });

    if (!submitted) {
      await window.nexus.jarvis.speak(jarvisUiVoice.agentOpenFail());
      playJarvisRequestFinishSound();
      await window.nexus.jarvis.notifyFinished(false, 'Falha ao abrir agent');
      return;
    }

    if (intent.mode === 'action') {
      playJarvisRequestFinishSound();
      await window.nexus.jarvis.notifyFinished(true);
      return;
    }

    await delay(600);

    const refreshed = useProjectStore.getState().getActiveProject();
    const paneId = refreshed?.activeTabId ?? null;
    if (!paneId) {
      await window.nexus.jarvis.speak(jarvisUiVoice.agentNoReply());
      playJarvisRequestFinishSound();
      await window.nexus.jarvis.notifyFinished(false, 'Sem pane do agent');
      return;
    }

    const pane = findPaneTab(refreshed?.tabs ?? [], paneId);
    const turnCountBefore =
      pane?.type === 'agent' ? Math.max(0, (pane.turns?.length ?? 1) - 1) : 0;
    const answer = await waitForJarvisAgentAnswer(paneId, turnCountBefore);
    if (!answer) {
      await window.nexus.jarvis.speak(jarvisUiVoice.agentEmpty());
      playJarvisRequestFinishSound();
      await window.nexus.jarvis.notifyFinished(false, 'Sem resposta');
      return;
    }

    await window.nexus.jarvis.speakSummary(answer);
    playJarvisRequestFinishSound();
    await window.nexus.jarvis.notifyFinished(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro no Jarvis';
    try {
      await window.nexus.jarvis.speak(jarvisUiVoice.genericFail());
    } catch {
    }
    playJarvisRequestFinishSound();
    await window.nexus.jarvis.notifyFinished(false, message);
  }
}
