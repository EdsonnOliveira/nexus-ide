import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, unlink } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const COMMON_PORTS = [3000, 5173, 4173, 8080, 3001, 5174, 4200, 8000, 4321, 5000, 24678];
const TOKEN_COOKIE = 'nexus_preview_token';
const TOKEN_QUERY = 'nexus_preview_token';
const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const CLOUDFLARED_VERSION = '2025.2.1';

export interface PreviewSessionInfo {
  session_id: string;
  project_id: string | null;
  local_project_id: string | null;
  local_url: string;
  public_url: string | null;
  state: 'detected' | 'starting' | 'running' | 'stopped' | 'error';
  message?: string | null;
}

interface ActivePreviewSession {
  id: string;
  projectId: string | null;
  localProjectId: string | null;
  localUrl: string;
  publicUrl: string | null;
  token: string;
  state: 'starting' | 'running' | 'stopped' | 'error';
  message: string | null;
  proxyPort: number;
  proxyServer: http.Server;
  tunnelProcess: ChildProcess | null;
  viewers: number;
}

const sessions = new Map<string, ActivePreviewSession>();

function normalizeLocalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1' &&
      parsed.hostname !== '[::1]' &&
      parsed.hostname !== '::1'
    ) {
      return null;
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1') {
      parsed.hostname = '127.0.0.1';
    }
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '') || parsed.origin;
  } catch {
    return null;
  }
}

function getProbeTargets(url: string): string[] {
  try {
    const parsed = new URL(url);
    const targets = [url];
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1'
    ) {
      const ipv4 = new URL(url);
      ipv4.hostname = '127.0.0.1';
      targets.push(ipv4.toString());
    }
    if (parsed.hostname === '127.0.0.1') {
      const localhost = new URL(url);
      localhost.hostname = 'localhost';
      targets.push(localhost.toString());
    }
    return [...new Set(targets)];
  } catch {
    return [url];
  }
}

function probeOnce(url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(
      parsed,
      {
        method,
        timeout: timeoutMs,
      },
      (response) => {
        response.destroy();
        const status = response.statusCode ?? 0;
        resolve(status > 0 && status < 500);
      },
    );
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => {
      resolve(false);
    });
    request.end();
  });
}

export async function probeUrlReachable(url: string, timeoutMs = 2500): Promise<boolean> {
  if (!url) {
    return false;
  }
  for (const target of getProbeTargets(url)) {
    if (await probeOnce(target, 'HEAD', timeoutMs)) {
      return true;
    }
    if (await probeOnce(target, 'GET', timeoutMs)) {
      return true;
    }
  }
  return false;
}

