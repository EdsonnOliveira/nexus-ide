import type { EmulatorPlatform } from '../../types';
import type {
  MaestroTestHighlight,
  MaestroTestHighlightKind,
  TestRunStep,
} from '../../types/test';
import { emulatorSessionManager } from './emulatorSessionManager';
import {
  findMaestroElement,
  highlightTargetToSelector,
  readNodeBounds,
} from './maestroElementMatcher';
import {
  walkMaestroHierarchy,
  type MaestroHierarchyNode,
} from './maestroHierarchy';
import { maestroHierarchyCache } from './maestroHierarchyCache';
import {
  maestroMcpClient,
  type MaestroInspectElement,
  type MaestroInspectScreen,
} from './maestroMcpClient';

export interface MaestroHighlightTarget {
  kind: 'text' | 'id' | 'point' | 'focused';
  value: string;
  highlightKind: MaestroTestHighlightKind;
}

interface ParsedBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ScreenMetrics {
  width: number;
  height: number;
}

interface ResolvedDevice {
  nexusDeviceId: string;
  maestroDeviceId: string;
  platform: EmulatorPlatform;
}

let resolveGeneration = 0;

interface PrecomputedHighlightEntry {
  target: MaestroHighlightTarget;
  bounds: MaestroTestHighlight['bounds'];
  screen: ScreenMetrics;
}

let preparedDevice: ResolvedDevice | null = null;
const precomputedByLabel = new Map<string, PrecomputedHighlightEntry>();
const precomputedByTarget = new Map<string, PrecomputedHighlightEntry>();

function stepLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

function targetCacheKey(target: MaestroHighlightTarget): string {
  return `${target.highlightKind}:${target.kind}:${normalizeMatchKey(target.value)}`;
}

function convertInspectElement(element: MaestroInspectElement): MaestroHierarchyNode {
  return {
    attributes: {
      bounds: element.b,
      text: element.txt,
      accessibilityText: element.a11y,
      'resource-id': element.rid,
      hintText: element.hint,
      focused: element.focused ? 'true' : 'false',
    },
    clickable: element.clickable,
    focused: element.focused,
    children: (element.c ?? []).map(convertInspectElement),
  };
}

function convertInspectScreenToHierarchy(screen: MaestroInspectScreen): MaestroHierarchyNode {
  return {
    children: screen.elements.map(convertInspectElement),
  };
}

async function fetchHierarchySnapshot(device: ResolvedDevice): Promise<MaestroHierarchyNode | null> {
  maestroHierarchyCache.bindDevice(device.maestroDeviceId);

  const cached = maestroHierarchyCache.getSnapshot();

  if (cached) {
    return cached;
  }

  const pending = await maestroHierarchyCache.waitForPendingSnapshot();

  if (pending) {
    return pending;
  }

  const cliPromise = maestroHierarchyCache.fetchFresh();
  const mcpPromise = maestroMcpClient
    .inspectScreen(device.maestroDeviceId)
    .then(convertInspectScreenToHierarchy)
    .catch(() => null);

  const raced = await Promise.race([cliPromise, mcpPromise]);

  if (raced) {
    return raced;
  }

  const cliResult = await cliPromise;
  const mcpResult = await mcpPromise;

  return cliResult ?? mcpResult;
}

const COMMAND_TO_KIND: Record<string, MaestroTestHighlightKind> = {
  tapon: 'tap',
  doubletapon: 'doubleTap',
  longpresson: 'longPress',
  launchapp: 'tap',
  assertvisible: 'assert',
  assertnotvisible: 'assert',
  asserttrue: 'assert',
  assertfalse: 'assert',
  inputtext: 'input',
  swipe: 'swipe',
  scroll: 'swipe',
  copytextfrom: 'tap',
  erasetext: 'input',
  pastetext: 'input',
};

