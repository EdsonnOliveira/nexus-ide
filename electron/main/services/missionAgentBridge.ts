import { createServer, type Server } from 'node:http';
import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';

type BridgeRequest =
  | { id: string; type: 'list'; missionId?: string; fromNodeId?: string }
  | {
      id: string;
      type: 'ask';
      missionId: string;
      fromNodeId: string;
      to: string;
      message: string;
    }
  | {
      id: string;
      type: 'note-read';
      missionId: string;
      fromNodeId: string;
      note: string;
    }
  | {
      id: string;
      type: 'note-write';
      missionId: string;
      fromNodeId: string;
      note: string;
      content: string;
      append?: boolean;
    };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let server: Server | null = null;
let bridgePort = 0;
let ipcRegistered = false;
const pending = new Map<string, Pending>();
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function bridgeDir(): string {
  const dir = path.join(app.getPath('userData'), 'mission-bridge');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeBridgeMeta(): void {
  const dir = bridgeDir();
  const meta = {
    port: bridgePort,
    url: `http://127.0.0.1:${bridgePort}`,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify(meta, null, 2), 'utf8');
  writeFileSync(path.join(dir, 'bridge.url'), meta.url, 'utf8');

  const cliPath = path.join(dir, 'nexus');
  const cli = `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
URL="$(cat "$ROOT/bridge.url" 2>/dev/null || true)"
if [[ -z "\${URL}" ]]; then
  echo "Nexus mission bridge offline" >&2
  exit 1
fi
CMD="\${1:-}"
case "$CMD" in
  list)
    FROM="\${NEXUS_MISSION_NODE_ID:-}"
    MISSION="\${NEXUS_MISSION_ID:-}"
    curl -sS "$URL/list?missionId=$MISSION&fromNodeId=$FROM"
    ;;
  ask)
    TO="\${2:-}"
    MSG="\${3:-}"
    curl -sS -X POST "$URL/ask" -H 'content-type: application/json' \\
      -d "{\\"missionId\\":\\"\${NEXUS_MISSION_ID:-}\\",\\"fromNodeId\\":\\"\${NEXUS_MISSION_NODE_ID:-}\\",\\"to\\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TO"),\\"message\\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MSG")}"
    ;;
  note)
    SUB="\${2:-}"
    NAME="\${3:-}"
    if [[ "$SUB" == "read" ]]; then
      curl -sS -X POST "$URL/note/read" -H 'content-type: application/json' \\
        -d "{\\"missionId\\":\\"\${NEXUS_MISSION_ID:-}\\",\\"fromNodeId\\":\\"\${NEXUS_MISSION_NODE_ID:-}\\",\\"note\\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$NAME")}"
    elif [[ "$SUB" == "write" ]]; then
      BODY="\${4:-}"
      curl -sS -X POST "$URL/note/write" -H 'content-type: application/json' \\
        -d "{\\"missionId\\":\\"\${NEXUS_MISSION_ID:-}\\",\\"fromNodeId\\":\\"\${NEXUS_MISSION_NODE_ID:-}\\",\\"note\\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$NAME"),\\"content\\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$BODY"),\\"append\\":false}"
    else
      echo "usage: nexus note read|write ..." >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: nexus list|ask|note" >&2
    exit 1
    ;;
esac
`;
  writeFileSync(cliPath, cli, 'utf8');
  try {
    chmodSync(cliPath, 0o755);
  } catch {
  }

  const skillDir = path.join(dir, 'skills', 'nexus-live');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---
name: nexus-live
description: Talk to connected mission peers on the Nexus live canvas.
---

# Nexus Live

When you are part of a Nexus mission with Live edges, use the \`nexus\` CLI (already on PATH when the bridge is up):

\`\`\`bash
nexus list
nexus ask "Peer Name" "Please review the API changes"
nexus note read "Shared Notes"
nexus note write "Shared Notes" "Done: auth flow"
\`\`\`

Environment:
- \`NEXUS_MISSION_ID\`
- \`NEXUS_MISSION_NODE_ID\`
- \`NEXUS_MISSION_BRIDGE\`

Only peers connected with a Live edge can be contacted.
`,
    'utf8',
  );
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
}

