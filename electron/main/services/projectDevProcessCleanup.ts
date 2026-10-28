import { execFileSync } from 'node:child_process';
import path from 'node:path';

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readProcessCwd(pid: number): string | null {
  try {
    const raw = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 1024 * 1024,
    });

    for (const line of raw.split('\n')) {
      if (line.startsWith('n')) {
        return line.slice(1).trim() || null;
      }
    }
  } catch {
  }

  return null;
}

function listProcessRows(): Array<{ pid: number; command: string }> {
  try {
    const raw = execFileSync('/bin/ps', ['-ax', '-o', 'pid=,command='], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const rows: Array<{ pid: number; command: string }> = [];

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(/^(\d+)\s+(.*)$/);

      if (!match) {
        continue;
      }

      const pid = Number(match[1]);
      const command = match[2];

      if (!Number.isFinite(pid) || pid <= 0 || !command) {
        continue;
      }

      rows.push({ pid, command });
    }

    return rows;
  } catch {
    return [];
  }
}

function isNexusProcess(command: string, cwd: string | null): boolean {
  if (command.includes('Nexus.app') || command.includes('nexus-ide/build')) {
    return true;
  }

  if (cwd && cwd.includes(`${path.sep}nexus-ide`)) {
    return true;
  }

  return false;
}

function matchesProject(command: string, cwd: string | null, projectPath: string): boolean {
  if (command.includes(projectPath)) {
    return true;
  }

  if (cwd && (cwd === projectPath || cwd.startsWith(`${projectPath}${path.sep}`))) {
    return true;
  }

  return false;
}

function isAgentCliProcess(command: string): boolean {
  return (
    command.includes('[Nexus IDE]') ||
    command.includes('/cursor-agent/') ||
    command.includes('cursor-agent/versions') ||
    /(?:^|\s)cursor-agent(?:\s|$)/.test(command) ||
    command.includes('/opencode/') ||
    /(?:^|\s)opencode(?:\s|$)/.test(command) ||
    /(?:^|\s)(?:codex|agy)(?:\s|$)/.test(command)
  );
}

function isDevCandidate(command: string): boolean {
  if (isAgentCliProcess(command)) {
    return false;
  }

  return (
    /\.app\/Contents\/MacOS\/Electron\b/.test(command) ||
    /\/Contents\/MacOS\/Electron\b/.test(command) ||
    /\/node_modules\/(?:\.bin\/)?electron-vite(?:\/|\s|$)/.test(command) ||
    /(?:^|\s)(?:npx\s+)?electron-vite(?:\s|$)/.test(command) ||
    /\/node_modules\/\.bin\/(vite|next|electron-vite)\b/.test(command)
  );
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
  }
}

function resolveSafeProjectPath(projectPath: unknown): string | null {
  if (typeof projectPath !== 'string') {
    return null;
  }

  const trimmed = projectPath.trim();

  if (!trimmed || trimmed === '/' || trimmed.length < 4) {
    return null;
  }

  const resolved = path.resolve(trimmed);
  const root = path.parse(resolved).root;

  if (!path.isAbsolute(resolved) || resolved === root) {
    return null;
  }

  return resolved;
}

export async function cleanupProjectDevProcesses(projectPath: unknown): Promise<number> {
  const resolved = resolveSafeProjectPath(projectPath);

  if (!resolved) {
    return 0;
  }

  const pids = new Set<number>();

  for (const row of listProcessRows()) {
    if (!isDevCandidate(row.command)) {
      continue;
    }

    const cwd = readProcessCwd(row.pid);

    if (isNexusProcess(row.command, cwd)) {
      continue;
    }

    if (!matchesProject(row.command, cwd, resolved)) {
      continue;
    }

    pids.add(row.pid);
  }

  for (const pid of pids) {
    signalPid(pid, 'SIGTERM');
  }

  if (pids.size > 0) {
    const deadline = Date.now() + 1_200;

    while (Date.now() < deadline) {
      let alive = 0;

      for (const pid of pids) {
        try {
          process.kill(pid, 0);
          alive += 1;
        } catch {
        }
      }

      if (alive === 0) {
        break;
      }

      await sleepMs(100);
    }

    for (const pid of pids) {
      signalPid(pid, 'SIGKILL');
    }
  }

  return pids.size;
}