const HIGHLIGHT_COMMAND_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  highlightKind: MaestroTestHighlightKind;
}> = [
  { pattern: /\btap\s+on\b/i, highlightKind: 'tap' },
  { pattern: /\blaunch\s+app\b/i, highlightKind: 'tap' },
  { pattern: /\bdouble\s+tap\s+on\b/i, highlightKind: 'doubleTap' },
  { pattern: /\blong\s+press\s+on\b/i, highlightKind: 'longPress' },
  { pattern: /\bassert\s+that\b/i, highlightKind: 'assert' },
  { pattern: /\bassert\s+visible\b/i, highlightKind: 'assert' },
  { pattern: /\binput\s+text\b/i, highlightKind: 'input' },
  { pattern: /\bswipe\b/i, highlightKind: 'swipe' },
  { pattern: /\bscroll\b/i, highlightKind: 'swipe' },
];

function parseBoundsString(bounds: string): ParsedBounds | null {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);

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

function readScreenMetrics(root: MaestroHierarchyNode): ScreenMetrics | null {
  let width = 0;
  let height = 0;

  walkMaestroHierarchy(root, (attributes) => {
    if (!attributes.bounds) {
      return;
    }

    const parsed = parseBoundsString(attributes.bounds);

    if (!parsed) {
      return;
    }

    width = Math.max(width, parsed.right);
    height = Math.max(height, parsed.bottom);
  });

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function normalizeBounds(
  bounds: ParsedBounds,
  screen: ScreenMetrics,
): MaestroTestHighlight['bounds'] {
  return {
    x: bounds.left / screen.width,
    y: bounds.top / screen.height,
    width: (bounds.right - bounds.left) / screen.width,
    height: (bounds.bottom - bounds.top) / screen.height,
  };
}

function normalizeMatchKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function findPointHighlightBounds(
  target: MaestroHighlightTarget,
  screen: ScreenMetrics,
  root: MaestroHierarchyNode,
): MaestroTestHighlight['bounds'] | null {
  const pointMatch =
    target.value.match(/^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/) ??
    target.value.match(/^(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%$/);

  if (!pointMatch) {
    return null;
  }

  const x = Number(pointMatch[1]);
  const y = Number(pointMatch[2]);
  const pointX = target.value.includes('%') ? (x / 100) * screen.width : x;
  const pointY = target.value.includes('%') ? (y / 100) * screen.height : y;

  let containingBounds: ParsedBounds | null = null;

  walkMaestroHierarchy(root, (attributes) => {
    if (!attributes.bounds) {
      return;
    }

    const parsed = parseBoundsString(attributes.bounds);

    if (!parsed) {
      return;
    }

    const containsPoint =
      pointX >= parsed.left &&
      pointX <= parsed.right &&
      pointY >= parsed.top &&
      pointY <= parsed.bottom;

    if (containsPoint) {
      containingBounds = parsed;
    }
  });

  if (containingBounds) {
    return normalizeBounds(containingBounds, screen);
  }

  const normalizedX = target.value.includes('%') ? x / 100 : x / screen.width;
  const normalizedY = target.value.includes('%') ? y / 100 : y / screen.height;
  const size = 0.08;

  return {
    x: Math.max(0, Math.min(1 - size, normalizedX - size / 2)),
    y: Math.max(0, Math.min(1 - size, normalizedY - size / 2)),
    width: size,
    height: size,
  };
}

function findElementBounds(
  root: MaestroHierarchyNode,
  target: MaestroHighlightTarget,
  screen: ScreenMetrics,
): MaestroTestHighlight['bounds'] | null {
  if (target.kind === 'point') {
    return findPointHighlightBounds(target, screen, root);
  }

  const selector = highlightTargetToSelector(target);

  if (!selector) {
    return null;
  }

  const matchedNode = findMaestroElement(root, selector);
  const parsed = readNodeBounds(matchedNode?.attributes);

  if (!parsed) {
    return null;
  }

  return normalizeBounds(parsed, screen);
}

async function resolveTargetDevice(): Promise<ResolvedDevice | null> {
  const activeSessions = emulatorSessionManager.listActiveSessions();
  const preferredSession = activeSessions[0];

  if (preferredSession) {
    return {
      nexusDeviceId: preferredSession.deviceId,
      maestroDeviceId: preferredSession.deviceId,
      platform: preferredSession.platform,
    };
  }

  if (emulatorSessionManager.hasPendingBoot()) {
    return null;
  }

  const devices = await maestroMcpClient.listDevices();
  const connected = devices.find((device) => device.connected && device.platform !== 'web');

  if (!connected) {
    return null;
  }

  return {
    nexusDeviceId: connected.device_id,
    maestroDeviceId: connected.device_id,
    platform: connected.platform === 'android' ? 'android' : 'ios',
  };
}

function resolveHighlightKindFromCommand(commandKey: string): MaestroTestHighlightKind | null {
  return COMMAND_TO_KIND[commandKey.toLowerCase()] ?? null;
}

export function parseMaestroStepLabel(stepLabel: string): MaestroHighlightTarget | null {
  const trimmed = stepLabel.trim();

  if (!trimmed) {
    return null;
  }

  const commandKey = trimmed.split(':')[0]?.trim().toLowerCase() ?? '';
  const highlightKind = resolveHighlightKindFromCommand(commandKey);

  if (!highlightKind) {
    return null;
  }

  const idMatch = trimmed.match(/\bid\s+"([^"]+)"/i);

  if (idMatch) {
    return { kind: 'id', value: idMatch[1], highlightKind };
  }

  const textPropertyMatch =
    trimmed.match(/\btext:\s*"([^"]+)"/i) ?? trimmed.match(/\btext:\s*([^,"]+)/i);

  if (textPropertyMatch) {
    return { kind: 'text', value: textPropertyMatch[1].trim(), highlightKind };
  }

  const quotedMatch = trimmed.match(/:\s*"([^"]+)"/);

  if (quotedMatch) {
    return { kind: 'text', value: quotedMatch[1], highlightKind };
  }

  const inlineMatch = trimmed.match(/^[^:]+:\s*(.+)$/);

  if (inlineMatch) {
    const inlineValue = inlineMatch[1].trim();

    if (inlineValue && !inlineValue.startsWith('{')) {
      return { kind: 'text', value: inlineValue, highlightKind };
    }
  }

  if (highlightKind === 'input') {
    return { kind: 'focused', value: '', highlightKind };
  }

  const pointMatch = trimmed.match(/(\d+(?:\.\d+)?%?\s*,\s*\d+(?:\.\d+)?%?)/);

  if (pointMatch) {
    return { kind: 'point', value: pointMatch[1].replace(/\s+/g, ''), highlightKind };
  }

  return null;
}

