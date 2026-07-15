import type {
  BrainAgentRun,
  BrainConcept,
  BrainDecision,
  BrainDocument,
  BrainMeeting,
  BrainMemoryFact,
  BrainPerson,
  BrainPrompt,
  BrainQuestion,
  BrainKnowledgeTabId,
} from '@/components/brain/brainTypes';
import { resolveBrainManualPath } from '@/utils/brainManualPath';

export type BrainManualEditableTabId = Exclude<
  BrainKnowledgeTabId,
  'summary' | 'timeline' | 'map'
>;

export interface BrainManualStore {
  version: 1;
  linkedTranscriptionIds: string[];
  documents: BrainDocument[];
  meetings: BrainMeeting[];
  decisions: BrainDecision[];
  prompts: BrainPrompt[];
  agents: BrainAgentRun[];
  concepts: BrainConcept[];
  people: BrainPerson[];
  questions: BrainQuestion[];
  memory: BrainMemoryFact[];
}

export const EMPTY_BRAIN_MANUAL_STORE: BrainManualStore = {
  version: 1,
  linkedTranscriptionIds: [],
  documents: [],
  meetings: [],
  decisions: [],
  prompts: [],
  agents: [],
  concepts: [],
  people: [],
  questions: [],
  memory: [],
};

export const BRAIN_MANUAL_EDITABLE_TABS: BrainManualEditableTabId[] = [
  'documents',
  'meetings',
  'decisions',
  'prompts',
  'agents',
  'concepts',
  'people',
  'questions',
  'memory',
];

