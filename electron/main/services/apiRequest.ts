import http from 'node:http';
import https from 'node:https';
import { URL, URLSearchParams } from 'node:url';
import type { ApiHttpResponse, ApiKeyValue, ApiRequest, ApiSendRequestPayload } from '../../types/api';

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function substituteVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawName: string) => {
    const name = rawName.trim();
    return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : `{{${name}}}`;
  });
}

function buildHeaders(
  request: ApiRequest,
  variables: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const entry of request.headers) {
    if (!entry.enabled || !entry.key.trim()) {
      continue;
    }

    headers[entry.key.trim()] = substituteVariables(entry.value, variables);
  }

  if (request.authType === 'bearer' && request.authBearer.trim()) {
    headers.Authorization = `Bearer ${substituteVariables(request.authBearer, variables)}`;
  }

  if (request.authType === 'basic') {
    const user = substituteVariables(request.authBasicUser, variables);
    const pass = substituteVariables(request.authBasicPass, variables);
    headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  return headers;
}

function buildBody(
  request: ApiRequest,
  variables: Record<string, string>,
): { body: string | null; headers: Record<string, string> } {
  const extraHeaders: Record<string, string> = {};

  if (request.bodyType === 'none' || request.method === 'GET' || request.method === 'HEAD') {
    return { body: null, headers: extraHeaders };
  }

  if (request.bodyType === 'json' || request.bodyType === 'text') {
    const body = substituteVariables(request.body, variables);

    if (request.bodyType === 'json' && !Object.keys(extraHeaders).some((key) => key.toLowerCase() === 'content-type')) {
      extraHeaders['Content-Type'] = 'application/json';
    }

    if (request.bodyType === 'text') {
      extraHeaders['Content-Type'] = 'text/plain';
    }

    return { body, headers: extraHeaders };
  }

  if (request.bodyType === 'form-urlencoded') {
    const body = substituteVariables(request.body, variables);
    extraHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    return { body, headers: extraHeaders };
  }

  return { body: null, headers: extraHeaders };
}

function buildUrl(request: ApiRequest, variables: Record<string, string>): URL {
  const substitutedUrl = substituteVariables(request.url, variables);
  const parsed = new URL(substitutedUrl);

  for (const entry of request.query) {
    if (!entry.enabled || !entry.key.trim()) {
      continue;
    }

    parsed.searchParams.append(entry.key.trim(), substituteVariables(entry.value, variables));
  }

  return parsed;
}

function readResponseBody(response: http.IncomingMessage): Promise<{ body: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let sizeBytes = 0;

    response.on('data', (chunk: Buffer) => {
      sizeBytes += chunk.length;

      if (sizeBytes > MAX_BODY_BYTES) {
        response.destroy();
        reject(new Error('Response body exceeded 5MB limit.'));
        return;
      }

      chunks.push(chunk);
    });

    response.on('end', () => {
      resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        sizeBytes,
      });
    });

    response.on('error', reject);
  });
}

export async function executeApiRequest(payload: ApiSendRequestPayload): Promise<ApiHttpResponse> {
  const variables = payload.variables;
  const request = payload.request;
  const url = buildUrl(request, variables);
  const headers = buildHeaders(request, variables);
  const bodyPayload = buildBody(request, variables);
  const mergedHeaders = { ...headers, ...bodyPayload.headers };
  const client = url.protocol === 'https:' ? https : http;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: request.method,
        headers: mergedHeaders,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        void readResponseBody(response)
          .then(({ body, sizeBytes }) => {
            const responseHeaders: Record<string, string> = {};

            for (const [key, value] of Object.entries(response.headers)) {
              if (typeof value === 'string') {
                responseHeaders[key] = value;
                continue;
              }

              if (Array.isArray(value)) {
                responseHeaders[key] = value.join(', ');
              }
            }

            resolve({
              status: response.statusCode ?? 0,
              statusText: response.statusMessage ?? '',
              headers: responseHeaders,
              body,
              durationMs: Date.now() - startedAt,
              sizeBytes,
            });
          })
          .catch(reject);
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out.'));
    });

    req.on('error', reject);

    if (bodyPayload.body !== null) {
      req.write(bodyPayload.body);
    }

    req.end();
  });
}