export function parseMaestroHighlightTarget(description: string): MaestroHighlightTarget | null {
  const fromStepLabel = parseMaestroStepLabel(description);

  if (fromStepLabel) {
    return fromStepLabel;
  }

  const trimmed = description.trim();

  if (!trimmed) {
    return null;
  }

  const highlightKind =
    HIGHLIGHT_COMMAND_PATTERNS.find(({ pattern }) => pattern.test(trimmed))?.highlightKind ?? null;

  if (!highlightKind) {
    return null;
  }

  const idMatch = trimmed.match(/\bid\s+"([^"]+)"/i);

  if (idMatch) {
    return { kind: 'id', value: idMatch[1], highlightKind };
  }

  const quotedMatch = trimmed.match(/"([^"]+)"/);

  if (quotedMatch) {
    return { kind: 'text', value: quotedMatch[1], highlightKind };
  }

  if (highlightKind === 'input') {
    return { kind: 'focused', value: '', highlightKind };
  }

  const pointMatch = trimmed.match(/(\d+(?:\.\d+)?%?\s*,\s*\d+(?:\.\d+)?%?)/);

  if (pointMatch) {
    return { kind: 'point', value: pointMatch[1].replace(/\s+/g, ''), highlightKind };
  }

  return null;
}

async function readHierarchySnapshot(
  maestroDeviceId: string,
  preferCache = true,
): Promise<MaestroHierarchyNode | null> {
  if (emulatorSessionManager.hasPendingBoot()) {
    return null;
  }

  maestroHierarchyCache.bindDevice(maestroDeviceId);

  if (preferCache) {
    const cached = maestroHierarchyCache.getSnapshot();

    if (cached) {
      return cached;
    }
  }

  return maestroHierarchyCache.fetchFresh();
}

