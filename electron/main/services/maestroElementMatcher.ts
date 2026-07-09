import type { MaestroHierarchyAttributes, MaestroHierarchyNode } from './maestroHierarchy';

const REGEX_FLAGS = 'ims';

type ElementFilter = (nodes: MaestroHierarchyNode[]) => MaestroHierarchyNode[];

export interface MaestroElementSelector {
  textRegex?: string;
  idRegex?: string;
  focused?: boolean;
  index?: number;
}

interface ParsedBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toRegexSafe(pattern: string): RegExp {
  try {
    return new RegExp(pattern, REGEX_FLAGS);
  } catch {
    return new RegExp(escapeRegex(pattern), REGEX_FLAGS);
  }
}

function regexMatchesFull(regex: RegExp, value: string): boolean {
  const anchored = new RegExp(`^(?:${regex.source})$`, regex.flags);
  return anchored.test(value);
}

function regexMatchesMaestro(regex: RegExp, value: string): boolean {
  const strippedValue = value.replace(/\n/g, ' ');

  return (
    regexMatchesFull(regex, value) ||
    regex.source === value ||
    regexMatchesFull(regex, strippedValue) ||
    regex.source === strippedValue
  );
}

function parseBounds(bounds: string | undefined): ParsedBounds | null {
  const match = bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);

  if (!match) {
    return null;
  }

  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

function indexComparator(a: MaestroHierarchyNode, b: MaestroHierarchyNode): number {
  const boundsA = parseBounds(a.attributes?.bounds);
  const boundsB = parseBounds(b.attributes?.bounds);
  const yA = boundsA?.top ?? Number.MAX_SAFE_INTEGER;
  const yB = boundsB?.top ?? Number.MAX_SAFE_INTEGER;

  if (yA !== yB) {
    return yA - yB;
  }

  const xA = boundsA?.left ?? Number.MAX_SAFE_INTEGER;
  const xB = boundsB?.left ?? Number.MAX_SAFE_INTEGER;

  return xA - xB;
}

function intersectFilters(filters: ElementFilter[]): ElementFilter {
  return (nodes) => {
    if (filters.length === 0) {
      return nodes;
    }

    const sets = filters.map((filter) => new Set(filter(nodes)));
    let intersection = sets[0];

    for (let index = 1; index < sets.length; index += 1) {
      intersection = new Set([...intersection].filter((node) => sets[index].has(node)));
    }

    return [...intersection];
  };
}

function composeFilters(...filters: ElementFilter[]): ElementFilter {
  return (nodes) => filters.reduce((accumulator, filter) => filter(accumulator), nodes);
}

function textMatches(regex: RegExp): ElementFilter {
  return (nodes) => {
    const textMatchNodes = new Set<MaestroHierarchyNode>();
    const hintMatchNodes: MaestroHierarchyNode[] = [];
    const accessibilityMatchNodes = new Set<MaestroHierarchyNode>();

    for (const node of nodes) {
      const attributes = node.attributes ?? {};

      if (attributes.text && regexMatchesMaestro(regex, attributes.text)) {
        textMatchNodes.add(node);
      }

      if (attributes.hintText && regexMatchesMaestro(regex, attributes.hintText)) {
        hintMatchNodes.push(node);
      }

      if (attributes.accessibilityText && regexMatchesMaestro(regex, attributes.accessibilityText)) {
        accessibilityMatchNodes.add(node);
      }
    }

    const combined = new Set<MaestroHierarchyNode>([
      ...textMatchNodes,
      ...hintMatchNodes,
      ...accessibilityMatchNodes,
    ]);

    return [...combined];
  };
}

function idMatches(regex: RegExp): ElementFilter {
  return (nodes) => {
    const exactMatches = new Set<MaestroHierarchyNode>();
    const suffixMatches = new Set<MaestroHierarchyNode>();

    for (const node of nodes) {
      const resourceId = node.attributes?.['resource-id'];

      if (!resourceId) {
        continue;
      }

      if (regexMatchesFull(regex, resourceId)) {
        exactMatches.add(node);
      }

      const suffix = resourceId.substring(resourceId.lastIndexOf('/') + 1);

      if (regexMatchesFull(regex, suffix)) {
        suffixMatches.add(node);
      }
    }

    return [...new Set([...exactMatches, ...suffixMatches])];
  };
}

