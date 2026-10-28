import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.NODE_OPTIONS;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patchScript = path.join(root, 'scripts/patch-electron-branding.mjs');
const viteCli = path.join(root, 'node_modules/vite/bin/vite.js');
const DEV_PORT = 5260;
const ALREADY_RUNNING_CODE = 75;

function isDevServerListening() {
  try {
    execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${DEV_PORT}`, '-sTCP:LISTEN'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

if (isDevServerListening()) {
  console.warn(`[run-dev-vite] port ${DEV_PORT} already in use — not replacing Nexus.app`);
  process.exit(ALREADY_RUNNING_CODE);
}

const patch = spawn(process.execPath, [patchScript], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

patch.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    process.exit(code);
    return;
  }

  const child = spawn(process.execPath, [viteCli, ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (viteCode, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(viteCode ?? 0);
  });
});
