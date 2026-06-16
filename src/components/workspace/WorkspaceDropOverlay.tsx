import { memo, useCallback, useMemo, useState } from 'react';
import { TAB_DRAG_MIME } from '@/constants/tabDrag';

interface WorkspaceDropOverlayProps {
  onDrop: (sourceTabId: string, side: 'left' | 'right') => void;
}

function WorkspaceDropOverlayComponent({ onDrop }: WorkspaceDropOverlayProps) {
  const [activeSide, setActiveSide] = useState<'left' | 'right' | null>(null);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;

    setActiveSide(offsetX < rect.width / 2 ? 'left' : 'right');
  }, []);

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
      const side = offsetX < rect.width / 2 ? 'left' : 'right';

      setActiveSide(null);

      if (!sourceTabId) {
        return;
      }

      onDrop(sourceTabId, side);
    },
    [onDrop],
  );

  const className = useMemo(() => {
    const classes = ['workspace-drop-overlay'];

    if (activeSide === 'left') {
      classes.push('workspace-drop-overlay--left');
    }

    if (activeSide === 'right') {
      classes.push('workspace-drop-overlay--right');
    }

    return classes.join(' ');
  }, [activeSide]);

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
