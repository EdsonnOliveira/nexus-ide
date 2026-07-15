import type {
  BrainAgentRun,
  BrainConcept,
  BrainDataset,
  BrainDecision,
  BrainDocument,
  BrainDocumentKind,
  BrainMapEdge,
  BrainMapNode,
  BrainMeeting,
  BrainPerson,
  BrainPrompt,
  BrainSummary,
  BrainTimelineEvent,
} from '@/components/brain/brainTypes';
import type {
  AgentTab,
  Project,
  ProjectDirectoryEntry,
} from '@/types';
import { getPanesFromItem } from '@/utils/tabGroups';
import { formatRelativeTimePt } from '@/utils/formatRelativeTimePt';
import { loadBrainManual, mergeBrainManualIntoDatasetSections } from '@/utils/brainManualStore';
import { isLocalTaskCompleted } from '@/utils/taskJson';

const STACK_KEYWORDS: Array<{ key: string; label: string }> = [
  { key: 'nestjs', label: 'NestJS' },
  { key: '@nestjs/', label: 'NestJS' },
  { key: 'next', label: 'Next.js' },
  { key: 'react', label: 'React' },
  { key: 'vue', label: 'Vue' },
  { key: 'angular', label: 'Angular' },
  { key: 'electron', label: 'Electron' },
  { key: 'express', label: 'Express' },
  { key: 'fastify', label: 'Fastify' },
  { key: 'bullmq', label: 'BullMQ' },
  { key: 'ioredis', label: 'Redis' },
  { key: 'redis', label: 'Redis' },
  { key: '@supabase/', label: 'Supabase' },
  { key: 'prisma', label: 'Prisma' },
  { key: 'drizzle-orm', label: 'Drizzle' },
  { key: 'typescript', label: 'TypeScript' },
  { key: 'vite', label: 'Vite' },
  { key: 'tailwindcss', label: 'Tailwind' },
  { key: 'zod', label: 'Zod' },
];

function createEmptyDataset(summary: BrainSummary): BrainDataset {
  return {
    summary,
    documents: [],
    meetings: [],
    decisions: [],
    prompts: [],
    agents: [],
    concepts: [],
    timeline: [],
    people: [],
    questions: [],
    memory: [],
    mapNodes: [],
    mapEdges: [],
  };
}

