import { ChevronDown, ChevronRight, FilePlus, FolderOpen, FolderPlus, GitBranch, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectGitDrawer } from '@/components/git/ProjectGitDrawer';
import { ExplorerEntryContextMenu } from '@/components/explorer/ExplorerEntryContextMenu';
import {
  ExplorerDirectoryIcon,
  ExplorerFileIcon,
} from '@/components/explorer/ExplorerTreeIcon';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { ProjectPromptDialog } from '@/components/sidebar/ProjectPromptDialog';
import { EXPLORER_ENTRY_DRAG_MIME } from '@/constants/explorerDrag';
import { useProjectStore } from '@/stores/useProjectStore';
import { usePendingExplorerCreateStore } from '@/stores/usePendingExplorerCreateStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useExplorerGitDecorations } from '@/hooks/useExplorerGitDecorations';
import { useGitChangeCount } from '@/hooks/useGitChangeCount';
import type { ExplorerGitDecoration } from '@/hooks/useExplorerGitDecorations';
import { useDelayedHoverHint } from '@/hooks/useDelayedHoverHint';
import {
  EXPLORER_ROOT_COLORS,
  type ProjectDirectoryEntry,
  type ProjectKind,
} from '@/types';
import {
  DEFAULT_EXPLORER_SEARCH_OPTIONS,
  type ExplorerSearchNode,
  type ExplorerSearchOptions,
} from '@/utils/explorerSearch';
import { resolveExplorerTargetDirectory } from '@/utils/explorerTarget';
import {
  getDroppedFilePaths,
  isExplorerInternalDrag,
  isExternalFileDrag,
} from '@/utils/explorerExternalDrop';
import { mentionExplorerEntryInAgent } from '@/utils/explorerAgentMention';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';
import { collectProjectPanes } from '@/utils/tabGroups';
import { resolvePaneAgentCommand } from '@/utils/projectAgentStatus';

interface ProjectExplorerDrawerProps {
  projectId: string;
  rootPath: string;
  onOpenFile: (entry: ProjectDirectoryEntry) => void;
  onOpenFileCode: (entry: ProjectDirectoryEntry) => void;
  onSelectPane: (paneId: string) => Promise<void>;
  onOpenDiff: (
    filePath: string,
    options: { staged: boolean; untracked?: boolean; repoPath?: string; agentPrompt?: string },
  ) => void;
}

interface ExplorerContextMenuState {
  entry?: ProjectDirectoryEntry;
  x: number;
  y: number;
}

type CreatePromptMode = 'file' | 'folder';

type ExplorerDragMode = 'internal' | 'external';

interface ExplorerDirectoryInvalidation {
  path: string;
  revision: number;
}

interface ExplorerTreeNodeProps {
  entry: ProjectDirectoryEntry;
  rootPath: string;
  depth: number;
  selectedPath: string | null;
  accentColor?: string;
  projectKind?: ProjectKind | null;
  preloadedChildren?: ProjectDirectoryEntry[] | null;
  initialExpanded?: boolean;
  dragEnabled: boolean;
  dropTargetPath: string | null;
  dropDragMode: ExplorerDragMode | null;
  treeRevision: number;
  directoryInvalidation: ExplorerDirectoryInvalidation | null;
  onSelect: (path: string, type: ProjectDirectoryEntry['type']) => void;
  onOpenFile: (entry: ProjectDirectoryEntry) => void;
  onDragStartEntry: (path: string, type: ProjectDirectoryEntry['type']) => void;
  onDragEndEntry: () => void;
  onDragOverDropTarget: (path: string) => void;
  onDropOnTarget: (sourcePath: string, targetDirPath: string) => void;
  onImportOnTarget: (sourcePaths: string[], targetDirPath: string) => void;
  onContextMenu: (entry: ProjectDirectoryEntry, x: number, y: number) => void;
  resolveGitDecoration: (absolutePath: string) => ExplorerGitDecoration | null;
}

function resolveExplorerDrop(
  event: React.DragEvent,
  targetDirPath: string,
  onDropOnTarget: (sourcePath: string, targetDirPath: string) => void,
  onImportOnTarget: (sourcePaths: string[], targetDirPath: string) => void,
): void {
  const sourcePath = event.dataTransfer.getData(EXPLORER_ENTRY_DRAG_MIME);

  if (sourcePath) {
    onDropOnTarget(sourcePath, targetDirPath);
    return;
  }

  const externalPaths = getDroppedFilePaths(event.dataTransfer);

  if (externalPaths.length > 0) {
    onImportOnTarget(externalPaths, targetDirPath);
  }
}

