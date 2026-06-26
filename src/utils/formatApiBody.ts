export function formatApiBody(body: string, contentType: string | null): string {
  if (!body) {
    return '';
  }

  const normalized = contentType?.toLowerCase() ?? '';

  if (normalized.includes('application/json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  return body;
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
