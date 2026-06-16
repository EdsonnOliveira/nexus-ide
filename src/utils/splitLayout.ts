export type SplitLayoutNode =
  | { type: 'tab'; tabId: string }
  | {
      type: 'split';
      orientation: 'horizontal';
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

function insertTabBeside(
  node: SplitLayoutNode,
  sourceTabId: string,
  targetTabId: string,
  side: 'left' | 'right',
): SplitLayoutNode {
  if (node.type === 'tab') {
    if (node.tabId !== targetTabId) {
      return node;
    }

    const sourceNode = createTabLayout(sourceTabId);
    const targetNode = node;

    if (side === 'left') {
      return {
        type: 'split',
        orientation: 'horizontal',
        left: sourceNode,
        right: targetNode,
        ratio: 0.5,
      };
    }

    return {
      type: 'split',
      orientation: 'horizontal',
      left: targetNode,
      right: sourceNode,
      ratio: 0.5,
    };
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
  side: 'left' | 'right',
): SplitLayoutNode {
  if (sourceTabId === targetTabId) {
    return layout;
  }

  const withoutSource = removeTabFromLayout(layout, sourceTabId) ?? createTabLayout(targetTabId);

  return insertTabBeside(withoutSource, sourceTabId, targetTabId, side);
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
