import { CheckCircle2, Copy, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { ProjectTask } from '@/types/task';
import { isLocalTaskCompleted } from '@/utils/taskJson';
import { classifyTaskStatus } from '@/utils/taskLabels';

interface TaskContextMenuProps {
  task: ProjectTask;
  x: number;
  y: number;
  allowComplete?: boolean;
  onClose: () => void;
  onCopyJson: (task: ProjectTask) => void;
  onComplete: (task: ProjectTask) => void;
  onReopen: (task: ProjectTask) => void;
  onDelete: (task: ProjectTask) => void;
}

function TaskContextMenuComponent({
  task,
  x,
  y,
  allowComplete = true,
  onClose,
  onCopyJson,
  onComplete,
  onReopen,
  onDelete,
}: TaskContextMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );
  const isLocalTask = task.source === 'local';
  const isCompleted = useMemo(
    () =>
      isLocalTaskCompleted(task) || classifyTaskStatus(task.status ?? '') === 'done',
    [task],
  );
  const showComplete = allowComplete && !isCompleted;
  const showReopen = allowComplete && isCompleted && isLocalTask;

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

  const runAction = useCallback(
    (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
      requestClose();
    },
    [requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      {isLocalTask ? (
        <>
          <button
            type='button'
            className='context-menu__item'
            role='menuitem'
            onMouseDown={runAction(() => onCopyJson(task))}
          >
            <Copy size={14} strokeWidth={2} aria-hidden />
            <span>Copiar JSON</span>
          </button>
          <div className='context-menu__separator' />
        </>
      ) : null}
      {showReopen ? (
        <button
          type='button'
          className='context-menu__item'
          role='menuitem'
          onMouseDown={runAction(() => onReopen(task))}
        >
          <RotateCcw size={14} strokeWidth={2} aria-hidden />
          <span>Reabrir</span>
        </button>
      ) : null}
      {showComplete ? (
        <button
          type='button'
          className='context-menu__item'
          role='menuitem'
          onMouseDown={runAction(() => onComplete(task))}
        >
          <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
          <span>Concluir</span>
        </button>
      ) : null}
      {showComplete || showReopen ? <div className='context-menu__separator' /> : null}
      <button
        type='button'
        className='context-menu__item context-menu__item--danger'
        role='menuitem'
        onMouseDown={runAction(() => onDelete(task))}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
        <span>Excluir</span>
      </button>
    </div>,
    document.body,
  );
}

export const TaskContextMenu = memo(TaskContextMenuComponent);
