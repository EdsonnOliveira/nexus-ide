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

const rebuildTargets = ['node-pty'];

if (process.platform === 'darwin') {
  rebuildTargets.push('macos-calendar');
}

for (const target of rebuildTargets) {
  const rebuild = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['@electron/rebuild', '-f', '-w', target],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: process.env,
    },
  );

  if (rebuild.status !== 0) {
    process.exit(rebuild.status ?? 1);
  }
}

const patchBranding = spawnSync(process.execPath, ['scripts/patch-electron-branding.mjs'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
});

if (patchBranding.status !== 0) {
  process.exit(patchBranding.status ?? 1);
}

if (process.platform === 'darwin') {
  const downloadSimulatorServer = spawnSync(process.execPath, ['scripts/download-simulator-server.mjs'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (downloadSimulatorServer.status !== 0) {
    process.exit(downloadSimulatorServer.status ?? 1);
  }
}
