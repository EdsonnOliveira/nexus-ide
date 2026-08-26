import os from 'node:os';
import path from 'node:path';

export function getRuntimeIpcPath(): string {
  if (process.env.NEXUS_RUNTIME_SOCKET) {
    return process.env.NEXUS_RUNTIME_SOCKET;
  }

  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\nexus-runtime';
  }

  return path.join(os.homedir(), '.nexus-runtime.sock');
}

export function getDesktopIpcPath(): string {
  if (process.env.NEXUS_DESKTOP_SOCKET) {
    return process.env.NEXUS_DESKTOP_SOCKET;
  }

  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\nexus-desktop';
  }

  return path.join(os.homedir(), '.nexus-desktop.sock');
}

export function isNamedPipePath(socketPath: string): boolean {
  return socketPath.startsWith('\\\\.\\pipe\\') || socketPath.startsWith('//./pipe/');
}
