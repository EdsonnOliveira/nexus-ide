const ARTIFACT_EXT_PATTERN = /\.(?:aab|apk|ipa)\b/i;

export function sanitizeMobileArtifactPath(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const cleaned = raw
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();

  if (!cleaned) {
    return null;
  }

  const absoluteMatch = cleaned.match(/((?:\/|[A-Za-z]:[\\/])[^\s'"`]+?\.(?:aab|apk|ipa))\b/i);

  if (absoluteMatch?.[1]) {
    return absoluteMatch[1];
  }

  const relativeMatch = cleaned.match(/((?:\.\/)?(?:[\w.@-]+\/)+[^\s'"`]+?\.(?:aab|apk|ipa))\b/i);

  if (relativeMatch?.[1]) {
    return relativeMatch[1];
  }

  const firstToken = cleaned.split(/\s+/)[0] ?? '';

  if (ARTIFACT_EXT_PATTERN.test(firstToken)) {
    return firstToken.replace(/^['"`]+|['"`]+$/g, '');
  }

  return null;
}

export function resolveMobileArtifactAbsolutePath(
  projectPath: string | null | undefined,
  artifactPath: string | null | undefined,
): string | null {
  const sanitized = sanitizeMobileArtifactPath(artifactPath) ?? artifactPath?.trim() ?? null;

  if (!sanitized) {
    return null;
  }

  if (sanitized.startsWith('/') || /^[A-Za-z]:[\\/]/.test(sanitized)) {
    return sanitized;
  }

  const base = projectPath?.replace(/\\/g, '/').replace(/\/+$/, '') ?? '';

  if (!base) {
    return sanitized.includes('/') ? sanitized : null;
  }

  const relative = sanitized.replace(/^\.\//, '');
  return `${base}/${relative}`;
}

export function canOpenMobileArtifact(artifactPath: string | null | undefined): boolean {
  const resolved = sanitizeMobileArtifactPath(artifactPath) ?? artifactPath?.trim() ?? '';
  return Boolean(resolved && (resolved.includes('/') || ARTIFACT_EXT_PATTERN.test(resolved)));
}