async function resolveCloudflaredPath(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('which', ['cloudflared']);
    const found = stdout.trim();
    if (found) {
      return found;
    }
  } catch {
  }

  const binDir = path.join(os.homedir(), '.nexus', 'bin');
  const localBin = path.join(binDir, 'cloudflared');
  try {
    await access(localBin);
    return localBin;
  } catch {
  }

  await mkdir(binDir, { recursive: true });
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const asset = `cloudflared-${platform}-${arch}`;
  const tgzUrl = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset}.tgz`;
  const tmpTgz = path.join(binDir, `${asset}.tgz`);

  await new Promise<void>((resolve, reject) => {
    const download = (url: string, redirectsLeft: number) => {
      https
        .get(url, (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location && redirectsLeft > 0) {
            response.resume();
            download(response.headers.location, redirectsLeft - 1);
            return;
          }
          if (status !== 200) {
            reject(new Error(`Failed to download cloudflared (${status})`));
            response.resume();
            return;
          }
          const file = createWriteStream(tmpTgz);
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
          file.on('error', reject);
        })
        .on('error', reject);
    };
    download(tgzUrl, 5);
  });

  await execFileAsync('tar', ['-xzf', tmpTgz, '-C', binDir]);
  await chmod(localBin, 0o755);
  try {
    await unlink(tmpTgz);
  } catch {
  }
  return localBin;
}

function stripFrameHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'x-frame-options' || lower === 'content-security-policy-report-only') {
      continue;
    }
    if (lower === 'content-security-policy' && typeof value === 'string') {
      const cleaned = value
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !/^frame-ancestors\b/i.test(part))
        .join('; ');
      if (cleaned) {
        next[key] = cleaned;
      }
      continue;
    }
    next[key] = value as string | string[] | undefined;
  }
  return next;
}

function readTokenFromRequest(req: http.IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const fromQuery = url.searchParams.get(TOKEN_QUERY);
    if (fromQuery) {
      return fromQuery;
    }
  } catch {
  }
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${TOKEN_COOKIE}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function createProxyServer(session: ActivePreviewSession): http.Server {
  const target = new URL(session.localUrl);
  const server = http.createServer((req, res) => {
    const token = readTokenFromRequest(req);
    const fetchDest = String(req.headers['sec-fetch-dest'] ?? '');
    const isDocument = fetchDest === 'document' || fetchDest === 'iframe';
    if (isDocument && token && token !== session.token) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized preview');
      return;
    }

    let pathname = req.url ?? '/';
    try {
      const incoming = new URL(req.url ?? '/', 'http://127.0.0.1');
      incoming.searchParams.delete(TOKEN_QUERY);
      pathname = `${incoming.pathname}${incoming.search}`;
    } catch {
    }

    const setCookie =
      token === session.token && !req.headers.cookie?.includes(`${TOKEN_COOKIE}=`)
        ? `${TOKEN_COOKIE}=${encodeURIComponent(session.token)}; Path=/; SameSite=None; Secure; HttpOnly`
        : null;

    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers.host;
    headers.host = target.host;
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-proto'] = 'https';

    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname === 'localhost' ? '127.0.0.1' : target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: pathname,
        method: req.method,
        headers,
      },
      (upstreamRes) => {
        const outHeaders = stripFrameHeaders(upstreamRes.headers);
        if (setCookie) {
          const existing = outHeaders['set-cookie'];
          outHeaders['set-cookie'] = Array.isArray(existing)
            ? [...existing, setCookie]
            : existing
              ? [existing, setCookie]
              : setCookie;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        upstreamRes.pipe(res);
      },
    );

    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      }
      res.end('Preview upstream unavailable');
    });

    req.pipe(upstream);
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = req.url ?? '/';
    try {
      const incoming = new URL(req.url ?? '/', 'http://127.0.0.1');
      incoming.searchParams.delete(TOKEN_QUERY);
      pathname = `${incoming.pathname}${incoming.search}`;
    } catch {
    }

    const hostName = target.hostname === 'localhost' ? '127.0.0.1' : target.hostname;
    const upstream = net.connect(Number(target.port || 80), hostName, () => {
      const headerLines = Object.entries({
        ...req.headers,
        host: target.host,
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
      const requestLine = `${req.method} ${pathname} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`;
      upstream.write(requestLine);
      if (head.length > 0) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    });

    upstream.on('error', () => {
      socket.destroy();
    });
    socket.on('error', () => {
      upstream.destroy();
    });
  });

  return server;
}

async function listenProxy(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind preview proxy'));
        return;
      }
      resolve(address.port);
    });
    server.on('error', reject);
  });
}

async function startCloudflared(proxyPort: number): Promise<{
  process: ChildProcess;
  publicUrl: string;
}> {
  const binary = await resolveCloudflaredPath();
  const child = spawn(
    binary,
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${proxyPort}`],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let combined = '';
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('Timed out waiting for Cloudflare tunnel URL'));
    }, 45000);

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      combined += text;
      const match = combined.match(TUNNEL_URL_REGEX);
      if (match && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ process: child, publicUrl: match[0] });
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`cloudflared exited early (code ${code ?? 'null'})`));
    });
  });
}

async function listListeningByCwd(): Promise<Array<{ port: number; cwd: string }>> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], {
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const entries: Array<{ pid: string; port: number }> = [];
    let currentPid = '';
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        currentPid = line.slice(1);
      } else if (line.startsWith('n') && currentPid) {
        const match = line.match(/:(\d+)$/);
        if (match) {
          entries.push({ pid: currentPid, port: Number(match[1]) });
        }
      }
    }

    const result: Array<{ port: number; cwd: string }> = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!COMMON_PORTS.includes(entry.port) && entry.port < 1024) {
        continue;
      }
      try {
        const { stdout: cwdOut } = await execFileAsync(
          'lsof',
          ['-a', '-p', entry.pid, '-d', 'cwd', '-Fn'],
          { timeout: 2000 },
        );
        const cwdLine = cwdOut.split('\n').find((line) => line.startsWith('n'));
        const cwd = cwdLine?.slice(1)?.trim();
        if (!cwd) {
          continue;
        }
        const key = `${entry.port}:${cwd}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        result.push({ port: entry.port, cwd });
      } catch {
      }
    }
    return result;
  } catch {
    return [];
  }
}

function projectOwnsPath(projectPath: string, cwd: string): boolean {
  const normalizedProject = path.resolve(projectPath);
  const normalizedCwd = path.resolve(cwd);
  return (
    normalizedCwd === normalizedProject ||
    normalizedCwd.startsWith(`${normalizedProject}${path.sep}`)
  );
}

export async function discoverProjectLocalUrl(projectPath: string | null): Promise<string | null> {
  if (!projectPath) {
    return null;
  }
  const listening = await listListeningByCwd();
  for (const item of listening) {
    if (!projectOwnsPath(projectPath, item.cwd)) {
      continue;
    }
    const url = `http://127.0.0.1:${item.port}`;
    if (await probeUrlReachable(url)) {
      return url;
    }
  }
  for (const port of COMMON_PORTS) {
    const url = `http://127.0.0.1:${port}`;
    if (await probeUrlReachable(url, 900)) {
      const matched = listening.find(
        (item) => item.port === port && projectOwnsPath(projectPath, item.cwd),
      );
      if (matched || listening.length === 0) {
        return url;
      }
    }
  }
  return null;
}

