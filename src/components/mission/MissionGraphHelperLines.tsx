import { memo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type {
  MissionGraphHelperLine,
  MissionGraphSpacingGuide,
} from '@/utils/missionGraphHelperLines';

interface MissionGraphHelperLinesProps {
  horizontal: MissionGraphHelperLine | null;
  vertical: MissionGraphHelperLine | null;
  spacings?: MissionGraphSpacingGuide[];
}

function MissionGraphHelperLinesComponent({
  horizontal,
  vertical,
  spacings = [],
}: MissionGraphHelperLinesProps) {
  if (!horizontal && !vertical && spacings.length === 0) {
    return null;
  }

  return (
    <ViewportPortal>
      {horizontal ? (
        <div
          className='mission-graph-helper-line mission-graph-helper-line--horizontal'
          style={{ top: horizontal.position }}
          aria-hidden='true'
        />
      ) : null}
      {vertical ? (
        <div
          className='mission-graph-helper-line mission-graph-helper-line--vertical'
          style={{ left: vertical.position }}
          aria-hidden='true'
        />
      ) : null}
      {spacings.map((spacing, index) => (
        <div
          key={`${spacing.orientation}-${spacing.x}-${spacing.y}-${index}`}
          className={`mission-graph-spacing-guide mission-graph-spacing-guide--${spacing.orientation}`}
          style={{
            left: spacing.x,
            top: spacing.y,
            width: spacing.width,
            height: spacing.height,
          }}
          aria-hidden='true'
        />
      ))}
    </ViewportPortal>
  );
}

export const MissionGraphHelperLines = memo(MissionGraphHelperLinesComponent);
