import type { AgentTurn } from '@/types';
import type {
  Mission,
  MissionAgentNode,
  MissionQaEvidence,
  MissionQaEvidenceKind,
} from '@/types/mission';
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';
import { expandUserPath } from '@/utils/gitPaths';
import { isImageAttachmentName, isVideoAttachmentName } from '@/utils/taskLabels';

const EVIDENCE_FOLDER_RE = /(?:^|\/)((?:evidencias|evidence)[-_][\w.-]+)/i;
const PATH_IN_TEXT_RE =
  /(?:^|[\s`'"(])((?:~\/|\/)?(?:[\w.@-]+\/)*(?:evidencias|evidence)[-_][\w.\/-]+)/gi;

export function isMissionQaNode(
  node: Pick<MissionAgentNode, 'agentTemplateId' | 'roleId'>,
): boolean {
  return node.agentTemplateId === 'tpl-qa' || node.roleId === 'role-qa';
}

function basenamePath(value: string): string {
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

function resolveEvidenceAbsolutePath(rootPath: string, filePath: string): string {
  const expanded = expandUserPath(filePath.trim(), rootPath).replace(/\\/g, '/');
  if (!expanded) {
    return '';
  }
  if (expanded.startsWith('/') || /^[A-Za-z]:\//.test(expanded)) {
    return expanded;
  }
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${root}/${expanded.replace(/^\/+/, '')}`;
}

function resolveMediaKind(filePath: string): MissionQaEvidenceKind | null {
  const name = basenamePath(filePath);
  if (isImageAttachmentName(name)) {
    return 'image';
  }
  if (isVideoAttachmentName(name)) {
    return 'video';
  }
  return null;
}

function pushUnique(
  target: MissionQaEvidence[],
  seen: Set<string>,
  evidence: MissionQaEvidence,
): void {
  const key =
    evidence.kind === 'text'
      ? `text:${(evidence.content ?? evidence.title).trim().toLowerCase()}`
      : `${evidence.kind}:${(evidence.path ?? evidence.title).trim().toLowerCase()}`;
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(evidence);
}

function collectPathsFromText(value: string | undefined, target: Set<string>): void {
  if (!value) {
    return;
  }
  PATH_IN_TEXT_RE.lastIndex = 0;
  for (const match of value.matchAll(PATH_IN_TEXT_RE)) {
    const path = match[1]?.trim();
    if (path) {
      target.add(path.replace(/\\/g, '/'));
    }
  }
}

function collectTurnMediaPaths(turn: AgentTurn): string[] {
  const paths = new Set<string>();

  for (const file of [...(turn.summary?.editedFiles ?? []), ...(turn.summary?.exploredFiles ?? [])]) {
    const path = file.path?.trim();
    if (path) {
      paths.add(path.replace(/\\/g, '/'));
    }
  }

  for (const activity of turn.activities) {
    const filePath = activity.filePath?.trim();
    if (
      filePath &&
      (activity.kind === 'file_edit' ||
        activity.kind === 'file_read' ||
        EVIDENCE_FOLDER_RE.test(filePath))
    ) {
      paths.add(filePath.replace(/\\/g, '/'));
    }
    collectPathsFromText(activity.label, paths);
    collectPathsFromText(activity.toolCommand, paths);
    collectPathsFromText(activity.toolOutput, paths);
  }

  return [...paths];
}

function collectTurnTextBlocks(turn: AgentTurn): string[] {
  const blocks: string[] = [];
  const lead = turn.summary?.responseLead?.trim();
  if (lead) {
    blocks.push(lead);
  }

  for (const activity of turn.activities) {
    if (activity.kind !== 'response') {
      continue;
    }
    const text = sanitizeResponseText(activity.label).trim();
    if (!text || text === lead) {
      continue;
    }
    blocks.push(text);
  }

  return blocks;
}

export function collectMissionQaEvidences(input: {
  mission: Mission;
  node: MissionAgentNode;
  turns: AgentTurn[];
  projectPath: string;
}): MissionQaEvidence[] {
  const evidences: MissionQaEvidence[] = [];
  const seen = new Set<string>();
  const rootPath = input.node.worktreePath || input.projectPath;
  const createdAt = input.node.completedAt ?? new Date().toISOString();

  for (const discovery of input.mission.discoveries) {
    if (discovery.sourceNodeId !== input.node.id || !discovery.content.trim()) {
      continue;
    }
    pushUnique(evidences, seen, {
      id: discovery.id,
      kind: 'text',
      title: 'Descoberta',
      content: discovery.content.trim(),
      createdAt: discovery.createdAt,
    });
  }

  for (const capsule of input.mission.capsules) {
    if (capsule.sourceNodeId !== input.node.id || !capsule.content.trim()) {
      continue;
    }
    pushUnique(evidences, seen, {
      id: capsule.id,
      kind: 'text',
      title: capsule.title.trim() || 'Cápsula',
      content: capsule.content.trim(),
      createdAt: capsule.createdAt,
    });
  }

  for (const stored of input.node.evidences ?? []) {
    pushUnique(evidences, seen, stored);
  }

  const turns =
    input.turns.length > 0
      ? input.turns
      : Array.isArray(input.node.transcriptTurns)
        ? (input.node.transcriptTurns as AgentTurn[])
        : [];

  for (const turn of turns) {
    for (const [index, block] of collectTurnTextBlocks(turn).entries()) {
      pushUnique(evidences, seen, {
        id: `qa-text-${turn.id}-${index}`,
        kind: 'text',
        title: index === 0 ? 'Relatório QA' : `Relatório QA ${index + 1}`,
        content: block,
        createdAt: turn.completedAt
          ? new Date(turn.completedAt).toISOString()
          : createdAt,
      });
    }

    for (const relativePath of collectTurnMediaPaths(turn)) {
      const kind = resolveMediaKind(relativePath);
      if (!kind && !EVIDENCE_FOLDER_RE.test(relativePath)) {
        continue;
      }
      if (!kind) {
        continue;
      }
      const absolutePath = resolveEvidenceAbsolutePath(rootPath, relativePath);
      pushUnique(evidences, seen, {
        id: `qa-media-${kind}-${absolutePath}`,
        kind,
        title: basenamePath(relativePath),
        path: absolutePath,
        createdAt,
      });
    }
  }

  return evidences;
}

export async function enrichMissionQaEvidencesWithFolders(
  evidences: MissionQaEvidence[],
  rootPath: string,
): Promise<MissionQaEvidence[]> {
  if (!window.nexus?.files?.listDirectoryEntries || !rootPath) {
    return evidences;
  }

  const next = [...evidences];
  const seen = new Set(
    next.map((item) =>
      item.kind === 'text'
        ? `text:${(item.content ?? item.title).trim().toLowerCase()}`
        : `${item.kind}:${(item.path ?? item.title).trim().toLowerCase()}`,
    ),
  );

  const folderNames = new Set<string>();
  for (const item of evidences) {
    const candidates = [item.path, item.content, item.title];
    for (const value of candidates) {
      if (!value) {
        continue;
      }
      const match = value.match(EVIDENCE_FOLDER_RE);
      if (match?.[1]) {
        folderNames.add(match[1]);
      }
      PATH_IN_TEXT_RE.lastIndex = 0;
      for (const pathMatch of value.matchAll(PATH_IN_TEXT_RE)) {
        const raw = pathMatch[1]?.trim();
        if (!raw) {
          continue;
        }
        const folderMatch = raw.match(EVIDENCE_FOLDER_RE);
        if (folderMatch?.[1]) {
          folderNames.add(folderMatch[1]);
        }
      }
    }
  }

  for (const folder of folderNames) {
    const folderPath = resolveEvidenceAbsolutePath(rootPath, folder);
    try {
      const entries = await window.nexus.files.listDirectoryEntries(folderPath);
      for (const entry of entries) {
        if (entry.type !== 'file') {
          continue;
        }
        const kind = resolveMediaKind(entry.name);
        if (!kind) {
          continue;
        }
        pushUnique(next, seen, {
          id: `qa-folder-${kind}-${entry.path}`,
          kind,
          title: entry.name,
          path: entry.path,
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      // ignore missing folders
    }
  }

  return next;
}
