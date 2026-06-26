export interface ParsedJiraIntegrationInput {
  siteUrl: string;
  projectKey?: string;
}

export function parseJiraIntegrationInput(rawUrl: string): ParsedJiraIntegrationInput {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return { siteUrl: '' };
  }

  try {
    const withProtocol = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    const siteUrl = `${url.protocol}//${url.host}`;
    const projectPathMatch = url.pathname.match(/\/projects\/([A-Z][A-Z0-9]+)/i);
    const browseMatch = url.pathname.match(/\/browse\/([A-Z][A-Z0-9]+)-\d+/i);

    if (projectPathMatch) {
      return { siteUrl, projectKey: projectPathMatch[1].toUpperCase() };
    }

    if (browseMatch) {
      return { siteUrl, projectKey: browseMatch[1].toUpperCase() };
    }

    return { siteUrl };
  } catch {
    return { siteUrl: trimmed.replace(/\/+$/, '') };
  }
}

export function buildJiraIssueUrl(siteUrl: string, issueKey: string): string | null {
  const normalizedSite = parseJiraIntegrationInput(siteUrl).siteUrl;
  const key = issueKey.trim();

  if (!normalizedSite || !key) {
    return null;
  }

  const site = normalizedSite.startsWith('http://') || normalizedSite.startsWith('https://')
    ? normalizedSite
    : `https://${normalizedSite}`;

  return `${site.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;
}

export function formatTaskIntegrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha ao conectar';
  const normalized = message
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error invoking remote method '[^']+': /, '');

  if (/status 410/i.test(normalized) || /search\/jql/i.test(normalized) || /deprecated/i.test(normalized)) {
    return 'A API de busca do Jira foi descontinuada. Atualize o Nexus IDE e tente sincronizar novamente.';
  }

  return normalized;
}
