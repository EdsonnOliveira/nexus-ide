import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAboveAnchor,
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { GitBranchInfo } from '@/types/git';

interface StatusBarBranchMenuProps {
  anchorRect: DOMRect;
  repoPath: string;
  currentBranch: string;
  placement?: 'above' | 'below';
  onClose: () => void;
  onCheckout: (branch: string) => void;
  onCreateBranch: (name: string) => void;
}

function StatusBarBranchMenuComponent({
  anchorRect,
  repoPath,
  currentBranch,
  placement = 'above',
  onClose,
  onCheckout,
  onCreateBranch,
}: StatusBarBranchMenuProps) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBranchName, setNewBranchName] = useState('');
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) =>
      placement === 'below'
        ? positionDropdownBelowAnchor(menu, anchorRect, 'start')
        : positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect, placement],
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);

    void window.nexus.git.listBranches(repoPath).then((nextBranches) => {
      if (!cancelled) {
        setBranches(nextBranches.filter((branch) => !branch.remote));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

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

  const handleCreateBranch = useCallback(() => {
    const trimmed = newBranchName.trim();

    if (!trimmed) {
      return;
    }

    onCreateBranch(trimmed);
    setNewBranchName('');
    requestClose();
  }, [newBranchName, onCreateBranch, requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup status-bar__branch-menu git-panel__branch-menu ${animationClass}`}
    >
      {loading ? (
        <p className='status-bar__branch-menu-loading'>Carregando branches...</p>
      ) : branches.length > 0 ? (
        <div className='git-panel__branch-list'>
          {branches.map((branch) => (
            <button
              key={branch.name}
              type='button'
              className={`git-panel__branch-item app-button app-button--enter${branch.current || branch.name === currentBranch ? ' git-panel__branch-item--active' : ''}`}
              onClick={() => {
                if (branch.name === currentBranch) {
                  requestClose();
                  return;
                }

                onCheckout(branch.name);
                requestClose();
              }}
            >
              {branch.name}
            </button>
          ))}
        </div>
      ) : (
        <p className='status-bar__branch-menu-loading'>Nenhuma branch encontrada</p>
      )}
      <div className='git-panel__branch-create'>
        <input
          type='text'
          className='git-panel__branch-input'
          placeholder='Nova branch'
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleCreateBranch();
            }
          }}
        />
        <button
          type='button'
          className='git-panel__branch-create-btn app-button app-button--enter'
          onClick={handleCreateBranch}
        >
          Criar
        </button>
      </div>
    </div>,
    document.body,
  );
}

export const StatusBarBranchMenu = memo(StatusBarBranchMenuComponent);
