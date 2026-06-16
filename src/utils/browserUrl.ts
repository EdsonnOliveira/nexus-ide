export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
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
