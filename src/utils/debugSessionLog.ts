type DebugSessionLogPayload = {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  runId?: string;
};

export function writeDebugSessionLog(_payload: DebugSessionLogPayload): void {}
