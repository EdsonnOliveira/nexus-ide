export type SplitOrientation = 'horizontal' | 'vertical';

export type SplitQuadrant = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type SplitInsertSide = 'left' | 'right' | 'top' | 'bottom';

export type SplitLayoutNode =
  | { type: 'tab'; tabId: string }
  | {
      type: 'split';
      orientation: SplitOrientation;
      left: SplitLayoutNode;
      right: SplitLayoutNode;
      ratio: number;
    };

export function createTabLayout(tabId: string): SplitLayoutNode {
  return { type: 'tab', tabId };
}

export function getVisibleTabIds(node: SplitLayoutNode | null): string[] {
  if (!node) {
    return [];
  }

  if (node.type === 'tab') {
    return [node.tabId];
  }

  return [...getVisibleTabIds(node.left), ...getVisibleTabIds(node.right)];
}

export function removeTabFromLayout(
  node: SplitLayoutNode,
  tabId: string,
): SplitLayoutNode | null {
  if (node.type === 'tab') {
    return node.tabId === tabId ? null : node;
  }

  const left = removeTabFromLayout(node.left, tabId);
  const right = removeTabFromLayout(node.right, tabId);

  if (!left && !right) {
    return null;
  }

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return { ...node, left, right };
}

function orientationForSide(side: SplitInsertSide): SplitOrientation {
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
}

function createSplitBeside(
  targetNode: SplitLayoutNode,
  sourceNode: SplitLayoutNode,
  side: SplitInsertSide,
): SplitLayoutNode {
  const orientation = orientationForSide(side);

  if (side === 'left' || side === 'top') {
    return {
      type: 'split',
      orientation,
      left: sourceNode,
      right: targetNode,
      ratio: 0.5,
    };
  }

  return {
    type: 'split',
    orientation,
    left: targetNode,
    right: sourceNode,
    ratio: 0.5,
  };
}

function insertTabBeside(
  node: SplitLayoutNode,
  sourceTabId: string,
  targetTabId: string,
  side: SplitInsertSide,
): SplitLayoutNode {
  if (node.type === 'tab') {
    if (node.tabId !== targetTabId) {
      return node;
    }

    return createSplitBeside(node, createTabLayout(sourceTabId), side);
  }

  return {
    ...node,
    left: insertTabBeside(node.left, sourceTabId, targetTabId, side),
    right: insertTabBeside(node.right, sourceTabId, targetTabId, side),
  };
}

export function moveTabInLayout(
  layout: SplitLayoutNode,
  sourceTabId: string,
  targetTabId: string,
  side: SplitInsertSide,
): SplitLayoutNode {
  if (sourceTabId === targetTabId) {
    return layout;
  }

  const withoutSource = removeTabFromLayout(layout, sourceTabId) ?? createTabLayout(targetTabId);

  return insertTabBeside(withoutSource, sourceTabId, targetTabId, side);
}

export function buildGridSplitLayout(ids: string[]): SplitLayoutNode {
  if (ids.length === 0) {
    return createTabLayout('');
  }

  if (ids.length === 1) {
    return createTabLayout(ids[0]);
  }

  if (ids.length === 2) {
    return {
      type: 'split',
      orientation: 'horizontal',
      left: createTabLayout(ids[0]),
      right: createTabLayout(ids[1]),
      ratio: 0.5,
    };
  }

  if (ids.length === 3) {
    return {
      type: 'split',
      orientation: 'horizontal',
      left: createTabLayout(ids[0]),
      right: {
        type: 'split',
        orientation: 'vertical',
        left: createTabLayout(ids[1]),
        right: createTabLayout(ids[2]),
        ratio: 0.5,
      },
      ratio: 0.5,
    };
  }

  if (ids.length === 4) {
    return {
      type: 'split',
      orientation: 'vertical',
      left: {
        type: 'split',
        orientation: 'horizontal',
        left: createTabLayout(ids[0]),
        right: createTabLayout(ids[1]),
        ratio: 0.5,
      },
      right: {
        type: 'split',
        orientation: 'horizontal',
        left: createTabLayout(ids[2]),
        right: createTabLayout(ids[3]),
        ratio: 0.5,
      },
      ratio: 0.5,
    };
  }

  const mid = Math.ceil(ids.length / 2);

  return {
    type: 'split',
    orientation: 'horizontal',
    left: buildGridSplitLayout(ids.slice(0, mid)),
    right: buildGridSplitLayout(ids.slice(mid)),
    ratio: 0.5,
  };
}

