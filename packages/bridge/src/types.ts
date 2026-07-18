import type {
  CloudProject,
  CloudWorkspace,
  CommandApproval,
  DeviceRecord,
  NexusCommand,
  RuntimeStatus,
  Unsubscribe,
} from '@nexus/protocol';

export interface NexusBridge {
  executeCommand(command: NexusCommand): Promise<string>;
  subscribeToExecution(id: string, onEvent: (payload: unknown) => void): Unsubscribe;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  listDevices(): Promise<DeviceRecord[]>;
  listWorkspaces(): Promise<CloudWorkspace[]>;
  listProjects(workspaceId?: string | null): Promise<CloudProject[]>;
  listApprovals(): Promise<CommandApproval[]>;
  decideApproval(approvalId: string, status: 'approved' | 'denied'): Promise<void>;
  requestLocalSync(deviceId: string): Promise<string>;
  createDevicePairing(
    name: string,
    workspaceId?: string | null,
  ): Promise<{ code: string; expires_at: string; name: string }>;
  listPendingPairings(): Promise<
    Array<{ id: string; code: string; name: string; expires_at: string; status: string }>
  >;
  openLocalFolder?(): Promise<string | null>;
  getWorkspaceId(): Promise<string | null>;
}
