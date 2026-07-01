import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  CheckCheck,
  ChevronDown,
  Download,
  GitBranch,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { GitDiscardConfirmDialog } from '@/components/git/GitDiscardConfirmDialog';
import { AgentGitPromptLabel, AgentGitPromptModal } from '@/components/git/AgentGitPromptChip';
import { ExplorerEntryContextMenu } from '@/components/explorer/ExplorerEntryContextMenu';
import {
  ExplorerDirectoryIcon,
  ExplorerFileIcon,
} from '@/components/explorer/ExplorerTreeIcon';
import { EmptyState } from '@/components/overlay/EmptyState';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { EXPLORER_ENTRY_DRAG_MIME } from '@/constants/explorerDrag';
import { StatusBarBranchMenu } from '@/components/layout/StatusBarBranchMenu';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useGitStatus } from '@/hooks/useGitStatus';
import { useGitChangeCounts } from '@/hooks/useGitChangeCount';
import { useDelayedHoverHint } from '@/hooks/useDelayedHoverHint';
import {
  useAgentGitChangeStore,
  useAgentGitGroupsForProject,
} from '@/stores/useAgentGitChangeStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { GitRepoDiscovery } from '@/types/git';
import type { ProjectDirectoryEntry } from '@/types';
import { mentionExplorerEntryInAgent } from '@/utils/explorerAgentMention';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';
import { buildFlatChanges, type GitFlatChange } from '@/utils/gitFlatChanges';
import { findGitFlatChangeByPath, gitChangePathsMatch, toRepoAbsolutePath } from '@/utils/gitPaths';
import { resolvePaneAgentCommand } from '@/utils/projectAgentStatus';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';
import { collectProjectPanes } from '@/utils/tabGroups';

type DiscardConfirmState =
  | { scope: 'file'; path: string; paths: string[] }
  | { scope: 'paths'; paths: string[] }
  | { scope: 'group'; paths: string[]; groupLabel: string };

