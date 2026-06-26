import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useGlobalSearchStore } from '@/stores/useGlobalSearchStore';
import { useTabActions } from '@/stores/useTabStore';
import { OVERLAY_POPUP_DURATION_MS, useAnimatedUnmount } from '@/hooks/useAnimatedUnmount';
import { readDroppedImageDataUrls } from '@/utils/attachAgentPromptImage';
import { readClipboardImageDataUrl } from '@/utils/terminalClipboardImage';
import { isExternalImageFileDrag } from '@/utils/explorerExternalDrop';
import {
  applyAutoProjectToken,
  buildGlobalSearchEffectKey,
  getSlashCommandDisplayInput,
  getSlashCommandMeta,
  mergeSlashCommandDisplayInput,
  normalizeSlashProjectDisplayInput,
  parseGlobalSearchQuery,
} from '@/utils/globalSearchQuery';
import { searchAllProgressive, searchSlashQuery, buildInitialSearchSuggestions } from '@/utils/globalSearchProviders';
import {
  executeGlobalSearchResult,
  executeSlashCommand,
} from '@/utils/executeGlobalSearchAction';
import type { GlobalSearchProjectPayload, GlobalSearchResult, GlobalSearchResultGroup } from '@/utils/globalSearchTypes';

const SEARCH_DEBOUNCE_MS = 180;

interface AgentPromptImageDraft {
  id: string;
  dataUrl: string;
}

function flattenGroups(groups: GlobalSearchResultGroup[]): GlobalSearchResult[] {
  const items: GlobalSearchResult[] = [];

  for (const group of groups) {
    if (group.kind === 'separator') {
      continue;
    }

    items.push(...group.items);
  }

  return items;
}

function resolveNextActiveIndex(
  previousFlat: GlobalSearchResult[],
  nextFlat: GlobalSearchResult[],
  previousIndex: number,
): number {
  if (nextFlat.length === 0) {
    return 0;
  }

  const selectedId = previousFlat[previousIndex]?.id;

  if (selectedId) {
    const preservedIndex = nextFlat.findIndex((item) => item.id === selectedId);

    if (preservedIndex >= 0) {
      return preservedIndex;
    }
  }

  return Math.min(previousIndex, nextFlat.length - 1);
}