export async function listDetectedPreviewSessions(
  projects: Array<{ projectId: string; localId: string | null; localPath: string | null }>,
): Promise<PreviewSessionInfo[]> {
  const listening = await listListeningByCwd();
  const detected: PreviewSessionInfo[] = [];
  const claimedPorts = new Set<number>();

  for (const project of projects) {
    if (!project.localPath) {
      continue;
    }
    for (const item of listening) {
      if (claimedPorts.has(item.port)) {
        continue;
      }
      if (!projectOwnsPath(project.localPath, item.cwd)) {
        continue;
      }
      const localUrl = `http://127.0.0.1:${item.port}`;
      if (!(await probeUrlReachable(localUrl, 900))) {
        continue;
      }
      claimedPorts.add(item.port);
      detected.push({
        session_id: `detected:${project.projectId}:${item.port}`,
        project_id: project.projectId,
        local_project_id: project.localId,
        local_url: localUrl,
        public_url: null,
        state: 'detected',
        message: null,
      });
    }
  }

  return detected;
}

function toSessionInfo(session: ActivePreviewSession): PreviewSessionInfo {
  return {
    session_id: session.id,
    project_id: session.projectId,
    local_project_id: session.localProjectId,
    local_url: session.localUrl,
    public_url: session.publicUrl
      ? `${session.publicUrl}/?${TOKEN_QUERY}=${encodeURIComponent(session.token)}`
      : null,
    state: session.state,
    message: session.message,
  };
}

export function listActivePreviewSessions(): PreviewSessionInfo[] {
  return [...sessions.values()]
    .filter((session) => session.state === 'running' || session.state === 'starting')
    .map(toSessionInfo);
}

export async function startPreviewSession(input: {
  projectId: string | null;
  localProjectId: string | null;
  localUrl?: string | null;
  projectPath?: string | null;
}): Promise<PreviewSessionInfo> {
  const existing = [...sessions.values()].find(
    (session) =>
      (input.projectId && session.projectId === input.projectId) ||
      (input.localUrl && session.localUrl === normalizeLocalUrl(input.localUrl)),
  );
  if (existing && existing.state === 'running' && existing.publicUrl) {
    existing.viewers += 1;
    return toSessionInfo(existing);
  }

  let localUrl = input.localUrl ? normalizeLocalUrl(input.localUrl) : null;
  if (!localUrl) {
    localUrl = await discoverProjectLocalUrl(input.projectPath ?? null);
  }
  if (!localUrl) {
    throw new Error('Nenhum front local detectado. Suba o dev server no Mac (ex.: npm run dev).');
  }
  if (!(await probeUrlReachable(localUrl))) {
    throw new Error(`Front local inacessível em ${localUrl}`);
  }

  const token = randomBytes(24).toString('hex');
  const id = randomUUID();
  const session: ActivePreviewSession = {
    id,
    projectId: input.projectId,
    localProjectId: input.localProjectId,
    localUrl,
    publicUrl: null,
    token,
    state: 'starting',
    message: 'Abrindo túnel…',
    proxyPort: 0,
    proxyServer: null as unknown as http.Server,
    tunnelProcess: null,
    viewers: 1,
  };

  const proxyServer = createProxyServer(session);
  session.proxyServer = proxyServer;
  const proxyPort = await listenProxy(proxyServer);
  session.proxyPort = proxyPort;
  sessions.set(id, session);

  try {
    const tunnel = await startCloudflared(proxyPort);
    session.tunnelProcess = tunnel.process;
    session.publicUrl = tunnel.publicUrl;
    session.state = 'running';
    session.message = null;
    tunnel.process.on('exit', () => {
      const current = sessions.get(id);
      if (!current) {
        return;
      }
      current.state = 'stopped';
      current.message = 'Túnel encerrado';
      current.publicUrl = null;
      try {
        current.proxyServer.close();
      } catch {
      }
      sessions.delete(id);
    });
    return toSessionInfo(session);
  } catch (error) {
    session.state = 'error';
    session.message = error instanceof Error ? error.message : String(error);
    try {
      proxyServer.close();
    } catch {
    }
    sessions.delete(id);
    throw error;
  }
}

export function attachPreviewSession(sessionId: string): PreviewSessionInfo {
  const session = sessions.get(sessionId);
  if (!session || (session.state !== 'running' && session.state !== 'starting')) {
    throw new Error('Preview session not found');
  }
  session.viewers += 1;
  return toSessionInfo(session);
}

export async function stopPreviewSession(sessionId: string): Promise<{ ok: true }> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: true };
  }
  session.viewers = Math.max(0, session.viewers - 1);
  if (session.viewers > 0) {
    return { ok: true };
  }
  try {
    session.tunnelProcess?.kill('SIGTERM');
  } catch {
  }
  try {
    session.proxyServer.close();
  } catch {
  }
  sessions.delete(sessionId);
  return { ok: true };
}

export function findPreviewSessionForProject(projectId: string | null): PreviewSessionInfo | null {
  if (!projectId) {
    return null;
  }
  const active = [...sessions.values()].find(
    (session) => session.projectId === projectId && session.state === 'running',
  );
  return active ? toSessionInfo(active) : null;
}
