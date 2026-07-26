import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  ArrowLeft,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Search,
} from 'lucide-react';
import {
  ExplorerDirectoryIcon,
  ExplorerFileIcon,
} from '@/components/explorer/ExplorerTreeIcon';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { EmptyState } from '@/components/overlay/EmptyState';
import type { ProjectDirectoryEntry } from '@/types';
import {
  addBrainManualDocumentsFromEntries,
  addBrainManualDocumentsFromPaths,
} from '@/utils/brainManualStore';
import { getDroppedFilePaths, isExternalFileDrag } from '@/utils/explorerExternalDrop';

type BrainDocumentSource = 'external' | 'project';

interface BrainAddDocumentsModalProps {
  projectPath: string;
  onClose: () => void;
  onSaved: () => void;
}

interface ProjectEntryOption {
  name: string;
  path: string;
  relativePath: string;
  type: 'file' | 'directory';
}

interface ProjectEntryItemProps {
  item: ProjectEntryOption;
  checked: boolean;
  onToggle: (entry: ProjectEntryOption, checked: boolean) => void;
}

interface BrainPickerTreeNodeProps {
  entry: ProjectDirectoryEntry;
  depth: number;
  selectedSet: Set<string>;
  onToggle: (entry: ProjectDirectoryEntry, checked: boolean) => void;
}

interface BrainProjectExplorerPanelProps {
  rootPath: string;
  selectedSet: Set<string>;
  onToggle: (entry: ProjectDirectoryEntry, checked: boolean) => void;
}

const SKIP_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.nexus',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
]);

function normalizeProjectRoot(projectPath: string): string {
  return projectPath.replace(/[\\/]+$/, '');
}

function toRelativePath(filePath: string, projectPath: string): string {
  const root = normalizeProjectRoot(projectPath);
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length).replace(/^[\\/]+/, '') || filePath;
  }
  return filePath;
}

function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRECTORY_NAMES.has(name);
}

function isDocumentLikeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.mdx') ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.doc') ||
    lower.endsWith('.docx') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.rst') ||
    lower.endsWith('.adoc') ||
    lower.includes('openapi') ||
    lower.includes('swagger') ||
    lower.startsWith('readme.')
  );
}

function flattenTreeEntries(
  nodes: Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>,
  projectPath: string,
  acc: ProjectEntryOption[] = [],
  seen: Set<string> = new Set(),
): ProjectEntryOption[] {
  for (const node of nodes) {
    if (seen.has(node.path)) {
      if (node.children && node.children.length > 0) {
        flattenTreeEntries(
          node.children as Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>,
          projectPath,
          acc,
          seen,
        );
      }
      continue;
    }

    seen.add(node.path);
    acc.push({
      name: node.name,
      path: node.path,
      relativePath: toRelativePath(node.path, projectPath),
      type: node.type,
    });

    if (node.children && node.children.length > 0) {
      flattenTreeEntries(
        node.children as Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>,
        projectPath,
        acc,
        seen,
      );
    }
  }
  return acc;
}

async function loadProjectDocumentCandidates(projectPath: string): Promise<ProjectEntryOption[]> {
  const options: ProjectEntryOption[] = [];
  const seen = new Set<string>();

  const pushEntry = (entry: ProjectDirectoryEntry, force = false) => {
    if (seen.has(entry.path)) {
      return;
    }
    if (entry.type === 'directory') {
      if (shouldSkipDirectory(entry.name) && !force) {
        return;
      }
      seen.add(entry.path);
      options.push({
        name: entry.name,
        path: entry.path,
        relativePath: toRelativePath(entry.path, projectPath),
        type: 'directory',
      });
      return;
    }
    if (!force && !isDocumentLikeFile(entry.name)) {
      return;
    }
    seen.add(entry.path);
    options.push({
      name: entry.name,
      path: entry.path,
      relativePath: toRelativePath(entry.path, projectPath),
      type: 'file',
    });
  };

  try {
    const rootEntries = await window.nexus.files.listDirectoryEntries(projectPath);
    rootEntries.forEach((entry) => {
      if (entry.type === 'file') {
        pushEntry(entry);
        return;
      }
      if (['docs', 'doc', 'documentation'].includes(entry.name.toLowerCase())) {
        pushEntry(entry, true);
      }
    });

    const docsDirs = rootEntries.filter(
      (entry) =>
        entry.type === 'directory' &&
        ['docs', 'doc', 'documentation'].includes(entry.name.toLowerCase()),
    );

    for (const docsDir of docsDirs) {
      try {
        const nested = await window.nexus.files.listDirectoryEntries(docsDir.path);
        nested.forEach((entry) => pushEntry(entry, entry.type === 'directory'));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const tree = await window.nexus.files.searchProjectTree(projectPath, 'README', {
      matchCase: false,
      matchWholeWord: false,
      useRegex: false,
    });
    flattenTreeEntries(
      tree as Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>,
      projectPath,
    ).forEach((item) => {
      if (seen.has(item.path) || item.type === 'directory') {
        return;
      }
      seen.add(item.path);
      options.push(item);
    });
  } catch {
    /* ignore */
  }

  return options.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.relativePath.localeCompare(right.relativePath, 'pt-BR');
  });
}

