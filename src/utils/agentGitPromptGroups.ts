import type {
  AgentActivity,
  AgentGitChangeGroup,
  AgentTurn,
  AgentTurnSummaryFileRef,
  TabBarItem,
} from '@/types';
import { isAgentPaneTab } from '@/utils/agentTabHelpers';
import {
  buildEditedFilesFromActivities,
  mergeAgentTurnFileRefs,
} from '@/utils/agentTurnSummary';
import type { GitFlatChange } from '@/utils/gitFlatChanges';
import { findGitFlatChangeByPath, gitChangePathCovers } from '@/utils/gitPaths';
import { collectProjectPanes } from '@/utils/tabGroups';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

export interface GitPromptGroupSection {
  group: AgentGitChangeGroup;
  changes: GitFlatChange[];
}

const EVIDENCE_FOLDER_RE = /(?:^|\/)((?:evidencias|evidence)[-_][\w.-]+)/i;
const PATH_IN_TEXT_RE =
  /(?:^|[\s`'"(])((?:~\/|\/)?(?:[\w.@-]+\/)+(?:evidencias|evidence)[-_][\w.\/-]+)/gi;

function resolveTurnPrompt(turn: AgentTurn): string {
  return sanitizeAgentPrompt(turn.user.agentPrompt ?? turn.user.content);
}

function isBroadPath(path: string): boolean {
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) {
    return true;
  }

  if (segments[0] === 'Users' || segments[0] === 'home') {
    return segments.length <= 6;
  }

  const last = segments[segments.length - 1] ?? '';

  if (!last.includes('.') && segments.length <= 2 && !EVIDENCE_FOLDER_RE.test(path)) {
    return true;
  }

  return false;
}

function addPathCandidates(target: Set<string>, rawPath: string): void {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');

  if (!normalized || isBroadPath(normalized)) {
    return;
  }

  target.add(normalized);

  const evidenceMatch = normalized.match(EVIDENCE_FOLDER_RE);

  if (evidenceMatch?.[1]) {
    target.add(evidenceMatch[1]);
  }
}

function collectTextPaths(value: string | undefined, target: Set<string>): void {
  if (!value) {
    return;
  }

  PATH_IN_TEXT_RE.lastIndex = 0;

  for (const match of value.matchAll(PATH_IN_TEXT_RE)) {
    const path = match[1]?.trim();

    if (path) {
      addPathCandidates(target, path);
    }
  }

  const evidenceMatch = value.match(EVIDENCE_FOLDER_RE);

  if (evidenceMatch?.[1]) {
    target.add(evidenceMatch[1]);
  }
}

function collectActivityPaths(activity: AgentActivity, target: Set<string>): void {
  if (activity.kind === 'file_read') {
    return;
  }

  const filePath = activity.filePath?.trim();

  if (filePath) {
    addPathCandidates(target, filePath);
  }

  collectTextPaths(activity.label, target);
  collectTextPaths(activity.toolCommand, target);
  collectTextPaths(activity.toolOutput, target);
}

function resolveTurnEditedPaths(turn: AgentTurn): string[] {
  const paths = new Set<string>();

  for (const file of turn.summary?.editedFiles ?? []) {
    const path = file.path.trim();

    if (path) {
      addPathCandidates(paths, path);
    }
  }

  for (const file of buildEditedFilesFromActivities(turn.activities)) {
    const path = file.path.trim();

    if (path) {
      addPathCandidates(paths, path);
    }
  }

  for (const activity of turn.activities) {
    collectActivityPaths(activity, paths);
  }

  collectTextPaths(resolveTurnPrompt(turn), paths);

  return [...paths];
}

function claimMatchingChanges(
  remaining: GitFlatChange[],
  candidatePaths: string[],
): { claimed: GitFlatChange[]; rest: GitFlatChange[] } {
  if (candidatePaths.length === 0) {
    return { claimed: [], rest: remaining };
  }

  const claimed: GitFlatChange[] = [];
  const rest: GitFlatChange[] = [];

  for (const change of remaining) {
    const matched = candidatePaths.some((path) => gitChangePathCovers(path, change.path));

    if (matched) {
      claimed.push(change);
    } else {
      rest.push(change);
    }
  }

  return { claimed, rest };
}

function toGroupFiles(changes: GitFlatChange[]): AgentGitChangeGroup['files'] {
  return changes.map((change) => ({
    path: change.path,
    status: change.status,
    staged: change.staged,
    additions: change.additions,
    deletions: change.deletions,
  }));
}

function createChangeGroup(
  id: string,
  paneId: string,
  projectId: string,
  prompt: string,
  changes: GitFlatChange[],
  completedAt: number,
): AgentGitChangeGroup {
  return {
    id,
    paneId,
    projectId,
    prompt,
    files: toGroupFiles(changes),
    additions: changes.reduce((sum, change) => sum + change.additions, 0),
    deletions: changes.reduce((sum, change) => sum + change.deletions, 0),
    completedAt,
  };
}

function collectAgentTurns(tabs: TabBarItem[]): Array<{ paneId: string; turn: AgentTurn }> {
  const sources: Array<{ paneId: string; turn: AgentTurn }> = [];

  for (const pane of collectProjectPanes(tabs)) {
    if (!isAgentPaneTab(pane)) {
      continue;
    }

    for (const turn of pane.turns ?? []) {
      sources.push({ paneId: pane.id, turn });
    }
  }

  return sources.sort((left, right) => {
    const leftAt = left.turn.completedAt ?? left.turn.startedAt;
    const rightAt = right.turn.completedAt ?? right.turn.startedAt;
    return rightAt - leftAt;
  });
}

function topLevelFolder(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean)[0] ?? path;
}

function timestampFromEvidenceFolder(folder: string): number {
  const match = folder.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return 0;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

function humanizeEvidenceFolder(folder: string): string {
  return (
    folder
      .replace(/^evidencias[-_]/i, '')
      .replace(/^evidence[-_]/i, '')
      .replace(/[-_]\d{4}-\d{2}-\d{2}$/, '')
      .replace(/[-_]+/g, ' ')
      .trim() || folder
  );
}

function collectEvidenceFolderSections(
  projectId: string,
  remaining: GitFlatChange[],
): { sections: GitPromptGroupSection[]; rest: GitFlatChange[] } {
  const grouped = new Map<string, GitFlatChange[]>();
  const rest: GitFlatChange[] = [];

  for (const change of remaining) {
    const folder = topLevelFolder(change.path);
    const evidenceMatch = folder.match(EVIDENCE_FOLDER_RE);

    if (!evidenceMatch?.[1]) {
      rest.push(change);
      continue;
    }

    const key = evidenceMatch[1];
    const bucket = grouped.get(key) ?? [];
    bucket.push(change);
    grouped.set(key, bucket);
  }

  const sections: GitPromptGroupSection[] = [];

  for (const [folder, changes] of grouped) {
    if (changes.length === 0) {
      continue;
    }

    const allNew = changes.every(
      (change) => change.status === 'untracked' || change.status === 'added',
    );

    if (!allNew) {
      rest.push(...changes);
      continue;
    }

    const group = createChangeGroup(
      `agent-git-folder-${folder}`,
      folder,
      projectId,
      humanizeEvidenceFolder(folder),
      changes,
      timestampFromEvidenceFolder(folder),
    );
    sections.push({ group, changes });
  }

  return { sections, rest };
}

export function listAgentPaneGitChangedFiles(
  paneId: string,
  turns: AgentTurn[] | undefined,
  groups: AgentGitChangeGroup[],
  uncommittedChanges: GitFlatChange[] | null,
): AgentTurnSummaryFileRef[] {
  const paneGroups = groups.filter((group) => group.paneId === paneId);
  const groupFiles = paneGroups.flatMap((group) =>
    group.files.map((file) => ({
      path: file.path,
      ...(file.additions > 0 ? { additions: file.additions } : {}),
      ...(file.deletions > 0 ? { deletions: file.deletions } : {}),
    })),
  );

  const turnFiles = (turns ?? []).flatMap((turn) =>
    mergeAgentTurnFileRefs(
      turn.summary?.editedFiles,
      buildEditedFilesFromActivities(turn.activities),
    ),
  );

  if (uncommittedChanges === null) {
    const liveFiles = (turns ?? [])
      .filter((turn) => turn.running)
      .flatMap((turn) =>
        mergeAgentTurnFileRefs(
          turn.summary?.editedFiles,
          buildEditedFilesFromActivities(turn.activities),
        ),
      );

    return mergeAgentTurnFileRefs(liveFiles, groupFiles);
  }

  const merged = mergeAgentTurnFileRefs(turnFiles, groupFiles);
  const matched = merged
    .map((file) => {
      const live = findGitFlatChangeByPath(uncommittedChanges, file.path);

      if (!live) {
        return null;
      }

      return {
        path: live.path,
        ...(live.additions > 0 ? { additions: live.additions } : {}),
        ...(live.deletions > 0 ? { deletions: live.deletions } : {}),
      };
    })
    .filter((file): file is AgentTurnSummaryFileRef => file !== null);

  return mergeAgentTurnFileRefs(matched);
}

export function countAgentPaneGitChangedFiles(
  paneId: string,
  turns: AgentTurn[] | undefined,
  groups: AgentGitChangeGroup[],
  uncommittedChanges: GitFlatChange[] | null,
): number {
  return listAgentPaneGitChangedFiles(paneId, turns, groups, uncommittedChanges).length;
}

export function buildGitPromptGroupSections(options: {
  projectId: string;
  changes: GitFlatChange[];
  storedGroups: AgentGitChangeGroup[];
  tabs: TabBarItem[];
}): { sections: GitPromptGroupSection[]; otherChanges: GitFlatChange[] } {
  const sections: GitPromptGroupSection[] = [];
  let remaining = [...options.changes];

  for (const group of options.storedGroups) {
    const candidates = new Set<string>();

    for (const file of group.files) {
      addPathCandidates(candidates, file.path);
    }

    const { claimed, rest } = claimMatchingChanges(remaining, [...candidates]);
    remaining = rest;

    if (claimed.length === 0) {
      continue;
    }

    sections.push({
      group: {
        ...group,
        files: toGroupFiles(claimed),
        additions: claimed.reduce((sum, change) => sum + change.additions, 0),
        deletions: claimed.reduce((sum, change) => sum + change.deletions, 0),
      },
      changes: claimed,
    });
  }

  const usedGroupIds = new Set(sections.map((section) => section.group.id));

  for (const { paneId, turn } of collectAgentTurns(options.tabs)) {
    const prompt = resolveTurnPrompt(turn);
    const editedPaths = resolveTurnEditedPaths(turn);

    if (!prompt && editedPaths.length === 0) {
      continue;
    }

    const { claimed, rest } = claimMatchingChanges(remaining, editedPaths);
    remaining = rest;

    if (claimed.length === 0) {
      continue;
    }

    const group = createChangeGroup(
      `agent-git-turn-${turn.id}`,
      paneId,
      options.projectId,
      prompt || 'Alterações do agent',
      claimed,
      turn.completedAt ?? turn.startedAt,
    );

    if (usedGroupIds.has(group.id)) {
      continue;
    }

    usedGroupIds.add(group.id);
    sections.push({ group, changes: claimed });
  }

  const evidenceFolders = collectEvidenceFolderSections(options.projectId, remaining);
  remaining = evidenceFolders.rest;

  for (const section of evidenceFolders.sections) {
    if (usedGroupIds.has(section.group.id)) {
      remaining.push(...section.changes);
      continue;
    }

    usedGroupIds.add(section.group.id);
    sections.push(section);
  }

  return {
    sections,
    otherChanges: remaining,
  };
}
