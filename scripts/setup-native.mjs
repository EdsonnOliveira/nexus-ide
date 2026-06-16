import { chmodSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const prebuildsDir = path.join(rootDir, 'node_modules/node-pty/prebuilds');

if (existsSync(prebuildsDir)) {
  for (const platformDir of readdirSync(prebuildsDir)) {
    const helperPath = path.join(prebuildsDir, platformDir, 'spawn-helper');

    if (existsSync(helperPath)) {
      chmodSync(helperPath, 0o755);
    }
  }
}

const rebuild = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['@electron/rebuild', '-f', '-w', 'node-pty'],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  },
);

if (rebuild.status !== 0) {
  process.exit(rebuild.status ?? 1);
}
