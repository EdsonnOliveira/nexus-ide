export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type ApiBodyType = 'none' | 'json' | 'text' | 'form-urlencoded';

export type ApiAuthType = 'none' | 'bearer' | 'basic';

export interface ApiKeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  query: ApiKeyValue[];
  headers: ApiKeyValue[];
  bodyType: ApiBodyType;
  body: string;
  authType: ApiAuthType;
  authBearer: string;
  authBasicUser: string;
  authBasicPass: string;
}

export interface ApiTab {
  id: string;
  title: string;
  type: 'api';
  requestId: string | null;
  collectionId: string | null;
  pinned?: boolean;
  badgeColorIndex?: number;
}

export interface ApiEnvironment {
  id: string;
  name: string;
  variables: ApiKeyValue[];
}

export interface ApiCollectionItem {
  id: string;
  name: string;
  request: ApiRequest;
}

export interface ApiCollectionFolder {
  id: string;
  name: string;
  items: ApiCollectionItem[];
  folders: ApiCollectionFolder[];
}

export interface ApiHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  sizeBytes: number;
}

export interface ApiHistoryEntry {
  id: string;
  executedAt: number;
  request: ApiRequest;
  response: ApiHttpResponse;
}

export interface ApiProjectData {
  collections: ApiCollectionFolder[];
  environments: ApiEnvironment[];
  activeEnvironmentId: string | null;
  history: ApiHistoryEntry[];
}

export interface ApiSendRequestPayload {
  request: ApiRequest;
  variables: Record<string, string>;
}
