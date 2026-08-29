import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESTART_DELAY_MS = 1000;

let child = null;
let stopping = false;
let restartTimer = null;

function clearRestartTimer() {
  if (!restartTimer) {
    return;
  }

  clearTimeout(restartTimer);
  restartTimer = null;
}

function stopChild() {
  if (!child) {
    return;
  }

  const current = child;
  child = null;
  current.removeAllListeners('exit');

  if (current.exitCode === null && current.signalCode === null) {
    current.kill('SIGTERM');
    setTimeout(() => {
      if (current.exitCode === null && current.signalCode === null) {
        current.kill('SIGKILL');
      }
    }, 2000);
  }
}

function startVite() {
  if (stopping) {
    return;
  }

  clearRestartTimer();
  stopChild();

  console.warn('[dev-supervisor] starting vite');
  const next = spawn(process.execPath, [path.join(root, 'scripts/run-dev-vite.mjs')], {
    cwd: root,
    env: { ...process.env, NODE_OPTIONS: undefined },
    stdio: 'inherit',
  });

  child = next;

  next.on('exit', (code, signal) => {
    if (child === next) {
      child = null;
    }

    console.warn(
      `[dev-supervisor] vite exited code=${code ?? 'null'} signal=${signal ?? 'none'}`,
    );

    if (stopping) {
      process.exit(code ?? 0);
      return;
    }

    if (signal === 'SIGINT') {
      process.exit(0);
      return;
    }

    clearRestartTimer();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startVite();
    }, RESTART_DELAY_MS);
  });
}

function requestStop(signal) {
  if (stopping) {
    return;
  }

  stopping = true;
  clearRestartTimer();
  console.warn(`[dev-supervisor] received ${signal} — stopping`);
  stopChild();
  setTimeout(() => process.exit(0), 2500);
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => {
  console.warn('[dev-supervisor] ignored SIGTERM');
});
process.on('SIGHUP', () => {
  console.warn('[dev-supervisor] ignored SIGHUP');
});

startVite();
