import fs from 'node:fs';
import path from 'node:path';

const DEBUG_LOG_PATH = '/Users/edsonpinheirodeoliveira/DEV/DESKTOP/nexus-ide/.cursor/debug-9fa93e.log';

export function writeDebugSessionLog(payload: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(
      DEBUG_LOG_PATH,
      `${JSON.stringify({
        sessionId: '9fa93e',
        timestamp: Date.now(),
        ...payload,
      })}\n`,
    );
  } catch {
    // ignore
  }
}
