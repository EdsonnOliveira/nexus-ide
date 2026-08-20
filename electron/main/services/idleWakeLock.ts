import { powerSaveBlocker } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';

const IDLE_ASSERTION_SECONDS = 60 * 60 * 24 * 7;

let caffeinateProcess: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isEnabled = false;
let powerBlockerId: number | null = null;

function startPowerBlocker(): void {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    return;
  }

  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
}

function stopPowerBlocker(): void {
  if (powerBlockerId === null) {
    return;
  }

  if (powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }

  powerBlockerId = null;
}

function spawnCaffeinate(): void {
  if (!isEnabled || process.platform !== 'darwin') {
    return;
  }

  if (caffeinateProcess && !caffeinateProcess.killed) {
    return;
  }

  const child = spawn(
    '/usr/bin/caffeinate',
    ['-i', '-u', '-t', String(IDLE_ASSERTION_SECONDS), '-w', String(process.pid)],
    { stdio: 'ignore' },
  );

  child.on('exit', () => {
    if (caffeinateProcess === child) {
      caffeinateProcess = null;
    }

    if (!isEnabled || restartTimer) {
      return;
    }

    restartTimer = setTimeout(() => {
      restartTimer = null;
      spawnCaffeinate();
    }, 1000);
  });

  child.on('error', () => {
    if (caffeinateProcess === child) {
      caffeinateProcess = null;
    }
  });

  caffeinateProcess = child;
}

export function startIdleWakeLock(): void {
  isEnabled = true;
  startPowerBlocker();
  spawnCaffeinate();
}

export function stopIdleWakeLock(): void {
  isEnabled = false;
  stopPowerBlocker();

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (!caffeinateProcess) {
    return;
  }

  caffeinateProcess.kill('SIGTERM');
  caffeinateProcess = null;
}
