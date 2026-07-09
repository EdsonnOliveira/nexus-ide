export type TestRunnerKind = 'maestro' | 'jest' | 'vitest' | 'playwright' | 'detox';

export interface ProjectTestEntry {
  id: string;
  kind: TestRunnerKind;
  name: string;
  sourceName: string;
  targetPath: string;
  command?: string;
  addedAt: number;
}

export type TestStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface TestRunStep {
  id: string;
  label: string;
  line?: number;
  status: TestStepStatus;
}

export interface TestRunSnapshot {
  entryId: string;
  projectId: string;
  runId: string;
  status: 'idle' | 'preparing' | 'running' | 'passed' | 'failed';
  steps: TestRunStep[];
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export type MaestroTestHighlightKind =
  | 'tap'
  | 'doubleTap'
  | 'longPress'
  | 'assert'
  | 'input'
  | 'swipe';

export interface MaestroTestHighlightBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaestroTestHighlight {
  runId: string;
  deviceId: string;
  platform: 'ios' | 'android';
  kind: MaestroTestHighlightKind;
  label: string;
  bounds: MaestroTestHighlightBounds;
  screenWidth: number;
  screenHeight: number;
}

export type MaestroTestHighlightEvent =
  | MaestroTestHighlight
  | { runId: string; clear: true };

export interface DiscoveredTestTarget {
  kind: TestRunnerKind;
  relativePath: string;
  name: string;
  isDirectory: boolean;
}
