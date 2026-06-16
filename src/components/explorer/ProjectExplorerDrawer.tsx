import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ExplorerDirectoryIcon,
  ExplorerFileIcon,
  getExplorerFileIconVariant,
} from '@/components/explorer/ExplorerTreeIcon';
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

interface ProjectExplorerDrawerProps {
  rootPath: string;
  onOpenFile: (entry: ProjectDirectoryEntry) => void;
}

interface ExplorerTreeNodeProps {
  entry: ProjectDirectoryEntry;
  depth: number;
  selectedPath: string | null;
  accentColor?: string;
  projectKind?: ProjectKind | null;
  preloadedChildren?: ProjectDirectoryEntry[] | null;
  initialExpanded?: boolean;
  onSelect: (path: string) => void;
  onOpenFile: (entry: ProjectDirectoryEntry) => void;
}

function getProjectKindBadgeLabel(kind: ProjectKind): string {
  if (kind === 'mobile') {
    return 'APP';
  }

  return kind.toUpperCase();
}

const ExplorerTreeNode = memo(function ExplorerTreeNodeComponent({
  entry,
  depth,
  selectedPath,
  accentColor,
  projectKind,
  preloadedChildren,
  initialExpanded = false,
  onSelect,
  onOpenFile,
}: ExplorerTreeNodeProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [children, setChildren] = useState<ProjectDirectoryEntry[] | null>(
    preloadedChildren ?? null,
  );
  const [loading, setLoading] = useState(false);
  const isDirectory = entry.type === 'directory';
  const isSelected = selectedPath === entry.path;
  const iconVariant = getExplorerFileIconVariant(entry.name, entry.type);
  const isRootProject = depth === 0 && isDirectory && projectKind;
  const rootAccent = depth === 0 && isDirectory ? accentColor : undefined;
  const isSearchTree = preloadedChildren !== undefined;

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

  const handleToggle = useCallback(() => {
    if (!isDirectory) {
      onOpenFile(entry);
      onSelect(entry.path);
      return;
    }

    setExpanded((value) => !value);
    onSelect(entry.path);
  }, [entry, isDirectory, onOpenFile, onSelect]);

  return (
    <div className={`project-explorer__branch${expanded ? ' project-explorer__branch--expanded' : ''}`}>
      <button
        type='button'
        className={`project-explorer__row app-button${isSelected ? ' project-explorer__row--selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleToggle}
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
          <ExplorerDirectoryIcon folderName={entry.name} />
        ) : (
          <ExplorerFileIcon variant={iconVariant} />
        )}
        <span
          className='project-explorer__label'
          style={rootAccent ? { color: rootAccent } : undefined}
        >
          {entry.name}
        </span>
      </button>

      {isDirectory ? (
        <div className={`project-explorer__children${expanded ? ' project-explorer__children--open' : ''}`}>
          <div className='project-explorer__children-inner'>
            {expanded && loading ? <div className='project-explorer__loading'>Carregando...</div> : null}
            {expanded && !loading && children?.length === 0 ? (
              <div className='project-explorer__empty-folder' style={{ paddingLeft: `${22 + depth * 14}px` }}>
                Pasta vazia
              </div>
            ) : null}
            {expanded
              ? children?.map((child) => (
                  <ExplorerTreeNode
                    key={child.path}
                    entry={child}
                    depth={depth + 1}
                    selectedPath={selectedPath}
                    preloadedChildren={
                      isSearchTree && child.type === 'directory'
                        ? ((child as ExplorerSearchNode).children ?? null)
                        : undefined
                    }
                    initialExpanded={isSearchTree}
                    onSelect={onSelect}
                    onOpenFile={onOpenFile}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

function ProjectExplorerDrawerComponent({ rootPath, onOpenFile }: ProjectExplorerDrawerProps) {
  const [rootEntries, setRootEntries] = useState<ProjectDirectoryEntry[]>([]);
  const [projectKinds, setProjectKinds] = useState<Record<string, ProjectKind | null>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState<ExplorerSearchOptions>(
    DEFAULT_EXPLORER_SEARCH_OPTIONS,
  );
  const [searchResults, setSearchResults] = useState<ExplorerSearchNode[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void window.nexus.files.listDirectoryEntries(rootPath).then(async (entries) => {
      if (cancelled) {
        return;
      }

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

      if (!cancelled) {
        setRootEntries(entries);
        setProjectKinds(kinds);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setRootEntries([]);
        setProjectKinds({});
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
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
            setSearchResults(results);
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
  const visibleEntries = isSearching ? (searchResults ?? []) : rootEntries;
  const treeLoading = isSearching ? searchLoading : loading;

  return (
    <aside className='project-explorer-drawer' aria-label='Explorador'>
        <div className='project-explorer__header'>
          <span className='project-explorer__title'>Explorador</span>
          <div className='project-explorer__header-actions'>
            <button
              type='button'
              className={`project-explorer__header-btn app-button${searchOpen ? ' project-explorer__header-btn--active' : ''}`}
              aria-label='Buscar arquivos'
              onClick={handleToggleSearch}
            >
              <Search size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

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

        <div className='project-explorer__tree'>
          {treeLoading ? <div className='project-explorer__loading'>Carregando arquivos...</div> : null}
          {!treeLoading && visibleEntries.length === 0 ? (
            <div className='project-explorer__loading'>Nenhum arquivo encontrado</div>
          ) : null}
          {!treeLoading
            ? visibleEntries.map((entry, index) => (
                <ExplorerTreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  selectedPath={selectedPath}
                  accentColor={
                    entry.type === 'directory'
                      ? EXPLORER_ROOT_COLORS[index % EXPLORER_ROOT_COLORS.length]
                      : undefined
                  }
                  projectKind={entry.type === 'directory' ? projectKinds[entry.path] : null}
                  preloadedChildren={
                    isSearching && entry.type === 'directory'
                      ? ((entry as ExplorerSearchNode).children ?? null)
                      : undefined
                  }
                  initialExpanded={isSearching}
                  onSelect={handleSelect}
                  onOpenFile={onOpenFile}
                />
              ))
            : null}
        </div>
      </aside>
  );
}

export const ProjectExplorerDrawer = memo(ProjectExplorerDrawerComponent);
