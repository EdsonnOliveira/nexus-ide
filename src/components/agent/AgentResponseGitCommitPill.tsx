import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import {
  AGENT_GIT_COMMIT_ACTION_LABELS,
  AGENT_GIT_COMMIT_ACTION_OPTIONS,
  executeAgentGitCommitAction,
  type AgentGitCommitActionId,
} from '@/utils/agentGitCommitAction';

interface AgentResponseGitCommitPillProps {
  projectPath: string;
  paneId: string;
  group: AgentGitChangeGroup;
}

function AgentGitCommitActionMenu({
  anchorRect,
  triggerRef,
  selectedAction,
  onClose,
  onSelect,
}: {
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLDivElement | HTMLButtonElement | null>;
  selectedAction: AgentGitCommitActionId;
  onClose: () => void;
  onSelect: (action: AgentGitCommitActionId) => void;
}) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuRef, requestClose, triggerRef]);

  return (
    <div
      ref={menuRef}
      className={`context-menu agent-view__response-git-commit-menu overlay-popup ${animationClass}`}
      role='menu'
    >
      {AGENT_GIT_COMMIT_ACTION_OPTIONS.map((action) => {
        const active = action === selectedAction;

        return (
          <button
            key={action}
            type='button'
            className={`context-menu__item app-button${active ? ' context-menu__item--active' : ''}`}
            role='menuitemradio'
            aria-checked={active}
            onMouseDown={preventPillFocusScroll}
            onClick={() => onSelect(action)}
          >
            <span className='agent-view__response-git-commit-menu-label'>
              {AGENT_GIT_COMMIT_ACTION_LABELS[action]}
            </span>
            {active ? (
              <Check size={14} strokeWidth={2} className='anchored-select__menu-check' aria-hidden='true' />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function preventPillFocusScroll(event: React.MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

function AgentResponseGitCommitPillComponent({
  projectPath,
  paneId,
  group,
}: AgentResponseGitCommitPillProps) {
  const [selectedAction, setSelectedAction] = useState<AgentGitCommitActionId>('branch-commit');
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [running, setRunning] = useState(false);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
    setAnchorRect(null);
  }, []);

  const handleOpenMenu = useCallback(() => {
    const rect = pillRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAnchorRect(rect);
    setMenuOpen(true);
  }, []);

  const handleToggleMenu = useCallback(() => {
    if (menuOpen) {
      handleCloseMenu();
      return;
    }

    handleOpenMenu();
  }, [handleCloseMenu, handleOpenMenu, menuOpen]);

  const runAction = useCallback(
    async (action: AgentGitCommitActionId) => {
      if (running) {
        return;
      }

      setRunning(true);

      try {
        await executeAgentGitCommitAction(action, {
          projectPath,
          paneId,
          group,
        });
      } finally {
        setRunning(false);
      }
    },
    [group, paneId, projectPath, running],
  );

  const handleRunSelected = useCallback(() => {
    void runAction(selectedAction);
  }, [runAction, selectedAction]);

  const handleSelectAction = useCallback(
    (action: AgentGitCommitActionId) => {
      setSelectedAction(action);
      handleCloseMenu();
      void runAction(action);
    },
    [handleCloseMenu, runAction],
  );

  return (
    <>
      <div
        ref={pillRef}
        className={`agent-view__response-pill agent-view__response-git-commit app-button app-button--enter${menuOpen ? ' agent-view__response-pill--open' : ''}${running ? ' agent-view__response-pill--running' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type='button'
          className='agent-view__response-git-commit-hit'
          aria-label={AGENT_GIT_COMMIT_ACTION_LABELS[selectedAction]}
          disabled={running}
          onMouseDown={preventPillFocusScroll}
          onClick={handleRunSelected}
        >
          <span className='agent-view__response-pill-label'>
            {AGENT_GIT_COMMIT_ACTION_LABELS[selectedAction]}
          </span>
        </button>
        <button
          ref={chevronRef}
          type='button'
          className={`agent-view__response-git-commit-hit agent-view__response-git-commit-hit--menu${menuOpen ? ' agent-view__response-git-commit-hit--open' : ''}`}
          aria-label='Mais opções de commit'
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          disabled={running}
          onMouseDown={preventPillFocusScroll}
          onClick={handleToggleMenu}
        >
          <ChevronDown size={12} strokeWidth={2} aria-hidden='true' />
        </button>
      </div>
      {menuOpen && anchorRect
        ? createPortal(
            <AgentGitCommitActionMenu
              anchorRect={anchorRect}
              triggerRef={pillRef}
              selectedAction={selectedAction}
              onClose={handleCloseMenu}
              onSelect={handleSelectAction}
            />,
            document.body,
          )
        : null}
    </>
  );
}

export const AgentResponseGitCommitPill = memo(AgentResponseGitCommitPillComponent);
