import type { ApiBodyType, ApiRequest, HttpMethod } from '@/types/api';
import { createDefaultApiRequest } from '@/utils/apiDefaults';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function tokenizeCurl(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        tokens.push(current);
        current = '';
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function nextValue(tokens: string[], startIndex: number): { value: string; nextIndex: number } {
  const token = tokens[startIndex];

  if (!token) {
    return { value: '', nextIndex: startIndex + 1 };
  }

  if (token.startsWith('=')) {
    return { value: token.slice(1), nextIndex: startIndex + 1 };
  }

  return { value: token, nextIndex: startIndex + 1 };
}

export function parseCurl(input: string): ApiRequest {
  const request = createDefaultApiRequest('Importada');
  const normalized = input.trim().replace(/\\\r?\n/g, ' ');

  if (!normalized.toLowerCase().includes('curl')) {
    return request;
  }

  const tokens = tokenizeCurl(normalized);
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];

    if (token === 'curl') {
      index += 1;
      continue;
    }

    if (token === '-X' || token === '--request') {
      index += 1;
      const method = tokens[index]?.toUpperCase() as HttpMethod | undefined;

      if (method && METHODS.includes(method)) {
        request.method = method;
      }

      index += 1;
      continue;
    }

    if (token === '-H' || token === '--header') {
      index += 1;
      const headerValue = tokens[index] ?? '';
      const separator = headerValue.indexOf(':');
      const key = separator >= 0 ? headerValue.slice(0, separator).trim() : headerValue.trim();
      const value = separator >= 0 ? headerValue.slice(separator + 1).trim() : '';

      if (key.toLowerCase() === 'authorization' && value.toLowerCase().startsWith('bearer ')) {
        request.authType = 'bearer';
        request.authBearer = value.slice(7).trim();
      } else if (key) {
        request.headers.push({
          id: crypto.randomUUID(),
          key,
          value,
          enabled: true,
        });
      }

      index += 1;
      continue;
    }

    if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
      index += 1;
      const body = tokens[index] ?? '';
      request.body = body;
      request.bodyType = body.includes('=') && !body.trim().startsWith('{') ? 'form-urlencoded' : 'json';
      if (request.method === 'GET') {
        request.method = 'POST';
      }
      index += 1;
      continue;
    }

    if (token === '-u' || token === '--user') {
      index += 1;
      const credentials = tokens[index] ?? '';
      const separator = credentials.indexOf(':');
      request.authType = 'basic';
      request.authBasicUser = separator >= 0 ? credentials.slice(0, separator) : credentials;
      request.authBasicPass = separator >= 0 ? credentials.slice(separator + 1) : '';
      index += 1;
      continue;
    }

    if (token.startsWith('http://') || token.startsWith('https://')) {
      request.url = token;
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      const combined = token.includes('=') ? token : `${token}${tokens[index + 1] ?? ''}`;
      const { value, nextIndex } = nextValue([combined], 0);
      index = token.includes('=') ? index + 1 : nextIndex + index;

      if (combined.startsWith('--data') || combined.startsWith('-d')) {
        request.body = value;
        request.bodyType = 'text';
      }

      continue;
    }

    index += 1;
  }

  if (request.bodyType === 'json' && request.body && !request.headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    request.headers.push({
      id: crypto.randomUUID(),
      key: 'Content-Type',
      value: 'application/json',
      enabled: true,
    });
  }

  return request;
}