function BrainPickerTreeNodeComponent({
  entry,
  depth,
  selectedSet,
  onToggle,
}: BrainPickerTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ProjectDirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isDirectory = entry.type === 'directory';
  const checked = selectedSet.has(entry.path);

  useEffect(() => {
    if (!expanded || !isDirectory || children !== null) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void window.nexus.files
      .listDirectoryEntries(entry.path)
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setChildren(entries.filter((item) => !(item.type === 'directory' && shouldSkipDirectory(item.name))));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setChildren([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [children, entry.path, expanded, isDirectory]);

  const handleToggleExpand = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded((current) => !current);
  }, []);

  const handleToggleChecked = useCallback(
    (nextChecked: boolean) => {
      onToggle(entry, nextChecked);
    },
    [entry, onToggle],
  );

  const handleRowClick = useCallback(() => {
    onToggle(entry, !checked);
  }, [checked, entry, onToggle]);

  return (
    <div className={`project-explorer__branch${expanded ? ' project-explorer__branch--expanded' : ''}`}>
      <div
        className={`project-explorer__row brain-add-documents__tree-row app-button app-button--enter${checked ? ' project-explorer__row--selected' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        role='button'
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleRowClick();
          }
        }}
      >
        <span
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <AppCheckbox
            checked={checked}
            aria-label={isDirectory ? `Selecionar pasta ${entry.name}` : `Selecionar ${entry.name}`}
            onChange={handleToggleChecked}
          />
        </span>
        {isDirectory ? (
          <button
            type='button'
            className='project-explorer__chevron brain-add-documents__tree-chevron app-button'
            aria-label={expanded ? `Recolher ${entry.name}` : `Expandir ${entry.name}`}
            onClick={handleToggleExpand}
          >
            {expanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
          </button>
        ) : (
          <span className='project-explorer__chevron' aria-hidden='true' />
        )}
        {isDirectory ? (
          <ExplorerDirectoryIcon folderName={entry.name} expanded={expanded} />
        ) : (
          <ExplorerFileIcon name={entry.name} />
        )}
        <span className='project-explorer__label'>{entry.name}</span>
      </div>

      {isDirectory ? (
        <div className={`project-explorer__children${expanded ? ' project-explorer__children--open' : ''}`}>
          <div className='project-explorer__children-inner'>
            {loading ? <p className='project-explorer__loading'>Carregando…</p> : null}
            {!loading && children && children.length === 0 ? (
              <div className='project-explorer__empty-folder'>
                <FolderOpen size={12} strokeWidth={2} aria-hidden />
                <span>Pasta vazia</span>
              </div>
            ) : null}
            {!loading && children
              ? children.map((child) => (
                  <BrainPickerTreeNode
                    key={child.path}
                    entry={child}
                    depth={depth + 1}
                    selectedSet={selectedSet}
                    onToggle={onToggle}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const BrainPickerTreeNode = memo(BrainPickerTreeNodeComponent);

function BrainProjectExplorerPanelComponent({
  rootPath,
  selectedSet,
  onToggle,
}: BrainProjectExplorerPanelProps) {
  const [rootEntries, setRootEntries] = useState<ProjectDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void window.nexus.files
      .listDirectoryEntries(rootPath)
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setRootEntries(
          entries.filter((entry) => !(entry.type === 'directory' && shouldSkipDirectory(entry.name))),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRootEntries([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  return (
    <aside className='brain-add-documents__explorer app-button--enter' aria-label='Explorador do projeto'>
      <div className='brain-add-documents__explorer-header'>
        <FolderOpen size={14} strokeWidth={2} aria-hidden='true' />
        <span>Explorador do projeto</span>
      </div>
      <div className='project-explorer__tree brain-add-documents__explorer-tree'>
        {loading ? <p className='project-explorer__loading'>Carregando…</p> : null}
        {!loading && rootEntries.length === 0 ? (
          <EmptyState
            icon={Folder}
            title='Projeto vazio'
            message='Nenhum arquivo encontrado na raiz.'
            compact
            className='brain-add-documents__empty'
          />
        ) : null}
        {!loading
          ? rootEntries.map((entry) => (
              <BrainPickerTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                selectedSet={selectedSet}
                onToggle={onToggle}
              />
            ))
          : null}
      </div>
    </aside>
  );
}

const BrainProjectExplorerPanel = memo(BrainProjectExplorerPanelComponent);

function ProjectEntryItemComponent({ item, checked, onToggle }: ProjectEntryItemProps) {
  const handleToggle = useCallback(
    (nextChecked: boolean) => {
      onToggle(item, nextChecked);
    },
    [item, onToggle],
  );

  const handleRowClick = useCallback(() => {
    onToggle(item, !checked);
  }, [checked, item, onToggle]);

  const isDirectory = item.type === 'directory';
  const Icon = isDirectory ? Folder : FileText;

  return (
    <div
      className={`brain-add-documents__file-item app-button app-button--enter${checked ? ' brain-add-documents__file-item--active' : ''}${isDirectory ? ' brain-add-documents__file-item--directory' : ''}`}
      onClick={handleRowClick}
      role='button'
      tabIndex={0}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleRowClick();
        }
      }}
    >
      <span
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <AppCheckbox
          checked={checked}
          aria-label={isDirectory ? `Selecionar pasta ${item.name}` : `Selecionar ${item.name}`}
          onChange={handleToggle}
        />
      </span>
      <span
        className={`brain-add-documents__file-icon${isDirectory ? ' brain-add-documents__file-icon--directory' : ''}`}
        aria-hidden='true'
      >
        <Icon size={14} strokeWidth={2} />
      </span>
      <span className='brain-add-documents__file-copy'>
        <span className='brain-add-documents__file-title'>{item.name}</span>
        <span className='brain-add-documents__file-meta'>
          {isDirectory ? `Pasta inteira · ${item.relativePath}` : item.relativePath}
        </span>
      </span>
    </div>
  );
}

const ProjectEntryItem = memo(ProjectEntryItemComponent);

function BrainAddDocumentsModalComponent({
  projectPath,
  onClose,
  onSaved,
}: BrainAddDocumentsModalProps) {
  const [source, setSource] = useState<BrainDocumentSource | null>(null);
  const [projectEntries, setProjectEntries] = useState<ProjectEntryOption[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [entryTypeByPath, setEntryTypeByPath] = useState<Map<string, 'file' | 'directory'>>(
    () => new Map(),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [externalDragging, setExternalDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'project') {
      return;
    }

    let cancelled = false;
    const trimmedQuery = searchQuery.trim();
    setLoadingFiles(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          if (!trimmedQuery) {
            const candidates = await loadProjectDocumentCandidates(projectPath);
            if (!cancelled) {
              setProjectEntries(candidates);
              setEntryTypeByPath((current) => {
                const next = new Map(current);
                candidates.forEach((entry) => {
                  next.set(entry.path, entry.type);
                });
                return next;
              });
            }
            return;
          }

          const tree = await window.nexus.files.searchProjectTree(projectPath, trimmedQuery, {
            matchCase: false,
            matchWholeWord: false,
            useRegex: false,
          });

          if (cancelled) {
            return;
          }

          const entries = flattenTreeEntries(
            tree as Array<ProjectDirectoryEntry & { children?: ProjectDirectoryEntry[] }>,
            projectPath,
          ).sort((left, right) => {
            if (left.type !== right.type) {
              return left.type === 'directory' ? -1 : 1;
            }
            return left.relativePath.localeCompare(right.relativePath, 'pt-BR');
          });

          setProjectEntries(entries);
          setEntryTypeByPath((current) => {
            const next = new Map(current);
            entries.forEach((entry) => {
              next.set(entry.path, entry.type);
            });
            return next;
          });
        } catch {
          if (!cancelled) {
            setError('Não foi possível listar os arquivos do projeto');
            setProjectEntries([]);
          }
        } finally {
          if (!cancelled) {
            setLoadingFiles(false);
          }
        }
      })();
    }, trimmedQuery ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [projectPath, searchQuery, source]);

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedCount = selectedPaths.length;

  const handleSelectSource = useCallback((nextSource: BrainDocumentSource) => {
    setSource(nextSource);
    setError(null);
    setSelectedPaths([]);
    setEntryTypeByPath(new Map());
    setSearchQuery('');
    setExternalDragging(false);
  }, []);

  const handleBack = useCallback(() => {
    setSource(null);
    setError(null);
    setSelectedPaths([]);
    setEntryTypeByPath(new Map());
    setSearchQuery('');
    setExternalDragging(false);
  }, []);

  const handleToggleEntry = useCallback(
    (entry: { path: string; type: 'file' | 'directory' }, checked: boolean) => {
      setEntryTypeByPath((current) => {
        const next = new Map(current);
        next.set(entry.path, entry.type);
        return next;
      });
      setSelectedPaths((current) => {
        if (checked) {
          return current.includes(entry.path) ? current : [...current, entry.path];
        }
        return current.filter((item) => item !== entry.path);
      });
    },
    [],
  );

  const persistPaths = useCallback(
    async (paths: string[], requestClose: () => void) => {
      setSaving(true);
      setError(null);

      try {
        const result = await addBrainManualDocumentsFromPaths(projectPath, paths);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.cancelled) {
          return;
        }
        onSaved();
        requestClose();
      } catch {
        setError('Não foi possível adicionar os documentos');
      } finally {
        setSaving(false);
      }
    },
    [onSaved, projectPath],
  );

  const handlePickExternal = useCallback(
    async (requestClose: () => void) => {
      const sourcePaths = await window.nexus.dialog.openFiles();
      if (!sourcePaths || sourcePaths.length === 0) {
        return;
      }
      await persistPaths(sourcePaths, requestClose);
    },
    [persistPaths],
  );

  const handleSaveProjectSelection = useCallback(
    async (requestClose: () => void) => {
      if (selectedPaths.length === 0) {
        setError('Selecione ao menos um arquivo ou pasta do projeto');
        return;
      }

      setSaving(true);
      setError(null);

      try {
        const entries = selectedPaths.map((path) => ({
          path,
          type: entryTypeByPath.get(path) ?? ('file' as const),
        }));

        const result = await addBrainManualDocumentsFromEntries(projectPath, entries);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.cancelled) {
          return;
        }
        onSaved();
        requestClose();
      } catch {
        setError('Não foi possível adicionar os documentos');
      } finally {
        setSaving(false);
      }
    },
    [entryTypeByPath, onSaved, projectPath, selectedPaths],
  );

  const handleExternalDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setExternalDragging(true);
  }, []);

  const handleExternalDragLeave = useCallback(() => {
    setExternalDragging(false);
  }, []);

  const handleExternalDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, requestClose: () => void) => {
      event.preventDefault();
      setExternalDragging(false);
      if (!isExternalFileDrag(event.dataTransfer)) {
        return;
      }
      const paths = getDroppedFilePaths(event.dataTransfer);
      if (paths.length === 0) {
        setError('Não foi possível ler os arquivos arrastados');
        return;
      }
      void persistPaths(paths, requestClose);
    },
    [persistPaths],
  );

  return (
    <AnimatedModal
      onClose={onClose}
      panelClassName={`project-dialog brain-add-documents${source === 'project' ? ' brain-add-documents--project' : ''}`}
    >
      {(requestClose) => (
        <>
          <div className='brain-add-documents__header'>
            {source ? (
              <button
                type='button'
                className='brain-add-documents__back app-button app-button--enter'
                onClick={handleBack}
                disabled={saving}
                aria-label='Voltar'
              >
                <ArrowLeft size={14} strokeWidth={2} />
              </button>
            ) : null}
            <span className='project-dialog__title'>Adicionar documentos</span>
          </div>

          {!source ? (
            <>
              <p className='project-dialog__message'>
                Escolha se os arquivos vêm de fora do projeto ou já existem dentro dele.
              </p>
              <div className='brain-add-documents__choices'>
                <button
                  type='button'
                  className='brain-add-documents__choice app-button app-button--enter'
                  onClick={() => handleSelectSource('external')}
                >
                  <span className='brain-add-documents__choice-icon' aria-hidden='true'>
                    <HardDrive size={18} strokeWidth={2} />
                  </span>
                  <span className='brain-add-documents__choice-copy'>
                    <span className='brain-add-documents__choice-title'>De fora do projeto</span>
                    <span className='brain-add-documents__choice-meta'>
                      Selecione ou arraste arquivos do sistema
                    </span>
                  </span>
                </button>
                <button
                  type='button'
                  className='brain-add-documents__choice app-button app-button--enter'
                  onClick={() => handleSelectSource('project')}
                >
                  <span
                    className='brain-add-documents__choice-icon brain-add-documents__choice-icon--project'
                    aria-hidden='true'
                  >
                    <FolderOpen size={18} strokeWidth={2} />
                  </span>
                  <span className='brain-add-documents__choice-copy'>
                    <span className='brain-add-documents__choice-title'>Do projeto</span>
                    <span className='brain-add-documents__choice-meta'>
                      Use o explorador ou busque arquivos e pastas
                    </span>
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {source === 'external' ? (
            <>
              <p className='project-dialog__message'>
                Arraste arquivos do Finder ou selecione no sistema.
              </p>
              <div
                className={`brain-add-documents__dropzone${externalDragging ? ' brain-add-documents__dropzone--active' : ''}`}
                onDragOver={handleExternalDragOver}
                onDragLeave={handleExternalDragLeave}
                onDrop={(event) => handleExternalDrop(event, requestClose)}
              >
                <span className='brain-add-documents__dropzone-icon' aria-hidden='true'>
                  <ArrowDownToLine size={22} strokeWidth={2} />
                </span>
                <span className='brain-add-documents__dropzone-title'>
                  Arraste arquivos para cá
                </span>
                <span className='brain-add-documents__dropzone-meta'>
                  PDFs, Markdown, contratos e outros documentos
                </span>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--primary app-button'
                  disabled={saving}
                  onClick={() => {
                    void handlePickExternal(requestClose);
                  }}
                >
                  {saving ? 'Adicionando…' : 'Selecionar arquivos'}
                </button>
              </div>
            </>
          ) : null}

          {source === 'project' ? (
            <>
              <p className='project-dialog__message'>
                Navegue no explorador ao lado ou busque arquivos e pastas para indexar.
              </p>
              <div className='brain-add-documents__layout'>
                <BrainProjectExplorerPanel
                  rootPath={projectPath}
                  selectedSet={selectedSet}
                  onToggle={handleToggleEntry}
                />

                <div className='brain-add-documents__panel'>
                  <label className='brain-add-documents__search'>
                    <Search size={14} strokeWidth={2} aria-hidden='true' />
                    <input
                      value={searchQuery}
                      placeholder='Buscar arquivos ou pastas…'
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </label>

                  {loadingFiles ? (
                    <p className='brain-add-documents__loading'>Carregando arquivos…</p>
                  ) : null}

                  {!loadingFiles && projectEntries.length === 0 ? (
                    <EmptyState
                      icon={Folder}
                      title='Nenhum item encontrado'
                      message={
                        searchQuery.trim()
                          ? 'Tente outro termo de busca.'
                          : 'Use o explorador à esquerda ou busque pelo nome.'
                      }
                      compact
                      className='brain-add-documents__empty'
                    />
                  ) : null}

                  {!loadingFiles && projectEntries.length > 0 ? (
                    <div className='brain-add-documents__file-list' role='list'>
                      {projectEntries.map((item) => (
                        <ProjectEntryItem
                          key={item.path}
                          item={item}
                          checked={selectedSet.has(item.path)}
                          onToggle={handleToggleEntry}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {error ? <p className='brain-add-modal__error'>{error}</p> : null}

          <div className='project-dialog__actions project-dialog__actions--split'>
            {source === 'project' ? (
              <span className='brain-add-documents__count'>
                {selectedCount} selecionado{selectedCount === 1 ? '' : 's'}
              </span>
            ) : (
              <span />
            )}
            <div className='project-dialog__actions-group'>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button'
                onClick={requestClose}
                disabled={saving}
              >
                Cancelar
              </button>
              {source === 'project' ? (
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--primary app-button'
                  disabled={saving || loadingFiles || selectedCount === 0}
                  onClick={() => {
                    void handleSaveProjectSelection(requestClose);
                  }}
                >
                  {saving ? 'Adicionando…' : 'Adicionar'}
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const BrainAddDocumentsModal = memo(BrainAddDocumentsModalComponent);
