import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import os from 'node:os';

interface LocalTerminal {
  id: string;
  pty: pty.IPty;
  buffer: string;
  sequence: number;
  onData: (chunk: string, sequence: number) => void;
}

const sessions = new Map<string, LocalTerminal>();
const BUFFER_LIMIT = 512 * 1024;

export function createTerminalSession(input: {
  id?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  onData: (chunk: string, sequence: number) => void;
}): string {
  const id = input.id ?? randomUUID();
  const shell = process.env.SHELL || '/bin/zsh';
  const term = pty.spawn(shell, ['-l'], {
    name: 'xterm-color',
    cols: input.cols ?? 80,
    rows: input.rows ?? 24,
    cwd: input.cwd ?? os.homedir(),
    env: process.env as Record<string, string>,
  });

  const session: LocalTerminal = {
    id,
    pty: term,
    buffer: '',
    sequence: 0,
    onData: input.onData,
  };

  term.onData((data) => {
    session.sequence += 1;
    session.buffer = `${session.buffer}${data}`.slice(-BUFFER_LIMIT);
    session.onData(data, session.sequence);
  });

  sessions.set(id, session);
  return id;
}

export function writeTerminal(id: string, data: string): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error('Terminal session not found');
  }
  session.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) {
    throw new Error('Terminal session not found');
  }
  session.pty.resize(cols, rows);
}

export function interruptTerminal(id: string): void {
  writeTerminal(id, '\u0003');
}

export function closeTerminal(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  session.pty.kill();
  sessions.delete(id);
}

export function getTerminalSnapshot(id: string): { content: string; sequence: number } | null {
  const session = sessions.get(id);
  if (!session) {
    return null;
  }
  return { content: session.buffer, sequence: session.sequence };
}

export function listActiveTerminalIds(): string[] {
  return [...sessions.keys()];
}
