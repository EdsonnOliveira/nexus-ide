type DebugSessionLogPayload = {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  runId?: string;
};

export function writeDebugSessionLog(payload: DebugSessionLogPayload): void {
  if (!import.meta.env.DEV) {
    return;
  }

  console.debug('[agent-debug]', payload.location, payload.message, payload.data ?? {});
}
