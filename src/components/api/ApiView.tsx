import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { monokaiInit } from '@uiw/codemirror-theme-monokai';
import { EditorView } from '@codemirror/view';
import {
  Braces,
  CircleOff,
  ClipboardPaste,
  FileCode2,
  FolderOpen,
  FolderPlus,
  FormInput,
  Heading,
  History,
  Inbox,
  ListFilter,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiVariableInput } from '@/components/api/ApiVariableInput';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { useApiProjectData } from '@/hooks/useApiProjectData';
import { usePendingApiRequestStore } from '@/stores/usePendingApiRequestStore';
import { useApiRequest } from '@/hooks/useApiRequest';
import type {
  ApiBodyType,
  ApiCollectionItem,
  ApiKeyValue,
  ApiRequest,
  ApiTab,
} from '@/types/api';
import {
  createApiKeyValue,
  createDefaultApiRequest,
  createDefaultCollection,
  createDefaultEnvironment,
} from '@/utils/apiDefaults';
import {
  collectionContainsRequestId,
  createDefaultApiHeaders,
  findCollectionItem,
  getApiMethodToneClass,
  HTTP_METHODS,
  parseFormBody,
  removeCollectionFolder,
  removeCollectionItem,
  renameCollectionFolder,
  renameCollectionItem,
  serializeFormBody,
  syncApiHeadersWithBodyType,
  upsertCollectionItem,
} from '@/utils/apiCollectionUtils';
import { formatApiBody, formatBytes } from '@/utils/formatApiBody';
import { parseCurl } from '@/utils/parseCurl';
import { renameApiVariableReference } from '@/utils/substituteApiVariables';
import { AUTOMATION_API_COLLECTION_ID } from '@/utils/automationApiRequest';

interface ApiViewProps {
  tab: ApiTab;
  projectId: string;
  isVisible: boolean;
  isRuntimeActive: boolean;
  isFocused: boolean;
  onFocusPane: (paneId: string) => void;
  onUpdateTab: (
    tabId: string,
    patch: Partial<Pick<ApiTab, 'requestId' | 'collectionId' | 'title'>>,
  ) => void;
}

type RequestSection = 'params' | 'headers' | 'body' | 'auth';

const apiEditorTheme = monokaiInit({
  settings: {
    background: 'transparent',
    gutterBackground: 'transparent',
    lineHighlight: 'transparent',
    gutterForeground: 'rgba(255, 255, 255, 0.38)',
  },
});

const apiEditorBaseExtensions = [
  EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      lineHeight: '1.6',
    },
    '.cm-gutters': {
      borderRight: 'none',
    },
    '.cm-content': {
      caretColor: '#f8f8f2',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#f8f8f2',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  }),
  EditorView.lineWrapping,
];

const responseEditorTheme = apiEditorTheme;

const responseEditorExtensions = [
  json(),
  ...apiEditorBaseExtensions,
];

const jsonBodyEditorExtensions = [json(), ...apiEditorBaseExtensions];

const jsonBodyEditorSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: false,
  closeBrackets: true,
  closeBracketsKeymap: true,
  bracketMatching: true,
  indentOnInput: true,
  autocompletion: false,
} as const;

interface ApiPanelEmptyProps {
  message: string;
  icon: LucideIcon;
  compact?: boolean;
}

function ApiPanelEmpty({ message, icon: Icon, compact = false }: ApiPanelEmptyProps) {
  return (
    <div className={`api-view__empty-state${compact ? ' api-view__empty-state--compact' : ''}`}>
      <div className='api-view__empty-state-icon' aria-hidden='true'>
        <Icon size={compact ? 16 : 22} strokeWidth={1.75} />
      </div>
      <span>{message}</span>
    </div>
  );
}

interface KeyValueEditorProps {
  entries: ApiKeyValue[];
  onChange: (entries: ApiKeyValue[]) => void;
  variant?: 'inline' | 'modal';
  variableValues?: boolean;
  emptyMessage?: string;
  emptyIcon?: LucideIcon;
  onVariableDoubleClick?: (variableName: string) => void;
}

function KeyValueEditor({
  entries,
  onChange,
  variant = 'inline',
  variableValues = false,
  emptyMessage,
  emptyIcon,
  onVariableDoubleClick,
}: KeyValueEditorProps) {
  const updateEntry = useCallback(
    (entryId: string, patch: Partial<ApiKeyValue>) => {
      onChange(
        entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
      );
    },
    [entries, onChange],
  );

  const removeEntry = useCallback(
    (entryId: string) => {
      onChange(entries.filter((entry) => entry.id !== entryId));
    },
    [entries, onChange],
  );

  const addEntry = useCallback(() => {
    onChange([...entries, createApiKeyValue()]);
  }, [entries, onChange]);

  const isEmpty = entries.length === 0;

  return (
    <div
      className={`api-view__kv-table${variant === 'modal' ? ' api-view__kv-table--modal' : ''}${isEmpty && emptyMessage ? ' api-view__kv-table--empty' : ''}`}
    >
      {isEmpty && emptyMessage && emptyIcon ? (
        <div className='api-view__kv-empty'>
          <ApiPanelEmpty message={emptyMessage} icon={emptyIcon} compact />
          <button
            type='button'
            className='api-view__kv-empty-add app-button app-button--enter'
            onClick={addEntry}
          >
            <Plus size={14} />
            Adicionar
          </button>
        </div>
      ) : null}
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`api-view__kv-row${entry.enabled ? '' : ' api-view__kv-row--disabled'}`}
        >
          <AppCheckbox
            checked={entry.enabled}
            onChange={(enabled) => updateEntry(entry.id, { enabled })}
            aria-label='Ativar campo'
          />
          <input
            className='api-view__kv-input'
            value={entry.key}
            placeholder='Chave'
            disabled={!entry.enabled}
            onChange={(event) => updateEntry(entry.id, { key: event.target.value })}
          />
          {variableValues ? (
            <ApiVariableInput
              className='api-view__kv-input'
              value={entry.value}
              placeholder='Valor'
              disabled={!entry.enabled}
              onChange={(nextValue) => updateEntry(entry.id, { value: nextValue })}
              onVariableDoubleClick={onVariableDoubleClick}
            />
          ) : (
            <input
              className='api-view__kv-input'
              value={entry.value}
              placeholder='Valor'
              disabled={!entry.enabled}
              onChange={(event) => updateEntry(entry.id, { value: event.target.value })}
            />
          )}
          <button
            type='button'
            className='api-view__icon-button app-button'
            onClick={() => removeEntry(entry.id)}
            aria-label='Remover campo'
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {!isEmpty ? (
        <button type='button' className='api-view__add-row app-button app-button--enter' onClick={addEntry}>
          <Plus size={14} />
          Adicionar
        </button>
      ) : null}
    </div>
  );
}