function getDropTargetClasses(
  isActive: boolean,
  mode: ExplorerDragMode | null,
  baseClass: string,
): string {
  if (!isActive || !mode) {
    return '';
  }

  return ` ${baseClass} ${baseClass}--${mode}`;
}

function canAcceptExplorerDragOver(event: React.DragEvent, isDirectory: boolean): boolean {
  if (!isDirectory) {
    return false;
  }

  if (isExplorerInternalDrag(event.dataTransfer)) {
    return true;
  }

  return isExternalFileDrag(event.dataTransfer);
}

function getProjectKindBadgeLabel(kind: ProjectKind): string {
  if (kind === 'mobile') {
    return 'APP';
  }

  return kind.toUpperCase();
}

function isPathInsideDirectory(directoryPath: string, candidatePath: string): boolean {
  const normalizedDirectory = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedCandidate = candidatePath.replace(/\\/g, '/');

  return (
    normalizedCandidate === normalizedDirectory ||
    normalizedCandidate.startsWith(`${normalizedDirectory}/`)
  );
}

function getParentDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');

  if (lastSlash <= 0) {
    return filePath;
  }

  return normalized.slice(0, lastSlash);
}

function areDirectoryEntriesEqual(
  left: ProjectDirectoryEntry[],
  right: ProjectDirectoryEntry[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];

    return (
      entry.path === other.path && entry.name === other.name && entry.type === other.type
    );
  });
}

function canDropEntry(sourcePath: string, targetDirPath: string): boolean {
  if (sourcePath === targetDirPath) {
    return false;
  }

  if (isPathInsideDirectory(sourcePath, targetDirPath)) {
    return false;
  }

  if (getParentDirectory(sourcePath) === targetDirPath.replace(/\\/g, '/')) {
    return false;
  }

  return true;
}

