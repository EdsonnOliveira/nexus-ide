import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  Download,
  Archive,
  Trash2,
} from 'lucide-react';
import {
  ExplorerDirectoryIcon,
  ExplorerFileIcon,
  getExplorerFileIconVariant,
} from '@/components/explorer/ExplorerTreeIcon';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useGitStatus } from '@/hooks/useGitStatus';
import type { GitChangeEntry, GitChangeStatus, GitRepoDiscovery } from '@/types/git';
import {
  buildGitChangesTree,
  collectChangePaths,
  type GitChangesTreeNode,
} from '@/utils/gitChangesTree';

interface GitBranchMenuProps {
  anchorRect: DOMRect;
  branches: { name: string; current: boolean }[];
  newBranchName: string;
  onClose: () => void;
  onCheckout: (branch: string) => void;
  onNewBranchNameChange: (value: string) => void;
  onCreateBranch: () => void;
}

function GitBranchMenu({
  anchorRect,
  branches,
  newBranchName,
  onClose,
  onCheckout,
  onNewBranchNameChange,
  onCreateBranch,
}: GitBranchMenuProps) {
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
    <div ref={menuRef} className={`overlay-popup git-panel__branch-menu ${animationClass}`}>
      <div className='git-panel__branch-list'>
        {branches.map((branch) => (
          <button
            key={branch.name}
            type='button'
            className={`git-panel__branch-item app-button app-button--enter${branch.current ? ' git-panel__branch-item--active' : ''}`}
            onClick={() => {
              onCheckout(branch.name);
              requestClose();
            }}
          >
            {branch.name}
          </button>
        ))}
      </div>
      <div className='git-panel__branch-create'>
        <input
          type='text'
          className='git-panel__branch-input'
          placeholder='Nova branch'
          value={newBranchName}
          onChange={(event) => onNewBranchNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onCreateBranch();
              requestClose();
            }
          }}
        />
        <button
          type='button'
          className='git-panel__branch-create-btn app-button app-button--enter'
          onClick={() => {
            onCreateBranch();
            requestClose();
          }}
        >
          Criar
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface GitRepoMenuProps {
  anchorRect: DOMRect;
  repos: GitRepoDiscovery[];
  selectedPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

function formatRepoLabel(relativePath: string): string {
  if (relativePath === '.' || relativePath === '') {
    return 'Raiz do projeto';
  }

  return relativePath;
}

function GitRepoMenu({ anchorRect, repos, selectedPath, onClose, onSelect }: GitRepoMenuProps) {
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
        {repos.map((repo) => (
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
            {repo.branch ? (
              <span className='git-panel__repo-item-branch'>{repo.branch}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

interface ProjectGitDrawerProps {
  rootPath: string;
  onOpenDiff: (filePath: string, staged: boolean) => void;
}

interface GitChangesSectionProps {
  title: string;
  changes: GitChangeEntry[];
  staged: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onOpenDiff: (filePath: string, staged: boolean) => void;
}

const STATUS_LABEL: Record<GitChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
};

function GitChangeStatusBadge({ status }: { status: GitChangeStatus }) {
  return <span className={`git-panel__status git-panel__status--${status}`}>{STATUS_LABEL[status]}</span>;
}

const GitTreeNode = memo(function GitTreeNodeComponent({
  node,
  depth,
  staged,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
}: {
  node: GitChangesTreeNode;
  depth: number;
  staged: boolean;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onOpenDiff: (filePath: string, staged: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDirectory = node.type === 'directory';
  const iconVariant = getExplorerFileIconVariant(node.name, node.type);

  const handleRowClick = useCallback(() => {
    if (isDirectory) {
      setExpanded((value) => !value);
      return;
    }

    if (node.change) {
      onOpenDiff(node.change.path, staged);
    }
  }, [isDirectory, node.change, onOpenDiff, staged]);

  const handleStage = useCallback(() => {
    if (node.change) {
      onStage([node.change.path]);
    }
  }, [node.change, onStage]);

  const handleUnstage = useCallback(() => {
    if (node.change) {
      onUnstage([node.change.path]);
    }
  }, [node.change, onUnstage]);

  const handleDiscard = useCallback(() => {
    if (node.change) {
      onDiscard([node.change.path]);
    }
  }, [node.change, onDiscard]);

  return (
    <div className={`project-explorer__branch${expanded ? ' project-explorer__branch--expanded' : ''}`}>
      <div className='git-panel__tree-row' style={{ paddingLeft: `${8 + depth * 14}px` }}>
        <button
          type='button'
          className='project-explorer__row app-button app-button--enter'
          onClick={handleRowClick}
        >
          <span className='project-explorer__chevron' aria-hidden='true'>
            {isDirectory ? (
              expanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />
            ) : null}
          </span>
          {isDirectory ? (
            <ExplorerDirectoryIcon folderName={node.name} />
          ) : (
            <ExplorerFileIcon variant={iconVariant} />
          )}
          <span className='project-explorer__label'>{node.name}</span>
          {node.change ? <GitChangeStatusBadge status={node.change.status} /> : null}
        </button>
        {node.change ? (
          <div className='git-panel__row-actions'>
            {staged ? (
              <button
                type='button'
                className='git-panel__action app-button app-button--enter'
                aria-label='Remover do stage'
                onClick={handleUnstage}
              >
                <Minus size={12} strokeWidth={2.25} />
              </button>
            ) : (
              <>
                <button
                  type='button'
                  className='git-panel__action app-button app-button--enter'
                  aria-label='Adicionar ao stage'
                  onClick={handleStage}
                >
                  <Plus size={12} strokeWidth={2.25} />
                </button>
                {node.change.status !== 'untracked' ? (
                  <button
                    type='button'
                    className='git-panel__action git-panel__action--danger app-button app-button--enter'
                    aria-label='Descartar alterações'
                    onClick={handleDiscard}
                  >
                    <RotateCcw size={12} strokeWidth={2.25} />
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      {isDirectory ? (
        <div className={`project-explorer__children${expanded ? ' project-explorer__children--open' : ''}`}>
          <div className='project-explorer__children-inner'>
            {expanded
              ? node.children?.map((child) => (
                  <GitTreeNode
                    key={`${child.path}-${child.type}`}
                    node={child}
                    depth={depth + 1}
                    staged={staged}
                    onStage={onStage}
                    onUnstage={onUnstage}
                    onDiscard={onDiscard}
                    onOpenDiff={onOpenDiff}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});

const GitChangesSection = memo(function GitChangesSectionComponent({
  title,
  changes,
  staged,
  onStage,
  onUnstage,
  onDiscard,
  onOpenDiff,
}: GitChangesSectionProps) {
  const [open, setOpen] = useState(true);
  const tree = useMemo(() => buildGitChangesTree(changes), [changes]);
  const allPaths = useMemo(() => collectChangePaths(tree), [tree]);

  const handleBulkPrimary = useCallback(() => {
    if (staged) {
      onUnstage(allPaths);
      return;
    }

    onStage(allPaths);
  }, [allPaths, onStage, onUnstage, staged]);

  if (changes.length === 0) {
    return null;
  }

  return (
    <section className='git-panel__section'>
      <div className='git-panel__section-header'>
        <button
          type='button'
          className='git-panel__section-toggle app-button app-button--enter'
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>
            {title} ({changes.length})
          </span>
        </button>
        <button
          type='button'
          className='git-panel__section-action app-button app-button--enter'
          aria-label={staged ? 'Unstage all' : 'Stage all'}
          onClick={handleBulkPrimary}
        >
          {staged ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      </div>
      {open ? (
        <div className='project-explorer__tree git-panel__tree'>
          {tree.map((node) => (
            <GitTreeNode
              key={`${node.path}-${node.type}`}
              node={node}
              depth={0}
              staged={staged}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
              onOpenDiff={onOpenDiff}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});

function ProjectGitDrawerComponent({ rootPath, onOpenDiff }: ProjectGitDrawerProps) {
  const [discoveredRepos, setDiscoveredRepos] = useState<GitRepoDiscovery[]>([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [branchAnchor, setBranchAnchor] = useState<DOMRect | null>(null);
  const [repoAnchor, setRepoAnchor] = useState<DOMRect | null>(null);
  const branchButtonRef = useRef<HTMLButtonElement>(null);
  const repoButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    setDiscovering(true);
    setDiscoveredRepos([]);
    setSelectedRepoPath(null);

    void window.nexus.git.discoverRepos(rootPath).then((repos) => {
      if (cancelled) {
        return;
      }

      setDiscoveredRepos(repos);
      setSelectedRepoPath(repos[0]?.path ?? null);
      setDiscovering(false);
    });

    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const {
    status,
    branches,
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

  const localBranches = useMemo(
    () => branches.filter((branch) => !branch.remote),
    [branches],
  );

  const handleStage = useCallback(
    (paths: string[]) => {
      void stage(paths);
    },
    [stage],
  );

  const handleUnstage = useCallback(
    (paths: string[]) => {
      void unstage(paths);
    },
    [unstage],
  );

  const handleDiscard = useCallback(
    (paths: string[]) => {
      void discard(paths);
    },
    [discard],
  );

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

  const handleCreateBranch = useCallback(() => {
    const trimmed = newBranchName.trim();

    if (!trimmed) {
      return;
    }

    setBranchAnchor(null);
    setNewBranchName('');
    void createBranch(trimmed);
  }, [createBranch, newBranchName]);

  const handleToggleBranchMenu = useCallback(() => {
    if (branchAnchor) {
      setBranchAnchor(null);
      return;
    }

    const rect = branchButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setBranchAnchor(rect);
    }
  }, [branchAnchor]);

  const handleToggleRepoMenu = useCallback(() => {
    if (repoAnchor) {
      setRepoAnchor(null);
      return;
    }

    const rect = repoButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setRepoAnchor(rect);
    }
  }, [repoAnchor]);

  const handleSelectRepo = useCallback((path: string) => {
    setRepoAnchor(null);
    setSelectedRepoPath(path);
  }, []);

  if (discovering || (loading && !status && selectedRepoPath)) {
    return (
      <aside className='project-explorer-drawer git-panel' aria-label='Controle de versão'>
        <div className='git-panel__loading'>Carregando Git...</div>
      </aside>
    );
  }

  if (discoveredRepos.length === 0) {
    return (
      <aside className='project-explorer-drawer git-panel' aria-label='Controle de versão'>
        <div className='project-explorer__header'>
          <span className='project-explorer__title'>Git</span>
        </div>
        <div className='git-panel__empty'>Nenhum repositório Git encontrado neste projeto.</div>
      </aside>
    );
  }

  if (!status?.repo.isRepo) {
    return (
      <aside className='project-explorer-drawer git-panel' aria-label='Controle de versão'>
        <div className='project-explorer__header'>
          <span className='project-explorer__title'>Git</span>
        </div>
        <div className='git-panel__empty'>Este projeto não é um repositório Git.</div>
      </aside>
    );
  }

  const hasMultipleRepos = discoveredRepos.length > 1;
  const hasChanges =
    status.staged.length + status.unstaged.length + status.untracked.length > 0;
  const currentBranch = status.repo.branch ?? 'HEAD';

  return (
    <aside className='project-explorer-drawer git-panel' aria-label='Controle de versão'>
      <div className='project-explorer__header git-panel__header'>
        <div className='git-panel__header-main'>
          {hasMultipleRepos ? (
            <button
              ref={repoButtonRef}
              type='button'
              className='git-panel__repo-btn app-button app-button--enter'
              onClick={handleToggleRepoMenu}
            >
              {formatRepoLabel(selectedRepo?.relativePath ?? '.')}
              <ChevronDown size={12} />
            </button>
          ) : null}
          <GitBranch size={14} strokeWidth={2} />
          <button
            ref={branchButtonRef}
            type='button'
            className='git-panel__branch-btn app-button app-button--enter'
            onClick={handleToggleBranchMenu}
          >
            {currentBranch}
            <ChevronDown size={12} />
          </button>
        </div>
        <div className='project-explorer__header-actions'>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Atualizar'
            disabled={actionLoading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Pull'
            disabled={actionLoading}
            onClick={() => void pull()}
          >
            <Download size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Push'
            disabled={actionLoading}
            onClick={() => void push()}
          >
            <Upload size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Stash'
            disabled={actionLoading}
            onClick={() => void stash()}
          >
            <Archive size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='project-explorer__header-btn app-button app-button--enter'
            aria-label='Stash pop'
            disabled={actionLoading}
            onClick={() => void stashPop()}
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {repoAnchor ? (
        <GitRepoMenu
          anchorRect={repoAnchor}
          repos={discoveredRepos}
          selectedPath={selectedRepoPath ?? ''}
          onClose={() => setRepoAnchor(null)}
          onSelect={handleSelectRepo}
        />
      ) : null}

      {branchAnchor ? (
        <GitBranchMenu
          anchorRect={branchAnchor}
          branches={localBranches}
          newBranchName={newBranchName}
          onClose={() => setBranchAnchor(null)}
          onCheckout={handleCheckout}
          onNewBranchNameChange={setNewBranchName}
          onCreateBranch={handleCreateBranch}
        />
      ) : null}

      {error ? <div className='git-panel__error'>{error}</div> : null}

      <div className='git-panel__body'>
        {!hasChanges ? (
          <div className='git-panel__empty'>
            <span>Nenhuma alteração</span>
            <button
              type='button'
              className='git-panel__refresh-btn app-button app-button--enter'
              onClick={() => void refresh()}
            >
              Atualizar
            </button>
          </div>
        ) : (
          <>
            <GitChangesSection
              title='Staged Changes'
              changes={status.staged}
              staged
              onStage={handleStage}
              onUnstage={handleUnstage}
              onDiscard={handleDiscard}
              onOpenDiff={onOpenDiff}
            />
            <GitChangesSection
              title='Changes'
              changes={[...status.unstaged, ...status.untracked]}
              staged={false}
              onStage={handleStage}
              onUnstage={handleUnstage}
              onDiscard={handleDiscard}
              onOpenDiff={onOpenDiff}
            />
          </>
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
    </aside>
  );
}

export const ProjectGitDrawer = memo(ProjectGitDrawerComponent);
