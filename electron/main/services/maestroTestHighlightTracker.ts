import path from 'node:path';
import { existsSync } from 'node:fs';
import { stripAnsi } from '../utils/stripAnsi';
import {
  cancelMaestroHighlightResolution,
  parseMaestroHighlightTarget,
  prefetchMaestroHierarchySnapshot,
  refreshMaestroHierarchySnapshot,
  refreshPrecomputedHighlightsForSteps,
  resolveMaestroHighlight,
  takePrecomputedMaestroHighlight,
  teardownMaestroHighlightSession,
} from './maestroHighlightResolver';
import { resolveMaestroStepsAtPath } from './testStepResolver';
import type { MaestroTestHighlight, MaestroTestHighlightKind, TestRunStep } from '../../types/test';

type HighlightEmitter = (payload: MaestroTestHighlight | { runId: string; clear: true }) => void;

export interface MaestroHighlightRunContext {
  projectPath: string;
  testRelativePath: string;
}

const PRE_RUN_HIGHLIGHT_DELAY_MS = 800;
const RUN_FLOW_HIGHLIGHT_RETRY_MS = 1200;
const RUN_FLOW_HIGHLIGHT_MAX_ATTEMPTS = 12;

const MAESTRO_STATUS_SUFFIX = /^(.+?)(?:\.{2,}|…)\s*(COMPLETED|RUNNING|FAILED)\s*$/i;
const MAESTRO_STATUS_PLAIN = /^(.+?)\s+(COMPLETED|RUNNING|FAILED)\s*$/i;

const INTERACTIVE_HIGHLIGHT_KINDS = new Set<MaestroTestHighlightKind>([
  'tap',
  'doubleTap',
  'longPress',
  'input',
  'swipe',
]);

function isInteractiveHighlightSource(source: string): boolean {
  const target = parseMaestroHighlightTarget(source);

  return Boolean(target && INTERACTIVE_HIGHLIGHT_KINDS.has(target.highlightKind));
}

const SCREEN_CHANGING_STEP_KEYS = new Set([
  'launchapp',
  'runflow',
  'tapon',
  'doubletapon',
  'longpresson',
  'swipe',
  'scroll',
  'openlink',
  'back',
  'stopapp',
]);

function cleanMaestroOutputLine(line: string): string {
  return stripAnsi(line).replace(/^[║>│\s]+/, '').trim();
}

function normalizeMatchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getStepCommandKey(label: string): string {
  return label.split(':')[0]?.trim().toLowerCase() ?? '';
}

function isScreenChangingStep(step: TestRunStep): boolean {
  return SCREEN_CHANGING_STEP_KEYS.has(getStepCommandKey(step.label));
}

function isRunFlowDescription(description: string): boolean {
  return (
    getStepCommandKey(description) === 'runflow' ||
    /\brun\s+flow\b/i.test(description) ||
    /\brun\s+[^\s]+\.ya?ml/i.test(description)
  );
}

function parseMaestroStdoutStatus(
  trimmed: string,
): { description: string; status: string } | null {
  const suffixMatch = trimmed.match(MAESTRO_STATUS_SUFFIX);
  const plainMatch = suffixMatch ? null : trimmed.match(MAESTRO_STATUS_PLAIN);
  const match = suffixMatch ?? plainMatch;

  if (!match) {
    return null;
  }

  return {
    description: match[1].trim(),
    status: match[2].toUpperCase(),
  };
}