function truncateGroupLabel(prompt: string, maxLength = 80): string {
  const sanitized = sanitizeAgentPrompt(prompt).replace(/\s+/g, ' ').trim();
  const singleLine = sanitized.split('\n')[0] ?? sanitized;

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 1)}…`;
}

interface GitRepoMenuProps {
  anchorRect: DOMRect;
  repos: GitRepoDiscovery[];
  selectedPath: string;
  changeCounts: Record<string, number>;
  onClose: () => void;
  onSelect: (path: string) => void;
}

function formatRepoLabel(relativePath: string): string {
  if (relativePath === '.' || relativePath === '') {
    return 'Raiz do projeto';
  }

  return relativePath;
}

function GitRepoMenu({
  anchorRect,
  repos,
  selectedPath,
  changeCounts,
  onClose,
  onSelect,
}: GitRepoMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuRef, requestClose]);

  return createPortal(
    <div ref={menuRef} className={`overlay-popup git-panel__repo-menu ${animationClass}`}>
      <div className='git-panel__repo-list'>
        {repos.map((repo) => {
          const changeCount = changeCounts[repo.path] ?? 0;

          return (
            <button
              key={repo.path}
              type='button'
              className={`git-panel__repo-item app-button${repo.path === selectedPath ? ' git-panel__repo-item--active' : ''}`}
              onClick={() => {
                onSelect(repo.path);
                requestClose();
              }}
            >
              <span className='git-panel__repo-item-label'>{formatRepoLabel(repo.relativePath)}</span>
              <span className='git-panel__repo-item-meta'>
                {changeCount > 0 ? (
                  <span className='git-panel__repo-item-badge' aria-hidden='true'>
                    {changeCount > 99 ? '99+' : changeCount}
                  </span>
                ) : null}
                {repo.branch ? (
                  <span className='git-panel__repo-item-branch'>{repo.branch}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

interface GitMoreMenuProps {
  anchorRect: DOMRect;
  actionLoading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onPull: () => void;
  onPush: () => void;
  onStash: () => void;
  onStashPop: () => void;
}

function GitMoreMenu({
  anchorRect,
  actionLoading,
  onClose,
  onRefresh,
  onPull,
  onPush,
  onStash,
  onStashPop,
}: GitMoreMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuRef, requestClose]);

  const handleAction = useCallback(
    (action: () => void) => {
      action();
      requestClose();
    },
    [requestClose],
  );

  return createPortal(
    <div ref={menuRef} className={`overlay-popup git-scm__more-menu ${animationClass}`}>
      <button
        type='button'
        className='git-scm__more-item app-button app-button--enter'
        disabled={actionLoading}
        onClick={() => handleAction(onRefresh)}
      >
        <RefreshCw size={13} strokeWidth={2} />
        Atualizar
      </button>
      <button
        type='button'
        className='git-scm__more-item app-button app-button--enter'
        disabled={actionLoading}
        onClick={() => handleAction(onPull)}
      >
        <Download size={13} strokeWidth={2} />
        Pull
      </button>
      <button
        type='button'
        className='git-scm__more-item app-button app-button--enter'
        disabled={actionLoading}
        onClick={() => handleAction(onPush)}
      >
        <Upload size={13} strokeWidth={2} />
        Push
      </button>
      <button
        type='button'
        className='git-scm__more-item app-button app-button--enter'
        disabled={actionLoading}
        onClick={() => handleAction(onStash)}
      >
        <Archive size={13} strokeWidth={2} />
        Stash
      </button>
      <button
        type='button'
        className='git-scm__more-item app-button app-button--enter'
        disabled={actionLoading}
        onClick={() => handleAction(onStashPop)}
      >
        <Trash2 size={13} strokeWidth={2} />
        Stash pop
      </button>
    </div>,
    document.body,
  );
}

function resolveGitChangeEntry(path: string): { name: string; isDirectory: boolean } {
  const normalized = path.replace(/\\/g, '/');
  const isDirectory = normalized.endsWith('/');
  const trimmed = isDirectory ? normalized.slice(0, -1) : normalized;
  const segments = trimmed.split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? trimmed;

  return { name, isDirectory };
}

const GitChangeEntryIcon = memo(function GitChangeEntryIconComponent({ path }: { path: string }) {
  const { name, isDirectory } = useMemo(() => resolveGitChangeEntry(path), [path]);

  return (
    <span className='git-scm__file-icon' aria-hidden>
      {isDirectory ? <ExplorerDirectoryIcon folderName={name} /> : <ExplorerFileIcon name={name} />}
    </span>
  );
});

interface GitChangeRowProps {
  change: GitFlatChange;
  absolutePath: string | null;
  agentPrompt?: string;
  selected: boolean;
  onToggleSelected: (path: string, selected: boolean) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onOpenDiff: (
    filePath: string,
    options: { staged: boolean; untracked?: boolean; agentPrompt?: string },
  ) => void;
  onContextMenu: (change: GitFlatChange, x: number, y: number) => void;
}

const GitChangeRow = memo(function GitChangeRowComponent({
  change,
  absolutePath,
  agentPrompt,
  selected,
  onToggleSelected,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
  onContextMenu,
}: GitChangeRowProps) {
  const isNew = change.status === 'untracked' || change.status === 'added';
  const { onMouseEnter, onMouseLeave, hintNode } = useDelayedHoverHint(change.path);

  const handleOpenDiff = useCallback(() => {
    onOpenDiff(change.path, {
      staged: change.staged,
      untracked: change.status === 'untracked',
      agentPrompt,
    });
  }, [agentPrompt, change.path, change.staged, change.status, onOpenDiff]);

  const handleRowClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;

      if (target.closest('.git-scm__file-revert, .git-scm__file-checkbox, .app-checkbox')) {
        return;
      }

      handleOpenDiff();
    },
    [handleOpenDiff],
  );

  const handleRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      handleOpenDiff();
    },
    [handleOpenDiff],
  );

  const handleToggleSelected = useCallback(() => {
    onToggleSelected(change.path, !selected);
  }, [change.path, onToggleSelected, selected]);

  const handleDiscard = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDiscard(change.path);
    },
    [change.path, onDiscard],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(change, event.clientX, event.clientY);
    },
    [change, onContextMenu],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!absolutePath) {
        event.preventDefault();
        return;
      }

      const target = event.target as HTMLElement;

      if (target.closest('.git-scm__file-revert, .git-scm__file-checkbox, .app-checkbox')) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.setData(EXPLORER_ENTRY_DRAG_MIME, absolutePath);
      event.dataTransfer.setData('text/plain', absolutePath);
      event.dataTransfer.effectAllowed = 'move';
    },
    [absolutePath],
  );

  return (
    <div
      className='git-scm__file-row app-button app-button--enter'
      role='button'
      tabIndex={0}
      draggable={Boolean(absolutePath)}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <GitChangeEntryIcon path={change.path} />
      <span className='git-scm__file-path app-button__label'>{change.path}</span>
      <span className='git-scm__file-stats'>
        {change.additions > 0 ? (
          <span className='git-scm__file-stat git-scm__file-stat--add'>+{change.additions}</span>
        ) : null}
        {change.deletions > 0 ? (
          <span className='git-scm__file-stat git-scm__file-stat--del'>-{change.deletions}</span>
        ) : null}
      </span>
      {isNew ? <span className='git-scm__file-new'>Novo</span> : null}
      <button
        type='button'
        className='git-scm__file-revert app-button app-button--enter'
        aria-label='Descartar alterações'
        onClick={handleDiscard}
      >
        <RotateCcw size={12} strokeWidth={2.25} />
      </button>
      <AppCheckbox
        className='git-scm__file-checkbox'
        checked={selected}
        aria-label={selected ? 'Remover da seleção' : 'Selecionar para descartar'}
        onChange={handleToggleSelected}
      />
      {hintNode}
    </div>
  );
});

interface GitChangeContextMenuState {
  change: GitFlatChange;
  x: number;
  y: number;
}

interface ProjectGitDrawerProps {
  projectId: string;
  rootPath: string;
  embedded?: boolean;
  onOpenDiff: (
    filePath: string,
    options: { staged: boolean; untracked?: boolean; repoPath?: string; agentPrompt?: string },
  ) => void;
}

function GitDrawerShell({
  embedded = false,
  className = '',
  children,
}: {
  embedded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (embedded) {
    return <div className={`git-panel git-panel--embedded ${className}`.trim()}>{children}</div>;
  }

  return (
    <aside
      className={`project-explorer-drawer git-panel ${className}`.trim()}
      aria-label='Controle de versão'
    >
      {children}
    </aside>
  );
}

function ProjectGitDrawerComponent({
  projectId,
  rootPath,
  embedded = false,
  onOpenDiff,
}: ProjectGitDrawerProps) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId) ?? null);
  const activeAgentByPane = useTerminalSessionStore((state) => state.activeAgentByPane);
  const { selectPane } = useTabActions();
  const [discoveredRepos, setDiscoveredRepos] = useState<GitRepoDiscovery[]>([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchAnchor, setBranchAnchor] = useState<DOMRect | null>(null);
  const [repoAnchor, setRepoAnchor] = useState<DOMRect | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<DOMRect | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [discardConfirm, setDiscardConfirm] = useState<DiscardConfirmState | null>(null);
  const [promptModalText, setPromptModalText] = useState<string | null>(null);
  const [changeContextMenu, setChangeContextMenu] = useState<GitChangeContextMenuState | null>(null);
  const branchButtonRef = useRef<HTMLButtonElement>(null);
  const repoButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const focusedGroupRef = useRef<HTMLDivElement>(null);
  const promptGroups = useAgentGitGroupsForProject(projectId);
  const focusedGroupId = useAgentGitChangeStore((state) => state.focusedGroupId);
  const { byRepo: gitChangeCountsByRepo } = useGitChangeCounts(rootPath);

  useEffect(() => {
    let cancelled = false;

    setDiscovering(true);
    setDiscoveredRepos([]);
    setSelectedRepoPath(null);

    void window.nexus.git
      .discoverRepos(rootPath)
      .then((repos) => {
        if (cancelled) {
          return;
        }

        setDiscoveredRepos(repos);
        setSelectedRepoPath(repos[0]?.path ?? null);
        setDiscovering(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDiscovering(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const {
    status,
    loading,
    actionLoading,
    error,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    pull,
    push,
    checkout,
    createBranch,
    stash,
    stashPop,
  } = useGitStatus(selectedRepoPath, Boolean(selectedRepoPath));

  const selectedRepo = useMemo(
    () => discoveredRepos.find((repo) => repo.path === selectedRepoPath) ?? null,
    [discoveredRepos, selectedRepoPath],
  );

  const flatChanges = useMemo(() => (status ? buildFlatChanges(status) : []), [status]);

  useEffect(() => {
    if (discovering || loading || !status) {
      return;
    }

    useAgentGitChangeStore.getState().pruneGroupsForChanges(projectId, flatChanges);
  }, [discovering, flatChanges, loading, projectId, status]);

  const agentGroupedPaths = useMemo(() => {
    const paths = new Set<string>();

    for (const change of flatChanges) {
      for (const group of promptGroups) {
        const isGrouped = group.files.some((file) => gitChangePathsMatch(file.path, change.path));

        if (isGrouped) {
          paths.add(change.path);
        }
      }
    }

    return paths;
  }, [flatChanges, promptGroups]);

  const otherChanges = useMemo(
    () => flatChanges.filter((change) => !agentGroupedPaths.has(change.path)),
    [agentGroupedPaths, flatChanges],
  );

  const promptGroupSections = useMemo(
    () =>
      promptGroups
        .map((group) => ({
          group,
          changes: group.files
            .map((file) => findGitFlatChangeByPath(flatChanges, file.path))
            .filter((change): change is GitFlatChange => change !== null),
        }))
        .filter((section) => section.changes.length > 0),
    [flatChanges, promptGroups],
  );

  const totalAdditions = useMemo(
    () => flatChanges.reduce((sum, change) => sum + change.additions, 0),
    [flatChanges],
  );

  const totalDeletions = useMemo(
    () => flatChanges.reduce((sum, change) => sum + change.deletions, 0),
    [flatChanges],
  );

  const allSelected = useMemo(
    () => flatChanges.length > 0 && flatChanges.every((change) => selectedPaths.has(change.path)),
    [flatChanges, selectedPaths],
  );

  const hasSelection = selectedPaths.size > 0;

  useEffect(() => {
    setSelectedPaths((previous) => {
      const validPaths = new Set(flatChanges.map((change) => change.path));
      const next = new Set<string>();

      for (const path of previous) {
        if (validPaths.has(path)) {
          next.add(path);
        }
      }

      if (next.size === previous.size && [...next].every((path) => previous.has(path))) {
        return previous;
      }

      return next;
    });
  }, [flatChanges]);

  const canAddToChat = useMemo(() => {
    if (!project) {
      return false;
    }

    return collectProjectPanes(project.tabs).some((pane) =>
      Boolean(resolvePaneAgentCommand(pane, activeAgentByPane)),
    );
  }, [activeAgentByPane, project]);

  const changeContextMenuEntry = useMemo<ProjectDirectoryEntry | null>(() => {
    if (!changeContextMenu || !selectedRepoPath) {
      return null;
    }

    const absolutePath = toRepoAbsolutePath(selectedRepoPath, changeContextMenu.change.path);
    const fileName = changeContextMenu.change.path.split('/').pop() ?? changeContextMenu.change.path;

    return {
      name: fileName,
      path: absolutePath,
      type: 'file',
    };
  }, [changeContextMenu, selectedRepoPath]);

  useEffect(() => {
    if (!focusedGroupId) {
      return;
    }

    if (discovering || loading) {
      return;
    }

    const hasVisibleGroup = promptGroupSections.some(
      ({ group, changes }) => group.id === focusedGroupId && changes.length > 0,
    );

    if (!hasVisibleGroup) {
      useAgentGitChangeStore.getState().setFocusedGroupId(null);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      focusedGroupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      useAgentGitChangeStore.getState().setFocusedGroupId(null);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [discovering, focusedGroupId, loading, promptGroupSections]);

  const handleOpenDiff = useCallback(
    (filePath: string, options: { staged: boolean; untracked?: boolean; agentPrompt?: string }) => {
      onOpenDiff(filePath, {
        ...options,
        repoPath: selectedRepoPath ?? undefined,
      });
    },
    [onOpenDiff, selectedRepoPath],
  );

  const handleStage = useCallback(
    (path: string) => {
      void stage([path]);
    },
    [stage],
  );

  const handleUnstage = useCallback(
    (path: string) => {
      void unstage([path]);
    },
    [unstage],
  );

  const handleToggleSelected = useCallback((path: string, selected: boolean) => {
    setSelectedPaths((previous) => {
      const next = new Set(previous);

      if (selected) {
        next.add(path);
      } else {
        next.delete(path);
      }

      return next;
    });
  }, []);

  const handleToggleAllSelected = useCallback(() => {
    if (allSelected) {
      setSelectedPaths(new Set());
      return;
    }

    setSelectedPaths(new Set(flatChanges.map((change) => change.path)));
  }, [allSelected, flatChanges]);

  const handleDiscard = useCallback((path: string) => {
    setDiscardConfirm({ scope: 'file', path, paths: [path] });
  }, []);

  const handleDiscardSelected = useCallback(() => {
    const paths = [...selectedPaths];

    if (paths.length === 0) {
      return;
    }

    setDiscardConfirm({ scope: 'paths', paths });
  }, [selectedPaths]);

  const handleDiscardGroup = useCallback((paths: string[], groupLabel: string) => {
    if (paths.length === 0) {
      return;
    }

    setDiscardConfirm({ scope: 'group', paths, groupLabel });
  }, []);

  const handleDiscardConfirm = useCallback(() => {
    if (!discardConfirm) {
      return;
    }

    const pathsToDiscard = discardConfirm.paths;

    if (pathsToDiscard.length > 0) {
      void discard(pathsToDiscard).then(() => {
        setSelectedPaths((previous) => {
          const next = new Set(previous);

          for (const path of pathsToDiscard) {
            next.delete(path);
          }

          return next;
        });
      });
    }

    setDiscardConfirm(null);
  }, [discard, discardConfirm]);

  const handleDiscardClose = useCallback(() => {
    setDiscardConfirm(null);
  }, []);

  const handleCommit = useCallback(() => {
    void commit(commitMessage).then((result) => {
      if (result.ok) {
        setCommitMessage('');
      }
    });
  }, [commit, commitMessage]);

  const handleCheckout = useCallback(
    (branch: string) => {
      setBranchAnchor(null);
      void checkout(branch);
    },
    [checkout],
  );

  const handleCreateBranch = useCallback(
    (name: string) => {
      setBranchAnchor(null);
      void createBranch(name);
    },
    [createBranch],
  );

  const openBranchMenu = useCallback(() => {
    const rect = branchButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setBranchAnchor(rect);
      setMoreAnchor(null);
      setRepoAnchor(null);
    }
  }, []);

  const handleToggleBranchMenu = useCallback(() => {
    if (branchAnchor) {
      setBranchAnchor(null);
      return;
    }

    openBranchMenu();
  }, [branchAnchor, openBranchMenu]);

  const handleToggleRepoMenu = useCallback(() => {
    if (repoAnchor) {
      setRepoAnchor(null);
      return;
    }

    const rect = repoButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setRepoAnchor(rect);
      setBranchAnchor(null);
      setMoreAnchor(null);
    }
  }, [repoAnchor]);

  const handleToggleMoreMenu = useCallback(() => {
    if (moreAnchor) {
      setMoreAnchor(null);
      return;
    }

    const rect = moreButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setMoreAnchor(rect);
      setBranchAnchor(null);
      setRepoAnchor(null);
    }
  }, [moreAnchor]);

  const handleSelectRepo = useCallback((path: string) => {
    setRepoAnchor(null);
    setSelectedRepoPath(path);
  }, []);

  const handleOpenPromptModal = useCallback((prompt: string) => {
    setPromptModalText(prompt);
  }, []);

  const handleClosePromptModal = useCallback(() => {
    setPromptModalText(null);
  }, []);

  const handleChangeContextMenu = useCallback((change: GitFlatChange, x: number, y: number) => {
    setChangeContextMenu({ change, x, y });
  }, []);

  const handleCloseChangeContextMenu = useCallback(() => {
    setChangeContextMenu(null);
  }, []);

  const handleAddToChat = useCallback(
    (entry: ProjectDirectoryEntry) => {
      if (!project) {
        return;
      }

      void mentionExplorerEntryInAgent(project, entry.path, selectPane);
    },
    [project, selectPane],
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

  if (discovering || (loading && !status && selectedRepoPath)) {
    return (
      <GitDrawerShell embedded={embedded}>
        <div className='git-panel__loading'>Carregando Git...</div>
      </GitDrawerShell>
    );
  }

  if (discoveredRepos.length === 0) {
    return (
      <GitDrawerShell embedded={embedded}>
        <EmptyState
          icon={GitBranch}
          message='Nenhum repositório Git encontrado neste projeto.'
          compact
          className='git-panel__empty'
        />
      </GitDrawerShell>
    );
  }

  if (!status?.repo.isRepo) {
    return (
      <GitDrawerShell embedded={embedded}>
        <EmptyState
          icon={GitBranch}
          message='Este projeto não é um repositório Git.'
          compact
          className='git-panel__empty'
        />
      </GitDrawerShell>
    );
  }

  const hasMultipleRepos = discoveredRepos.length > 1;
  const hasChanges = flatChanges.length > 0;
  const otherRepoChangeCount = selectedRepoPath
    ? Object.entries(gitChangeCountsByRepo)
        .filter(([path]) => path !== selectedRepoPath)
        .reduce((sum, [, count]) => sum + count, 0)
    : 0;
  const emptyChangesMessage =
    otherRepoChangeCount > 0
      ? `Nenhuma alteração neste repositório (${otherRepoChangeCount} em outros)`
      : 'Nenhuma alteração';
  const currentBranch = status.repo.branch ?? 'HEAD';

  return (
    <GitDrawerShell embedded={embedded} className='git-scm'>
      <div className='git-scm__toolbar'>
        {hasMultipleRepos ? (
          <button
            ref={repoButtonRef}
            type='button'
            className='git-scm__repo-btn app-button app-button--enter'
            onClick={handleToggleRepoMenu}
          >
            {formatRepoLabel(selectedRepo?.relativePath ?? '.')}
            <ChevronDown size={12} />
          </button>
        ) : null}
        <button
          ref={branchButtonRef}
          type='button'
          className='git-scm__branch-btn app-button app-button--enter'
          aria-label='Trocar branch'
          onClick={handleToggleBranchMenu}
        >
          <GitBranch size={13} strokeWidth={2} />
          {currentBranch}
        </button>
        <button
          ref={moreButtonRef}
          type='button'
          className='git-scm__icon-btn app-button app-button--enter'
          aria-label='Mais ações'
          onClick={handleToggleMoreMenu}
        >
          <MoreHorizontal size={15} strokeWidth={2} />
        </button>
      </div>

      {repoAnchor ? (
        <GitRepoMenu
          anchorRect={repoAnchor}
          repos={discoveredRepos}
          selectedPath={selectedRepoPath ?? ''}
          changeCounts={gitChangeCountsByRepo}
          onClose={() => setRepoAnchor(null)}
          onSelect={handleSelectRepo}
        />
      ) : null}

      {branchAnchor && selectedRepoPath ? (
        <StatusBarBranchMenu
          anchorRect={branchAnchor}
          repoPath={selectedRepoPath}
          currentBranch={currentBranch}
          placement='below'
          onClose={() => setBranchAnchor(null)}
          onCheckout={handleCheckout}
          onCreateBranch={handleCreateBranch}
        />
      ) : null}

      {moreAnchor ? (
        <GitMoreMenu
          anchorRect={moreAnchor}
          actionLoading={actionLoading}
          onClose={() => setMoreAnchor(null)}
          onRefresh={() => void refresh()}
          onPull={() => void pull()}
          onPush={() => void push()}
          onStash={() => void stash()}
          onStashPop={() => void stashPop()}
        />
      ) : null}

      {error ? <div className='git-panel__error'>{error}</div> : null}

      <div className='git-panel__body git-scm__body'>
        {!hasChanges ? (
          <EmptyState icon={CheckCheck} message={emptyChangesMessage} compact className='git-panel__empty'>
            <button
              type='button'
              className='git-panel__refresh-btn app-button app-button--enter'
              onClick={() => void refresh()}
            >
              Atualizar
            </button>
          </EmptyState>
        ) : (
          <section className='git-scm__changes'>
            <div className='git-scm__changes-header'>
              <span className='git-scm__changes-title'>
                {flatChanges.length} Alterações
              </span>
              <span className='git-scm__changes-stats'>
                <span className='git-scm__changes-stat git-scm__changes-stat--add'>+{totalAdditions}</span>
                <span className='git-scm__changes-stat git-scm__changes-stat--del'>-{totalDeletions}</span>
              </span>
              <button
                type='button'
                className='git-scm__changes-revert app-button app-button--enter'
                aria-label='Descartar alterações selecionadas'
                disabled={!hasSelection}
                onClick={handleDiscardSelected}
              >
                <RotateCcw size={13} strokeWidth={2.25} />
              </button>
              <AppCheckbox
                className='git-scm__changes-checkbox'
                checked={allSelected}
                aria-label={allSelected ? 'Desmarcar todos' : 'Selecionar todos para descartar'}
                onChange={handleToggleAllSelected}
              />
            </div>
            <div className='git-scm__changes-body'>
              {promptGroups.length === 0 ? (
                <div className='git-scm__file-list'>
                  {flatChanges.map((change) => (
                    <GitChangeRow
                      key={change.path}
                      change={change}
                      absolutePath={
                        selectedRepoPath ? toRepoAbsolutePath(selectedRepoPath, change.path) : null
                      }
                      selected={selectedPaths.has(change.path)}
                      onToggleSelected={handleToggleSelected}
                      onStage={handleStage}
                      onUnstage={handleUnstage}
                      onDiscard={handleDiscard}
                      onOpenDiff={handleOpenDiff}
                      onContextMenu={handleChangeContextMenu}
                    />
                  ))}
                </div>
              ) : (
                <>
                  {promptGroupSections.map(({ group, changes }) => (
                      <section
                        key={group.id}
                        ref={group.id === focusedGroupId ? focusedGroupRef : undefined}
                        className={`git-scm__prompt-group${group.id === focusedGroupId ? ' git-scm__prompt-group--focused' : ''}`}
                      >
                        <div className='git-scm__prompt-header'>
                          <AgentGitPromptLabel prompt={group.prompt} onOpen={handleOpenPromptModal} />
                          <span className='git-scm__changes-stats'>
                            <span className='git-scm__changes-stat git-scm__changes-stat--add'>
                              +{changes.reduce((sum, change) => sum + change.additions, 0)}
                            </span>
                            <span className='git-scm__changes-stat git-scm__changes-stat--del'>
                              -{changes.reduce((sum, change) => sum + change.deletions, 0)}
                            </span>
                          </span>
                          <button
                            type='button'
                            className='git-scm__changes-revert app-button app-button--enter'
                            aria-label='Descartar alterações do prompt'
                            onClick={() =>
                              handleDiscardGroup(
                                changes.map((change) => change.path),
                                group.prompt,
                              )
                            }
                          >
                            <RotateCcw size={12} strokeWidth={2.25} />
                          </button>
                        </div>
                        <div className='git-scm__file-list'>
                          {changes.map((change) => (
                            <GitChangeRow
                              key={`${group.id}:${change.path}`}
                              change={change}
                              absolutePath={
                                selectedRepoPath
                                  ? toRepoAbsolutePath(selectedRepoPath, change.path)
                                  : null
                              }
                              agentPrompt={group.prompt}
                              selected={selectedPaths.has(change.path)}
                              onToggleSelected={handleToggleSelected}
                              onStage={handleStage}
                              onUnstage={handleUnstage}
                              onDiscard={handleDiscard}
                              onOpenDiff={handleOpenDiff}
                              onContextMenu={handleChangeContextMenu}
                            />
                          ))}
                        </div>
                      </section>
                  ))}
                  {otherChanges.length > 0 ? (
                    <section className='git-scm__prompt-group'>
                      <div className='git-scm__prompt-header'>
                        <p className='git-scm__prompt-label git-scm__prompt-label--other'>
                          Outras alterações
                        </p>
                      </div>
                      <div className='git-scm__file-list'>
                        {otherChanges.map((change) => (
                          <GitChangeRow
                            key={change.path}
                            change={change}
                            absolutePath={
                              selectedRepoPath
                                ? toRepoAbsolutePath(selectedRepoPath, change.path)
                                : null
                            }
                            selected={selectedPaths.has(change.path)}
                            onToggleSelected={handleToggleSelected}
                            onStage={handleStage}
                            onUnstage={handleUnstage}
                            onDiscard={handleDiscard}
                            onOpenDiff={handleOpenDiff}
                            onContextMenu={handleChangeContextMenu}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          </section>
        )}
      </div>

      <div className='git-panel__commit'>
        <textarea
          className='git-panel__commit-input'
          placeholder='Mensagem do commit'
          value={commitMessage}
          rows={3}
          onChange={(event) => setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              handleCommit();
            }
          }}
        />
        <button
          type='button'
          className='git-panel__commit-btn app-button app-button--enter'
          disabled={actionLoading || status.staged.length === 0 || !commitMessage.trim()}
          onClick={handleCommit}
        >
          Commit
        </button>
      </div>

      {promptModalText ? (
        <AgentGitPromptModal prompt={promptModalText} onClose={handleClosePromptModal} />
      ) : null}

      {discardConfirm ? (
        <GitDiscardConfirmDialog
          scope={discardConfirm.scope}
          filePath={discardConfirm.scope === 'file' ? discardConfirm.path : undefined}
          pathCount={discardConfirm.scope === 'paths' ? discardConfirm.paths.length : undefined}
          groupLabel={
            discardConfirm.scope === 'group'
              ? truncateGroupLabel(discardConfirm.groupLabel)
              : undefined
          }
          onConfirm={handleDiscardConfirm}
          onClose={handleDiscardClose}
        />
      ) : null}

      {changeContextMenu && changeContextMenuEntry ? (
        <ExplorerEntryContextMenu
          entry={changeContextMenuEntry}
          x={changeContextMenu.x}
          y={changeContextMenu.y}
          canAddToChat={canAddToChat}
          hideRename
          hideDelete
          hideViewCode
          onClose={handleCloseChangeContextMenu}
          onAddToChat={handleAddToChat}
          onRevealInFolder={handleRevealInFolder}
          onCopyPath={handleCopyPath}
          onCopyRelativePath={handleCopyRelativePath}
        />
      ) : null}
    </GitDrawerShell>
  );
}

export const ProjectGitDrawer = memo(ProjectGitDrawerComponent);