function resolveBoundsFromHierarchy(
  hierarchy: MaestroHierarchyNode,
  target: MaestroHighlightTarget,
): { bounds: MaestroTestHighlight['bounds']; screen: ScreenMetrics } | null {
  const screen = readScreenMetrics(hierarchy);

  if (!screen) {
    return null;
  }

  const bounds = findElementBounds(hierarchy, target, screen);

  if (!bounds) {
    return null;
  }

  return { bounds, screen };
}

function buildHighlightPayload(
  runId: string,
  device: ResolvedDevice,
  target: MaestroHighlightTarget,
  source: string,
  bounds: MaestroTestHighlight['bounds'],
  screen: ScreenMetrics,
): MaestroTestHighlight {
  return {
    runId,
    deviceId: device.nexusDeviceId,
    platform: device.platform,
    kind: target.highlightKind,
    label: source.trim(),
    bounds,
    screenWidth: screen.width,
    screenHeight: screen.height,
  };
}

function storePrecomputedHighlight(
  source: string,
  target: MaestroHighlightTarget,
  bounds: MaestroTestHighlight['bounds'],
  screen: ScreenMetrics,
): void {
  const entry: PrecomputedHighlightEntry = {
    target,
    bounds,
    screen,
  };

  precomputedByLabel.set(stepLabelKey(source), entry);
  precomputedByTarget.set(targetCacheKey(target), entry);
}

function precomputeStepsFromHierarchy(
  hierarchy: MaestroHierarchyNode,
  steps: TestRunStep[],
  startIndex = 0,
): void {
  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index];
    const target = parseMaestroHighlightTarget(step.label);

    if (!target) {
      continue;
    }

    const match = resolveBoundsFromHierarchy(hierarchy, target);

    if (!match) {
      continue;
    }

    storePrecomputedHighlight(step.label, target, match.bounds, match.screen);
  }
}

export async function prepareMaestroHighlightCache(steps: TestRunStep[]): Promise<void> {
  precomputedByLabel.clear();
  preparedDevice = null;

  if (steps.length === 0) {
    return;
  }

  await prefetchMaestroHierarchyWhenReady();

  const device = await resolveTargetDevice();

  if (!device || emulatorSessionManager.hasPendingBoot()) {
    return;
  }

  preparedDevice = device;
  maestroHierarchyCache.bindDevice(device.maestroDeviceId);

  const hierarchy =
    maestroHierarchyCache.getSnapshot() ?? (await fetchHierarchySnapshot(device));

  if (!hierarchy) {
    return;
  }

  precomputeStepsFromHierarchy(hierarchy, steps);
}

export function takePrecomputedMaestroHighlight(
  runId: string,
  source: string,
): MaestroTestHighlight | null {
  if (!preparedDevice) {
    return null;
  }

  const target = parseMaestroHighlightTarget(source);
  const entry =
    (target ? precomputedByTarget.get(targetCacheKey(target)) : null) ??
    precomputedByLabel.get(stepLabelKey(source));

  if (!entry) {
    return null;
  }

  return buildHighlightPayload(
    runId,
    preparedDevice,
    entry.target,
    source,
    entry.bounds,
    entry.screen,
  );
}

export function refreshPrecomputedHighlightsForSteps(
  steps: TestRunStep[],
  startIndex = 0,
): void {
  const hierarchy = maestroHierarchyCache.getSnapshot();

  if (!hierarchy) {
    return;
  }

  precomputeStepsFromHierarchy(hierarchy, steps, startIndex);
}

export function clearMaestroHighlightPrecompute(): void {
  precomputedByLabel.clear();
  precomputedByTarget.clear();
  preparedDevice = null;
}

export async function prefetchMaestroHierarchySnapshot(): Promise<void> {
  const device = await resolveTargetDevice();

  if (!device || emulatorSessionManager.hasPendingBoot()) {
    return;
  }

  if (!preparedDevice) {
    preparedDevice = device;
  }

  await fetchHierarchySnapshot(device);
}