export function useGlobalSearchPalette() {
  const isOpen = useGlobalSearchStore((state) => state.isOpen);
  const close = useGlobalSearchStore((state) => state.close);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const lastRestartCommands = useTerminalSessionStore((state) => state.lastRestartCommands);
  const tabActions = useTabActions();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<GlobalSearchResultGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [agentPromptImages, setAgentPromptImages] = useState<AgentPromptImageDraft[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryRef = useRef(query);
  const lastSearchEffectKeyRef = useRef<string | null>(null);
  const activeIndexRef = useRef(activeIndex);
  const groupsRef = useRef(groups);

  queryRef.current = query;
  activeIndexRef.current = activeIndex;
  groupsRef.current = groups;

  const handleAnimatedClose = useCallback(() => {
    setVisible(false);
  }, []);

  const { phase, requestClose, resetPhase } = useAnimatedUnmount(
    handleAnimatedClose,
    OVERLAY_POPUP_DURATION_MS,
  );

  const finishClose = useCallback(() => {
    close();
    requestClose();
  }, [close, requestClose]);

  useEffect(() => {
    if (isOpen) {
      resetPhase();
      setVisible(true);
      return;
    }

    if (visible) {
      requestClose();
    }
  }, [isOpen, requestClose, resetPhase, visible]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const parsed = useMemo(
    () => parseGlobalSearchQuery(query, activeProject?.name ?? null, projects),
    [activeProject?.name, projects, query],
  );

  const flatResults = useMemo(() => flattenGroups(groups), [groups]);

  const slashMeta = parsed.slash ? getSlashCommandMeta(parsed.slash.command) : null;

  const canAttachAgentImages = useMemo(
    () =>
      parsed.mode === 'slash' &&
      parsed.slash?.command === 'agent' &&
      Boolean(parsed.slash.projectId),
    [parsed.mode, parsed.slash?.command, parsed.slash?.projectId],
  );

  const inputValue = useMemo(
    () => getSlashCommandDisplayInput(query, parsed.slash),
    [parsed.slash, query],
  );

  const resolvedSlashProject = useMemo(() => {
    if (!parsed.slash?.projectId) {
      return null;
    }

    return projects.find((entry) => entry.id === parsed.slash?.projectId) ?? null;
  }, [parsed.slash?.projectId, projects]);

  const commandInputValue = useMemo(() => {
    if (!parsed.slash || !resolvedSlashProject) {
      return inputValue;
    }

    if (parsed.slash.phase === 'payload') {
      return parsed.slash.payload;
    }

    return parsed.slash.filterText;
  }, [inputValue, parsed.slash, resolvedSlashProject]);

  const searchEffectKey = useMemo(
    () => buildGlobalSearchEffectKey(parsed, String(lastRestartCommands)),
    [lastRestartCommands, parsed],
  );

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setGroups([]);
      resetActiveIndex();
      setAgentPromptImages([]);
      lastSearchEffectKeyRef.current = null;
      return;
    }

    const timerId = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const nextQuery = applyAutoProjectToken(query, activeProject?.name ?? null);

    if (nextQuery !== query) {
      setQuery(nextQuery);
    }
  }, [activeProject?.name, query, visible]);

  useEffect(() => {
    if (!visible || !canAttachAgentImages) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      const hasImageItem = event.clipboardData
        ? Array.from(event.clipboardData.items).some((item) => item.type.startsWith('image/'))
        : false;

      if (!hasImageItem) {
        return;
      }

      event.preventDefault();

      void readClipboardImageDataUrl(event).then((dataUrl) => {
        if (!dataUrl) {
          return;
        }

        setAgentPromptImages((current) => [
          ...current,
          { id: crypto.randomUUID(), dataUrl },
        ]);
      });
    };

    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [canAttachAgentImages, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (searchEffectKey.startsWith('slash-static:') && searchEffectKey === lastSearchEffectKeyRef.current) {
      return;
    }

    if (parsed.mode === 'free' && !parsed.freeText.trim()) {
      abortRef.current?.abort();
      const results = buildInitialSearchSuggestions(projects, activeProjectId);
      const nextFlat = flattenGroups(results.groups);
      const previousFlat = flattenGroups(groupsRef.current);
      const nextIndex = resolveNextActiveIndex(previousFlat, nextFlat, activeIndexRef.current);
      activeIndexRef.current = nextIndex;
      setGroups(results.groups);
      setActiveIndex(nextIndex);
      setIsSearching(false);
      lastSearchEffectKeyRef.current = searchEffectKey;
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timerId = window.setTimeout(() => {
      setIsSearching(true);
      groupsRef.current = [];
      setGroups([]);

      void (async () => {
        try {
          const applyProgressiveGroups = (nextGroups: GlobalSearchResultGroup[]) => {
            if (controller.signal.aborted) {
              return;
            }

            const previousFlat = flattenGroups(groupsRef.current);
            const nextFlat = flattenGroups(nextGroups);
            const preservedIndex = resolveNextActiveIndex(
              previousFlat,
              nextFlat,
              activeIndexRef.current,
            );

            groupsRef.current = nextGroups;
            activeIndexRef.current = preservedIndex;
            setGroups(nextGroups);
            setActiveIndex(preservedIndex);
          };

          if (parsed.mode === 'free') {
            await searchAllProgressive(
              parsed.freeText,
              projects,
              activeProjectId,
              applyProgressiveGroups,
              controller.signal,
            );
            return;
          }

          const results = await searchSlashQuery(
            parsed.slash,
            parsed.suggestedCommands,
            projects,
            activeProjectId,
            controller.signal,
          );
          applyProgressiveGroups(results.groups);
        } finally {
          if (!controller.signal.aborted) {
            setIsSearching(false);
            lastSearchEffectKeyRef.current = searchEffectKey;
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
      controller.abort();
    };
  }, [
    activeProjectId,
    parsed.freeText,
    parsed.mode,
    parsed.slash,
    parsed.suggestedCommands,
    projects,
    lastRestartCommands,
    searchEffectKey,
    visible,
  ]);

  const handleQueryChange = useCallback(
    (value: string) => {
      if (parsed.mode === 'slash' && parsed.slash) {
        const resolvedProject = parsed.slash.projectId
          ? projects.find((entry) => entry.id === parsed.slash?.projectId) ?? null
          : null;

        if (resolvedProject) {
          const displayValue = value ? `@${resolvedProject.name} ${value}` : `@${resolvedProject.name} `;
          setQuery(mergeSlashCommandDisplayInput(displayValue, parsed.slash.command));
          return;
        }

        const normalizedValue =
          parsed.slash.requiresProject && value.trimStart().startsWith('@')
            ? normalizeSlashProjectDisplayInput(
                queryRef.current,
                value,
                parsed.slash.command,
                projects,
              )
            : value;

        setQuery(mergeSlashCommandDisplayInput(normalizedValue, parsed.slash.command));
        return;
      }

      setQuery(value);
    },
    [parsed.mode, parsed.slash, projects],
  );

  const handleClose = useCallback(() => {
    finishClose();
  }, [finishClose]);

  const setActiveIndexFromPointer = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);

  const resetActiveIndex = useCallback(() => {
    activeIndexRef.current = 0;
    setActiveIndex(0);
  }, []);

  const moveActiveIndex = useCallback(
    (direction: -1 | 1) => {
      if (flatResults.length === 0) {
        return;
      }

      const nextIndex =
        direction === 1
          ? Math.min(activeIndexRef.current + 1, flatResults.length - 1)
          : Math.max(activeIndexRef.current - 1, 0);

      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    },
    [flatResults.length],
  );

  const handleRemoveAgentPromptImage = useCallback((imageId: string) => {
    setAgentPromptImages((current) => current.filter((image) => image.id !== imageId));
  }, []);

  const handleExecute = useCallback(async () => {
    const selected = flatResults[activeIndexRef.current] ?? null;

    if (selected?.kind === 'slash-command') {
      const payload = selected.payload as { command: string };
      setQuery(`/${payload.command} `);
      resetActiveIndex();
      return;
    }

    if (parsed.mode === 'slash' && parsed.slash?.phase === 'project' && selected?.kind === 'project') {
      const payload = selected.payload as GlobalSearchProjectPayload;
      const project = projects.find((entry) => entry.id === payload.projectId);

      if (project) {
        setQuery(`/${parsed.slash.command} @${project.name} `);
        resetActiveIndex();
      }

      return;
    }

    if (parsed.mode === 'slash' && parsed.slash) {
      const success = await executeSlashCommand(
        parsed.slash,
        tabActions,
        selected,
        agentPromptImages.map((image) => image.dataUrl),
      );

      if (success) {
        finishClose();
      }

      return;
    }

    if (!selected) {
      return;
    }

    const success = await executeGlobalSearchResult(selected, tabActions);

    if (success) {
      finishClose();
    }
  }, [agentPromptImages, finishClose, flatResults, parsed.mode, parsed.slash, projects, resetActiveIndex, tabActions]);

  const handlePromptDrop = useCallback(
    (event: React.DragEvent) => {
      if (!canAttachAgentImages) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void readDroppedImageDataUrls(event.dataTransfer).then((dataUrls) => {
        if (dataUrls.length === 0) {
          return;
        }

        setAgentPromptImages((current) => [
          ...current,
          ...dataUrls.map((dataUrl) => ({ id: crypto.randomUUID(), dataUrl })),
        ]);
      });
    },
    [canAttachAgentImages],
  );

  const handlePromptDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!canAttachAgentImages || !isExternalImageFileDrag(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [canAttachAgentImages],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();

        if (parsed.mode === 'slash') {
          setQuery('');
          setGroups([]);
          resetActiveIndex();
          return;
        }

        handleClose();
        return;
      }

      if (event.key === 'Backspace') {
        const input = event.currentTarget;

        if (
          parsed.mode === 'slash' &&
          parsed.slash?.projectId &&
          commandInputValue === '' &&
          input.selectionStart === 0 &&
          input.selectionEnd === 0
        ) {
          event.preventDefault();
          setQuery(`/${parsed.slash.command} @`);
          resetActiveIndex();
          return;
        }
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActiveIndex(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActiveIndex(-1);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        void handleExecute();
      }
    },
    [commandInputValue, handleClose, handleExecute, moveActiveIndex, parsed.mode, parsed.slash, resetActiveIndex],
  );

  return {
    visible,
    animationPhase: phase,
    inputValue,
    commandInputValue,
    resolvedSlashProject,
    query,
    groups,
    flatResults,
    activeIndex,
    isSearching,
    slashMeta,
    parsed,
    inputRef,
    handleQueryChange,
    handleClose,
    handleExecute,
    handleKeyDown,
    selectActiveIndex: setActiveIndexFromPointer,
    agentPromptImages,
    canAttachAgentImages,
    handleRemoveAgentPromptImage,
    handlePromptDrop,
    handlePromptDragOver,
  };
}
