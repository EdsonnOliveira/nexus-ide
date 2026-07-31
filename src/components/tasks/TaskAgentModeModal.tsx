import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import {
  AGENT_MODE_OPTIONS,
  type AgentModeBadgeIcon,
  type AutomationAgentMode,
} from '@/constants/agentModes';

const AGENT_MODE_ICON_SRC: Record<AgentModeBadgeIcon, string> = {
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
  'mode-ask': iconModeAsk,
};

export interface TaskExecutionAnchor {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface TaskAgentModeModalProps {
  anchor: TaskExecutionAnchor;
  onClose: () => void;
  onSelect: (mode: AutomationAgentMode) => void;
}

function resolveAnchorRect(anchor: TaskExecutionAnchor): DOMRect {
  return {
    top: anchor.top,
    left: anchor.left,
    right: anchor.right,
    bottom: anchor.bottom,
    width: anchor.width,
    height: anchor.height,
    x: anchor.left,
    y: anchor.top,
    toJSON: () => anchor,
  };
}

export function readTaskExecutionAnchor(target: EventTarget | null): TaskExecutionAnchor | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const rect = target.getBoundingClientRect();

  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function TaskAgentModeModalComponent({ anchor, onClose, onSelect }: TaskAgentModeModalProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, resolveAnchorRect(anchor), 'end'),
    [anchor],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu task-agent-mode-menu overlay-popup overlay-popup--anchor-end ${animationClass}`}
      role='menu'
      aria-label='Modo do agent'
    >
      {AGENT_MODE_OPTIONS.map((mode) => (
        <button
          key={mode.id}
          type='button'
          className='context-menu__item app-button app-button--enter'
          role='menuitem'
          onClick={() => onSelect(mode.id)}
        >
          <span className='task-agent-mode-menu__badge' style={{ backgroundColor: mode.badgeColor }}>
            <img
              src={AGENT_MODE_ICON_SRC[mode.badgeIcon]}
              alt=''
              className='task-agent-mode-menu__badge-icon'
              draggable={false}
            />
          </span>
          <span>{mode.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export const TaskAgentModeModal = memo(TaskAgentModeModalComponent);