const ExplorerTreeNode = memo(function ExplorerTreeNodeComponent({
  entry,
  rootPath,
  depth,
  selectedPath,
  accentColor,
  projectKind,
  preloadedChildren,
  initialExpanded = false,
  dragEnabled,
  dropTargetPath,
  dropDragMode,
  treeRevision,
  directoryInvalidation,
  onSelect,
  onOpenFile,
  onDragStartEntry,
  onDragEndEntry,
  onDragOverDropTarget,
  onDropOnTarget,
  onImportOnTarget,
  onContextMenu,
  resolveGitDecoration,
}: ExplorerTreeNodeProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [children, setChildren] = useState<ProjectDirectoryEntry[] | null>(
    preloadedChildren ?? null,
  );
  const [loading, setLoading] = useState(false);
  const isDirectory = entry.type === 'directory';
  const isSelected = selectedPath === entry.path;
  const fileHintText = useMemo(
    () => (isDirectory ? '' : toProjectRelativePath(rootPath, entry.path)),
    [entry.path, isDirectory, rootPath],
  );
  const { onMouseEnter: onFileHintEnter, onMouseLeave: onFileHintLeave, hintNode } =
    useDelayedHoverHint(fileHintText);
  const isDropTarget = isDirectory && dropTargetPath === entry.path;
  const rowDropClass = getDropTargetClasses(
    isDropTarget,
    dropDragMode,
    'project-explorer__row--drop-target',
  );
  const childrenDropClass = getDropTargetClasses(
    isDropTarget && expanded,
    dropDragMode,
    'project-explorer__children-inner--drop-target',
  );
  const isRootProject = depth === 0 && isDirectory && projectKind;
  const rootAccent = depth === 0 && isDirectory ? accentColor : undefined;
  const isSearchTree = preloadedChildren !== undefined;
  const gitDecoration =
    !isDirectory && typeof resolveGitDecoration === 'function'
      ? resolveGitDecoration(entry.path)
      : null;

  useEffect(() => {
    if (isSearchTree) {
      return;
    }

    setChildren(null);
  }, [isSearchTree, treeRevision]);

  useEffect(() => {
    if (isSearchTree) {
      setChildren(preloadedChildren ?? null);
      setExpanded(initialExpanded);
      return;
    }

    if (!expanded || !isDirectory || children !== null) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void window.nexus.files.listDirectoryEntries(entry.path).then((entries) => {
      if (!cancelled) {
        setChildren(entries);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setChildren([]);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [children, entry.path, expanded, initialExpanded, isDirectory, isSearchTree, preloadedChildren]);

  useEffect(() => {
    if (
      isSearchTree ||
      !isDirectory ||
      !directoryInvalidation ||
      directoryInvalidation.path !== entry.path ||
      !expanded
    ) {
      return;
    }

    let cancelled = false;

    void window.nexus.files.listDirectoryEntries(entry.path).then((entries) => {
      if (!cancelled) {
        setChildren((current) => (areDirectoryEntriesEqual(current ?? [], entries) ? current : entries));
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setChildren([]);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [directoryInvalidation, entry.path, expanded, isDirectory, isSearchTree]);

  const handleToggle = useCallback(() => {
    if (!isDirectory) {
      onOpenFile(entry);
      onSelect(entry.path, entry.type);
      return;
    }

    setExpanded((value) => !value);
    onSelect(entry.path, entry.type);
  }, [entry, isDirectory, onOpenFile, onSelect]);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      if (!dragEnabled) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.setData(EXPLORER_ENTRY_DRAG_MIME, entry.path);
      event.dataTransfer.effectAllowed = 'move';
      onDragStartEntry(entry.path, entry.type);
    },
    [dragEnabled, entry.path, entry.type, onDragStartEntry],
  );

  const handleDragEnd = useCallback(() => {
    onDragEndEntry();
  }, [onDragEndEntry]);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      if (!dragEnabled || !canAcceptExplorerDragOver(event, isDirectory)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = isExternalFileDrag(event.dataTransfer) ? 'copy' : 'move';

      if (!expanded) {
        setExpanded(true);
      }

      onDragOverDropTarget(entry.path);
    },
    [dragEnabled, entry.path, expanded, isDirectory, onDragOverDropTarget],
  );

  const handleChildrenDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!dragEnabled || !expanded || !canAcceptExplorerDragOver(event, isDirectory)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = isExternalFileDrag(event.dataTransfer) ? 'copy' : 'move';
      onDragOverDropTarget(entry.path);
    },
    [dragEnabled, entry.path, expanded, isDirectory, onDragOverDropTarget],
  );

  const handleChildrenDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!dragEnabled || !expanded || !isDirectory) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resolveExplorerDrop(event, entry.path, onDropOnTarget, onImportOnTarget);
    },
    [dragEnabled, entry.path, expanded, isDirectory, onDropOnTarget, onImportOnTarget],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      if (!dragEnabled || !isDirectory) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resolveExplorerDrop(event, entry.path, onDropOnTarget, onImportOnTarget);
    },
    [dragEnabled, entry.path, isDirectory, onDropOnTarget, onImportOnTarget],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(entry.path, entry.type);
      onContextMenu(entry, event.clientX, event.clientY);
    },
    [entry, onContextMenu, onSelect],
  );

  return (
    <div className={`project-explorer__branch${expanded ? ' project-explorer__branch--expanded' : ''}`}>
      <button
        type='button'
        className={`project-explorer__row app-button app-button--enter${isSelected ? ' project-explorer__row--selected' : ''}${rowDropClass}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        draggable={dragEnabled}
        onClick={handleToggle}
        onMouseEnter={isDirectory ? undefined : onFileHintEnter}
        onMouseLeave={isDirectory ? undefined : onFileHintLeave}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        <span className='project-explorer__chevron' aria-hidden='true'>
          {isDirectory ? (
            expanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />
          ) : null}
        </span>
        {isRootProject && projectKind ? (
          <span
            className='project-explorer__kind-badge'
            style={rootAccent ? { backgroundColor: rootAccent, color: '#000000' } : undefined}
          >
            {getProjectKindBadgeLabel(projectKind)}
          </span>
        ) : isDirectory ? (
          <ExplorerDirectoryIcon folderName={entry.name} expanded={expanded} />
        ) : (
          <ExplorerFileIcon name={entry.name} />
        )}
        <span
          className={`project-explorer__label${gitDecoration ? ` project-explorer__label--git-${gitDecoration.kind}` : ''}`}
          style={rootAccent ? { color: rootAccent } : undefined}
        >
          {entry.name}
        </span>
        {gitDecoration ? (
          <span
            className={`project-explorer__git-badge project-explorer__git-badge--${gitDecoration.kind}`}
          >
            {gitDecoration.badge}
          </span>
        ) : null}
        {isDropTarget && dropDragMode ? (
          <span className={`project-explorer__drop-badge project-explorer__drop-badge--${dropDragMode}`}>
            {dropDragMode === 'external' ? 'Importar' : 'Mover'}
          </span>
        ) : null}
      </button>
      {hintNode}

      {isDirectory ? (
        <div className={`project-explorer__children${expanded ? ' project-explorer__children--open' : ''}`}>
          <div
            className={`project-explorer__children-inner${childrenDropClass}`}
            onDragOver={handleChildrenDragOver}
            onDrop={handleChildrenDrop}
          >
            {expanded && loading ? <div className='project-explorer__loading'>Carregando...</div> : null}
            {expanded && !loading && children?.length === 0 ? (
              <div className='project-explorer__empty-folder' style={{ paddingLeft: `${22 + depth * 14}px` }}>
                <FolderOpen size={12} strokeWidth={2} aria-hidden />
                <span>Pasta vazia</span>
              </div>
            ) : null}
            {expanded
              ? children?.map((child) => (
                  <ExplorerTreeNode
                    key={child.path}
                    entry={child}
                    rootPath={rootPath}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    dragEnabled={dragEnabled}
                    dropTargetPath={dropTargetPath}
                    dropDragMode={dropDragMode}
                    treeRevision={treeRevision}
                    directoryInvalidation={directoryInvalidation}
                    preloadedChildren={
                      isSearchTree && child.type === 'directory'
                        ? ((child as ExplorerSearchNode).children ?? null)
                        : undefined
                    }
                    initialExpanded={isSearchTree}
                    onSelect={onSelect}
                    onOpenFile={onOpenFile}
                    onDragStartEntry={onDragStartEntry}
                    onDragEndEntry={onDragEndEntry}
                    onDragOverDropTarget={onDragOverDropTarget}
                    onDropOnTarget={onDropOnTarget}
                    onImportOnTarget={onImportOnTarget}
                    onContextMenu={onContextMenu}
                    resolveGitDecoration={resolveGitDecoration}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

function ProjectExplorerDrawerComponent({
  projectId,
  rootPath,
  onOpenFile,
  onOpenFileCode,
  onSelectPane,
  onOpenDiff,
}: ProjectExplorerDrawerProps) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId) ?? null);
  const explorerView = useProjectStore((state) => state.explorerView);
  const toggleExplorerGit = useProjectStore((state) => state.toggleExplorerGit);
  const gitChangeCount = useGitChangeCount(rootPath);
  const isGitView = explorerView === 'git';
  const activeAgentByPane = useTerminalSessionStore((state) => state.activeAgentByPane);
  const resolveGitDecoration = useExplorerGitDecorations(rootPath);
  const [rootEntries, setRootEntries] = useState<ProjectDirectoryEntry[]>([]);
  const rootEntriesRef = useRef<ProjectDirectoryEntry[]>([]);
  const [projectKinds, setProjectKinds] = useState<Record<string, ProjectKind | null>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ProjectDirectoryEntry['type'] | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<ExplorerSearchOptions>(
    DEFAULT_EXPLORER_SEARCH_OPTIONS,
  );
  const [searchResults, setSearchResults] = useState<ExplorerSearchNode[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [treeRevision, setTreeRevision] = useState(0);
  const [directoryInvalidation, setDirectoryInvalidation] =
    useState<ExplorerDirectoryInvalidation | null>(null);
  const [createPromptMode, setCreatePromptMode] = useState<CreatePromptMode | null>(null);
  const pendingExplorerCreate = usePendingExplorerCreateStore((state) => state.pending);
  const clearPendingExplorerCreate = usePendingExplorerCreateStore((state) => state.clearPending);
  const [draggingEntry, setDraggingEntry] = useState<{
    path: string;
    type: ProjectDirectoryEntry['type'];
  } | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [explorerDragMode, setExplorerDragMode] = useState<ExplorerDragMode | null>(null);
  const externalDragDepthRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null);
  const [renameEntry, setRenameEntry] = useState<ProjectDirectoryEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ProjectDirectoryEntry | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const canAddToChat = useMemo(() => {
    if (!project) {
      return false;
    }

    return collectProjectPanes(project.tabs).some((pane) =>
      Boolean(resolvePaneAgentCommand(pane, activeAgentByPane)),
    );
  }, [activeAgentByPane, project]);

  const refreshTree = useCallback(() => {
    setTreeRevision((value) => value + 1);
  }, []);

  const loadRootEntries = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const entries = await window.nexus.files.listDirectoryEntries(rootPath);
      const directoryPaths = entries
        .filter((entry) => entry.type === 'directory')
        .map((entry) => entry.path);

      let kinds: Record<string, ProjectKind | null> = {};

      try {
        kinds =
          directoryPaths.length > 0
            ? await window.nexus.files.detectProjectKinds(directoryPaths)
            : {};
      } catch {
        kinds = {};
      }

      if (!areDirectoryEntriesEqual(rootEntriesRef.current, entries)) {
        rootEntriesRef.current = entries;
        setRootEntries(entries);
        setProjectKinds(kinds);
      }
    } catch {
      rootEntriesRef.current = [];
      setRootEntries([]);
      setProjectKinds({});
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [rootPath]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!pendingExplorerCreate || pendingExplorerCreate.projectId !== projectId) {
      return;
    }

    if (pendingExplorerCreate.mode === 'file') {
      setCreatePromptMode('file');
    }

    clearPendingExplorerCreate();
  }, [clearPendingExplorerCreate, pendingExplorerCreate, projectId]);

  useEffect(() => {
    void loadRootEntries();
  }, [loadRootEntries, treeRevision]);

  useEffect(() => {
    return window.nexus.files.onProjectChange((payload) => {
      if (payload.projectPath !== rootPath) {
        return;
      }

      const parentDir = payload.changedPath ? getParentDirectory(payload.changedPath) : rootPath;

      if (parentDir === rootPath) {
        void loadRootEntries({ silent: true });
        return;
      }

      setDirectoryInvalidation((current) => ({
        path: parentDir,
        revision: current?.path === parentDir ? current.revision + 1 : 1,
      }));
    });
  }, [loadRootEntries, rootPath]);

  const handleSelect = useCallback((path: string, type: ProjectDirectoryEntry['type']) => {
    setSelectedPath(path);
    setSelectedType(type);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) {
        setQuery('');
        setSearchResults(null);
      }

      return !open;
    });
  }, []);

  const toggleSearchOption = useCallback((key: keyof ExplorerSearchOptions) => {
    setSearchOptions((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (!searchOpen || !trimmedQuery) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);

    const timeoutId = window.setTimeout(() => {
      void window.nexus.files
        .searchProjectTree(rootPath, trimmedQuery, searchOptions)
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results as ExplorerSearchNode[]);
            setSearchLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults([]);
            setSearchLoading(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, rootPath, searchOpen, searchOptions]);

  const isSearching = searchOpen && query.trim().length > 0;
  const dragEnabled = !isSearching;
  const targetDirectory = resolveExplorerTargetDirectory(rootPath, selectedPath, selectedType);

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      if (!createPromptMode) {
        return;
      }

      const result =
        createPromptMode === 'file'
          ? await window.nexus.files.createEmptyFile(targetDirectory, name)
          : await window.nexus.files.createDirectory(targetDirectory, name);

      if (!result.ok) {
        return;
      }

      refreshTree();
      setSelectedPath(result.path);
      setSelectedType(createPromptMode === 'file' ? 'file' : 'directory');

      if (createPromptMode === 'file') {
        onOpenFile({
          name,
          path: result.path,
          type: 'file',
        });
      }
    },
    [createPromptMode, onOpenFile, refreshTree, targetDirectory],
  );

  const handleDragStartEntry = useCallback((path: string, type: ProjectDirectoryEntry['type']) => {
    setDraggingEntry({ path, type });
    setExplorerDragMode('internal');
  }, []);

  const clearExplorerDragState = useCallback(() => {
    setDraggingEntry(null);
    setDropTargetPath(null);
    setExplorerDragMode(null);
    externalDragDepthRef.current = 0;
  }, []);

  const handleDragEndEntry = useCallback(() => {
    clearExplorerDragState();
  }, [clearExplorerDragState]);

  const handleDragOverDropTarget = useCallback(
    (path: string) => {
      if (draggingEntry) {
        if (!canDropEntry(draggingEntry.path, path)) {
          return;
        }

        setDropTargetPath(path);
        return;
      }

      setDropTargetPath(path);
    },
    [draggingEntry],
  );

  const handleImportOnTarget = useCallback(
    async (sourcePaths: string[], targetDirPath: string) => {
      clearExplorerDragState();

      if (sourcePaths.length === 0) {
        return;
      }

      const results = await window.nexus.files.importEntries(targetDirPath, sourcePaths);
      const imported = [...results].reverse().find((result) => result.ok);

      refreshTree();

      if (!imported?.ok) {
        return;
      }

      setSelectedPath(imported.path);
      setSelectedType(imported.entryType ?? 'file');
    },
    [clearExplorerDragState, refreshTree],
  );

  const handleDropOnTarget = useCallback(
    async (sourcePath: string, targetDirPath: string) => {
      const movedType = draggingEntry?.path === sourcePath ? draggingEntry.type : null;
      clearExplorerDragState();

      if (!canDropEntry(sourcePath, targetDirPath)) {
        return;
      }

      const result = await window.nexus.files.moveEntry(sourcePath, targetDirPath);

      if (!result.ok) {
        return;
      }

      refreshTree();
      setSelectedPath(result.path);

      if (movedType) {
        setSelectedType(movedType);
      }
    },
    [clearExplorerDragState, draggingEntry, refreshTree],
  );

  const handleExplorerDragEnter = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!dragEnabled || isSearching || !isExternalFileDrag(event.dataTransfer)) {
        return;
      }

      externalDragDepthRef.current += 1;

      if (externalDragDepthRef.current === 1) {
        setExplorerDragMode('external');
      }
    },
    [dragEnabled, isSearching],
  );

  const handleExplorerDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (explorerDragMode !== 'external') {
        return;
      }

      const related = event.relatedTarget as Node | null;

      if (related && event.currentTarget.contains(related)) {
        return;
      }

      clearExplorerDragState();
    },
    [clearExplorerDragState, explorerDragMode],
  );

  const handleTreeDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('.project-explorer__children-inner')) {
        return;
      }

      if (isSearching) {
        return;
      }

      if (isExplorerInternalDrag(event.dataTransfer)) {
        if (!draggingEntry || !canDropEntry(draggingEntry.path, rootPath)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setDropTargetPath(rootPath);
        return;
      }

      if (!isExternalFileDrag(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setExplorerDragMode('external');
      setDropTargetPath(rootPath);
    },
    [draggingEntry, isSearching, rootPath],
  );

  const handleTreeDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDropTargetPath(null);
    }
  }, []);

  const handleTreeDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('.project-explorer__children-inner')) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resolveExplorerDrop(event, rootPath, handleDropOnTarget, handleImportOnTarget);
    },
    [handleDropOnTarget, handleImportOnTarget, rootPath],
  );

  const handleContextMenu = useCallback((entry: ProjectDirectoryEntry, x: number, y: number) => {
    setContextMenu({ entry, x, y });
  }, []);

  const handleTreeContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.project-explorer__row')) {
      return;
    }

    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleNewFileFromMenu = useCallback(() => {
    setCreatePromptMode('file');
  }, []);

  const handleNewFolderFromMenu = useCallback(() => {
    setCreatePromptMode('folder');
  }, []);

  const handleAddToChat = useCallback(
    (entry: ProjectDirectoryEntry) => {
      if (!project) {
        return;
      }

      void mentionExplorerEntryInAgent(project, entry.path, onSelectPane);
    },
    [onSelectPane, project],
  );

  const handleRevealInFolder = useCallback((entry: ProjectDirectoryEntry) => {
    void window.nexus.files.revealInFolder(entry.path);
  }, []);

  const handleCopyPath = useCallback((entry: ProjectDirectoryEntry) => {
    void navigator.clipboard.writeText(entry.path);
  }, []);

  const handleCopyRelativePath = useCallback(
    (entry: ProjectDirectoryEntry) => {
      void navigator.clipboard.writeText(toProjectRelativePath(rootPath, entry.path));
    },
    [rootPath],
  );

  const handleRenameRequest = useCallback((entry: ProjectDirectoryEntry) => {
    setRenameEntry(entry);
  }, []);

  const handleRenameConfirm = useCallback(
    async (nextName: string) => {
      if (!renameEntry) {
        return;
      }

      const result = await window.nexus.files.renameEntry(renameEntry.path, nextName);

      if (!result.ok) {
        return;
      }

      refreshTree();
      setSelectedPath(result.path);
      setSelectedType(renameEntry.type);
      setRenameEntry(null);
    },
    [refreshTree, renameEntry],
  );

  const handleDeleteRequest = useCallback((entry: ProjectDirectoryEntry) => {
    setDeleteEntry(entry);
  }, []);

  const handleDeleteConfirm = useCallback(
    async (requestClose: () => void) => {
      if (!deleteEntry) {
        return;
      }

      const result = await window.nexus.files.deleteEntry(deleteEntry.path);

      if (!result.ok) {
        return;
      }

      if (selectedPath === deleteEntry.path || selectedPath?.startsWith(`${deleteEntry.path}/`)) {
        setSelectedPath(null);
        setSelectedType(null);
      }

      refreshTree();
      setDeleteEntry(null);
      requestClose();
    },
    [deleteEntry, refreshTree, selectedPath],
  );

  const handleViewCode = useCallback(
    (entry: ProjectDirectoryEntry) => {
      onOpenFileCode(entry);
    },
    [onOpenFileCode],
  );

  const visibleEntries = isSearching ? (searchResults ?? []) : rootEntries;
  const shouldAutoExpandSingleRootFolder = useMemo(() => {
    if (isSearching) {
      return false;
    }

    return rootEntries.length === 1 && rootEntries[0]?.type === 'directory';
  }, [isSearching, rootEntries]);
  const treeLoading = isSearching ? searchLoading : loading;
  const isRootDropTarget = dropTargetPath === rootPath;
  const treeDropClass = getDropTargetClasses(
    isRootDropTarget,
    explorerDragMode,
    'project-explorer__tree--drop-target',
  );

  const dropFeedbackLabel = useMemo(() => {
    if (explorerDragMode !== 'external') {
      return null;
    }

    if (!dropTargetPath || dropTargetPath === rootPath) {
      return 'Solte para importar na raiz do projeto';
    }

    const folderName = dropTargetPath.split('/').pop();

    return folderName ? `Solte para importar em ${folderName}` : 'Solte para importar';
  }, [dropTargetPath, explorerDragMode, rootPath]);

  return (
    <aside
      className={`project-explorer-drawer${explorerDragMode === 'external' ? ' project-explorer-drawer--external-drag' : ''}${explorerDragMode === 'internal' ? ' project-explorer-drawer--internal-drag' : ''}`}
      aria-label='Explorador'
      onDragEnter={handleExplorerDragEnter}
      onDragLeave={handleExplorerDragLeave}
      onDragOver={(event) => {
        if (!dragEnabled || isSearching) {
          return;
        }

        if (isExternalFileDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
    >
        <div className='project-explorer__header'>
          <span className='project-explorer__title'>Explorador</span>
          <div className='project-explorer__header-actions'>
            {!isGitView ? (
              <>
                <button
                  type='button'
                  className='project-explorer__header-btn app-button app-button--enter'
                  aria-label='Novo arquivo'
                  onClick={() => setCreatePromptMode('file')}
                >
                  <FilePlus size={14} strokeWidth={2} />
                </button>
                <button
                  type='button'
                  className='project-explorer__header-btn app-button app-button--enter'
                  aria-label='Nova pasta'
                  onClick={() => setCreatePromptMode('folder')}
                >
                  <FolderPlus size={14} strokeWidth={2} />
                </button>
                <button
                  type='button'
                  className={`project-explorer__header-btn app-button app-button--enter${searchOpen ? ' project-explorer__header-btn--active' : ''}`}
                  aria-label='Buscar arquivos'
                  onClick={handleToggleSearch}
                >
                  <Search size={14} strokeWidth={2} />
                </button>
              </>
            ) : null}
            <button
              type='button'
              className={`project-explorer__header-btn project-explorer__header-btn--git app-button app-button--enter${isGitView ? ' project-explorer__header-btn--active' : ''}`}
              aria-label='Controle de versão'
              onClick={toggleExplorerGit}
            >
              <GitBranch size={14} strokeWidth={2} />
              {gitChangeCount > 0 ? (
                <span className='project-explorer__header-badge' aria-hidden='true'>
                  {gitChangeCount > 99 ? '99+' : gitChangeCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {isGitView ? (
          <ProjectGitDrawer
            embedded
            projectId={projectId}
            rootPath={rootPath}
            onOpenDiff={onOpenDiff}
          />
        ) : (
          <>
        <div className={`project-explorer__search${searchOpen ? ' project-explorer__search--open' : ''}`}>
          <div className='project-explorer__search-inner'>
            <div className='project-explorer__search-field'>
              <input
                ref={searchInputRef}
                type='text'
                className='project-explorer__search-input'
                placeholder='Buscar no projeto'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className='project-explorer__search-options'>
                <button
                  type='button'
                  className={`project-explorer__search-option${searchOptions.matchCase ? ' project-explorer__search-option--active' : ''}`}
                  aria-label='Diferenciar maiúsculas e minúsculas'
                  aria-pressed={searchOptions.matchCase}
                  onClick={() => toggleSearchOption('matchCase')}
                >
                  Aa
                </button>
                <button
                  type='button'
                  className={`project-explorer__search-option project-explorer__search-option--whole-word${searchOptions.matchWholeWord ? ' project-explorer__search-option--active' : ''}`}
                  aria-label='Palavra inteira'
                  aria-pressed={searchOptions.matchWholeWord}
                  onClick={() => toggleSearchOption('matchWholeWord')}
                >
                  ab
                </button>
                <button
                  type='button'
                  className={`project-explorer__search-option${searchOptions.useRegex ? ' project-explorer__search-option--active' : ''}`}
                  aria-label='Usar expressão regular'
                  aria-pressed={searchOptions.useRegex}
                  onClick={() => toggleSearchOption('useRegex')}
                >
                  .*
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`project-explorer__tree-shell${explorerDragMode ? ` project-explorer__tree-shell--${explorerDragMode}` : ''}`}
        >
          {dropFeedbackLabel ? (
            <div className='project-explorer__drop-feedback app-button--enter'>
              <span>{dropFeedbackLabel}</span>
            </div>
          ) : null}
          <div
            className={`project-explorer__tree${treeDropClass}`}
            onContextMenu={handleTreeContextMenu}
            onDragOver={handleTreeDragOver}
            onDragLeave={handleTreeDragLeave}
            onDrop={handleTreeDrop}
          >
          {treeLoading ? <div className='project-explorer__loading'>Carregando arquivos...</div> : null}
          {!treeLoading && visibleEntries.length === 0 ? (
            <div className='project-explorer__loading'>Nenhum arquivo encontrado</div>
          ) : null}
          {!treeLoading
            ? visibleEntries.map((entry, index) => (
                <ExplorerTreeNode
                  key={entry.path}
                  entry={entry}
                  rootPath={rootPath}
                  depth={0}
                  selectedPath={selectedPath}
                  accentColor={
                    entry.type === 'directory'
                      ? EXPLORER_ROOT_COLORS[index % EXPLORER_ROOT_COLORS.length]
                      : undefined
                  }
                  projectKind={entry.type === 'directory' ? projectKinds[entry.path] : null}
                  dragEnabled={dragEnabled}
                  dropTargetPath={dropTargetPath}
                  dropDragMode={explorerDragMode}
                  treeRevision={treeRevision}
                  directoryInvalidation={directoryInvalidation}
                  preloadedChildren={
                    isSearching && entry.type === 'directory'
                      ? ((entry as ExplorerSearchNode).children ?? null)
                      : undefined
                  }
                  initialExpanded={isSearching || shouldAutoExpandSingleRootFolder}
                  onSelect={handleSelect}
                  onOpenFile={onOpenFile}
                  onDragStartEntry={handleDragStartEntry}
                  onDragEndEntry={handleDragEndEntry}
                  onDragOverDropTarget={handleDragOverDropTarget}
                  onDropOnTarget={handleDropOnTarget}
                  onImportOnTarget={handleImportOnTarget}
                  onContextMenu={handleContextMenu}
                  resolveGitDecoration={resolveGitDecoration}
                />
              ))
            : null}
          </div>
        </div>
          </>
        )}

        {createPromptMode ? (
          <ProjectPromptDialog
            mode='rename'
            initialValue={createPromptMode === 'file' ? 'novo-arquivo.txt' : 'nova-pasta'}
            dialogTitle={createPromptMode === 'file' ? 'Novo arquivo' : 'Nova pasta'}
            dialogLabel={createPromptMode === 'file' ? 'Nome do arquivo' : 'Nome da pasta'}
            onConfirm={(value) => {
              void handleCreateConfirm(value);
            }}
            onClose={() => setCreatePromptMode(null)}
          />
        ) : null}

        {contextMenu ? (
          <ExplorerEntryContextMenu
            entry={contextMenu.entry}
            x={contextMenu.x}
            y={contextMenu.y}
            canAddToChat={canAddToChat}
            onClose={handleCloseContextMenu}
            onNewFile={handleNewFileFromMenu}
            onNewFolder={handleNewFolderFromMenu}
            onAddToChat={handleAddToChat}
            onRevealInFolder={handleRevealInFolder}
            onCopyPath={handleCopyPath}
            onCopyRelativePath={handleCopyRelativePath}
            onRename={handleRenameRequest}
            onDelete={handleDeleteRequest}
            onViewCode={handleViewCode}
          />
        ) : null}

        {renameEntry ? (
          <ProjectPromptDialog
            mode='rename'
            initialValue={renameEntry.name}
            dialogTitle='Renomear'
            dialogLabel={renameEntry.type === 'directory' ? 'Nome da pasta' : 'Nome do arquivo'}
            onConfirm={(value) => {
              void handleRenameConfirm(value);
            }}
            onClose={() => setRenameEntry(null)}
          />
        ) : null}

        {deleteEntry ? (
          <AnimatedModal onClose={() => setDeleteEntry(null)} panelClassName='project-dialog'>
            {(requestClose) => (
              <>
                <span className='project-dialog__title'>Deletar item</span>
                <p className='project-dialog__message'>
                  Tem certeza que deseja deletar <strong>{deleteEntry.name}</strong>?
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
                    className='project-dialog__btn project-dialog__btn--danger app-button'
                    onClick={() => {
                      void handleDeleteConfirm(requestClose);
                    }}
                  >
                    Deletar
                  </button>
                </div>
              </>
            )}
          </AnimatedModal>
        ) : null}
      </aside>
  );
}

export const ProjectExplorerDrawer = memo(ProjectExplorerDrawerComponent);
