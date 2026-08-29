export interface AgentPipSubmitOptions {
  displayContent?: string;
  skillLabel?: string;
  forceNewTurn?: boolean;
  attachments?: Array<{
    id: string;
    label: string;
    dataUrl: string;
    relativePath?: string;
  }>;
}

export interface AgentPipProjectSlice {
  id: string;
  name: string;
  path: string;
  color: string;
  icon: string;
  logo: string | null;
  agentResponseSkills: Array<{
    id: string;
    hintId: string;
    label: string;
    command: string;
  }>;
}

export interface AgentPipSnapshot {
  kind: 'desktop' | 'cloud';
  paneId: string;
  projectId: string | null;
  projectPath: string | null;
  projectName: string;
  projectColor: string;
  projectIcon: string;
  logoDataUrl: string | null;
  busy: boolean;
  draft: string;
  revision?: number;
  contextUsage?: unknown;
  pinging?: boolean;
  tab: Record<string, unknown> | null;
  followUps: unknown[];
  cloudTurns: unknown[];
  project: AgentPipProjectSlice | null;
}

export type AgentPipCommand =
  | { type: 'submit'; paneId: string; prompt: string; options?: AgentPipSubmitOptions }
  | { type: 'stop'; paneId: string }
  | { type: 'write'; paneId: string; text: string }
  | { type: 'runCommand'; paneId: string; command: string }
  | { type: 'redo'; paneId: string; turnId: string }
  | { type: 'editTurn'; paneId: string; turnId: string }
  | { type: 'cancelEdit'; paneId: string }
  | { type: 'flushFollowUp'; paneId: string }
  | { type: 'sendFollowUpNow'; paneId: string; id: string }
  | { type: 'removeFollowUp'; paneId: string; id: string }
  | { type: 'editFollowUp'; paneId: string; id: string }
  | {
      type: 'question';
      paneId: string;
      activityId: string;
      answers: Record<string, string | string[]>;
    }
  | { type: 'acceptPlan'; paneId: string; activityId: string }
  | { type: 'rejectPlan'; paneId: string; activityId: string }
  | { type: 'ackViewed'; paneId: string };

export type AgentPipHostRequest = AgentPipCommand & {
  requestId: string;
};
