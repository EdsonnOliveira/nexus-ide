import type { MacParakeetSourceType } from '@/types';
import {
  loadBrainManual,
  saveBrainLinkedTranscriptionIds,
} from '@/utils/brainManualStore';
import { startOfLocalDay } from '@/utils/dailyGenerateDate';

export interface LinkedTranscriptionSummary {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number | null;
  snippet: string;
  conclusion: string | null;
  sourceType: MacParakeetSourceType;
}

interface ProjectLinkTarget {
  id: string;
  path: string;
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/[\\/]+$/, '');
}

export function isTranscriptionOnLocalDay(createdAt: number, day: Date): boolean {
  if (!createdAt) {
    return false;
  }

  const created = startOfLocalDay(new Date(createdAt));
  const target = startOfLocalDay(day);

  return created.getTime() === target.getTime();
}

export async function findLinkedProjectIdForTranscription(
  transcriptionId: string,
  projects: ProjectLinkTarget[],
): Promise<string | null> {
  const matches = await Promise.all(
    projects.map(async (project) => {
      const store = await loadBrainManual(project.path);
      return store.linkedTranscriptionIds.includes(transcriptionId) ? project.id : null;
    }),
  );

  return matches.find((projectId) => projectId !== null) ?? null;
}

export async function setTranscriptionLinkedProject(
  transcriptionId: string,
  nextProjectPath: string | null,
  projects: ProjectLinkTarget[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedNext =
    nextProjectPath === null ? null : normalizeProjectPath(nextProjectPath);

  const planned: Array<{ path: string; previousIds: string[]; nextIds: string[] }> = [];

  for (const project of projects) {
    const projectPath = normalizeProjectPath(project.path);
    const store = await loadBrainManual(project.path);
    const hasLink = store.linkedTranscriptionIds.includes(transcriptionId);
    const shouldHave = normalizedNext !== null && projectPath === normalizedNext;

    if (hasLink === shouldHave) {
      continue;
    }

    const nextIds = shouldHave
      ? [...store.linkedTranscriptionIds, transcriptionId]
      : store.linkedTranscriptionIds.filter((id) => id !== transcriptionId);

    planned.push({
      path: project.path,
      previousIds: [...store.linkedTranscriptionIds],
      nextIds,
    });
  }

  const applied: Array<{ path: string; previousIds: string[] }> = [];

  for (const entry of planned) {
    const saved = await saveBrainLinkedTranscriptionIds(entry.path, entry.nextIds);
    if (!saved.ok) {
      for (const rollback of [...applied].reverse()) {
        await saveBrainLinkedTranscriptionIds(rollback.path, rollback.previousIds);
      }
      return saved;
    }

    applied.push({ path: entry.path, previousIds: entry.previousIds });
  }

  return { ok: true };
}

export async function loadProjectLinkedTranscriptions(
  projectPath: string,
): Promise<LinkedTranscriptionSummary[]> {
  const store = await loadBrainManual(projectPath);
  const linkedIds = store.linkedTranscriptionIds;

  if (!window.nexus?.macParakeet || linkedIds.length === 0) {
    return [];
  }

  try {
    const snapshot = await window.nexus.macParakeet.getTranscriptions(null, false).catch(() => null);
    const listedById = new Map(
      (snapshot?.transcriptions ?? []).map((item) => [item.id, item] as const),
    );

    const details = await Promise.all(
      linkedIds.map(async (id) => {
        try {
          return await window.nexus.macParakeet.getTranscriptionDetail(id);
        } catch {
          return null;
        }
      }),
    );

    const items: LinkedTranscriptionSummary[] = [];

    linkedIds.forEach((id, index) => {
      const detail = details[index];
      const listed = listedById.get(id) ?? null;
      const source = detail ?? listed;

      if (!source) {
        return;
      }

      items.push({
        id: source.id,
        title: source.title || 'Sem título',
        createdAt: source.createdAt,
        durationMs: source.durationMs,
        snippet: source.snippet || '',
        conclusion: detail?.conclusion ?? null,
        sourceType: source.sourceType,
      });
    });

    return items.sort((left, right) => right.createdAt - left.createdAt);
  } catch {
    return [];
  }
}
