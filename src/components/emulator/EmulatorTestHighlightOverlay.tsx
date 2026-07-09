import { memo, useMemo } from 'react';
import type { MaestroTestHighlight } from '@/types/test';

interface EmulatorTestHighlightOverlayProps {
  highlight: MaestroTestHighlight;
}

const HIGHLIGHT_PAD = 0.01;

function EmulatorTestHighlightOverlayComponent({ highlight }: EmulatorTestHighlightOverlayProps) {
  const style = useMemo(() => {
    const x = Math.max(0, highlight.bounds.x - HIGHLIGHT_PAD);
    const y = Math.max(0, highlight.bounds.y - HIGHLIGHT_PAD);
    const width = Math.min(1 - x, highlight.bounds.width + HIGHLIGHT_PAD * 2);
    const height = Math.min(1 - y, highlight.bounds.height + HIGHLIGHT_PAD * 2);

    return {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
    } as const;
  }, [highlight.bounds.height, highlight.bounds.width, highlight.bounds.x, highlight.bounds.y]);

  return (
    <div className='emulator-view__highlight-layer' aria-hidden>
      <div className='emulator-view__highlight-target overlay-popup--in' style={style}>
        <span className='emulator-view__highlight-fill' />
        <span className='emulator-view__highlight-outline' />
      </div>
    </div>
  );
}

export const EmulatorTestHighlightOverlay = memo(EmulatorTestHighlightOverlayComponent);
