import { spawn, type ChildProcess } from 'node:child_process';

export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
  }
}

export function killChildProcess(child: ChildProcess | null | undefined): void {
  if (!child || child.killed) {
    return;
  }

  const pid = child.pid;

  if (pid) {
    killProcessTree(pid);
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
  }
}
