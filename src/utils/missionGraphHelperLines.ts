import type { Node, XYPosition } from '@xyflow/react';

export interface MissionGraphHelperLine {
  orientation: 'horizontal' | 'vertical';
  position: number;
}

export interface MissionGraphSpacingGuide {
  orientation: 'horizontal' | 'vertical';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MissionGraphAlignmentResult {
  horizontal: MissionGraphHelperLine | null;
  vertical: MissionGraphHelperLine | null;
  spacings: MissionGraphSpacingGuide[];
  snap: XYPosition;
}

interface NodeBounds {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface AxisMatch {
  guide: number;
  distance: number;
  snap: number;
}

interface SpacingMatch {
  distance: number;
  snapX: number;
  snapY: number;
  guides: MissionGraphSpacingGuide[];
}

const DEFAULT_NODE_WIDTH = 248;
const DEFAULT_NODE_HEIGHT = 120;
const MIN_GAP = 1;

function resolveNodeSize(node: Node): { width: number; height: number } {
  const styleWidth =
    typeof node.style?.width === 'number'
      ? node.style.width
      : typeof node.width === 'number'
        ? node.width
        : undefined;
  const styleHeight =
    typeof node.style?.height === 'number'
      ? node.style.height
      : typeof node.height === 'number'
        ? node.height
        : undefined;

  return {
    width: node.measured?.width || styleWidth || DEFAULT_NODE_WIDTH,
    height: node.measured?.height || styleHeight || DEFAULT_NODE_HEIGHT,
  };
}

function getNodeBounds(node: Node): NodeBounds {
  const { width, height } = resolveNodeSize(node);
  const left = node.position.x;
  const top = node.position.y;

  return {
    id: node.id,
    left,
    right: left + width,
    top,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > 0;
}

function pickClosestMatch(candidates: AxisMatch[]): AxisMatch | null {
  let best: AxisMatch | null = null;

  for (const candidate of candidates) {
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }

  return best;
}

function pickClosestSpacing(candidates: SpacingMatch[]): SpacingMatch | null {
  let best: SpacingMatch | null = null;

  for (const candidate of candidates) {
    if (!best || candidate.distance < best.distance) {
      best = candidate;
    }
  }

  return best;
}

function collectVerticalMatches(
  dragging: NodeBounds,
  other: NodeBounds,
  threshold: number,
): AxisMatch[] {
  const pairs: Array<[number, number, number]> = [
    [dragging.left, other.left, other.left],
    [dragging.left, other.centerX, other.centerX],
    [dragging.left, other.right, other.right],
    [dragging.centerX, other.left, other.left - dragging.width / 2],
    [dragging.centerX, other.centerX, other.centerX - dragging.width / 2],
    [dragging.centerX, other.right, other.right - dragging.width / 2],
    [dragging.right, other.left, other.left - dragging.width],
    [dragging.right, other.centerX, other.centerX - dragging.width],
    [dragging.right, other.right, other.right - dragging.width],
  ];

  const matches: AxisMatch[] = [];
  for (const [source, guide, snap] of pairs) {
    const distance = Math.abs(source - guide);
    if (distance <= threshold) {
      matches.push({ guide, distance, snap });
    }
  }
  return matches;
}

function collectHorizontalMatches(
  dragging: NodeBounds,
  other: NodeBounds,
  threshold: number,
): AxisMatch[] {
  const pairs: Array<[number, number, number]> = [
    [dragging.top, other.top, other.top],
    [dragging.top, other.centerY, other.centerY],
    [dragging.top, other.bottom, other.bottom],
    [dragging.centerY, other.top, other.top - dragging.height / 2],
    [dragging.centerY, other.centerY, other.centerY - dragging.height / 2],
    [dragging.centerY, other.bottom, other.bottom - dragging.height / 2],
    [dragging.bottom, other.top, other.top - dragging.height],
    [dragging.bottom, other.centerY, other.centerY - dragging.height],
    [dragging.bottom, other.bottom, other.bottom - dragging.height],
  ];

  const matches: AxisMatch[] = [];
  for (const [source, guide, snap] of pairs) {
    const distance = Math.abs(source - guide);
    if (distance <= threshold) {
      matches.push({ guide, distance, snap });
    }
  }
  return matches;
}

function buildHorizontalGapGuide(
  left: NodeBounds,
  right: NodeBounds,
  gap: number,
): MissionGraphSpacingGuide {
  const top = Math.max(left.top, right.top);
  const bottom = Math.min(left.bottom, right.bottom);
  const height = Math.max(12, bottom - top);

  return {
    orientation: 'horizontal',
    x: left.right,
    y: top + (bottom - top - height) / 2,
    width: gap,
    height,
  };
}

function buildVerticalGapGuide(
  topNode: NodeBounds,
  bottomNode: NodeBounds,
  gap: number,
): MissionGraphSpacingGuide {
  const left = Math.max(topNode.left, bottomNode.left);
  const right = Math.min(topNode.right, bottomNode.right);
  const width = Math.max(12, right - left);

  return {
    orientation: 'vertical',
    x: left + (right - left - width) / 2,
    y: topNode.bottom,
    width,
    height: gap,
  };
}

function collectHorizontalSpacingMatches(
  dragging: NodeBounds,
  others: NodeBounds[],
  threshold: number,
): SpacingMatch[] {
  const matches: SpacingMatch[] = [];

  for (const neighbor of others) {
    if (!rangesOverlap(dragging.top, dragging.bottom, neighbor.top, neighbor.bottom)) {
      continue;
    }

    for (const reference of others) {
      if (reference.id === neighbor.id) {
        continue;
      }
      if (!rangesOverlap(neighbor.top, neighbor.bottom, reference.top, reference.bottom)) {
        continue;
      }

      if (reference.right + MIN_GAP <= neighbor.left) {
        const gap = neighbor.left - reference.right;
        if (gap < MIN_GAP) {
          continue;
        }

        const snapX = neighbor.right + gap;
        const distance = Math.abs(dragging.left - snapX);
        if (distance > threshold) {
          continue;
        }

        const snapped: NodeBounds = {
          ...dragging,
          left: snapX,
          right: snapX + dragging.width,
          centerX: snapX + dragging.width / 2,
        };

        matches.push({
          distance,
          snapX,
          snapY: dragging.top,
          guides: [
            buildHorizontalGapGuide(reference, neighbor, gap),
            buildHorizontalGapGuide(neighbor, snapped, gap),
          ],
        });
      }

      if (neighbor.right + MIN_GAP <= reference.left) {
        const gap = reference.left - neighbor.right;
        if (gap < MIN_GAP) {
          continue;
        }

        const snapX = neighbor.left - gap - dragging.width;
        const distance = Math.abs(dragging.left - snapX);
        if (distance > threshold) {
          continue;
        }

        const snapped: NodeBounds = {
          ...dragging,
          left: snapX,
          right: snapX + dragging.width,
          centerX: snapX + dragging.width / 2,
        };

        matches.push({
          distance,
          snapX,
          snapY: dragging.top,
          guides: [
            buildHorizontalGapGuide(neighbor, reference, gap),
            buildHorizontalGapGuide(snapped, neighbor, gap),
          ],
        });
      }
    }
  }

  return matches;
}

function collectVerticalSpacingMatches(
  dragging: NodeBounds,
  others: NodeBounds[],
  threshold: number,
): SpacingMatch[] {
  const matches: SpacingMatch[] = [];

  for (const neighbor of others) {
    if (!rangesOverlap(dragging.left, dragging.right, neighbor.left, neighbor.right)) {
      continue;
    }

    for (const reference of others) {
      if (reference.id === neighbor.id) {
        continue;
      }
      if (!rangesOverlap(neighbor.left, neighbor.right, reference.left, reference.right)) {
        continue;
      }

      if (reference.bottom + MIN_GAP <= neighbor.top) {
        const gap = neighbor.top - reference.bottom;
        if (gap < MIN_GAP) {
          continue;
        }

        const snapY = neighbor.bottom + gap;
        const distance = Math.abs(dragging.top - snapY);
        if (distance > threshold) {
          continue;
        }

        const snapped: NodeBounds = {
          ...dragging,
          top: snapY,
          bottom: snapY + dragging.height,
          centerY: snapY + dragging.height / 2,
        };

        matches.push({
          distance,
          snapX: dragging.left,
          snapY,
          guides: [
            buildVerticalGapGuide(reference, neighbor, gap),
            buildVerticalGapGuide(neighbor, snapped, gap),
          ],
        });
      }

      if (neighbor.bottom + MIN_GAP <= reference.top) {
        const gap = reference.top - neighbor.bottom;
        if (gap < MIN_GAP) {
          continue;
        }

        const snapY = neighbor.top - gap - dragging.height;
        const distance = Math.abs(dragging.top - snapY);
        if (distance > threshold) {
          continue;
        }

        const snapped: NodeBounds = {
          ...dragging,
          top: snapY,
          bottom: snapY + dragging.height,
          centerY: snapY + dragging.height / 2,
        };

        matches.push({
          distance,
          snapX: dragging.left,
          snapY,
          guides: [
            buildVerticalGapGuide(neighbor, reference, gap),
            buildVerticalGapGuide(snapped, neighbor, gap),
          ],
        });
      }
    }
  }

  return matches;
}

export function resolveMissionGraphAlignment(
  draggingNode: Node,
  nodes: Node[],
  threshold = 8,
): MissionGraphAlignmentResult {
  const draggingBounds = getNodeBounds(draggingNode);
  const others = nodes
    .filter((node) => node.id !== draggingNode.id && !node.hidden)
    .map(getNodeBounds);

  const verticalCandidates: AxisMatch[] = [];
  const horizontalCandidates: AxisMatch[] = [];

  for (const other of others) {
    verticalCandidates.push(...collectVerticalMatches(draggingBounds, other, threshold));
    horizontalCandidates.push(...collectHorizontalMatches(draggingBounds, other, threshold));
  }

  const vertical = pickClosestMatch(verticalCandidates);
  const horizontal = pickClosestMatch(horizontalCandidates);
  const horizontalSpacing = pickClosestSpacing(
    collectHorizontalSpacingMatches(draggingBounds, others, threshold),
  );
  const verticalSpacing = pickClosestSpacing(
    collectVerticalSpacingMatches(draggingBounds, others, threshold),
  );

  const preferHorizontalSpacing =
    horizontalSpacing &&
    (!vertical || horizontalSpacing.distance <= vertical.distance);
  const preferVerticalSpacing =
    verticalSpacing &&
    (!horizontal || verticalSpacing.distance <= horizontal.distance);

  const spacings: MissionGraphSpacingGuide[] = [];
  if (preferHorizontalSpacing && horizontalSpacing) {
    spacings.push(...horizontalSpacing.guides);
  }
  if (preferVerticalSpacing && verticalSpacing) {
    spacings.push(...verticalSpacing.guides);
  }

  return {
    vertical: preferHorizontalSpacing
      ? null
      : vertical
        ? { orientation: 'vertical', position: vertical.guide }
        : null,
    horizontal: preferVerticalSpacing
      ? null
      : horizontal
        ? { orientation: 'horizontal', position: horizontal.guide }
        : null,
    spacings,
    snap: {
      x: preferHorizontalSpacing
        ? horizontalSpacing!.snapX
        : vertical
          ? vertical.snap
          : draggingNode.position.x,
      y: preferVerticalSpacing
        ? verticalSpacing!.snapY
        : horizontal
          ? horizontal.snap
          : draggingNode.position.y,
    },
  };
}
