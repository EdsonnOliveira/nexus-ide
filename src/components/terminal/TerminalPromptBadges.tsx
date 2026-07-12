import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Check,
  File,
  FileText,
  Folder,
  GitBranch,
} from 'lucide-react';
import { StatusBarBranchMenu } from '@/components/layout/StatusBarBranchMenu';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectDirectoryEntry } from '@/types';
import { shellEscapeSingleQuotes } from '@/utils/agentCliSession';
import type { TerminalPromptInfo } from '@/utils/terminalPromptInfo';
import { gitRepoHasPendingWork } from '@/utils/gitPendingWork';

interface TerminalPromptBadgesProps {
  info: TerminalPromptInfo | null;
  visible: boolean;
  top: number;
  left: number;
  cwd: string;
  onRunCommand: (command: string) => void;
}

type BadgeMenu = 'node' | 'path' | 'branch' | null;

function NodeJsLogoIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='currentColor'
      className='terminal-prompt-badge__icon terminal-prompt-badge__icon--node'
      aria-hidden='true'
    >
      <path d='M11.998 24c-.321 0-.641-.084-.922-.247l-2.936-1.737c-.438-.245-.224-.332-.08-.383.585-.203.703-.25 1.328-.604.065-.037.151-.023.218.017l2.256 1.339c.082.045.197.045.272 0l8.795-5.076c.082-.047.134-.141.134-.238V6.922c0-.099-.053-.192-.137-.242l-8.791-5.072c-.081-.047-.189-.047-.271 0L3.075 6.68C2.99 6.729 2.936 6.825 2.936 6.922v10.15c0 .097.054.189.139.235l2.409 1.392c1.307.654 2.108-.116 2.108-.89V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.112.255.253v10.021c0 1.745-.95 2.745-2.604 2.745-.508 0-.909 0-2.026-.551L2.28 18.675c-.57-.329-.922-.945-.922-1.604V6.922c0-.659.353-1.274.922-1.603l8.795-5.081c.557-.315 1.296-.315 1.848 0l8.794 5.081c.57.329.924.944.924 1.603v10.15c0 .659-.354 1.273-.924 1.604l-8.794 5.078C12.643 23.916 12.324 24 11.998 24zm6.993-10.632c0-1.357-.918-1.705-2.837-1.971-1.934-.271-2.128-.41-2.128-.889 0-.397.177-.93 1.706-.93 1.37 0 1.873.294 2.079 1.23.018.082.091.141.176.141h1.142c.05 0 .095-.021.13-.056.033-.034.053-.083.05-.133-.131-1.552-1.156-2.275-3.575-2.275-2.039 0-3.45.862-3.45 2.304 0 1.566 1.202 2.004 3.162 2.25 2.345.291 2.802.541 2.802 1.099 0 .851-.682 1.209-2.281 1.209-2.008 0-2.446-.498-2.595-1.488-.016-.091-.096-.156-.188-.156h-1.155c-.103 0-.188.083-.188.186C9.382 15.649 10.513 17 13.61 17c2.367 0 5.381-1.121 5.381-3.632z' />
    </svg>
  );
}

function compareNodeVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (b[index] ?? 0) - (a[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function normalizeNodeVersionLabel(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

function nvmUseTarget(version: string): string {
  return version.replace(/^v/i, '');
}

interface PromptBadgeMenuShellProps {
  anchorRect: DOMRect;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel: string;
}

function PromptBadgeMenuShell({
  anchorRect,
  onClose,
  children,
  className = '',
  ariaLabel,
}: PromptBadgeMenuShellProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup terminal-prompt-badge-menu ${animationClass}${className ? ` ${className}` : ''}`}
      role='dialog'
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}

interface NodeVersionMenuProps {
  anchorRect: DOMRect;
  currentVersion: string;
  onClose: () => void;
  onSelect: (version: string) => void;
}

function NodeVersionMenu({ anchorRect, currentVersion, onClose, onSelect }: NodeVersionMenuProps) {
  const [versions, setVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const current = normalizeNodeVersionLabel(currentVersion);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      try {
        const dir = await window.nexus.files.resolveCdPath('', '~/.nvm/versions/node');
        const entries = await window.nexus.files.listDirectoryEntries(dir);
        const next = entries
          .filter((entry) => entry.type === 'directory' && /^v?\d/.test(entry.name))
          .map((entry) => normalizeNodeVersionLabel(entry.name))
          .sort(compareNodeVersions);

        if (!cancelled) {
          setVersions(next);
        }
      } catch {
        if (!cancelled) {
          setVersions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PromptBadgeMenuShell anchorRect={anchorRect} onClose={onClose} ariaLabel='Versões do Node.js'>
      <div className='terminal-prompt-badge-menu__header'>Instaladas</div>
      {loading ? (
        <p className='terminal-prompt-badge-menu__empty'>Carregando versões...</p>
      ) : versions.length === 0 ? (
        <p className='terminal-prompt-badge-menu__empty'>Nenhuma versão do nvm encontrada</p>
      ) : (
        <div className='terminal-prompt-badge-menu__list'>
          {versions.map((version) => {
            const selected = version === current;

            return (
              <button
                key={version}
                type='button'
                className={`terminal-prompt-badge-menu__item app-button${selected ? ' terminal-prompt-badge-menu__item--active' : ''}`}
                onClick={() => onSelect(version)}
              >
                {selected ? <Check size={14} className='terminal-prompt-badge-menu__check' /> : (
                  <span className='terminal-prompt-badge-menu__check-spacer' />
                )}
                <span>{version}</span>
              </button>
            );
          })}
        </div>
      )}
    </PromptBadgeMenuShell>
  );
}

interface PathMenuProps {
  anchorRect: DOMRect;
  cwd: string;
  onClose: () => void;
  onSelectDirectory: (absolutePath: string) => void;
}

function PathMenu({ anchorRect, cwd, onClose, onSelectDirectory }: PathMenuProps) {
  const [entries, setEntries] = useState<ProjectDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      try {
        const next = await window.nexus.files.listDirectoryEntries(cwd);

        if (!cancelled) {
          setEntries(next);
        }
      } catch {
        if (!cancelled) {
          setEntries([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cwd]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) => entry.name.toLowerCase().includes(normalized));
  }, [entries, query]);

  const parentPath = useMemo(() => {
    const trimmed = cwd.replace(/\/+$/, '');
    const index = trimmed.lastIndexOf('/');

    if (index <= 0) {
      return '/';
    }

    return trimmed.slice(0, index) || '/';
  }, [cwd]);

  return (
    <PromptBadgeMenuShell
      anchorRect={anchorRect}
      onClose={onClose}
      ariaLabel='Diretórios'
      className='terminal-prompt-badge-menu--path'
    >
      <input
        ref={inputRef}
        type='text'
        className='terminal-prompt-badge-menu__search'
        placeholder='Buscar pastas...'
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {loading ? (
        <p className='terminal-prompt-badge-menu__empty'>Carregando...</p>
      ) : (
        <div className='terminal-prompt-badge-menu__list'>
          {cwd !== '/' ? (
            <button
              type='button'
              className='terminal-prompt-badge-menu__item app-button'
              onClick={() => onSelectDirectory(parentPath)}
            >
              <ArrowUp size={14} className='terminal-prompt-badge-menu__item-icon' />
              <span>.. (pasta pai)</span>
            </button>
          ) : null}
          {filtered.map((entry) => {
            const isDirectory = entry.type === 'directory';

            return (
              <button
                key={entry.path}
                type='button'
                className='terminal-prompt-badge-menu__item app-button'
                disabled={!isDirectory}
                onClick={() => {
                  if (isDirectory) {
                    onSelectDirectory(entry.path);
                  }
                }}
              >
                {isDirectory ? (
                  <Folder size={14} className='terminal-prompt-badge-menu__item-icon' />
                ) : (
                  <File size={14} className='terminal-prompt-badge-menu__item-icon' />
                )}
                <span>{entry.name}</span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className='terminal-prompt-badge-menu__empty'>Nenhum item encontrado</p>
          ) : null}
        </div>
      )}
    </PromptBadgeMenuShell>
  );
}

function TerminalPromptBadgesComponent({
  info,
  visible,
  top,
  left,
  cwd,
  onRunCommand,
}: TerminalPromptBadgesProps) {
  const openExplorerGit = useProjectStore((state) => state.openExplorerGit);
  const [menu, setMenu] = useState<BadgeMenu>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setAnchorRect(null);
  }, []);

  const openMenu = useCallback((next: BadgeMenu, target: HTMLElement) => {
    setAnchorRect(target.getBoundingClientRect());
    setMenu(next);
  }, []);

  const handleSelectNodeVersion = useCallback(
    (version: string) => {
      const current = normalizeNodeVersionLabel(info?.nodeVersion ?? '');

      closeMenu();

      if (version === current) {
        return;
      }

      onRunCommand(`nvm use ${shellEscapeSingleQuotes(nvmUseTarget(version))}`);
    },
    [closeMenu, info?.nodeVersion, onRunCommand],
  );

  const handleSelectDirectory = useCallback(
    (absolutePath: string) => {
      closeMenu();

      if (!absolutePath || absolutePath === cwd) {
        return;
      }

      onRunCommand(`cd ${shellEscapeSingleQuotes(absolutePath)}`);
    },
    [closeMenu, cwd, onRunCommand],
  );

  const handleCheckout = useCallback(
    async (branch: string) => {
      closeMenu();

      if (!cwd) {
        return;
      }

      try {
        const status = await window.nexus.git.getStatus(cwd);

        if (gitRepoHasPendingWork(status)) {
          openExplorerGit();
          return;
        }

        const result = await window.nexus.git.checkout(cwd, branch);

        if (!result.ok) {
          onRunCommand(`git checkout ${shellEscapeSingleQuotes(branch)}`);
        }
      } catch {
        onRunCommand(`git checkout ${shellEscapeSingleQuotes(branch)}`);
      }
    },
    [closeMenu, cwd, onRunCommand, openExplorerGit],
  );

  const handleCreateBranch = useCallback(
    async (name: string) => {
      closeMenu();

      const trimmed = name.trim();

      if (!cwd || !trimmed) {
        return;
      }

      const result = await window.nexus.git.createBranch(cwd, trimmed);

      if (!result.ok) {
        onRunCommand(`git checkout -b ${shellEscapeSingleQuotes(trimmed)}`);
      }
    },
    [closeMenu, cwd, onRunCommand],
  );

  const handleOpenChanges = useCallback(() => {
    closeMenu();
    openExplorerGit();
  }, [closeMenu, openExplorerGit]);

  if (!visible || !info) {
    return null;
  }

  const showChanges = Boolean(
    info.branch && (info.files > 0 || info.additions > 0 || info.deletions > 0),
  );

  return (
    <>
      <div className='terminal-prompt-badges app-button--enter' style={{ top, left }}>
        {info.nodeVersion ? (
          <button
            type='button'
            className='terminal-prompt-badge app-button'
            aria-label={`Node ${info.nodeVersion}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => openMenu('node', event.currentTarget)}
          >
            <NodeJsLogoIcon size={12} />
            <span className='terminal-prompt-badge__text terminal-prompt-badge__text--node'>
              {info.nodeVersion}
            </span>
          </button>
        ) : null}
        <button
          type='button'
          className='terminal-prompt-badge app-button'
          aria-label={`Diretório ${info.path}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => openMenu('path', event.currentTarget)}
        >
          <Folder size={12} className='terminal-prompt-badge__icon' />
          <span className='terminal-prompt-badge__text'>{info.path}</span>
        </button>
        {info.branch ? (
          <button
            type='button'
            className='terminal-prompt-badge app-button'
            aria-label={`Branch ${info.branch}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => openMenu('branch', event.currentTarget)}
          >
            <GitBranch size={12} className='terminal-prompt-badge__icon terminal-prompt-badge__icon--git' />
            <span className='terminal-prompt-badge__text terminal-prompt-badge__text--git'>
              {info.branch}
            </span>
          </button>
        ) : null}
        {showChanges ? (
          <button
            type='button'
            className='terminal-prompt-badge app-button'
            aria-label='Abrir alterações Git'
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleOpenChanges}
          >
            <FileText size={12} className='terminal-prompt-badge__icon' />
            <span className='terminal-prompt-badge__text terminal-prompt-badge__text--muted'>
              {info.files}
            </span>
            <span className='terminal-prompt-badge__dot'>•</span>
            <span className='terminal-prompt-badge__text terminal-prompt-badge__text--add'>
              +{info.additions}
            </span>
            <span className='terminal-prompt-badge__text terminal-prompt-badge__text--del'>
              -{info.deletions}
            </span>
          </button>
        ) : null}
      </div>
      {menu === 'node' && anchorRect ? (
        <NodeVersionMenu
          anchorRect={anchorRect}
          currentVersion={info.nodeVersion}
          onClose={closeMenu}
          onSelect={handleSelectNodeVersion}
        />
      ) : null}
      {menu === 'path' && anchorRect ? (
        <PathMenu
          anchorRect={anchorRect}
          cwd={cwd}
          onClose={closeMenu}
          onSelectDirectory={handleSelectDirectory}
        />
      ) : null}
      {menu === 'branch' && anchorRect && info.branch ? (
        <StatusBarBranchMenu
          anchorRect={anchorRect}
          repoPath={cwd}
          currentBranch={info.branch}
          placement='above'
          onClose={closeMenu}
          onCheckout={(branch) => {
            void handleCheckout(branch);
          }}
          onCreateBranch={(name) => {
            void handleCreateBranch(name);
          }}
        />
      ) : null}
    </>
  );
}

export const TerminalPromptBadges = memo(TerminalPromptBadgesComponent);