function askRenderer(request: BridgeRequest): Promise<unknown> {
  const win = getWindow();
  if (!win) {
    return Promise.reject(new Error('Nexus window unavailable'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request.id);
      reject(new Error('Mission live bridge timeout'));
    }, REQUEST_TIMEOUT_MS);

    pending.set(request.id, { resolve, reject, timer });
    win.webContents.send('mission-live:request', request);
  });
}

function readJson(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

export function getMissionBridgePort(): number {
  return bridgePort;
}

export function getMissionBridgeCliDir(): string {
  return bridgeDir();
}

export function startMissionAgentBridge(): void {
  if (server) {
    return;
  }

  if (!ipcRegistered) {
    ipcRegistered = true;
    ipcMain.handle('mission-live:respond', (_, payload: { id: string; ok: boolean; result?: unknown; error?: string }) => {
      const entry = pending.get(payload.id);
      if (!entry) {
        return false;
      }
      clearTimeout(entry.timer);
      pending.delete(payload.id);
      if (payload.ok) {
        entry.resolve(payload.result);
      } else {
        entry.reject(new Error(payload.error || 'Live bridge error'));
      }
      return true;
    });

    ipcMain.handle('mission-live:status', () => ({
      port: bridgePort,
      url: bridgePort ? `http://127.0.0.1:${bridgePort}` : null,
      cliDir: bridgeDir(),
    }));
  }

  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        res.end();
        return;
      }

      if (url.pathname === '/health') {
        sendJson(res, 200, { ok: true, port: bridgePort });
        return;
      }

      if (url.pathname === '/list' && req.method === 'GET') {
        const result = await askRenderer({
          id: randomUUID(),
          type: 'list',
          missionId: url.searchParams.get('missionId') || undefined,
          fromNodeId: url.searchParams.get('fromNodeId') || undefined,
        });
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === '/ask' && req.method === 'POST') {
        const body = await readJson(req);
        const result = await askRenderer({
          id: randomUUID(),
          type: 'ask',
          missionId: String(body.missionId || ''),
          fromNodeId: String(body.fromNodeId || ''),
          to: String(body.to || ''),
          message: String(body.message || ''),
        });
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === '/note/read' && req.method === 'POST') {
        const body = await readJson(req);
        const result = await askRenderer({
          id: randomUUID(),
          type: 'note-read',
          missionId: String(body.missionId || ''),
          fromNodeId: String(body.fromNodeId || ''),
          note: String(body.note || ''),
        });
        sendJson(res, 200, result);
        return;
      }

      if (url.pathname === '/note/write' && req.method === 'POST') {
        const body = await readJson(req);
        const result = await askRenderer({
          id: randomUUID(),
          type: 'note-write',
          missionId: String(body.missionId || ''),
          fromNodeId: String(body.fromNodeId || ''),
          note: String(body.note || ''),
          content: String(body.content || ''),
          append: Boolean(body.append),
        });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'bridge_error',
      });
    }
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server?.address();
    bridgePort = address && typeof address === 'object' ? address.port : 0;
    writeBridgeMeta();
  });
}

export function stopMissionAgentBridge(): void {
  if (!server) {
    return;
  }
  server.close();
  server = null;
  bridgePort = 0;
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error('Bridge stopped'));
  }
  pending.clear();
}

export function ensureMissionLiveSkillInProject(projectPath: string): void {
  if (!projectPath || !existsSync(projectPath)) {
    return;
  }

  const skillDir = path.join(projectPath, '.cursor', 'skills', 'nexus-live');
  mkdirSync(skillDir, { recursive: true });
  const source = path.join(bridgeDir(), 'skills', 'nexus-live', 'SKILL.md');
  if (!existsSync(source)) {
    writeBridgeMeta();
  }
  try {
    const content = readFileSync(
      path.join(bridgeDir(), 'skills', 'nexus-live', 'SKILL.md'),
      'utf8',
    );
    writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  } catch {
  }
}