export function isBrainManualEditableTab(
  tabId: BrainKnowledgeTabId,
): tabId is BrainManualEditableTabId {
  return BRAIN_MANUAL_EDITABLE_TABS.includes(tabId as BrainManualEditableTabId);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function normalizeBrainManualStore(value: unknown): BrainManualStore {
  if (!isObject(value)) {
    return { ...EMPTY_BRAIN_MANUAL_STORE };
  }

  return {
    version: 1,
    linkedTranscriptionIds: asStringArray(value.linkedTranscriptionIds),
    documents: asArray<BrainDocument>(value.documents),
    meetings: asArray<BrainMeeting>(value.meetings),
    decisions: asArray<BrainDecision>(value.decisions),
    prompts: asArray<BrainPrompt>(value.prompts),
    agents: asArray<BrainAgentRun>(value.agents),
    concepts: asArray<BrainConcept>(value.concepts),
    people: asArray<BrainPerson>(value.people),
    questions: asArray<BrainQuestion>(value.questions),
    memory: asArray<BrainMemoryFact>(value.memory),
  };
}

export async function loadBrainManual(projectPath: string): Promise<BrainManualStore> {
  try {
    const result = await window.nexus.files.readTextFile(resolveBrainManualPath(projectPath));
    if (!result.ok) {
      return { ...EMPTY_BRAIN_MANUAL_STORE };
    }

    return normalizeBrainManualStore(JSON.parse(result.content) as unknown);
  } catch {
    return { ...EMPTY_BRAIN_MANUAL_STORE };
  }
}

export async function saveBrainManual(
  projectPath: string,
  store: BrainManualStore,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const rootPath = projectPath.replace(/[\\/]+$/, '');
    const payload: BrainManualStore = {
      ...store,
      version: 1,
      linkedTranscriptionIds: Array.from(new Set(store.linkedTranscriptionIds)),
    };
    const filePath = resolveBrainManualPath(rootPath);
    const content = `${JSON.stringify(payload, null, 2)}\n`;

    let written = await window.nexus.files.writeTextFile(filePath, content);

    if (!written?.ok) {
      await window.nexus.files.createDirectory(rootPath, '.nexus');
      await window.nexus.files.createDirectory(`${rootPath}/.nexus`, 'brain');
      const existing = await window.nexus.files.readTextFile(filePath);
      if (!existing.ok) {
        await window.nexus.files.createEmptyFile(`${rootPath}/.nexus/brain`, 'manual.json');
      }
      written = await window.nexus.files.writeTextFile(filePath, content);
    }

    if (!written?.ok) {
      return {
        ok: false,
        error: written?.error || 'Não foi possível salvar o Cérebro',
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível salvar o Cérebro' };
  }
}

function mergeById<T extends { id: string }>(autoItems: T[], manualItems: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of [...manualItems, ...autoItems]) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  return result;
}

export function mergeBrainManualIntoDatasetSections<
  T extends {
    documents: BrainDocument[];
    meetings: BrainMeeting[];
    decisions: BrainDecision[];
    prompts: BrainPrompt[];
    agents: BrainAgentRun[];
    concepts: BrainConcept[];
    people: BrainPerson[];
    questions: BrainQuestion[];
    memory: BrainMemoryFact[];
  },
>(sections: T, manual: BrainManualStore): T {
  return {
    ...sections,
    documents: mergeById(sections.documents, manual.documents),
    meetings: mergeById(sections.meetings, manual.meetings),
    decisions: mergeById(sections.decisions, manual.decisions),
    prompts: mergeById(sections.prompts, manual.prompts),
    agents: mergeById(sections.agents, manual.agents),
    concepts: mergeById(sections.concepts, manual.concepts),
    people: mergeById(sections.people, manual.people),
    questions: mergeById(sections.questions, manual.questions),
    memory: mergeById(sections.memory, manual.memory),
  };
}

export async function appendBrainManualItem(
  projectPath: string,
  tabId: BrainManualEditableTabId,
  item:
    | BrainDocument
    | BrainMeeting
    | BrainDecision
    | BrainPrompt
    | BrainAgentRun
    | BrainConcept
    | BrainPerson
    | BrainQuestion
    | BrainMemoryFact,
): Promise<{ ok: true; store: BrainManualStore } | { ok: false; error: string }> {
  const store = await loadBrainManual(projectPath);
  const next: BrainManualStore = {
    ...store,
    [tabId]: [...store[tabId], item],
  };

  const saved = await saveBrainManual(projectPath, next);
  if (!saved.ok) {
    return saved;
  }

  return { ok: true, store: next };
}

export async function saveBrainLinkedTranscriptionIds(
  projectPath: string,
  linkedTranscriptionIds: string[],
): Promise<{ ok: true; store: BrainManualStore } | { ok: false; error: string }> {
  const store = await loadBrainManual(projectPath);
  const next: BrainManualStore = {
    ...store,
    linkedTranscriptionIds: Array.from(new Set(linkedTranscriptionIds)),
  };
  const saved = await saveBrainManual(projectPath, next);
  if (!saved.ok) {
    return saved;
  }

  return { ok: true, store: next };
}

function fileNameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function resolveManualDocumentKind(fileName: string): BrainDocument['kind'] {
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
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    return 'word';
  }
  return 'wiki';
}

export async function addBrainManualDocumentFromPicker(
  projectPath: string,
): Promise<
  | { ok: true; cancelled: true }
  | { ok: true; cancelled: false; store: BrainManualStore }
  | { ok: false; error: string }
> {
  const sourcePath = await window.nexus.dialog.openFile();
  if (!sourcePath) {
    return { ok: true, cancelled: true };
  }

  const name = fileNameFromPath(sourcePath);
  const item: BrainDocument = {
    id: `manual:${crypto.randomUUID()}`,
    name,
    kind: resolveManualDocumentKind(name),
    origin: sourcePath,
    status: 'indexed',
    tags: [],
    aiSummary: '',
    related: [],
    updatedAtLabel: 'agora',
    relatedFiles: [sourcePath],
    relatedDecisions: [],
    relatedMeetings: [],
    relatedIssues: [],
    agentsModified: [],
    lastChangeLabel: 'agora',
  };

  const saved = await appendBrainManualItem(projectPath, 'documents', item);
  if (!saved.ok) {
    return saved;
  }

  return { ok: true, cancelled: false, store: saved.store };
}
