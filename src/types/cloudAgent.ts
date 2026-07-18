export type CloudAgentTurnStatus = 'running' | 'done' | 'error';

export interface CloudAgentTurn {
  id: string;
  prompt: string;
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  status: CloudAgentTurnStatus;
  createdAt: number;
  endedAt?: number;
  commandId: string;
}

export interface CloudAgentSession {
  id: string;
  commandId: string;
  prompt: string;
  projectId: string | null;
  projectPath: string | null;
  projectName: string;
  projectColor: string;
  logoUrl: string | null;
  deviceId: string | null;
  status: CloudAgentTurnStatus;
  createdAt: number;
  turns: CloudAgentTurn[];
}
