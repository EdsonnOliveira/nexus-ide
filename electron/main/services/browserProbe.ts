import http from 'node:http';
import https from 'node:https';

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

export async function probeUrlReachable(url: string, timeoutMs = 3000): Promise<boolean> {
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