type EnvironmentModalState =
  | { mode: 'create' }
  | { mode: 'edit'; environmentId: string };

type CollectionModalState = { mode: 'create' } | { mode: 'edit'; collectionId: string };

interface EnvironmentDraft {
  name: string;
  variables: ApiKeyValue[];
}

interface CollectionDraft {
  name: string;
}

interface VariableEditDraft {
  originalName: string;
  key: string;
  value: string;
}

interface RequestDeleteTarget {
  collectionId: string;
  requestId: string;
}

type RequestModalState = { mode: 'edit'; collectionId: string; requestId: string };

interface RequestDraft {
  name: string;
}

function ApiViewComponent({
  tab,
  projectId,
  isVisible,
  isRuntimeActive,
  isFocused,
  onFocusPane,
  onUpdateTab,
}: ApiViewProps) {
  const { data, isLoading, updateData } = useApiProjectData(projectId, isRuntimeActive);
  const activeEnvironment = useMemo(
    () => data.environments.find((environment) => environment.id === data.activeEnvironmentId) ?? null,
    [data.activeEnvironmentId, data.environments],
  );
  const environmentOptions = useMemo(
    () => data.environments.map((environment) => ({ value: environment.id, label: environment.name })),
    [data.environments],
  );
  const methodOptions = useMemo(
    () =>
      HTTP_METHODS.map((method) => ({
        value: method,
        label: method,
        className: getApiMethodToneClass(method),
      })),
    [],
  );
  const authOptions = useMemo(
    () =>
      [
        { value: 'none' as const, label: 'Nenhuma' },
        { value: 'bearer' as const, label: 'Bearer' },
        { value: 'basic' as const, label: 'Basic' },
      ] satisfies { value: ApiRequest['authType']; label: string }[],
    [],
  );
  const { request, setRequest, response, setResponse, error, isSending, sendRequest } =
    useApiRequest(activeEnvironment);
  const [section, setSection] = useState<RequestSection>('params');
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [environmentModal, setEnvironmentModal] = useState<EnvironmentModalState | null>(null);
  const [environmentDraft, setEnvironmentDraft] = useState<EnvironmentDraft | null>(null);
  const [collectionModal, setCollectionModal] = useState<CollectionModalState | null>(null);
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft | null>(null);
  const [collectionDeleteId, setCollectionDeleteId] = useState<string | null>(null);
  const [requestDeleteTarget, setRequestDeleteTarget] = useState<RequestDeleteTarget | null>(null);
  const [requestModal, setRequestModal] = useState<RequestModalState | null>(null);
  const [requestDraft, setRequestDraft] = useState<RequestDraft | null>(null);
  const [environmentDeleteId, setEnvironmentDeleteId] = useState<string | null>(null);
  const [variableEditDraft, setVariableEditDraft] = useState<VariableEditDraft | null>(null);
  const [formBodyEntries, setFormBodyEntries] = useState<ApiKeyValue[]>([]);
  const automationSentRef = useRef(false);
  const collectionToDelete = useMemo(
    () => data.collections.find((collection) => collection.id === collectionDeleteId) ?? null,
    [collectionDeleteId, data.collections],
  );
  const environmentToDelete = useMemo(
    () => data.environments.find((environment) => environment.id === environmentDeleteId) ?? null,
    [environmentDeleteId, data.environments],
  );
  const requestToDelete = useMemo(() => {
    if (!requestDeleteTarget) {
      return null;
    }

    const match = findCollectionItem(data.collections, requestDeleteTarget.requestId);

    if (!match || match.folder.id !== requestDeleteTarget.collectionId) {
      return null;
    }

    return match;
  }, [data.collections, requestDeleteTarget]);

  useEffect(() => {
    if (!isRuntimeActive || request) {
      return;
    }

    if (tab.requestId) {
      const match = findCollectionItem(data.collections, tab.requestId);

      if (match) {
        setRequest({ ...match.item.request });
        return;
      }
    }

    setRequest(createDefaultApiRequest(tab.title));
  }, [data.collections, isRuntimeActive, request, setRequest, tab.requestId, tab.title]);

  useEffect(() => {
    if (!isRuntimeActive) {
      return;
    }

    const pending = usePendingApiRequestStore.getState().takePending(tab.id);

    if (!pending) {
      return;
    }

    setRequest({ ...pending.request });

    if (!pending.autoSend) {
      return;
    }

    void sendRequest(pending.request).then((result) => {
      if (!result) {
        return;
      }

      updateData((current) => ({
        ...current,
        history: [
          {
            id: crypto.randomUUID(),
            executedAt: Date.now(),
            request: { ...pending.request },
            response: result,
          },
          ...current.history,
        ].slice(0, 50),
      }));
    });
  }, [isRuntimeActive, sendRequest, setRequest, tab.id, updateData]);

  useEffect(() => {
    if (
      !isRuntimeActive ||
      !request ||
      tab.collectionId !== AUTOMATION_API_COLLECTION_ID ||
      automationSentRef.current
    ) {
      return;
    }

    automationSentRef.current = true;
    void sendRequest(request);
  }, [isRuntimeActive, request, sendRequest, tab.collectionId]);

  useEffect(() => {
    if (!request || request.headers.length > 0) {
      return;
    }

    setRequest((current) =>
      current
        ? {
            ...current,
            headers: createDefaultApiHeaders(current.bodyType, current.method),
          }
        : current,
    );
  }, [request?.headers.length, request?.bodyType, request?.method, setRequest]);

  useEffect(() => {
    if (!request || request.bodyType !== 'form-urlencoded') {
      return;
    }

    setFormBodyEntries(parseFormBody(request.body));
  }, [request?.body, request?.bodyType]);

  const handleMouseDown = useCallback(() => {
    onFocusPane(tab.id);
  }, [onFocusPane, tab.id]);

  const patchRequest = useCallback(
    (patch: Partial<ApiRequest>) => {
      setRequest((current) => (current ? { ...current, ...patch } : current));
    },
    [setRequest],
  );

  const handleSend = useCallback(async () => {
    if (!request) {
      return;
    }

    const result = await sendRequest(request);

    if (!result) {
      return;
    }

    updateData((current) => ({
      ...current,
      history: [
        {
          id: crypto.randomUUID(),
          executedAt: Date.now(),
          request: { ...request },
          response: result,
        },
        ...current.history,
      ].slice(0, 50),
    }));
  }, [request, sendRequest, updateData]);

  const handleImportCurl = useCallback(() => {
    const parsed = parseCurl(curlInput);
    setRequest(parsed);
    setCurlOpen(false);
    setCurlInput('');
  }, [curlInput, setRequest]);

  const handleSaveToCollection = useCallback(() => {
    if (!request) {
      return;
    }

    const nextCollections =
      data.collections.length > 0 ? data.collections : [createDefaultCollection('Coleção')];
    const resolvedCollectionId = tab.collectionId ?? nextCollections[0].id;
    const item: ApiCollectionItem = {
      id: tab.requestId ?? request.id,
      name: request.name,
      request: {
        ...request,
        id: tab.requestId ?? request.id,
      },
    };

    updateData((current) => ({
      ...current,
      collections: upsertCollectionItem(
        current.collections.length > 0 ? current.collections : nextCollections,
        resolvedCollectionId,
        item,
      ),
    }));

    void onUpdateTab(tab.id, {
      requestId: item.id,
      collectionId: resolvedCollectionId,
      title: request.name,
    });
  }, [data.collections, onUpdateTab, request, tab.collectionId, tab.id, tab.requestId, updateData]);

  const handleOpenCreateEnvironment = useCallback(() => {
    setEnvironmentDraft({
      name: `Ambiente ${data.environments.length + 1}`,
      variables: [createApiKeyValue('BASE_URL', 'http://localhost:3000')],
    });
    setEnvironmentModal({ mode: 'create' });
  }, [data.environments.length]);

  const handleOpenEditEnvironment = useCallback(() => {
    if (!activeEnvironment) {
      return;
    }

    setEnvironmentDraft({
      name: activeEnvironment.name,
      variables: activeEnvironment.variables.map((entry) => ({ ...entry })),
    });
    setEnvironmentModal({ mode: 'edit', environmentId: activeEnvironment.id });
  }, [activeEnvironment]);

  const handleCloseEnvironmentModal = useCallback(() => {
    setEnvironmentModal(null);
    setEnvironmentDraft(null);
  }, []);

  const handleOpenVariableEdit = useCallback(
    (variableName: string) => {
      if (!activeEnvironment) {
        return;
      }

      const entry = activeEnvironment.variables.find((item) => item.key.trim() === variableName);

      setVariableEditDraft({
        originalName: variableName,
        key: variableName,
        value: entry?.value ?? '',
      });
    },
    [activeEnvironment],
  );

  const handleCloseVariableEdit = useCallback(() => {
    setVariableEditDraft(null);
  }, []);

  const replaceVariableReferencesInRequest = useCallback(
    (oldName: string, newName: string) => {
      if (!request || oldName === newName) {
        return;
      }

      const replaceText = (text: string) => renameApiVariableReference(text, oldName, newName);

      patchRequest({
        url: replaceText(request.url),
        authBearer: replaceText(request.authBearer),
        authBasicUser: replaceText(request.authBasicUser),
        body: replaceText(request.body),
        query: request.query.map((entry) => ({
          ...entry,
          value: replaceText(entry.value),
        })),
        headers: request.headers.map((entry) => ({
          ...entry,
          value: replaceText(entry.value),
        })),
      });
    },
    [patchRequest, request],
  );

  const handleSaveVariableEdit = useCallback(
    (requestClose: () => void) => {
      if (!variableEditDraft || !activeEnvironment) {
        return;
      }

      const trimmedKey = variableEditDraft.key.trim();

      if (!trimmedKey) {
        return;
      }

      updateData((current) => ({
        ...current,
        environments: current.environments.map((environment) => {
          if (environment.id !== activeEnvironment.id) {
            return environment;
          }

          const existingIndex = environment.variables.findIndex(
            (entry) => entry.key.trim() === variableEditDraft.originalName,
          );
          const matchingIndex = environment.variables.findIndex(
            (entry) => entry.key.trim() === trimmedKey,
          );

          if (existingIndex >= 0) {
            const nextVariables = [...environment.variables];
            nextVariables[existingIndex] = {
              ...nextVariables[existingIndex],
              key: trimmedKey,
              value: variableEditDraft.value,
              enabled: true,
            };
            return { ...environment, variables: nextVariables };
          }

          if (matchingIndex >= 0) {
            const nextVariables = [...environment.variables];
            nextVariables[matchingIndex] = {
              ...nextVariables[matchingIndex],
              value: variableEditDraft.value,
              enabled: true,
            };
            return { ...environment, variables: nextVariables };
          }

          return {
            ...environment,
            variables: [...environment.variables, createApiKeyValue(trimmedKey, variableEditDraft.value)],
          };
        }),
      }));

      if (trimmedKey !== variableEditDraft.originalName) {
        replaceVariableReferencesInRequest(variableEditDraft.originalName, trimmedKey);
      }

      requestClose();
      setVariableEditDraft(null);
    },
    [
      activeEnvironment,
      replaceVariableReferencesInRequest,
      updateData,
      variableEditDraft,
    ],
  );

  const handleVariableDoubleClick = activeEnvironment ? handleOpenVariableEdit : undefined;

  const handleSaveEnvironment = useCallback(
    (requestClose: () => void) => {
      if (!environmentDraft || !environmentModal) {
        return;
      }

      const trimmedName = environmentDraft.name.trim();

      if (!trimmedName) {
        return;
      }

      if (environmentModal.mode === 'create') {
        const environment = createDefaultEnvironment(trimmedName);
        environment.variables = environmentDraft.variables;

        updateData((current) => ({
          ...current,
          environments: [...current.environments, environment],
          activeEnvironmentId: environment.id,
        }));
      } else {
        updateData((current) => ({
          ...current,
          environments: current.environments.map((environment) =>
            environment.id === environmentModal.environmentId
              ? {
                  ...environment,
                  name: trimmedName,
                  variables: environmentDraft.variables,
                }
              : environment,
          ),
        }));
      }

      requestClose();
      handleCloseEnvironmentModal();
    },
    [environmentDraft, environmentModal, handleCloseEnvironmentModal, updateData],
  );

  const handleCloseEnvironmentDelete = useCallback(() => {
    setEnvironmentDeleteId(null);
  }, []);

  const handleRequestDeleteEnvironment = useCallback(
    (environmentId: string, requestClose: () => void) => {
      setEnvironmentDeleteId(environmentId);
      requestClose();
      handleCloseEnvironmentModal();
    },
    [handleCloseEnvironmentModal],
  );

  const handleConfirmDeleteEnvironment = useCallback(
    (requestClose: () => void) => {
      if (!environmentDeleteId) {
        return;
      }

      updateData((current) => {
        const nextEnvironments = current.environments.filter(
          (environment) => environment.id !== environmentDeleteId,
        );
        const wasActive = current.activeEnvironmentId === environmentDeleteId;

        return {
          ...current,
          environments: nextEnvironments,
          activeEnvironmentId: wasActive
            ? (nextEnvironments[0]?.id ?? null)
            : current.activeEnvironmentId,
        };
      });

      requestClose();
      handleCloseEnvironmentDelete();
    },
    [environmentDeleteId, handleCloseEnvironmentDelete, updateData],
  );

  const handleOpenCollectionModal = useCallback(() => {
    setCollectionDraft({ name: `Coleção ${data.collections.length + 1}` });
    setCollectionModal({ mode: 'create' });
  }, [data.collections.length]);

  const handleOpenEditCollection = useCallback(
    (collectionId: string) => {
      const collection = data.collections.find((entry) => entry.id === collectionId);

      if (!collection) {
        return;
      }

      setCollectionDraft({ name: collection.name });
      setCollectionModal({ mode: 'edit', collectionId });
    },
    [data.collections],
  );

  const handleCloseCollectionModal = useCallback(() => {
    setCollectionModal(null);
    setCollectionDraft(null);
  }, []);

  const handleSaveCollection = useCallback(
    (requestClose: () => void) => {
      if (!collectionDraft || !collectionModal) {
        return;
      }

      const trimmedName = collectionDraft.name.trim();

      if (!trimmedName) {
        return;
      }

      if (collectionModal.mode === 'create') {
        const collection = createDefaultCollection(trimmedName);
        updateData((current) => ({
          ...current,
          collections: [...current.collections, collection],
        }));
      } else {
        updateData((current) => ({
          ...current,
          collections: renameCollectionFolder(
            current.collections,
            collectionModal.collectionId,
            trimmedName,
          ),
        }));
      }

      requestClose();
      handleCloseCollectionModal();
    },
    [collectionDraft, collectionModal, handleCloseCollectionModal, updateData],
  );

  const handleRequestDeleteCollection = useCallback(
    (collectionId: string, requestClose: () => void) => {
      setCollectionDeleteId(collectionId);
      requestClose();
      handleCloseCollectionModal();
    },
    [handleCloseCollectionModal],
  );

  const handleCloseCollectionDelete = useCallback(() => {
    setCollectionDeleteId(null);
  }, []);

  const handleConfirmDeleteCollection = useCallback(
    (requestClose: () => void) => {
      if (!collectionDeleteId || !collectionToDelete) {
        return;
      }

      const shouldClearTabLink =
        tab.collectionId === collectionDeleteId ||
        (tab.requestId ? collectionContainsRequestId(collectionToDelete, tab.requestId) : false);

      updateData((current) => ({
        ...current,
        collections: removeCollectionFolder(current.collections, collectionDeleteId),
      }));

      if (shouldClearTabLink) {
        void onUpdateTab(tab.id, {
          collectionId: null,
          requestId: null,
        });
      }

      requestClose();
      handleCloseCollectionDelete();
    },
    [
      collectionDeleteId,
      collectionToDelete,
      handleCloseCollectionDelete,
      onUpdateTab,
      tab.collectionId,
      tab.id,
      tab.requestId,
      updateData,
    ],
  );

  const handleCloseRequestDelete = useCallback(() => {
    setRequestDeleteTarget(null);
  }, []);

  const handleOpenEditRequest = useCallback(
    (collectionId: string, requestId: string) => {
      const match = findCollectionItem(data.collections, requestId);

      if (!match || match.folder.id !== collectionId) {
        return;
      }

      setRequestDraft({ name: match.item.name });
      setRequestModal({ mode: 'edit', collectionId, requestId });
    },
    [data.collections],
  );

  const handleCloseRequestModal = useCallback(() => {
    setRequestModal(null);
    setRequestDraft(null);
  }, []);

  const handleSaveRequest = useCallback(
    (requestClose: () => void) => {
      if (!requestDraft || !requestModal) {
        return;
      }

      const trimmedName = requestDraft.name.trim();

      if (!trimmedName) {
        return;
      }

      updateData((current) => ({
        ...current,
        collections: renameCollectionItem(
          current.collections,
          requestModal.collectionId,
          requestModal.requestId,
          trimmedName,
        ),
      }));

      if (tab.requestId === requestModal.requestId) {
        setRequest((current) => (current ? { ...current, name: trimmedName } : current));
        void onUpdateTab(tab.id, { title: trimmedName });
      }

      requestClose();
      handleCloseRequestModal();
    },
    [handleCloseRequestModal, onUpdateTab, requestDraft, requestModal, setRequest, tab.id, tab.requestId, updateData],
  );

  const handleConfirmDeleteRequest = useCallback(
    (requestClose: () => void) => {
      if (!requestDeleteTarget || !requestToDelete) {
        return;
      }

      updateData((current) => ({
        ...current,
        collections: removeCollectionItem(
          current.collections,
          requestDeleteTarget.collectionId,
          requestDeleteTarget.requestId,
        ),
      }));

      if (tab.requestId === requestDeleteTarget.requestId) {
        void onUpdateTab(tab.id, {
          collectionId: null,
          requestId: null,
        });
      }

      requestClose();
      handleCloseRequestDelete();
    },
    [
      handleCloseRequestDelete,
      onUpdateTab,
      requestDeleteTarget,
      requestToDelete,
      tab.id,
      tab.requestId,
      updateData,
    ],
  );

  const handleSelectRequest = useCallback(
    (item: ApiCollectionItem, collectionId: string) => {
      setRequest({ ...item.request });
      setResponse(null);
      void onUpdateTab(tab.id, {
        requestId: item.id,
        collectionId,
        title: item.name,
      });
    },
    [onUpdateTab, setRequest, setResponse, tab.id],
  );

  const handleSelectHistory = useCallback(
    (historyRequest: ApiRequest) => {
      setRequest({ ...historyRequest });
      setResponse(null);
    },
    [setRequest, setResponse],
  );

  const handleBodyTypeChange = useCallback(
    (bodyType: ApiBodyType) => {
      setRequest((current) =>
        current
          ? {
              ...current,
              bodyType,
              headers: syncApiHeadersWithBodyType(current.headers, bodyType, current.method),
            }
          : current,
      );
    },
    [setRequest],
  );

  const handleMethodChange = useCallback(
    (method: ApiRequest['method']) => {
      setRequest((current) =>
        current
          ? {
              ...current,
              method,
              headers: syncApiHeadersWithBodyType(current.headers, current.bodyType, method),
            }
          : current,
      );
    },
    [setRequest],
  );

  const handleFormBodyChange = useCallback(
    (entries: ApiKeyValue[]) => {
      setFormBodyEntries(entries);
      patchRequest({ body: serializeFormBody(entries) });
    },
    [patchRequest],
  );

  const responseBody = useMemo(() => {
    if (!response) {
      return '';
    }

    return formatApiBody(response.body, response.headers['content-type'] ?? null);
  }, [response]);

  if (!request || isLoading) {
    return (
      <div className='api-view api-view--loading' onMouseDown={handleMouseDown}>
        <span>Carregando API Client…</span>
      </div>
    );
  }

  return (
    <div className={`api-view${isFocused ? ' api-view--focused' : ''}`} onMouseDown={handleMouseDown}>
      <aside className='api-view__sidebar app-button--enter'>
        <div className='api-view__sidebar-section api-view__sidebar-section--collections'>
          <div className='api-view__sidebar-header'>
            <div className='api-view__sidebar-title'>
              <Braces size={16} />
              <span>Coleções</span>
            </div>
            <button
              type='button'
              className='api-view__icon-button app-button app-button--enter'
              title='Nova coleção'
              onClick={handleOpenCollectionModal}
            >
              <FolderPlus size={14} />
            </button>
          </div>

          <div className='api-view__collection-list'>
          {data.collections.length === 0 ? (
            <ApiPanelEmpty message='Nenhuma coleção criada' icon={FolderOpen} compact />
          ) : (
            data.collections.map((collection) => (
            <div key={collection.id} className='api-view__collection'>
              <div className='api-view__collection-header'>
                <span className='api-view__collection-name'>{collection.name}</span>
                <button
                  type='button'
                  className='api-view__collection-edit app-button app-button--enter'
                  title='Editar coleção'
                  aria-label={`Editar coleção ${collection.name}`}
                  onClick={() => handleOpenEditCollection(collection.id)}
                >
                  <Pencil size={12} />
                </button>
              </div>
              {collection.items.map((item) => (
                <div key={item.id} className='api-view__collection-item-row'>
                  <button
                    type='button'
                    className={`api-view__collection-item app-button${tab.requestId === item.id ? ' api-view__collection-item--active app-button--enter' : ''}`}
                    onClick={() => handleSelectRequest(item, collection.id)}
                  >
                    <span className={`api-view__collection-method ${getApiMethodToneClass(item.request.method)}`}>
                      {item.request.method}
                    </span>
                    <span className='api-view__collection-label'>{item.name}</span>
                  </button>
                  <button
                    type='button'
                    className='api-view__collection-item-edit app-button app-button--enter'
                    title='Editar request'
                    aria-label={`Editar request ${item.name}`}
                    onClick={() => handleOpenEditRequest(collection.id, item.id)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type='button'
                    className='api-view__collection-item-delete app-button app-button--enter'
                    title='Excluir request'
                    aria-label={`Excluir request ${item.name}`}
                    onClick={() =>
                      setRequestDeleteTarget({
                        collectionId: collection.id,
                        requestId: item.id,
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            ))
          )}
          </div>
        </div>

        <div className='api-view__sidebar-section api-view__sidebar-section--environment'>
          <div className='api-view__sidebar-header'>
            <span>Ambiente</span>
            <button
              type='button'
              className='api-view__icon-button app-button'
              title='Novo ambiente'
              onClick={handleOpenCreateEnvironment}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className='api-view__env-row'>
            <AnchoredSelect
              value={data.activeEnvironmentId ?? ''}
              options={environmentOptions}
              allowEmpty
              emptyLabel='Sem ambiente'
              onChange={(value) =>
                updateData((current) => ({
                  ...current,
                  activeEnvironmentId: value || null,
                }))
              }
              triggerClassName='api-view__env-select'
            />
            <button
              type='button'
              className='api-view__text-button app-button app-button--enter'
              disabled={!activeEnvironment}
              onClick={handleOpenEditEnvironment}
            >
              Editar
            </button>
          </div>
        </div>

        <div className='api-view__sidebar-section api-view__sidebar-section--history'>
          <div className='api-view__sidebar-header'>
            <span>Histórico</span>
          </div>
          <div className='api-view__history-list'>
            {data.history.length === 0 ? (
              <ApiPanelEmpty message='Nenhuma request enviada ainda' icon={History} compact />
            ) : (
              data.history.map((entry) => (
                <button
                  key={entry.id}
                  type='button'
                  className='api-view__history-item app-button'
                  onClick={() => handleSelectHistory(entry.request)}
                >
                  <span className={`api-view__collection-method ${getApiMethodToneClass(entry.request.method)}`}>
                    {entry.request.method}
                  </span>
                  <span className='api-view__history-label'>{entry.request.url}</span>
                  <span className='api-view__history-status'>{entry.response.status}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <div className='api-view__main'>
        <div className='api-view__toolbar'>
          <div className='api-view__toolbar-request'>
            <AnchoredSelect
              value={request.method}
              options={methodOptions}
              onChange={(method) => {
                if (method) {
                  handleMethodChange(method);
                }
              }}
              className='api-view__method-picker'
              triggerClassName={`api-view__method-select ${getApiMethodToneClass(request.method)}`}
            />
            <ApiVariableInput
              className='api-view__url-input'
              value={request.url}
              placeholder='{{BASE_URL}}/endpoint'
              onChange={(url) => patchRequest({ url })}
              onVariableDoubleClick={handleVariableDoubleClick}
            />
          </div>
          <div className='api-view__toolbar-actions'>
            <button
              type='button'
              className='api-view__toolbar-button app-button app-button--enter'
              onClick={() => setCurlOpen((open) => !open)}
            >
              <ClipboardPaste size={14} />
              cURL
            </button>
            <button
              type='button'
              className='api-view__toolbar-button app-button app-button--enter'
              onClick={handleSaveToCollection}
            >
              <Save size={14} />
              Salvar
            </button>
            <button
              type='button'
              className='api-view__send-button app-button app-button--enter'
              disabled={isSending}
              onClick={() => void handleSend()}
            >
              <Send size={14} />
              Enviar
            </button>
          </div>
        </div>

        {curlOpen ? (
          <div className='api-view__curl-panel app-button--enter'>
            <textarea
              className='api-view__curl-input'
              value={curlInput}
              placeholder='Cole o comando cURL aqui'
              onChange={(event) => setCurlInput(event.target.value)}
            />
            <button
              type='button'
              className='api-view__text-button app-button app-button--enter'
              onClick={handleImportCurl}
            >
              Importar
            </button>
          </div>
        ) : null}

        <div className='api-view__section-tabs' role='tablist' aria-label='Seções da request'>
          {(['params', 'headers', 'body', 'auth'] as RequestSection[]).map((entry) => (
            <button
              key={entry}
              type='button'
              role='tab'
              className={`api-view__section-tab app-button${section === entry ? ' api-view__section-tab--active app-button--enter' : ''}`}
              onClick={() => setSection(entry)}
            >
              {entry === 'params'
                ? 'Params'
                : entry === 'headers'
                  ? 'Headers'
                  : entry === 'body'
                    ? 'Body'
                    : 'Auth'}
            </button>
          ))}
        </div>

        <div className='api-view__editor-panel'>
          {section === 'params' ? (
            <KeyValueEditor
              entries={request.query}
              variableValues
              emptyMessage='Nenhum parâmetro adicionado'
              emptyIcon={ListFilter}
              onChange={(query) => patchRequest({ query })}
              onVariableDoubleClick={handleVariableDoubleClick}
            />
          ) : null}
          {section === 'headers' ? (
            <KeyValueEditor
              entries={request.headers}
              variableValues
              emptyMessage='Nenhum header adicionado'
              emptyIcon={Heading}
              onChange={(headers) => patchRequest({ headers })}
              onVariableDoubleClick={handleVariableDoubleClick}
            />
          ) : null}
          {section === 'body' ? (
            <div className='api-view__body-panel'>
              <div className='api-view__body-types'>
                {(['none', 'json', 'text', 'form-urlencoded'] as ApiBodyType[]).map((bodyType) => (
                  <button
                    key={bodyType}
                    type='button'
                    className={`api-view__body-type app-button${request.bodyType === bodyType ? ' api-view__body-type--active app-button--enter' : ''}`}
                    onClick={() => handleBodyTypeChange(bodyType)}
                  >
                    {bodyType}
                  </button>
                ))}
              </div>
              {request.bodyType === 'form-urlencoded' ? (
                <KeyValueEditor
                  entries={formBodyEntries}
                  variableValues
                  emptyMessage='Nenhum campo no body'
                  emptyIcon={FormInput}
                  onChange={handleFormBodyChange}
                  onVariableDoubleClick={handleVariableDoubleClick}
                />
              ) : request.bodyType === 'none' ? (
                <ApiPanelEmpty message='Esta request não envia body' icon={CircleOff} />
              ) : request.bodyType === 'json' ? (
                <div className='api-view__body-editor'>
                  {!request.body.trim() ? (
                    <ApiPanelEmpty message='Nenhum conteúdo no body' icon={FileCode2} />
                  ) : null}
                  <CodeMirror
                    value={request.body}
                    height='100%'
                    theme={apiEditorTheme}
                    extensions={jsonBodyEditorExtensions}
                    basicSetup={jsonBodyEditorSetup}
                    onChange={(body) => patchRequest({ body })}
                  />
                </div>
              ) : (
                <div className='api-view__body-editor'>
                  {!request.body.trim() ? (
                    <ApiPanelEmpty message='Nenhum conteúdo no body' icon={FileCode2} />
                  ) : null}
                  <textarea
                    className='api-view__body-input'
                    value={request.body}
                    onChange={(event) => patchRequest({ body: event.target.value })}
                  />
                </div>
              )}
            </div>
          ) : null}
          {section === 'auth' ? (
            <div className='api-view__auth-panel'>
              <AnchoredSelect
                value={request.authType}
                options={authOptions}
                onChange={(authType) => {
                  if (authType) {
                    patchRequest({ authType });
                  }
                }}
                triggerClassName='api-view__auth-select'
              />
              {request.authType === 'bearer' ? (
                <ApiVariableInput
                  className='api-view__auth-input'
                  value={request.authBearer}
                  placeholder='Token'
                  onChange={(authBearer) => patchRequest({ authBearer })}
                  onVariableDoubleClick={handleVariableDoubleClick}
                />
              ) : null}
              {request.authType === 'basic' ? (
                <div className='api-view__auth-basic'>
                  <ApiVariableInput
                    className='api-view__auth-input'
                    value={request.authBasicUser}
                    placeholder='Usuário'
                    onChange={(authBasicUser) => patchRequest({ authBasicUser })}
                    onVariableDoubleClick={handleVariableDoubleClick}
                  />
                  <input
                    className='api-view__auth-input'
                    type='password'
                    value={request.authBasicPass}
                    placeholder='Senha'
                    onChange={(event) => patchRequest({ authBasicPass: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className='api-view__response'>
          <div className='api-view__response-header'>
            <span className='api-view__response-title'>Resposta</span>
            {response ? (
              <div className='api-view__response-meta'>
                <span
                  className={`api-view__status api-view__status--${response.status >= 200 && response.status < 300 ? 'ok' : 'error'}`}
                >
                  {response.status} {response.statusText}
                </span>
                <span>{response.durationMs} ms</span>
                <span>{formatBytes(response.sizeBytes)}</span>
              </div>
            ) : null}
            {error ? <span className='api-view__response-error'>{error}</span> : null}
          </div>
          <div className='api-view__response-body'>
            {response ? (
              <CodeMirror
                value={responseBody}
                height='100%'
                theme={responseEditorTheme}
                extensions={responseEditorExtensions}
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: true }}
              />
            ) : (
              <ApiPanelEmpty message='Envie uma request para ver a resposta' icon={Inbox} />
            )}
          </div>
        </div>
      </div>

      {collectionModal && collectionDraft ? (
        <AnimatedModal onClose={handleCloseCollectionModal} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSaveCollection(requestClose);
              }}
            >
              <span className='project-dialog__title'>
                {collectionModal.mode === 'create' ? 'Nova coleção' : 'Editar coleção'}
              </span>
              <label className='project-dialog__label'>
                Nome
                <input
                  className='project-dialog__input'
                  value={collectionDraft.name}
                  onChange={(event) =>
                    setCollectionDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  autoFocus
                />
              </label>
              <div className='project-dialog__actions project-dialog__actions--split'>
                {collectionModal.mode === 'edit' ? (
                  <button
                    type='button'
                    className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
                    onClick={() =>
                      handleRequestDeleteCollection(collectionModal.collectionId, requestClose)
                    }
                  >
                    Excluir
                  </button>
                ) : (
                  <span />
                )}
                <div className='project-dialog__actions-group'>
                  <button
                    type='button'
                    className='project-dialog__btn project-dialog__btn--ghost app-button'
                    onClick={requestClose}
                  >
                    Cancelar
                  </button>
                  <button
                    type='submit'
                    className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                  >
                    {collectionModal.mode === 'create' ? 'Criar' : 'Salvar'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </AnimatedModal>
      ) : null}

      {collectionToDelete ? (
        <AnimatedModal onClose={handleCloseCollectionDelete} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir coleção</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir a coleção <strong>{collectionToDelete.name}</strong>?
                Todas as requests salvas nela serão removidas.
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
                  onClick={() => handleConfirmDeleteCollection(requestClose)}
                >
                  Excluir
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}

      {requestModal && requestDraft ? (
        <AnimatedModal onClose={handleCloseRequestModal} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSaveRequest(requestClose);
              }}
            >
              <span className='project-dialog__title'>Editar request</span>
              <label className='project-dialog__label'>
                Nome
                <input
                  className='project-dialog__input'
                  value={requestDraft.name}
                  onChange={(event) =>
                    setRequestDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  autoFocus
                />
              </label>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='submit'
                  className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                >
                  Salvar
                </button>
              </div>
            </form>
          )}
        </AnimatedModal>
      ) : null}

      {requestToDelete ? (
        <AnimatedModal onClose={handleCloseRequestDelete} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir request</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir <strong>{requestToDelete.item.name}</strong> da coleção{' '}
                <strong>{requestToDelete.folder.name}</strong>?
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
                  onClick={() => handleConfirmDeleteRequest(requestClose)}
                >
                  Excluir
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}

      {variableEditDraft && activeEnvironment ? (
        <AnimatedModal onClose={handleCloseVariableEdit} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSaveVariableEdit(requestClose);
              }}
            >
              <span className='project-dialog__title'>Editar variável</span>
              <p className='project-dialog__message'>
                Ambiente: <strong>{activeEnvironment.name}</strong>
              </p>
              <label className='project-dialog__label'>
                Variável
                <input
                  className='project-dialog__input'
                  value={variableEditDraft.key}
                  onChange={(event) =>
                    setVariableEditDraft((current) =>
                      current ? { ...current, key: event.target.value } : current,
                    )
                  }
                  autoFocus
                />
              </label>
              <label className='project-dialog__label'>
                Valor
                <input
                  className='project-dialog__input'
                  value={variableEditDraft.value}
                  onChange={(event) =>
                    setVariableEditDraft((current) =>
                      current ? { ...current, value: event.target.value } : current,
                    )
                  }
                />
              </label>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='submit'
                  className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                >
                  Salvar
                </button>
              </div>
            </form>
          )}
        </AnimatedModal>
      ) : null}

      {environmentModal && environmentDraft ? (
        <AnimatedModal onClose={handleCloseEnvironmentModal} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleSaveEnvironment(requestClose);
              }}
            >
              <span className='project-dialog__title'>
                {environmentModal.mode === 'create' ? 'Novo ambiente' : 'Editar ambiente'}
              </span>
              <label className='project-dialog__label'>
                Nome
                <input
                  className='project-dialog__input'
                  value={environmentDraft.name}
                  onChange={(event) =>
                    setEnvironmentDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  autoFocus
                />
              </label>
              <div className='api-view__dialog-section'>
                <span className='api-view__dialog-section-title'>Variáveis</span>
                <KeyValueEditor
                  variant='modal'
                  entries={environmentDraft.variables}
                  onChange={(variables) =>
                    setEnvironmentDraft((current) => (current ? { ...current, variables } : current))
                  }
                />
              </div>
              <div className='project-dialog__actions project-dialog__actions--split'>
                {environmentModal.mode === 'edit' ? (
                  <button
                    type='button'
                    className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
                    onClick={() =>
                      handleRequestDeleteEnvironment(environmentModal.environmentId, requestClose)
                    }
                  >
                    Excluir
                  </button>
                ) : (
                  <span />
                )}
                <div className='project-dialog__actions-group'>
                  <button
                    type='button'
                    className='project-dialog__btn project-dialog__btn--ghost app-button'
                    onClick={requestClose}
                  >
                    Cancelar
                  </button>
                  <button
                    type='submit'
                    className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </form>
          )}
        </AnimatedModal>
      ) : null}

      {environmentToDelete ? (
        <AnimatedModal onClose={handleCloseEnvironmentDelete} panelClassName='project-dialog api-view__dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir ambiente</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir o ambiente <strong>{environmentToDelete.name}</strong>?
                Todas as variáveis dele serão removidas.
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
                  onClick={() => handleConfirmDeleteEnvironment(requestClose)}
                >
                  Excluir
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </div>
  );
}

export const ApiView = memo(ApiViewComponent);
