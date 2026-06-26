import type {
  ApiBodyType,
  ApiCollectionFolder,
  ApiCollectionItem,
  ApiEnvironment,
  ApiKeyValue,
  ApiRequest,
  HttpMethod,
} from '@/types/api';
import { createApiKeyValue } from '@/utils/apiDefaults';

export function findCollectionItem(
  collections: ApiCollectionFolder[],
  requestId: string,
): { folder: ApiCollectionFolder; item: ApiCollectionItem } | null {
  for (const folder of collections) {
    const item = folder.items.find((entry) => entry.id === requestId);

    if (item) {
      return { folder, item };
    }

    const nested = findCollectionItem(folder.folders, requestId);

    if (nested) {
      return nested;
    }
  }

  return null;
}

export function updateCollectionTree(
  folders: ApiCollectionFolder[],
  folderId: string,
  updater: (folder: ApiCollectionFolder) => ApiCollectionFolder,
): ApiCollectionFolder[] {
  return folders.map((folder) => {
    if (folder.id === folderId) {
      return updater(folder);
    }

    return {
      ...folder,
      folders: updateCollectionTree(folder.folders, folderId, updater),
    };
  });
}

export function upsertCollectionItem(
  folders: ApiCollectionFolder[],
  folderId: string,
  item: ApiCollectionItem,
): ApiCollectionFolder[] {
  return updateCollectionTree(folders, folderId, (folder) => {
    const existingIndex = folder.items.findIndex((entry) => entry.id === item.id);

    if (existingIndex === -1) {
      return {
        ...folder,
        items: [...folder.items, item],
      };
    }

    const nextItems = [...folder.items];
    nextItems[existingIndex] = item;
    return {
      ...folder,
      items: nextItems,
    };
  });
}

export function removeCollectionFolder(
  folders: ApiCollectionFolder[],
  folderId: string,
): ApiCollectionFolder[] {
  return folders
    .filter((folder) => folder.id !== folderId)
    .map((folder) => ({
      ...folder,
      folders: removeCollectionFolder(folder.folders, folderId),
    }));
}

export function renameCollectionFolder(
  folders: ApiCollectionFolder[],
  folderId: string,
  name: string,
): ApiCollectionFolder[] {
  return updateCollectionTree(folders, folderId, (folder) => ({
    ...folder,
    name,
  }));
}

export function renameCollectionItem(
  folders: ApiCollectionFolder[],
  folderId: string,
  itemId: string,
  name: string,
): ApiCollectionFolder[] {
  return updateCollectionTree(folders, folderId, (folder) => ({
    ...folder,
    items: folder.items.map((item) =>
      item.id === itemId ? { ...item, name, request: { ...item.request, name } } : item,
    ),
  }));
}

export function removeCollectionItem(
  folders: ApiCollectionFolder[],
  folderId: string,
  itemId: string,
): ApiCollectionFolder[] {
  return updateCollectionTree(folders, folderId, (folder) => ({
    ...folder,
    items: folder.items.filter((item) => item.id !== itemId),
  }));
}

export function collectionContainsRequestId(
  folder: ApiCollectionFolder,
  requestId: string,
): boolean {
  if (folder.items.some((item) => item.id === requestId)) {
    return true;
  }

  return folder.folders.some((nested) => collectionContainsRequestId(nested, requestId));
}

export function serializeFormBody(entries: ApiKeyValue[]): string {
  return entries
    .filter((entry) => entry.enabled && entry.key.trim())
    .map((entry) => `${encodeURIComponent(entry.key.trim())}=${encodeURIComponent(entry.value)}`)
    .join('&');
}

export function parseFormBody(body: string): ApiKeyValue[] {
  if (!body.trim()) {
    return [];
  }

  return body.split('&').map((pair) => {
    const separator = pair.indexOf('=');
    const key = separator >= 0 ? decodeURIComponent(pair.slice(0, separator)) : pair;
    const value = separator >= 0 ? decodeURIComponent(pair.slice(separator + 1)) : '';

    return {
      id: crypto.randomUUID(),
      key,
      value,
      enabled: true,
    };
  });
}

export const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

export function getApiMethodToneClass(method: HttpMethod): string {
  return `api-view__method-tone--${method.toLowerCase()}`;
}

export function getContentTypeForBodyType(bodyType: ApiBodyType): string {
  switch (bodyType) {
    case 'json':
      return 'application/json';
    case 'text':
      return 'text/plain';
    case 'form-urlencoded':
      return 'application/x-www-form-urlencoded';
    default:
      return 'application/json';
  }
}

export function isContentTypeHeaderEnabled(bodyType: ApiBodyType, method: HttpMethod): boolean {
  if (bodyType === 'none') {
    return false;
  }

  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function syncApiHeadersWithBodyType(
  headers: ApiKeyValue[],
  bodyType: ApiBodyType,
  method: HttpMethod,
): ApiKeyValue[] {
  const contentTypeValue = getContentTypeForBodyType(bodyType);
  const contentTypeEnabled = isContentTypeHeaderEnabled(bodyType, method);

  const customHeaders = headers.filter((entry) => {
    const key = entry.key.trim().toLowerCase();
    return key !== 'accept' && key !== 'content-type';
  });

  const existingAccept = headers.find((entry) => entry.key.trim().toLowerCase() === 'accept');
  const existingContentType = headers.find((entry) => entry.key.trim().toLowerCase() === 'content-type');

  const acceptHeader = existingAccept
    ? {
        ...existingAccept,
        key: 'Accept',
        value: existingAccept.value || 'application/json',
      }
    : createApiKeyValue('Accept', 'application/json');

  const contentTypeHeader = existingContentType
    ? {
        ...existingContentType,
        key: 'Content-Type',
        value: existingContentType.value || contentTypeValue,
        enabled: contentTypeEnabled,
      }
    : createApiKeyValue('Content-Type', contentTypeValue, contentTypeEnabled);

  return [acceptHeader, contentTypeHeader, ...customHeaders];
}

export function createDefaultApiHeaders(
  bodyType: ApiBodyType = 'none',
  method: HttpMethod = 'GET',
): ApiKeyValue[] {
  return syncApiHeadersWithBodyType([], bodyType, method);
}
