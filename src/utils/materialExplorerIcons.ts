import type { Manifest } from 'material-icon-theme';
import materialIconsManifest from 'material-icon-theme/dist/material-icons.json';

const manifest = materialIconsManifest as Manifest;

const iconModules = import.meta.glob<string>('../../node_modules/material-icon-theme/icons/*.svg', {
  query: '?url',
  import: 'default',
});

const iconUrlCache = new Map<string, string>();
const iconLoadQueue = new Map<string, Promise<string | null>>();

function normalizeFolderKeys(folderName: string): string[] {
  const lower = folderName.toLowerCase();
  const stripped = lower.replace(/^\.+/, '');

  return [...new Set([lower, stripped])];
}

export function resolveMaterialFileIconKey(fileName: string): string {
  const lower = fileName.toLowerCase();
  const fileNames = manifest.fileNames ?? {};
  const fileExtensions = manifest.fileExtensions ?? {};
  const exactName = fileNames[lower] ?? fileNames[fileName];

  if (exactName) {
    return exactName;
  }

  const segments = lower.split('.');

  if (segments.length > 1) {
    for (let index = 1; index < segments.length; index += 1) {
      const compound = segments.slice(index).join('.');
      const byCompound = fileExtensions[compound];

      if (byCompound) {
        return byCompound;
      }
    }
  }

  const lastExtension = segments[segments.length - 1];
  const byExtension = lastExtension ? fileExtensions[lastExtension] : undefined;

  if (byExtension) {
    return byExtension;
  }

  return manifest.file ?? 'file';
}

export function resolveMaterialFolderIconKey(folderName: string, expanded: boolean): string {
  const map = expanded ? (manifest.folderNamesExpanded ?? {}) : (manifest.folderNames ?? {});

  for (const key of normalizeFolderKeys(folderName)) {
    const iconKey = map[key];

    if (iconKey) {
      return iconKey;
    }
  }

  if (expanded) {
    return manifest.folderExpanded ?? manifest.folder ?? 'folder-open';
  }

  return manifest.folder ?? 'folder';
}

function resolveIconFileName(iconKey: string): string | null {
  const definition = manifest.iconDefinitions?.[iconKey];

  if (!definition?.iconPath) {
    return null;
  }

  const segments = definition.iconPath.split('/');

  return segments[segments.length - 1] ?? null;
}

export async function loadMaterialIconUrl(iconKey: string): Promise<string | null> {
  const cached = iconUrlCache.get(iconKey);

  if (cached) {
    return cached;
  }

  const pending = iconLoadQueue.get(iconKey);

  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    const fileName = resolveIconFileName(iconKey);

    if (!fileName) {
      return null;
    }

    const moduleKey = `../../node_modules/material-icon-theme/icons/${fileName}`;
    const loader = iconModules[moduleKey];

    if (!loader) {
      return null;
    }

    const url = await loader();
    iconUrlCache.set(iconKey, url);
    return url;
  })();

  iconLoadQueue.set(iconKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    iconLoadQueue.delete(iconKey);
  }
}

export function getCachedMaterialIconUrl(iconKey: string): string | null {
  return iconUrlCache.get(iconKey) ?? null;
}
