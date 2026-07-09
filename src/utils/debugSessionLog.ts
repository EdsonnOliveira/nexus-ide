type DebugSessionLogPayload = {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  runId?: string;
};

export function writeDebugSessionLog(payload: DebugSessionLogPayload): void {
  window.nexus.debug.sessionLog(payload);
}