function extractRunFlowRelativePath(description: string, stepLabel?: string): string | null {
  const patterns = [
    /\brun\s+flow(?::|\s+file:?|\s+)?\s*([^\s]+\.ya?ml)/i,
    /\brun\s+([^\s]+\.ya?ml)/i,
    /file:\s*([^\s]+\.ya?ml)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  const sources = [stepLabel, description].filter((value): value is string => Boolean(value));

  for (const source of sources) {
    const fileMatch = source.match(/file:\s*([^\s]+\.ya?ml)/i);

    if (fileMatch?.[1]) {
      return fileMatch[1];
    }

    const quotedMatch = source.match(/:\s*"([^"]+\.ya?ml)"/i);

    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const runFlowPathMatch = source.match(/runflow:\s*([^\s"']+\.ya?ml)/i);

    if (runFlowPathMatch?.[1]) {
      return runFlowPathMatch[1];
    }
  }

  return null;
}

function resolveRunFlowAbsolutePath(
  context: MaestroHighlightRunContext | null,
  description: string,
  stepLabel?: string,
): string | null {
  if (!context) {
    return null;
  }

  const relativePath = extractRunFlowRelativePath(description, stepLabel);

  if (!relativePath || relativePath.includes('..')) {
    return null;
  }

  const mainFlowPath = path.join(context.projectPath, context.testRelativePath);
  const fromFlowDir = path.resolve(path.dirname(mainFlowPath), relativePath);
  const flowDirBase = path.resolve(path.dirname(mainFlowPath));

  if (fromFlowDir.startsWith(flowDirBase + path.sep) && existsSync(fromFlowDir)) {
    return fromFlowDir;
  }

  const fromProjectRoot = path.resolve(context.projectPath, relativePath);
  const projectRoot = path.resolve(context.projectPath);

  if (fromProjectRoot.startsWith(projectRoot + path.sep) && existsSync(fromProjectRoot)) {
    return fromProjectRoot;
  }

  return null;
}

function basenameWithoutExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;

  return base.replace(/\.ya?ml$/i, '').toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MaestroTestHighlightTracker {
  private emit: HighlightEmitter;
  private activeRunId: string | null = null;
  private steps: TestRunStep[] = [];
  private context: MaestroHighlightRunContext | null = null;
  private highlightedSource: string | null = null;
  private spawnTimer: NodeJS.Timeout | null = null;
  private inSubflow = false;
  private subflowSteps: TestRunStep[] = [];
  private subflowStepIndex = -1;
  private runFlowEntrySource: string | null = null;
  private subflowPrepareTask: Promise<void> | null = null;

  constructor(emit: HighlightEmitter) {
    this.emit = emit;
  }

  start(runId: string, steps: TestRunStep[] = [], context: MaestroHighlightRunContext | null = null): void {
    this.activeRunId = runId;
    this.steps = steps;
    this.context = context;
    this.highlightedSource = null;
    this.resetSubflowState();
    cancelMaestroHighlightResolution();
  }

  stop(runId: string): void {
    if (this.activeRunId !== runId) {
      return;
    }

    this.activeRunId = null;
    this.steps = [];
    this.context = null;
    this.highlightedSource = null;
    this.resetSubflowState();
    this.clearSpawnTimer();
    cancelMaestroHighlightResolution();
    teardownMaestroHighlightSession();
    this.emit({ runId, clear: true });
  }

  scheduleProcessStart(delayMs: number, startProcess: () => void): void {
    this.clearSpawnTimer();

    if (delayMs <= 0) {
      startProcess();
      return;
    }

    this.spawnTimer = setTimeout(() => {
      this.spawnTimer = null;
      startProcess();
    }, delayMs);
  }

  previewBeforeRun(runId: string): number {
    const firstHighlightIndex = this.findFirstHighlightableStepIndex();

    if (firstHighlightIndex < 0) {
      return 0;
    }

    const hasPriorScreenStep = this.steps
      .slice(0, firstHighlightIndex)
      .some((step) => isScreenChangingStep(step));

    if (hasPriorScreenStep) {
      return 0;
    }

    this.showStepHighlight(runId, this.steps[firstHighlightIndex].label);
    return PRE_RUN_HIGHLIGHT_DELAY_MS;
  }

  resolveSource(runId: string, source: string): void {
    if (this.activeRunId !== runId) {
      return;
    }

    if (isRunFlowDescription(source)) {
      void this.handleRunFlowRunning(runId, source);
      return;
    }

    if (!parseMaestroHighlightTarget(source)) {
      return;
    }

    if (this.inSubflow) {
      this.syncSubflowStepIndexFromSource(source);
    }

    if (
      this.highlightedSource &&
      normalizeMatchText(this.highlightedSource) === normalizeMatchText(source)
    ) {
      return;
    }

    if (this.inSubflow) {
      void refreshMaestroHierarchySnapshot();
    } else {
      void prefetchMaestroHierarchySnapshot();
    }

    this.showStepHighlight(runId, source, this.inSubflow);
  }

  handleChunk(runId: string, chunk: string): void {
    if (this.activeRunId !== runId) {
      return;
    }

    for (const line of chunk.split('\n')) {
      const trimmed = cleanMaestroOutputLine(line);

      if (!trimmed) {
        continue;
      }

      const parsedStatus = parseMaestroStdoutStatus(trimmed);

      if (!parsedStatus) {
        continue;
      }

      const { description, status } = parsedStatus;

      if (status === 'FAILED') {
        continue;
      }

      if (status === 'COMPLETED') {
        void prefetchMaestroHierarchySnapshot();
        this.onStepCompleted(runId, description);
        continue;
      }

      if (isRunFlowDescription(description)) {
        void this.handleRunFlowRunning(runId, description);
        continue;
      }

      if (status !== 'RUNNING') {
        continue;
      }

      this.resolveSource(runId, description);
    }
  }

  private resetSubflowState(): void {
    this.inSubflow = false;
    this.subflowSteps = [];
    this.subflowStepIndex = -1;
    this.runFlowEntrySource = null;
    this.subflowPrepareTask = null;
  }

  private clearHighlight(runId: string): void {
    this.highlightedSource = null;
    this.emit({ runId, clear: true });
  }

  private handleRunFlowRunning(runId: string, description: string): void {
    const normalizedDescription = normalizeMatchText(description);

    if (
      this.subflowPrepareTask &&
      this.runFlowEntrySource &&
      normalizeMatchText(this.runFlowEntrySource) === normalizedDescription
    ) {
      return;
    }

    this.runFlowEntrySource = description;
    this.subflowPrepareTask = this.enterSubflow(runId, description).finally(() => {
      this.subflowPrepareTask = null;
    });
  }

  private async enterSubflow(runId: string, description: string): Promise<void> {
    this.clearHighlight(runId);
    this.highlightedSource = null;

    const stepLabel = this.findRunFlowStepLabel(description);
    const subflowPath = resolveRunFlowAbsolutePath(this.context, description, stepLabel ?? undefined);

    if (!subflowPath) {
      await refreshMaestroHierarchySnapshot();
      return;
    }

    const subflowSteps = resolveMaestroStepsAtPath(subflowPath);
    const firstIndex = this.findFirstSubflowHighlightIndex();

    if (firstIndex < 0) {
      return;
    }

    this.inSubflow = true;
    this.subflowSteps = subflowSteps;
    this.subflowStepIndex = -1;

    for (let attempt = 0; attempt < RUN_FLOW_HIGHLIGHT_MAX_ATTEMPTS; attempt += 1) {
      if (this.activeRunId !== runId || !this.inSubflow) {
        return;
      }

      await refreshMaestroHierarchySnapshot();
      refreshPrecomputedHighlightsForSteps(subflowSteps);

      const step = subflowSteps[firstIndex];
      const highlight = await resolveMaestroHighlight(runId, step.label, { forceFresh: true });

      if (highlight && this.activeRunId === runId && this.inSubflow) {
        this.subflowStepIndex = firstIndex;
        this.highlightedSource = step.label;
        this.emit(highlight);
        return;
      }

      await sleep(RUN_FLOW_HIGHLIGHT_RETRY_MS);
    }
  }

  private onStepCompleted(runId: string, description: string): void {
    const completedIndex = this.findStepIndexByDescription(description);

    if (
      completedIndex >= 0 &&
      isRunFlowDescription(this.steps[completedIndex]?.label ?? '')
    ) {
      this.resetSubflowState();
      return;
    }

    if (this.inSubflow) {
      if (completedIndex < 0) {
        void this.advanceSubflowHighlight(runId);
      }

      return;
    }

    if (completedIndex < 0) {
      return;
    }

    const nextHighlightIndex = this.findNextHighlightableStepIndex(completedIndex);

    if (nextHighlightIndex < 0) {
      return;
    }

    const nextStep = this.steps[nextHighlightIndex];

    if (isRunFlowDescription(nextStep.label)) {
      void this.handleRunFlowRunning(runId, nextStep.label);
      return;
    }

    this.showStepHighlight(runId, nextStep.label);

    void prefetchMaestroHierarchySnapshot().then(() => {
      if (this.activeRunId !== runId) {
        return;
      }

      refreshPrecomputedHighlightsForSteps(this.steps, nextHighlightIndex);
      this.showStepHighlight(runId, nextStep.label);
    });
  }

  private async advanceSubflowHighlight(runId: string): Promise<void> {
    const nextIndex = this.findNextSubflowHighlightIndex(this.subflowStepIndex);

    if (nextIndex < 0) {
      return;
    }

    await refreshMaestroHierarchySnapshot();
    refreshPrecomputedHighlightsForSteps(this.subflowSteps, nextIndex);
    this.subflowStepIndex = nextIndex;
    this.showStepHighlight(runId, this.subflowSteps[nextIndex].label, true);
  }

  private showStepHighlight(runId: string, source: string, forceFresh = false): void {
    if (this.activeRunId !== runId) {
      return;
    }

    if (!parseMaestroHighlightTarget(source)) {
      return;
    }

    if (!forceFresh) {
      const immediate = takePrecomputedMaestroHighlight(runId, source);

      if (immediate) {
        this.highlightedSource = source;
        this.emit(immediate);
        return;
      }
    }

    const currentRunId = runId;

    void resolveMaestroHighlight(currentRunId, source, { forceFresh }).then((highlight) => {
      if (!highlight || this.activeRunId !== currentRunId) {
        return;
      }

      this.highlightedSource = source;
      this.emit(highlight);
    });
  }

  private syncSubflowStepIndexFromSource(source: string): void {
    const normalizedSource = normalizeMatchText(source);
    const quotedMatch = source.match(/"([^"]+)"/);
    const quotedFragment = quotedMatch ? normalizeMatchText(quotedMatch[1]) : '';

    for (let index = 0; index < this.subflowSteps.length; index += 1) {
      const normalizedLabel = normalizeMatchText(this.subflowSteps[index].label);

      if (
        normalizedLabel === normalizedSource ||
        normalizedSource.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedSource) ||
        (quotedFragment && normalizedLabel.includes(quotedFragment))
      ) {
        this.subflowStepIndex = index;
        return;
      }
    }
  }

  private findRunFlowStepLabel(description: string): string | null {
    const matchedIndex = this.findStepIndexByDescription(description);

    if (matchedIndex >= 0) {
      return this.steps[matchedIndex]?.label ?? null;
    }

    const yamlPath = extractRunFlowRelativePath(description);
    const runFlowSteps = this.steps.filter((step) => getStepCommandKey(step.label) === 'runflow');

    if (yamlPath) {
      const baseName = basenameWithoutExtension(yamlPath);
      const match = runFlowSteps.find((step) =>
        normalizeMatchText(step.label).includes(baseName.slice(0, Math.max(6, baseName.length))),
      );

      if (match) {
        return match.label;
      }
    }

    if (runFlowSteps.length === 1) {
      return runFlowSteps[0].label;
    }

    return runFlowSteps[runFlowSteps.length - 1]?.label ?? null;
  }

  private findFirstHighlightableStepIndex(): number {
    return this.steps.findIndex((step) => isInteractiveHighlightSource(step.label));
  }

  private findFirstSubflowHighlightIndex(): number {
    return this.subflowSteps.findIndex((step) => isInteractiveHighlightSource(step.label));
  }

  private findNextSubflowHighlightIndex(fromIndex: number): number {
    for (let index = fromIndex + 1; index < this.subflowSteps.length; index += 1) {
      if (isInteractiveHighlightSource(this.subflowSteps[index].label)) {
        return index;
      }
    }

    return -1;
  }

  private findNextHighlightableStepIndex(fromIndex: number): number {
    for (let index = fromIndex + 1; index < this.steps.length; index += 1) {
      if (isInteractiveHighlightSource(this.steps[index].label) || isRunFlowDescription(this.steps[index].label)) {
        return index;
      }
    }

    return -1;
  }

  private findStepIndexByDescription(description: string): number {
    const normalizedDescription = normalizeMatchText(description);

    if (!normalizedDescription) {
      return -1;
    }

    const quotedMatch = description.match(/"([^"]+)"/);
    const quotedFragment = quotedMatch ? normalizeMatchText(quotedMatch[1]) : '';
    const yamlPath = extractRunFlowRelativePath(description);
    const yamlBase = yamlPath ? basenameWithoutExtension(yamlPath) : '';

    for (let index = 0; index < this.steps.length; index += 1) {
      const normalizedLabel = normalizeMatchText(this.steps[index].label);

      if (quotedFragment && normalizedLabel.includes(quotedFragment)) {
        return index;
      }

      if (yamlBase && normalizedLabel.includes(yamlBase.slice(0, Math.max(6, yamlBase.length)))) {
        return index;
      }

      if (
        normalizedLabel.includes(normalizedDescription) ||
        normalizedDescription.includes(normalizedLabel)
      ) {
        return index;
      }
    }

    return -1;
  }

  private clearSpawnTimer(): void {
    if (this.spawnTimer) {
      clearTimeout(this.spawnTimer);
      this.spawnTimer = null;
    }
  }
}
