import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sessionFilePath(): string {
  const dir = path.join(os.homedir(), '.nexus', 'runtime');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'auth-session.json');
}

export function createFileAuthStorage() {
  return {
    getItem(key: string): string | null {
      const filePath = sessionFilePath();
      if (!existsSync(filePath)) {
        return null;
      }
      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
        return raw[key] ?? null;
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      const filePath = sessionFilePath();
      let current: Record<string, string> = {};
      if (existsSync(filePath)) {
        try {
          current = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
        } catch {
          current = {};
        }
      }
      current[key] = value;
      writeFileSync(filePath, JSON.stringify(current), { mode: 0o600 });
    },
    removeItem(key: string): void {
      const filePath = sessionFilePath();
      if (!existsSync(filePath)) {
        return;
      }
      try {
        const current = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
        delete current[key];
        if (Object.keys(current).length === 0) {
          unlinkSync(filePath);
          return;
        }
        writeFileSync(filePath, JSON.stringify(current), { mode: 0o600 });
      } catch {
        unlinkSync(filePath);
      }
    },
  };
}
