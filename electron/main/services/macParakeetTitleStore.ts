import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { MacParakeetTranscriptionItem } from '../../types';

interface MacParakeetTitleStoreFile {
  titles: Record<string, string>;
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'macparakeet-title-overrides.json');
}

let cache: MacParakeetTitleStoreFile | null = null;

function loadStore(): MacParakeetTitleStoreFile {
  if (cache) {
    return cache;
  }

  const filePath = getStorePath();

  if (existsSync(filePath)) {
    try {
      cache = JSON.parse(readFileSync(filePath, 'utf8')) as MacParakeetTitleStoreFile;
      return cache;
    } catch {
      cache = { titles: {} };
      return cache;
    }
  }

  cache = { titles: {} };
  return cache;
}

function persistStore(store: MacParakeetTitleStoreFile): void {
  cache = store;
  const filePath = getStorePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store));
}

export function getMacParakeetTitleOverride(id: string): string | null {
  const trimmedId = id.trim();
  if (!trimmedId) {
    return null;
  }

  const title = loadStore().titles[trimmedId]?.trim();
  return title || null;
}

export function setMacParakeetTitleOverride(id: string, title: string): string | null {
  const trimmedId = id.trim();
  const trimmedTitle = title.trim();

  if (!trimmedId || !trimmedTitle) {
    return null;
  }

  const store = loadStore();
  store.titles[trimmedId] = trimmedTitle;
  persistStore(store);
  return trimmedTitle;
}

export function applyMacParakeetTitleOverride<T extends MacParakeetTranscriptionItem>(item: T): T {
  const override = getMacParakeetTitleOverride(item.id);
  if (!override) {
    return item;
  }

  return {
    ...item,
    title: override,
  };
}
