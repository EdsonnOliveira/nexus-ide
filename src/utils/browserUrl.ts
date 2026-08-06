export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);

      if (
        parsed.hostname === 'www.google.com' &&
        parsed.pathname === '/search'
      ) {
        const query = parsed.searchParams.get('q')?.trim() ?? '';

        if (/^(about|chrome-error):/i.test(query)) {
          return 'https://www.google.com';
        }
      }
    } catch {
      return trimmed;
    }

    return trimmed;
  }

  if (/^(about|chrome-error|data|blob|file|devtools):/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }

  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