function focusedFilter(expected: boolean): ElementFilter {
  return (nodes) =>
    nodes.filter((node) => {
      if (node.focused !== undefined) {
        return node.focused === expected;
      }

      return node.attributes?.focused === (expected ? 'true' : 'false');
    });
}

function deepestMatchingElement(filter: ElementFilter): ElementFilter {
  return (nodes) => {
    const result: MaestroHierarchyNode[] = [];
    const seen = new Set<MaestroHierarchyNode>();

    for (const node of nodes) {
      const matchingChildren = deepestMatchingElement(filter)(node.children ?? []);

      if (matchingChildren.length > 0) {
        for (const child of matchingChildren) {
          if (!seen.has(child)) {
            seen.add(child);
            result.push(child);
          }
        }
        continue;
      }

      if (filter([node]).length > 0 && !seen.has(node)) {
        seen.add(node);
        result.push(node);
      }
    }

    return result;
  };
}

function clickableFirst(): ElementFilter {
  return (nodes) =>
    [...nodes].sort((left, right) => {
      const leftScore = left.clickable === true ? 1 : 0;
      const rightScore = right.clickable === true ? 1 : 0;

      return rightScore - leftScore;
    });
}

function indexFilter(index: number): ElementFilter {
  return (nodes) => {
    const sortedNodes = [...nodes].sort(indexComparator);
    const resolvedIndex = index >= 0 ? index : sortedNodes.length + index;

    if (resolvedIndex < 0) {
      return [];
    }

    const match = sortedNodes[resolvedIndex];

    return match ? [match] : [];
  };
}

export function aggregateMaestroHierarchy(root: MaestroHierarchyNode): MaestroHierarchyNode[] {
  const aggregated = [root];

  for (const child of root.children ?? []) {
    aggregated.push(...aggregateMaestroHierarchy(child));
  }

  return aggregated;
}

export function buildMaestroElementFilter(selector: MaestroElementSelector): ElementFilter {
  const basicFilters: ElementFilter[] = [];

  if (selector.textRegex) {
    basicFilters.push(textMatches(toRegexSafe(selector.textRegex)));
  }

  if (selector.idRegex) {
    basicFilters.push(idMatches(toRegexSafe(selector.idRegex)));
  }

  if (selector.focused !== undefined) {
    basicFilters.push(focusedFilter(selector.focused));
  }

  let resultFilter: ElementFilter =
    basicFilters.length > 0
      ? deepestMatchingElement(intersectFilters(basicFilters))
      : (nodes) => nodes;

  if (selector.index !== undefined) {
    resultFilter = composeFilters(resultFilter, indexFilter(selector.index));
  } else {
    resultFilter = composeFilters(resultFilter, clickableFirst());
  }

  return resultFilter;
}

export function findMaestroElement(
  root: MaestroHierarchyNode,
  selector: MaestroElementSelector,
): MaestroHierarchyNode | null {
  const filter = buildMaestroElementFilter(selector);
  return filter(aggregateMaestroHierarchy(root))[0] ?? null;
}

export function highlightTargetToSelector(target: {
  kind: 'text' | 'id' | 'point' | 'focused';
  value: string;
}): MaestroElementSelector | null {
  if (target.kind === 'text') {
    return { textRegex: target.value };
  }

  if (target.kind === 'id') {
    return { idRegex: target.value };
  }

  if (target.kind === 'focused') {
    return { focused: true };
  }

  return null;
}

export function readNodeBounds(attributes: MaestroHierarchyAttributes | undefined): ParsedBounds | null {
  if (!attributes?.bounds) {
    return null;
  }

  return parseBounds(attributes.bounds);
}
