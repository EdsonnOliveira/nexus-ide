export type BrainKnowledgeTabId =
  | 'summary'
  | 'documents'
  | 'meetings'
  | 'decisions'
  | 'prompts'
  | 'agents'
  | 'concepts'
  | 'timeline'
  | 'people'
  | 'questions'
  | 'memory'
  | 'map';

export type BrainDocumentKind =
  | 'markdown'
  | 'pdf'
  | 'openapi'
  | 'notion'
  | 'figma'
  | 'word'
  | 'wiki'
  | 'readme';

export type BrainDocumentStatus = 'indexed' | 'syncing' | 'outdated' | 'draft';

export type BrainDecisionStatus = 'accepted' | 'proposed' | 'superseded' | 'rejected';

export type BrainMapNodeKind =
  | 'concept'
  | 'document'
  | 'meeting'
  | 'decision'
  | 'prompt'
  | 'agent'
  | 'file';

export interface BrainSummary {
  projectName: string;
  objective: string;
  statusLabel: string;
  statusProgress: number;
  lastUpdatedLabel: string;
  summary: string;
  nextPriorities: string[];
  stack: string[];
  team: string[];
  relatedProjects: string[];
}

export interface BrainDocument {
  id: string;
  name: string;
  kind: BrainDocumentKind;
  origin: string;
  status: BrainDocumentStatus;
  tags: string[];
  aiSummary: string;
  related: string[];
  updatedAtLabel: string;
  relatedFiles: string[];
  relatedDecisions: string[];
  relatedMeetings: string[];
  relatedIssues: string[];
  agentsModified: string[];
  lastChangeLabel: string;
}

export interface BrainMeeting {
  id: string;
  title: string;
  summary: string;
  participants: string[];
  transcriptPreview: string;
  insights: string[];
  decisions: string[];
  tasks: string[];
  mentionedFiles: string[];
  mentionedProjects: string[];
  durationLabel: string;
  sentiment: string;
  openQuestions: string[];
}

export interface BrainDecision {
  id: string;
  title: string;
  status: BrainDecisionStatus;
  reason: string;
  context: string;
  alternatives: string[];
  chosen: string;
  decidedBy: string[];
  decidedAtLabel: string;
  impact: string[];
  relatedFiles: string[];
  relatedPr: string | null;
  relatedIssue: string | null;
  relatedMeeting: string | null;
  relatedDocs: string[];
}

export interface BrainPrompt {
  id: string;
  title: string;
  result: string;
  created: string[];
  related: string[];
  agentName: string;
  updatedAtLabel: string;
}

export interface BrainAgentRun {
  id: string;
  name: string;
  mission: string;
  result: string;
  fileCount: number;
  durationLabel: string;
  costLabel: string;
  model: string;
  summary: string;
}

export interface BrainConcept {
  id: string;
  name: string;
  summary: string;
  files: string[];
  documents: string[];
  meetings: string[];
  decisions: string[];
  issues: string[];
  prompts: string[];
  agents: string[];
  faqs: string[];
}

export interface BrainTimelineEvent {
  id: string;
  dateLabel: string;
  title: string;
  description: string;
  relatedIds: string[];
}

export interface BrainPerson {
  id: string;
  name: string;
  specialties: string[];
  meetings: string[];
  decisions: string[];
  prs: string[];
  documents: string[];
  comments: string[];
  agents: string[];
}

export interface BrainQuestion {
  id: string;
  question: string;
  answer: string;
  related: string[];
}

export interface BrainMemoryFact {
  id: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  origins: string[];
  lastConfirmedLabel: string;
}

export interface BrainMapNode {
  id: string;
  label: string;
  kind: BrainMapNodeKind;
  communityId: string;
  communityLabel: string;
  x?: number;
  y?: number;
}

export interface BrainMapEdge {
  id: string;
  sourceId: string;
  targetId: string;
}

export interface BrainMapCommunity {
  id: string;
  label: string;
  color: string;
  count: number;
}


export interface BrainSearchHit {
  id: string;
  kind: BrainMapNodeKind | 'person' | 'question' | 'memory';
  title: string;
  subtitle: string;
  tabId: BrainKnowledgeTabId;
}

export interface BrainDataset {
  summary: BrainSummary;
  documents: BrainDocument[];
  meetings: BrainMeeting[];
  decisions: BrainDecision[];
  prompts: BrainPrompt[];
  agents: BrainAgentRun[];
  concepts: BrainConcept[];
  timeline: BrainTimelineEvent[];
  people: BrainPerson[];
  questions: BrainQuestion[];
  memory: BrainMemoryFact[];
  mapNodes: BrainMapNode[];
  mapEdges: BrainMapEdge[];
}