export async function refreshMaestroHierarchySnapshot(): Promise<void> {
  const device = await resolveTargetDevice();

  if (!device || emulatorSessionManager.hasPendingBoot()) {
    return;
  }

  if (!preparedDevice) {
    preparedDevice = device;
  }

  maestroHierarchyCache.bindDevice(device.maestroDeviceId);
  await maestroHierarchyCache.fetchFresh();
}

export async function prefetchMaestroHierarchyWhenReady(): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (emulatorSessionManager.hasPendingBoot()) {
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
      continue;
    }

    const device = await resolveTargetDevice();

    if (!device) {
      return;
    }

    if (!preparedDevice) {
      preparedDevice = device;
    }

    maestroHierarchyCache.bindDevice(device.maestroDeviceId);
    await fetchHierarchySnapshot(device);
    return;
  }
}

export async function resolveMaestroHighlight(
  runId: string,
  source: string,
  options?: { forceFresh?: boolean },
): Promise<MaestroTestHighlight | null> {
  const forceFresh = options?.forceFresh ?? false;
  const target = parseMaestroHighlightTarget(source);

  if (!target) {
    return null;
  }

  if (!forceFresh) {
    const precomputed = takePrecomputedMaestroHighlight(runId, source);

    if (precomputed) {
      return precomputed;
    }
  }

  const generation = ++resolveGeneration;

  try {
    const device = preparedDevice ?? (await resolveTargetDevice());

    if (!device || emulatorSessionManager.hasPendingBoot()) {
      return null;
    }

    if (!preparedDevice) {
      preparedDevice = device;
    }

    maestroHierarchyCache.bindDevice(device.maestroDeviceId);

    const pendingSnapshot = forceFresh ? null : await maestroHierarchyCache.waitForPendingSnapshot();
    const cachedHierarchy = forceFresh
      ? null
      : pendingSnapshot ?? maestroHierarchyCache.getSnapshot();

    if (cachedHierarchy) {
      const cachedMatch = resolveBoundsFromHierarchy(cachedHierarchy, target);

      if (cachedMatch && generation === resolveGeneration) {
        storePrecomputedHighlight(source, target, cachedMatch.bounds, cachedMatch.screen);

        return buildHighlightPayload(
          runId,
          device,
          target,
          source,
          cachedMatch.bounds,
          cachedMatch.screen,
        );
      }
    }

    const hierarchy = forceFresh
      ? await maestroHierarchyCache.fetchFresh()
      : await fetchHierarchySnapshot(device);

    if (generation !== resolveGeneration || !hierarchy) {
      if (cachedHierarchy && generation === resolveGeneration) {
        const staleMatch = resolveBoundsFromHierarchy(cachedHierarchy, target);

        if (staleMatch) {
          storePrecomputedHighlight(source, target, staleMatch.bounds, staleMatch.screen);

          return buildHighlightPayload(
            runId,
            device,
            target,
            source,
            staleMatch.bounds,
            staleMatch.screen,
          );
        }
      }

      return null;
    }

    const freshMatch = resolveBoundsFromHierarchy(hierarchy, target);

    if (freshMatch && generation === resolveGeneration) {
      storePrecomputedHighlight(source, target, freshMatch.bounds, freshMatch.screen);

      return buildHighlightPayload(
        runId,
        device,
        target,
        source,
        freshMatch.bounds,
        freshMatch.screen,
      );
    }

    if (cachedHierarchy && generation === resolveGeneration) {
      const staleMatch = resolveBoundsFromHierarchy(cachedHierarchy, target);

      if (staleMatch) {
        storePrecomputedHighlight(source, target, staleMatch.bounds, staleMatch.screen);

        return buildHighlightPayload(
          runId,
          device,
          target,
          source,
          staleMatch.bounds,
          staleMatch.screen,
        );
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function cancelMaestroHighlightResolution(): void {
  resolveGeneration += 1;
}

export function teardownMaestroHighlightSession(): void {
  resolveGeneration += 1;
  clearMaestroHighlightPrecompute();
  maestroHierarchyCache.stop();
  maestroMcpClient.dispose();
}