function buildGridFromIds(ids: string[]): SplitLayoutNode {
  return buildGridSplitLayout(ids);
}

function isMonoOrientationChain(
  node: SplitLayoutNode,
  orientation: SplitOrientation,
): boolean {
  if (node.type === 'tab') {
    return true;
  }

  if (node.orientation !== orientation) {
    return false;
  }

  return (
    isMonoOrientationChain(node.left, orientation) &&
    isMonoOrientationChain(node.right, orientation)
  );
}

export function rebalanceMonoChainsToGrid(node: SplitLayoutNode): SplitLayoutNode {
  if (node.type === 'tab') {
    return node;
  }

  const ids = getVisibleTabIds(node);

  if (ids.length >= 3 && isMonoOrientationChain(node, node.orientation)) {
    return buildGridFromIds(ids);
  }

  const left = rebalanceMonoChainsToGrid(node.left);
  const right = rebalanceMonoChainsToGrid(node.right);

  if (left === node.left && right === node.right) {
    return node;
  }

  return {
    ...node,
    left,
    right,
  };
}

function splitLeafByQuadrant(
  leaf: { type: 'tab'; tabId: string },
  sourceLayout: SplitLayoutNode,
  quadrant: SplitQuadrant,
  parentOrientation: SplitOrientation | null,
): SplitLayoutNode {
  const isLeft = quadrant === 'top-left' || quadrant === 'bottom-left';
  const isTop = quadrant === 'top-left' || quadrant === 'top-right';

  if (parentOrientation === 'horizontal') {
    return createSplitBeside(leaf, sourceLayout, isTop ? 'top' : 'bottom');
  }

  if (parentOrientation === 'vertical') {
    return createSplitBeside(leaf, sourceLayout, isLeft ? 'left' : 'right');
  }

  return createSplitBeside(leaf, sourceLayout, isLeft ? 'left' : 'right');
}

function insertIntoPaneQuadrantWithParent(
  layout: SplitLayoutNode,
  targetPaneId: string,
  sourceLayout: SplitLayoutNode,
  quadrant: SplitQuadrant,
  parentOrientation: SplitOrientation | null,
): SplitLayoutNode {
  if (layout.type === 'tab') {
    if (layout.tabId !== targetPaneId) {
      return layout;
    }

    return splitLeafByQuadrant(layout, sourceLayout, quadrant, parentOrientation);
  }

  return {
    ...layout,
    left: insertIntoPaneQuadrantWithParent(
      layout.left,
      targetPaneId,
      sourceLayout,
      quadrant,
      layout.orientation,
    ),
    right: insertIntoPaneQuadrantWithParent(
      layout.right,
      targetPaneId,
      sourceLayout,
      quadrant,
      layout.orientation,
    ),
  };
}

export function insertIntoPaneQuadrant(
  layout: SplitLayoutNode,
  targetPaneId: string,
  sourceLayout: SplitLayoutNode,
  quadrant: SplitQuadrant,
): SplitLayoutNode {
  const inserted = insertIntoPaneQuadrantWithParent(
    layout,
    targetPaneId,
    sourceLayout,
    quadrant,
    null,
  );

  return rebalanceMonoChainsToGrid(inserted);
}

export function resolveProjectLayout(
  layout: SplitLayoutNode | null | undefined,
  activeTabId: string | null,
  tabIds: string[],
): SplitLayoutNode | null {
  if (layout) {
    const visible = getVisibleTabIds(layout);
    const valid = visible.length > 0 && visible.every((id) => tabIds.includes(id));

    if (valid) {
      return layout;
    }
  }

  if (activeTabId && tabIds.includes(activeTabId)) {
    return createTabLayout(activeTabId);
  }

  if (tabIds.length > 0) {
    return createTabLayout(tabIds[0]);
  }

  return null;
}

const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;

export function clampSplitRatio(ratio: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function updateSplitRatioAtPath(
  node: SplitLayoutNode,
  path: readonly number[],
  ratio: number,
): SplitLayoutNode {
  if (node.type === 'tab') {
    return node;
  }

  if (path.length === 0) {
    return { ...node, ratio: clampSplitRatio(ratio) };
  }

  const [next, ...rest] = path;

  if (next === 0) {
    return {
      ...node,
      left: updateSplitRatioAtPath(node.left, rest, ratio),
    };
  }

  return {
    ...node,
    right: updateSplitRatioAtPath(node.right, rest, ratio),
  };
}