function truncate(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) {
    return '—';
  }

  const totalMinutes = Math.round(durationMs / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function collectAgentTabs(project: Project): AgentTab[] {
  return project.tabs
    .flatMap((item) => getPanesFromItem(item))
    .filter((pane): pane is AgentTab => pane.type === 'agent');
}

function resolveDocumentKind(fileName: string): BrainDocumentKind {
  const lower = fileName.toLowerCase();
  if (lower.includes('openapi') || lower.includes('swagger')) {
    return 'openapi';
  }
  if (lower === 'readme.md' || lower.startsWith('readme.')) {
    return 'readme';
  }
  if (lower.endsWith('.md')) {
    return 'markdown';
  }
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  return 'wiki';
}

function extractSectionBullets(markdown: string, markers: string[]): string[] {
  const lines = markdown.split(/\r?\n/);
  let capturing = false;
  const bullets: string[] = [];

  for (const line of lines) {
    const heading = line.replace(/^#+\s*/, '').trim().toLowerCase();
    if (markers.some((marker) => heading === marker.toLowerCase() || heading.startsWith(`${marker.toLowerCase()} `))) {
      capturing = true;
      continue;
    }

    if (capturing && /^#{1,3}\s+\S/.test(line)) {
      break;
    }

    if (!capturing) {
      continue;
    }

    const bullet = line.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim();
    if (bullet && bullet !== line.trim()) {
      bullets.push(bullet);
    } else if (bullet && capturing && line.trim().length > 0 && !line.startsWith('#')) {
      if (/^[-*•]/.test(line) || /^\d+\./.test(line)) {
        bullets.push(bullet);
      }
    }
  }

  return bullets.slice(0, 12);
}

function extractSummaryFromConclusion(conclusion: string | null): string {
  if (!conclusion?.trim()) {
    return 'Sem resumo gerado.';
  }

  const markers = ['## Resumo', '## Summary', 'Resumo', 'Summary'];
  const lines = conclusion.split(/\r?\n/);
  let capturing = false;
  const chunks: string[] = [];

  for (const line of lines) {
    const heading = line.replace(/^#+\s*/, '').trim().toLowerCase();
    if (markers.some((marker) => heading === marker.toLowerCase())) {
      capturing = true;
      continue;
    }
    if (capturing && /^#{1,3}\s+\S/.test(line)) {
      break;
    }
    if (capturing && line.trim()) {
      chunks.push(line.trim());
    }
  }

  if (chunks.length > 0) {
    return truncate(chunks.join(' '), 280);
  }

  return truncate(conclusion, 280);
}

async function loadPackageStack(projectPath: string): Promise<string[]> {
  try {
    const result = await window.nexus.files.readTextFile(`${projectPath}/package.json`);
    if (!result.ok) {
      return [];
    }

    const parsed = JSON.parse(result.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
    };
    const found = new Set<string>();

    STACK_KEYWORDS.forEach(({ key, label }) => {
      if (Object.keys(deps).some((dep) => dep === key || dep.startsWith(key))) {
        found.add(label);
      }
    });

    return Array.from(found).slice(0, 10);
  } catch {
    return [];
  }
}

async function discoverDocuments(projectPath: string): Promise<BrainDocument[]> {
  const documents: BrainDocument[] = [];
  const seen = new Set<string>();

  const consider = async (entry: { name: string; path: string; type: string }) => {
    if (entry.type !== 'file' || seen.has(entry.path)) {
      return;
    }

    const lower = entry.name.toLowerCase();
    const isDoc =
      lower.endsWith('.md') ||
      lower.endsWith('.mdx') ||
      lower.includes('openapi') ||
      lower.includes('swagger') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml');

    if (!isDoc) {
      return;
    }

    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
      if (!lower.includes('openapi') && !lower.includes('swagger')) {
        return;
      }
    }

    seen.add(entry.path);
    let summary = 'Documento do repositório.';

    try {
      const file = await window.nexus.files.readTextFile(entry.path);
      if (file.ok) {
        summary = truncate(file.content.replace(/^#+\s+/gm, ''), 220) || summary;
      }
    } catch {
      /* ignore */
    }

    const relative = entry.path.startsWith(projectPath)
      ? entry.path.slice(projectPath.length).replace(/^[\\/]/, '')
      : entry.name;

    documents.push({
      id: `doc:${entry.path}`,
      name: entry.name,
      kind: resolveDocumentKind(entry.name),
      origin: 'repositório',
      status: 'indexed',
      tags: [resolveDocumentKind(entry.name)],
      aiSummary: summary,
      related: [],
      updatedAtLabel: 'no projeto',
      relatedFiles: [relative],
      relatedDecisions: [],
      relatedMeetings: [],
      relatedIssues: [],
      agentsModified: [],
      lastChangeLabel: 'no disco do projeto',
    });
  };

  try {
    const rootEntries = await window.nexus.files.listDirectoryEntries(projectPath);
    await Promise.all(rootEntries.slice(0, 80).map((entry) => consider(entry)));

    const docsDir = rootEntries.find(
      (entry) => entry.type === 'directory' && ['docs', 'doc', 'documentation'].includes(entry.name.toLowerCase()),
    );

    if (docsDir) {
      const nested = await window.nexus.files.listDirectoryEntries(docsDir.path);
      await Promise.all(nested.slice(0, 60).map((entry) => consider(entry)));
    }
  } catch {
    /* ignore */
  }

  try {
    const tree = await window.nexus.files.searchProjectTree(projectPath, 'README', {
      matchCase: false,
      matchWholeWord: false,
      useRegex: false,
    });

    const flatten = (nodes: Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>) => {
      nodes.forEach((node) => {
        void consider(node);
        if (node.children) {
          flatten(node.children as Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>);
        }
      });
    };

    flatten(tree as Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>);
  } catch {
    /* ignore */
  }

  return documents.slice(0, 40);
}

function buildPromptsAndAgents(project: Project): {
  prompts: BrainPrompt[];
  agents: BrainAgentRun[];
  timeline: BrainTimelineEvent[];
} {
  const agentTabs = collectAgentTabs(project);
  const prompts: BrainPrompt[] = [];
  const agents: BrainAgentRun[] = [];
  const timeline: BrainTimelineEvent[] = [];

  agentTabs.forEach((tab) => {
    const completedTurns = tab.turns.filter((turn) => !turn.running);
    const latest = completedTurns[completedTurns.length - 1] ?? tab.turns[tab.turns.length - 1];
    const fileCount = completedTurns.reduce(
      (sum, turn) => sum + (turn.summary?.editedFiles?.length ?? turn.summary?.editedFileCount ?? 0),
      0,
    );

    agents.push({
      id: `agent:${tab.id}`,
      name: tab.title,
      mission: latest?.user.content?.trim()
        ? truncate(latest.user.content, 140)
        : 'Sessão de agente do projeto',
      result: latest?.running ? 'Em andamento' : completedTurns.length > 0 ? 'Concluído' : 'Sem execuções',
      fileCount,
      durationLabel:
        latest?.completedAt && latest.startedAt
          ? formatDuration(latest.completedAt - latest.startedAt)
          : '—',
      costLabel: '—',
      model: tab.cliAgent || 'Agent',
      summary: latest?.summary?.responseLead
        ? truncate(latest.summary.responseLead, 220)
        : `${completedTurns.length} turnos nesta aba`,
    });

    completedTurns.slice(-20).forEach((turn) => {
      const created = [
        ...(turn.summary?.editedFiles?.map((file) => file.path) ?? []),
        ...(turn.summary?.commands?.map((command) => command.command) ?? []),
      ].slice(0, 6);

      prompts.push({
        id: `prompt:${tab.id}:${turn.id}`,
        title: truncate(turn.user.content || 'Prompt', 100),
        result: turn.summary?.responseLead
          ? truncate(turn.summary.responseLead, 160)
          : `${turn.summary?.editedFileCount ?? turn.summary?.editedFiles?.length ?? 0} arquivos editados`,
        created,
        related: turn.summary?.exploredFiles?.map((file) => file.path).slice(0, 4) ?? [],
        agentName: tab.title,
        updatedAtLabel: formatRelativeTimePt(turn.completedAt ?? turn.startedAt),
      });

      timeline.push({
        id: `tl-prompt:${tab.id}:${turn.id}`,
        dateLabel: formatRelativeTimePt(turn.completedAt ?? turn.startedAt),
        title: truncate(turn.user.content || tab.title, 80),
        description: turn.summary?.responseLead
          ? truncate(turn.summary.responseLead, 160)
          : `Execução em ${tab.title}`,
        relatedIds: [`agent:${tab.id}`],
      });
    });
  });

  (project.agentGitGroups ?? []).forEach((group) => {
    timeline.push({
      id: `tl-git:${group.id}`,
      dateLabel: formatRelativeTimePt(group.completedAt),
      title: truncate(group.prompt || 'Alterações do agente', 80),
      description: `${group.files.length} arquivos · +${group.additions}/-${group.deletions}`,
      relatedIds: group.files.map((file) => file.path).slice(0, 4),
    });

    if (!prompts.some((prompt) => prompt.title === truncate(group.prompt, 100))) {
      prompts.push({
        id: `prompt-git:${group.id}`,
        title: truncate(group.prompt || 'Prompt com alterações', 100),
        result: `${group.files.length} arquivos alterados`,
        created: group.files.map((file) => file.path).slice(0, 6),
        related: [],
        agentName: 'Agent',
        updatedAtLabel: formatRelativeTimePt(group.completedAt),
      });
    }
  });

  prompts.sort((left, right) => right.updatedAtLabel.localeCompare(left.updatedAtLabel));

  return {
    prompts: prompts.slice(0, 50),
    agents,
    timeline: timeline.slice(0, 40),
  };
}

async function loadMeetingsAndDerivatives(
  projectName: string,
  linkedTranscriptionIds: string[],
): Promise<{
  meetings: BrainMeeting[];
  decisions: BrainDecision[];
  people: BrainPerson[];
}> {
  if (!window.nexus?.macParakeet || linkedTranscriptionIds.length === 0) {
    return { meetings: [], decisions: [], people: [] };
  }

  try {
    const snapshot = await window.nexus.macParakeet.getTranscriptions(null, false).catch(() => null);
    const listedById = new Map(
      (snapshot?.transcriptions ?? []).map((item) => [item.id, item] as const),
    );

    const details = await Promise.all(
      linkedTranscriptionIds.map(async (id) => {
        try {
          return await window.nexus.macParakeet.getTranscriptionDetail(id);
        } catch {
          return null;
        }
      }),
    );

    const meetings: BrainMeeting[] = [];
    const decisions: BrainDecision[] = [];
    const peopleMap = new Map<string, BrainPerson>();

    linkedTranscriptionIds.forEach((id, index) => {
      const detail = details[index];
      const listed = listedById.get(id) ?? null;
      const source = detail ?? listed;
      if (!source) {
        return;
      }

      const conclusion = detail?.conclusion ?? null;
      const segments = detail?.segments ?? [];
      const decisionBullets = conclusion
        ? extractSectionBullets(conclusion, ['Decisões', 'Decisions'])
        : [];
      const taskBullets = conclusion
        ? extractSectionBullets(conclusion, ['Próximos passos', 'Itens de ação', 'Action Items'])
        : [];

      meetings.push({
        id: `meet:${source.id}`,
        title: source.title || 'Reunião',
        summary:
          extractSummaryFromConclusion(conclusion) || truncate(source.snippet || 'Sem resumo', 220),
        participants: Array.from(
          new Set(
            segments
              .map((segment) => segment.speakerLabel)
              .filter((label): label is string => Boolean(label)),
          ),
        ),
        transcriptPreview: truncate(detail?.transcript || source.snippet || '', 320),
        insights: taskBullets.slice(0, 4),
        decisions: decisionBullets,
        tasks: taskBullets,
        mentionedFiles: [],
        mentionedProjects: projectName.trim() ? [projectName] : [],
        durationLabel: formatDuration(source.durationMs),
        sentiment: source.sourceType === 'interview' ? 'Entrevista' : 'Chamada',
        openQuestions: segments
          .filter((segment) => segment.isQuestion && segment.question)
          .map((segment) => segment.question as string)
          .slice(0, 6),
      });

      decisionBullets.forEach((bullet, bulletIndex) => {
        decisions.push({
          id: `dec:${source.id}:${bulletIndex}`,
          title: truncate(bullet, 100),
          status: 'accepted',
          reason: `Extraído da reunião “${source.title}”`,
          context: extractSummaryFromConclusion(conclusion),
          alternatives: [],
          chosen: truncate(bullet, 100),
          decidedBy: Array.from(
            new Set(
              segments
                .map((segment) => segment.speakerLabel)
                .filter((label): label is string => Boolean(label)),
            ),
          ),
          decidedAtLabel: formatRelativeTimePt(source.createdAt),
          impact: [],
          relatedFiles: [],
          relatedPr: null,
          relatedIssue: null,
          relatedMeeting: source.title,
          relatedDocs: [],
        });
      });

      segments.forEach((segment) => {
        const name = segment.speakerLabel?.trim();
        if (!name) {
          return;
        }

        const existing = peopleMap.get(name) ?? {
          id: `person:${name}`,
          name,
          specialties: [],
          meetings: [],
          decisions: [],
          prs: [],
          documents: [],
          comments: [],
          agents: [],
        };

        if (!existing.meetings.includes(source.title)) {
          existing.meetings.push(source.title);
        }

        decisionBullets.forEach((bullet) => {
          if (!existing.decisions.includes(bullet)) {
            existing.decisions.push(bullet);
          }
        });

        if (segment.content) {
          existing.comments = [...existing.comments, truncate(segment.content, 120)].slice(0, 8);
        }

        peopleMap.set(name, existing);
      });
    });

    return {
      meetings,
      decisions,
      people: Array.from(peopleMap.values()),
    };
  } catch {
    return { meetings: [], decisions: [], people: [] };
  }
}


function buildConceptsFromFiles(
  documents: BrainDocument[],
  prompts: BrainPrompt[],
  agents: BrainAgentRun[],
): BrainConcept[] {
  const bucket = new Map<string, BrainConcept>();

  const ingest = (pathOrName: string, kind: 'documents' | 'files' | 'prompts' | 'agents') => {
    const base = pathOrName.split(/[\\/]/).filter(Boolean);
    const folder = base.length > 1 ? base[0] : base[0]?.replace(/\.[^.]+$/, '');
    if (!folder || folder.startsWith('.')) {
      return;
    }

    const id = `concept:${folder.toLowerCase()}`;
    const current =
      bucket.get(id) ??
      ({
        id,
        name: folder,
        summary: `Área “${folder}” referida no projeto`,
        files: [],
        documents: [],
        meetings: [],
        decisions: [],
        issues: [],
        prompts: [],
        agents: [],
        faqs: [],
      } satisfies BrainConcept);

    if (kind === 'documents' && !current.documents.includes(pathOrName)) {
      current.documents.push(pathOrName);
    }
    if (kind === 'files' && !current.files.includes(pathOrName)) {
      current.files.push(pathOrName);
    }
    if (kind === 'prompts' && !current.prompts.includes(pathOrName)) {
      current.prompts.push(pathOrName);
    }
    if (kind === 'agents' && !current.agents.includes(pathOrName)) {
      current.agents.push(pathOrName);
    }

    bucket.set(id, current);
  };

  documents.forEach((doc) => ingest(doc.name, 'documents'));
  prompts.forEach((prompt) => {
    prompt.created.forEach((file) => ingest(file, 'files'));
    ingest(prompt.title, 'prompts');
  });
  agents.forEach((agent) => ingest(agent.name, 'agents'));

  return Array.from(bucket.values()).slice(0, 24);
}

function buildMapGraph(dataset: Omit<BrainDataset, 'mapNodes' | 'mapEdges'>): {
  mapNodes: BrainMapNode[];
  mapEdges: BrainMapEdge[];
} {
  const mapNodes: BrainMapNode[] = [];
  const mapEdges: BrainMapEdge[] = [];

  dataset.documents.slice(0, 20).forEach((doc) => {
    mapNodes.push({
      id: doc.id,
      label: doc.name,
      kind: 'document',
      communityId: 'documents',
      communityLabel: 'Documentos',
    });
  });

  dataset.meetings.slice(0, 12).forEach((meeting) => {
    mapNodes.push({
      id: meeting.id,
      label: meeting.title,
      kind: 'meeting',
      communityId: 'meetings',
      communityLabel: 'Reuniões',
    });
  });

  dataset.decisions.slice(0, 12).forEach((decision) => {
    mapNodes.push({
      id: decision.id,
      label: decision.title,
      kind: 'decision',
      communityId: 'decisions',
      communityLabel: 'Decisões',
    });
    if (decision.relatedMeeting) {
      const meeting = dataset.meetings.find((item) => item.title === decision.relatedMeeting);
      if (meeting) {
        mapEdges.push({
          id: `edge:${decision.id}:${meeting.id}`,
          sourceId: decision.id,
          targetId: meeting.id,
        });
      }
    }
  });

  dataset.prompts.slice(0, 16).forEach((prompt) => {
    mapNodes.push({
      id: prompt.id,
      label: truncate(prompt.title, 28),
      kind: 'prompt',
      communityId: 'prompts',
      communityLabel: 'Prompts',
    });
  });

  dataset.agents.slice(0, 12).forEach((agent) => {
    mapNodes.push({
      id: agent.id,
      label: agent.name,
      kind: 'agent',
      communityId: 'agents',
      communityLabel: 'Agentes',
    });
  });

  dataset.concepts.slice(0, 16).forEach((concept) => {
    mapNodes.push({
      id: concept.id,
      label: concept.name,
      kind: 'concept',
      communityId: 'concepts',
      communityLabel: 'Conceitos',
    });
  });

  const fileIds = new Set<string>();
  dataset.prompts.forEach((prompt) => {
    prompt.created.slice(0, 3).forEach((filePath) => {
      const id = `file:${filePath}`;
      if (!fileIds.has(id)) {
        fileIds.add(id);
        mapNodes.push({
          id,
          label: filePath.split(/[\\/]/).pop() ?? filePath,
          kind: 'file',
          communityId: 'files',
          communityLabel: 'Arquivos',
        });
      }
      mapEdges.push({
        id: `edge:${prompt.id}:${id}`,
        sourceId: prompt.id,
        targetId: id,
      });
    });
  });

  dataset.agents.forEach((agent) => {
    dataset.prompts
      .filter((prompt) => prompt.agentName === agent.name)
      .slice(0, 4)
      .forEach((prompt) => {
        mapEdges.push({
          id: `edge:${agent.id}:${prompt.id}`,
          sourceId: agent.id,
          targetId: prompt.id,
        });
      });
  });

  return { mapNodes, mapEdges };
}

export async function buildBrainDataset(
  project: Project,
  relatedProjectNames: string[],
): Promise<BrainDataset> {
  const now = Date.now();
  const tasks = project.tasks ?? [];
  const openTasks = tasks.filter((task) => !isLocalTaskCompleted(task));
  const doneTasks = tasks.filter((task) => isLocalTaskCompleted(task));
  const progress =
    tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  const [stack, documents, manual] = await Promise.all([
    loadPackageStack(project.path),
    discoverDocuments(project.path),
    loadBrainManual(project.path),
  ]);

  const meetingBundle = await loadMeetingsAndDerivatives(
    project.name,
    manual.linkedTranscriptionIds,
  );

  const { prompts, agents, timeline: agentTimeline } = buildPromptsAndAgents(project);

  const concepts = buildConceptsFromFiles(documents, prompts, agents);

  const taskTimeline: BrainTimelineEvent[] = openTasks.slice(0, 10).map((task) => ({
    id: `tl-task:${task.id}`,
    dateLabel: formatRelativeTimePt(task.updatedAt, now),
    title: task.title,
    description: truncate(task.description || task.status || 'Tarefa do projeto', 160),
    relatedIds: [],
  }));

  const timeline = [...agentTimeline, ...taskTimeline]
    .sort((left, right) => right.dateLabel.localeCompare(left.dateLabel))
    .slice(0, 50);

  const mergedSections = mergeBrainManualIntoDatasetSections(
    {
      documents,
      meetings: meetingBundle.meetings,
      decisions: meetingBundle.decisions,
      prompts,
      agents,
      concepts,
      people: meetingBundle.people,
      questions: [] as BrainDataset['questions'],
      memory: [] as BrainDataset['memory'],
    },
    manual,
  );

  const manualTimeline: BrainTimelineEvent[] = [
    ...mergedSections.documents
      .filter((item) => item.id.startsWith('manual:'))
      .map((item) => ({
        id: `tl:${item.id}`,
        dateLabel: item.updatedAtLabel,
        title: item.name,
        description: truncate(item.aiSummary || 'Documento adicionado ao Cérebro', 160),
        relatedIds: [item.id],
      })),
    ...mergedSections.meetings
      .filter((item) => item.id.startsWith('manual:'))
      .map((item) => ({
        id: `tl:${item.id}`,
        dateLabel: 'manual',
        title: item.title,
        description: truncate(item.summary || 'Reunião adicionada ao Cérebro', 160),
        relatedIds: [item.id],
      })),
    ...mergedSections.decisions
      .filter((item) => item.id.startsWith('manual:'))
      .map((item) => ({
        id: `tl:${item.id}`,
        dateLabel: item.decidedAtLabel,
        title: item.title,
        description: truncate(item.reason || 'Decisão adicionada ao Cérebro', 160),
        relatedIds: [item.id],
      })),
  ];

  const mergedTimeline = [...manualTimeline, ...timeline].slice(0, 50);

  let lastActivity = now;
  const activityCandidates = [
    ...mergedSections.prompts.map(() => now),
    ...(project.agentGitGroups ?? []).map((group) => group.completedAt),
    ...tasks.map((task) => task.updatedAt),
    ...mergedSections.meetings.map((meeting) => {
      const match = meeting.id.replace('meet:', '');
      return Number.isFinite(Number(match)) ? Number(match) : now;
    }),
  ];

  collectAgentTabs(project).forEach((tab) => {
    tab.turns.forEach((turn) => {
      activityCandidates.push(turn.completedAt ?? turn.startedAt);
    });
  });

  if (activityCandidates.length > 0) {
    lastActivity = Math.max(...activityCandidates);
  }

  const kinds = await window.nexus.files.detectProjectKinds([project.path]).catch(
    (): Record<string, string | null> => ({}),
  );
  const kindLabel = kinds[project.path] ?? null;

  const summary: BrainSummary = {
    projectName: project.name,
    objective: kindLabel
      ? `Projeto ${kindLabel} em ${project.path}`
      : `Workspace local em ${project.path}`,
    statusLabel:
      tasks.length > 0 ? `${doneTasks.length}/${tasks.length} tarefas concluídas` : 'Projeto ativo',
    statusProgress: progress,
    lastUpdatedLabel: formatRelativeTimePt(lastActivity, now),
    summary:
      mergedSections.agents.length > 0 ||
      mergedSections.documents.length > 0 ||
      mergedSections.meetings.length > 0 ||
      mergedSections.questions.length > 0 ||
      mergedSections.memory.length > 0
        ? [
            mergedSections.documents.length > 0
              ? `${mergedSections.documents.length} documentos no Cérebro`
              : null,
            mergedSections.agents.length > 0
              ? `${mergedSections.agents.length} abas de agente`
              : null,
            mergedSections.prompts.length > 0
              ? `${mergedSections.prompts.length} prompts`
              : null,
            mergedSections.meetings.length > 0
              ? `${mergedSections.meetings.length} reuniões`
              : null,
            mergedSections.decisions.length > 0
              ? `${mergedSections.decisions.length} decisões`
              : null,
            openTasks.length > 0 ? `${openTasks.length} tarefas em aberto` : null,
          ]
            .filter(Boolean)
            .join('. ') + '.'
        : 'Ainda não há conhecimento consolidado neste projeto. Use o botão Adicionar ou agents, documentos e reuniões para alimentar o Cérebro.',
    nextPriorities: openTasks.slice(0, 8).map((task) => task.title),
    stack,
    team: mergedSections.people.map((person) => person.name).slice(0, 12),
    relatedProjects: relatedProjectNames,
  };

  const partial = {
    summary,
    ...mergedSections,
    timeline: mergedTimeline,
  };

  const { mapNodes, mapEdges } = buildMapGraph(partial);

  return {
    ...partial,
    mapNodes,
    mapEdges,
  };
}

export function createIdleBrainDataset(projectName: string): BrainDataset {
  return createEmptyDataset({
    projectName,
    objective: 'Carregando conhecimento do projeto…',
    statusLabel: 'Carregando',
    statusProgress: 0,
    lastUpdatedLabel: 'agora',
    summary: 'Coletando dados reais do projeto.',
    nextPriorities: [],
    stack: [],
    team: [],
    relatedProjects: [],
  });
}
