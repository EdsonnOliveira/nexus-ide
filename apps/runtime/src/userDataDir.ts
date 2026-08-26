import os from 'node:os';
import path from 'node:path';

export function userDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'nexus-ide',
    );
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-ide');
  }

  return path.join(os.homedir(), '.config', 'nexus-ide');
}
