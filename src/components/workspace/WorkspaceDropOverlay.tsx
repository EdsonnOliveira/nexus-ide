import { memo, useCallback, useMemo, useState } from 'react';
import { TAB_DRAG_MIME } from '@/constants/tabDrag';
import type { SplitSide } from '@/types';

interface WorkspaceDropOverlayProps {
  mode: 'sides' | 'quadrants';
  variant?: 'workspace' | 'pane';
  onDrop: (sourceTabId: string, side: SplitSide) => void;
}

function resolveSide(
  mode: 'sides' | 'quadrants',
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): SplitSide {
  if (mode === 'sides') {
    return offsetX < width / 2 ? 'left' : 'right';
  }

  const isLeft = offsetX < width / 2;
  const isTop = offsetY < height / 2;

  if (isTop && isLeft) {
    return 'top-left';
  }

  if (isTop) {
    return 'top-right';
  }

  if (isLeft) {
    return 'bottom-left';
  }

  return 'bottom-right';
}

function WorkspaceDropOverlayComponent({
  mode,
  variant = 'workspace',
  onDrop,
}: WorkspaceDropOverlayProps) {
  const [activeSide, setActiveSide] = useState<SplitSide | null>(null);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      const rect = event.currentTarget.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;

      setActiveSide(resolveSide(mode, offsetX, offsetY, rect.width, rect.height));
    },
    [mode],
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget as Node | null;

    if (!event.currentTarget.contains(related)) {
      setActiveSide(null);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const sourceTabId = event.dataTransfer.getData(TAB_DRAG_MIME);
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const side = resolveSide(mode, offsetX, offsetY, rect.width, rect.height);

      setActiveSide(null);

      if (!sourceTabId) {
        return;
      }

      onDrop(sourceTabId, side);
    },
    [mode, onDrop],
  );

  const className = useMemo(() => {
    const classes = ['workspace-drop-overlay'];

    if (variant === 'pane') {
      classes.push('workspace-drop-overlay--pane');
    }

    if (mode === 'quadrants') {
      classes.push('workspace-drop-overlay--quadrants');
    }

    if (activeSide) {
      classes.push(`workspace-drop-overlay--${activeSide}`);
    }

    return classes.join(' ');
  }, [activeSide, mode, variant]);

  return (
    <div
      className={className}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  );
}

export const WorkspaceDropOverlay = memo(WorkspaceDropOverlayComponent);
