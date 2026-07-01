import type { AgentActivity, AgentActivityKind, AgentTurn } from '@/types';
import { computeAgentTurnSummaryFromActivities } from '@/utils/agentTurnSummary';
import {
  isAgentLiveStatusFragment,
  isAgentLiveStatusLine,
  isAgentToolSummaryLine,
  isUserPromptEchoLine,
  normalizeAgentTranscriptRawLine,
  sanitizeAgentTranscriptLine,
  stripAgentLiveStatusLabel,
  stripAgentSpinnerPrefix,
} from '@/utils/agentCliSession';

const SLASH_SKILL_LINE = /^\/[\w-]+(?:\s|$)/;
const NO_MATCHES_LINE = /^No matches$/i;
const SLASH_ECHO_LINE = /^\/agent[\w-]*/i;

const SECTION_LABELS = new Set(['Editing', 'Reading', 'Grepping', 'Searching', 'Planning', 'Working', 'Generating']);

const TOOL_ACTIVITY_KINDS = new Set<AgentActivityKind>(['file_edit', 'file_read', 'status', 'section']);

function createActivity(
  kind: AgentActivityKind,
  label: string,
  extra: Partial<AgentActivity> = {},
): AgentActivity {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    createdAt: Date.now(),
    ...extra,
  };
}

function isNoiseLine(line: string): boolean {
  const trimmed = prepareParserLine(line);

  if (!trimmed) {
    return true;
  }

  return sanitizeAgentTranscriptLine(trimmed) === null;
}

function isAgentProseLine(line: string): boolean {
  const sanitized = sanitizeAgentTranscriptLine(line);

  if (!sanitized) {
    return false;
  }

  if (sanitized.length < 24) {
    return false;
  }

  if (/^[\w./\\-]+%?\s*$/.test(sanitized)) {
    return false;
  }

  return /[a-záàâãéêíóôõúçA-Z]{3,}/.test(sanitized);
}

export function detectSlashAutocompleteInTail(tail: string): boolean {
  if (NO_MATCHES_LINE.test(tail.trim()) || /\bNo matches\b/i.test(tail)) {
    return true;
  }

  if (/\bRun Everything\b/i.test(tail) && !/\b(Reading|Edited|Planning next moves)\b/i.test(tail)) {
    return true;
  }

  const slashLines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => SLASH_SKILL_LINE.test(line));

  return slashLines.length >= 3;
}

function prepareParserLine(line: string): string {
  return stripAgentSpinnerPrefix(normalizeAgentTranscriptRawLine(line));
}

function parseEditedLine(line: string): AgentActivity | null {
  const normalized = prepareParserLine(line);
  const match = normalized.match(/^(?:Edited|Wrote)\s+(.+?)(?:\s+\+(\d+)\s+-(\d+))?$/i);

  if (!match) {
    return null;
  }

  return createActivity('file_edit', 'Edited', {
    filePath: match[1]?.trim(),
    additions: match[2] ? Number(match[2]) : undefined,
    deletions: match[3] ? Number(match[3]) : undefined,
  });
}

export function isValidReadFileTarget(target: string): boolean {
  if (!target || target.length < 3) {
    return false;
  }

  if (isAgentLiveStatusLine(target) || isAgentToolSummaryLine(target) || isAgentLiveStatusFragment(target)) {
    return false;
  }

  if (/^[\d.]+\s*k?\s*tokens?$/i.test(target)) {
    return false;
  }

  if (/\b(?:globs?|greps?)\b/i.test(target)) {
    return false;
  }

  if (/^(?:Globbing|Globbed|Reading|Grepping|Grepped|Searching|Searched|Working|Generating)\b/i.test(target)) {
    return false;
  }

  if (/^(?:fi|src|glob|gre|globb|glo|rea|read|page|wor|work)$/i.test(target)) {
    return false;
  }

  if (/^[,.\s"'`]+$/.test(target)) {
    return false;
  }

  if (target.includes('*') && !/\*\.\w+/.test(target)) {
    return false;
  }

  if (target.length < 5 && !/[./\\]/.test(target) && !/\.\w+/.test(target)) {
    return false;
  }

  return true;
}

export function resolveAgentActivityFilePath(projectPath: string, filePath: string): string | null {
  const trimmed = filePath.trim();

  if (!trimmed || !isValidReadFileTarget(trimmed)) {
    return null;
  }

  const normalizedProject = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  let normalized = trimmed.replace(/\\/g, '/');

  if (normalized.startsWith('…') || normalized.startsWith('...')) {
    normalized = normalized.replace(/^(\.{3}|…)/, '').replace(/^\/+/, '');
    return `${normalizedProject}/${normalized}`;
  }

  if (normalized.startsWith('~/')) {
    const homeRoot = normalizedProject.match(/^(\/Users\/[^/]+)/)?.[1];

    if (!homeRoot) {
      return null;
    }

    return `${homeRoot}${normalized.slice(1)}`;
  }

  if (normalized.startsWith('~')) {
    const homeRoot = normalizedProject.match(/^(\/Users\/[^/]+)/)?.[1];

    if (!homeRoot) {
      return null;
    }

    return normalized.replace(/^~/, homeRoot);
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) {
    return normalized;
  }

  return `${normalizedProject}/${normalized.replace(/^\/+/, '')}`;
}

function normalizeReadFileTarget(rawTarget: string): string {
  let target = rawTarget.trim().replace(/^["'`]+|["'`]+$/g, '');
  const inMatch = target.match(/^(.+?)\s+"?\s*in\s+.+$/i);

  if (inMatch) {
    target = inMatch[1]?.trim() ?? target;
  }

  return target.replace(/^["'`]+|["'`]+$/g, '').trim();
}

function parseReadLine(line: string): AgentActivity | null {
  const normalized = prepareParserLine(line);
  const match = normalized.match(/^Read\s+(.+)$/i);

  if (!match) {
    return null;
  }

  const target = normalizeReadFileTarget(match[1]?.trim() ?? '');

  if (!isValidReadFileTarget(target)) {
    return null;
  }

  return createActivity('file_read', 'Read', {
    filePath: target,
  });
}

function parseExploredLine(line: string): AgentActivity | null {
  const normalized = prepareParserLine(line);
  const match = normalized.match(/^Explored\s+(.+)$/i);

  if (!match) {
    return null;
  }

  return createActivity('status', `Explored ${match[1]?.trim()}`);
}

function parseLiveStatus(line: string): AgentActivity | null {
  const normalized = prepareParserLine(line);

  if (!normalized || !isAgentLiveStatusLine(normalized)) {
    return null;
  }

  if (/^Planning next moves/i.test(normalized)) {
    return createActivity('live_status', 'Planning next moves');
  }

  const label = stripAgentLiveStatusLabel(normalized);

  return createActivity('live_status', label || 'Working');
}

export interface AgentTranscriptParserState {
  lineBuffer: string;
  hasToolActivity: boolean;
  thoughtStartedAt: number | null;
  sawAgentMarker: boolean;
  processedLineKeys: Set<string>;
  seenReadPaths: Set<string>;
}

export function createAgentTranscriptParserState(): AgentTranscriptParserState {
  return {
    lineBuffer: '',
    hasToolActivity: false,
    thoughtStartedAt: Date.now(),
    sawAgentMarker: false,
    processedLineKeys: new Set<string>(),
    seenReadPaths: new Set<string>(),
  };
}

export function createInitialTurnActivities(): AgentActivity[] {
  const startedAt = Date.now();

  return [
    createActivity('thought', '', {
      streaming: true,
      collapsed: false,
      createdAt: startedAt,
    }),
  ];
}

function markAgentMarker(state: AgentTranscriptParserState): void {
  state.sawAgentMarker = true;
}

function upsertFileRead(activities: AgentActivity[], activity: AgentActivity): AgentActivity[] {
  const filePath = activity.filePath?.trim().toLowerCase() ?? '';

  if (!filePath) {
    return activities;
  }

  const existing = activities.find(
    (entry) => entry.kind === 'file_read' && entry.filePath?.trim().toLowerCase() === filePath,
  );

  if (existing) {
    return activities;
  }

  return [...activities, activity];
}

function upsertLiveStatus(activities: AgentActivity[], activity: AgentActivity): AgentActivity[] {
  const existing = activities.find((entry) => entry.kind === 'live_status');
  const withoutLive = activities.filter((entry) => entry.kind !== 'live_status');

  return [
    ...withoutLive,
    {
      ...activity,
      id: existing?.id ?? activity.id,
    },
  ];
}

function ensureStreamingThought(
  activities: AgentActivity[],
  state: AgentTranscriptParserState,
): AgentActivity[] {
  const existing = activities.find((entry) => entry.kind === 'thought' && entry.streaming);

  if (existing) {
    return activities;
  }

  const startedAt = state.thoughtStartedAt ?? Date.now();
  state.thoughtStartedAt = startedAt;

  return [
    ...activities.filter((entry) => entry.kind !== 'live_status'),
    createActivity('thought', '', {
      streaming: true,
      collapsed: true,
      createdAt: startedAt,
    }),
  ];
}

function finalizeStreamingThought(
  activities: AgentActivity[],
  state: AgentTranscriptParserState,
): AgentActivity[] {
  const existing = activities.find((entry) => entry.kind === 'thought' && entry.streaming);

  if (!existing) {
    state.thoughtStartedAt = null;
    return activities;
  }

  const durationMs = state.thoughtStartedAt
    ? Math.max(Date.now() - state.thoughtStartedAt, 1000)
    : 1000;

  state.thoughtStartedAt = null;

  return activities.map((entry) =>
    entry.id === existing.id
      ? {
          ...entry,
          streaming: undefined,
          collapsed: true,
          durationMs,
        }
      : entry,
  );
}

function settleResponseStream(activities: AgentActivity[]): AgentActivity[] {
  return activities.map((entry) =>
    entry.kind === 'response' && entry.streaming ? { ...entry, streaming: undefined } : entry,
  );
}

function shouldStartNewResponseBlock(activities: AgentActivity[]): boolean {
  const last = activities[activities.length - 1];

  if (!last) {
    return true;
  }

  if (last.kind === 'response' && last.streaming) {
    return false;
  }

  if (last.kind === 'response' && !last.streaming) {
    return true;
  }

  if (TOOL_ACTIVITY_KINDS.has(last.kind)) {
    return true;
  }

  if (last.kind === 'thought' && !last.streaming) {
    return true;
  }

  return last.kind !== 'response';
}

function isResponseNoiseLine(line: string): boolean {
  return (
    isAgentLiveStatusLine(line) ||
    isAgentLiveStatusFragment(line) ||
    isAgentToolSummaryLine(line) ||
    /^\/[\w-]+\s*$/.test(line.trim())
  );
}

function isMarkdownFenceLine(line: string): boolean {
  return /^```/.test(line.trim());
}

function sanitizeResponseText(text: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const rawLine of text.split('\n')) {
    if (isResponseNoiseLine(rawLine)) {
      continue;
    }

    const sanitized = sanitizeAgentTranscriptLine(rawLine);

    if (!sanitized) {
      continue;
    }

    const key = sanitized.toLowerCase();

    if (!isMarkdownFenceLine(sanitized) && seen.has(key)) {
      continue;
    }

    if (!isMarkdownFenceLine(sanitized)) {
      seen.add(key);
    }

    lines.push(sanitized);
  }

  return lines.join('\n').trim();
}

function appendNarrative(
  activities: AgentActivity[],
  text: string,
  streaming: boolean,
): AgentActivity[] {
  if (isAgentLiveStatusLine(text) || isAgentLiveStatusFragment(text) || isAgentToolSummaryLine(text)) {
    return activities;
  }

  const sanitized = sanitizeAgentTranscriptLine(text) ?? sanitizeResponseText(text);

  if (
    !sanitized ||
    isAgentLiveStatusLine(sanitized) ||
    isAgentLiveStatusFragment(sanitized) ||
    isAgentToolSummaryLine(sanitized)
  ) {
    return activities;
  }

  const startNewBlock = shouldStartNewResponseBlock(activities);
  const last = activities[activities.length - 1];

  if (!startNewBlock && last?.kind === 'response' && last.streaming) {
    const separator = last.label.endsWith('\n') || !last.label ? '' : '\n';

    return activities.map((entry) =>
      entry.id === last.id
        ? { ...entry, label: `${entry.label}${separator}${sanitized}`.trim() }
        : entry,
    );
  }

  return [...settleResponseStream(activities), createActivity('response', sanitized, { streaming })];
}

function applyNarrativeLine(
  turn: AgentTurn,
  line: string,
  state: AgentTranscriptParserState,
  streaming: boolean,
): AgentTurn {
  if (isAgentLiveStatusLine(line) || isAgentLiveStatusFragment(line) || isAgentToolSummaryLine(line)) {
    return turn;
  }

  const sanitized = sanitizeAgentTranscriptLine(line);

  if (
    !sanitized ||
    isAgentLiveStatusLine(sanitized) ||
    isAgentLiveStatusFragment(sanitized) ||
    isAgentToolSummaryLine(sanitized)
  ) {
    return turn;
  }

  if (isUserPromptEchoLine(sanitized, turn.user.content)) {
    return turn;
  }

  if (!state.sawAgentMarker && !isAgentProseLine(sanitized)) {
    return turn;
  }

  markAgentMarker(state);

  let activities = [...turn.activities];

  activities = finalizeStreamingThought(activities, state);
  activities = activities.filter((entry) => entry.kind !== 'live_status');
  activities = appendNarrative(activities, sanitized, streaming);

  return { ...turn, activities };
}

function applyLineToTurn(
  turn: AgentTurn,
  line: string,
  state: AgentTranscriptParserState,
): AgentTurn {
  const trimmed = prepareParserLine(line);

  if (!trimmed || isUserPromptEchoLine(trimmed, turn.user.content)) {
    return turn;
  }

  if (isNoiseLine(trimmed)) {
    return turn;
  }

  const lineKey = trimmed.toLowerCase();

  if (state.processedLineKeys.has(lineKey)) {
    return turn;
  }

  state.processedLineKeys.add(lineKey);

  const normalized = trimmed;
  let activities = [...turn.activities];
  const edited = parseEditedLine(trimmed);
  const read = parseReadLine(trimmed);
  const explored = parseExploredLine(trimmed);
  const live = parseLiveStatus(trimmed);
  const section = SECTION_LABELS.has(normalized) ? createActivity('section', normalized) : null;

  if (/^Thinking/i.test(normalized)) {
    markAgentMarker(state);
    activities = activities.filter((entry) => entry.kind !== 'live_status');
    activities = ensureStreamingThought(activities, state);
    return { ...turn, activities };
  }

  if (edited || read || explored || section) {
    if (read && !edited && !explored && !section) {
      const readKey = read.filePath?.trim().toLowerCase() ?? '';

      if (readKey && state.seenReadPaths.has(readKey)) {
        return turn;
      }
    }

    markAgentMarker(state);
    activities = finalizeStreamingThought(activities, state);
    activities = settleResponseStream(activities);
    activities = activities.filter((entry) => entry.kind !== 'live_status');
    state.hasToolActivity = true;

    if (edited) {
      activities = [...activities, edited];
    }

    if (read) {
      const readKey = read.filePath?.trim().toLowerCase() ?? '';

      if (readKey && !state.seenReadPaths.has(readKey)) {
        state.seenReadPaths.add(readKey);
        activities = upsertFileRead(activities, read);
      }
    }

    if (explored) {
      activities = [...activities, explored];
    }

    if (section) {
      activities = [...activities, section];
    }

    return { ...turn, activities };
  }

  if (live) {
    markAgentMarker(state);
    activities = upsertLiveStatus(activities, live);
    activities = ensureStreamingThought(activities, state);
    return { ...turn, activities };
  }

  if (turn.running) {
    return { ...turn, activities };
  }

  return applyNarrativeLine(turn, trimmed, state, true);
}

export function feedAgentTranscriptChunk(
  turn: AgentTurn,
  chunk: string,
  state: AgentTranscriptParserState,
): AgentTurn {
  const combined = `${state.lineBuffer}${chunk}`.replace(/\r/g, '\n');
  const parts = combined.split('\n');
  state.lineBuffer = parts.pop() ?? '';

  let nextTurn = turn;

  for (const line of parts) {
    nextTurn = applyLineToTurn(nextTurn, line, state);
  }

  if (state.lineBuffer.trim() && !turn.running) {
    const partial = prepareParserLine(state.lineBuffer);

    if (partial && !isNoiseLine(partial) && !isAgentLiveStatusFragment(partial)) {
      nextTurn = applyLineToTurn(nextTurn, partial, state);
    }
  }

  return nextTurn;
}

function splitResponseActivity(activity: AgentActivity): AgentActivity[] {
  const cleaned = sanitizeResponseText(activity.label);

  if (!cleaned) {
    return [];
  }

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return [{ ...activity, label: cleaned, streaming: undefined }];
  }

  return paragraphs.map((paragraph) =>
    createActivity('response', paragraph, {
      createdAt: activity.createdAt,
      streaming: undefined,
    }),
  );
}

function dedupeFileReadActivities(activities: AgentActivity[]): AgentActivity[] {
  const seen = new Set<string>();

  return activities.filter((activity) => {
    if (activity.kind !== 'file_read') {
      return true;
    }

    const key = activity.filePath?.trim().toLowerCase() ?? activity.label.trim().toLowerCase();

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function postProcessActivities(activities: AgentActivity[]): AgentActivity[] {
  const processed: AgentActivity[] = [];

  for (const activity of activities) {
    if (activity.kind === 'live_status' || activity.kind === 'section') {
      continue;
    }

    if (activity.kind === 'file_read') {
      const target = activity.filePath?.trim() ?? '';

      if (!isValidReadFileTarget(target)) {
        continue;
      }
    }

    if (activity.kind !== 'response') {
      processed.push(activity);
      continue;
    }

    processed.push(...splitResponseActivity(activity));
  }

  return dedupeFileReadActivities(processed);
}

function mergeResponseActivities(activities: AgentActivity[]): AgentActivity[] {
  const responses = activities.filter((entry) => entry.kind === 'response');

  if (responses.length <= 1) {
    return activities;
  }

  const mergedLabel = responses
    .map((entry) => sanitizeResponseText(entry.label))
    .filter(Boolean)
    .join('\n\n');

  if (!mergedLabel) {
    return activities.filter((entry) => entry.kind !== 'response');
  }

  const other = activities.filter((entry) => entry.kind !== 'response');

  return [
    ...other,
    createActivity('response', mergedLabel, {
      createdAt: responses[0]?.createdAt,
      streaming: undefined,
    }),
  ];
}

export function finalizeAgentTurn(turn: AgentTurn, state: AgentTranscriptParserState): AgentTurn {
  let activities = finalizeStreamingThought(turn.activities, state);
  activities = settleResponseStream(activities);

  if (state.lineBuffer.trim()) {
    const flushed = applyLineToTurn({ ...turn, activities }, state.lineBuffer, state);
    activities = flushed.activities;
    state.lineBuffer = '';
  }

  activities = activities
    .filter((entry) => entry.kind !== 'live_status')
    .map((entry) => {
      if (entry.kind === 'thought' && entry.streaming) {
        return {
          ...entry,
          streaming: undefined,
          collapsed: true,
          durationMs: entry.durationMs ?? Math.max(Date.now() - turn.startedAt, 1000),
        };
      }

      if (entry.kind === 'response') {
        return { ...entry, streaming: undefined };
      }

      if (entry.kind === 'thought' && turn.running) {
        return { ...entry, collapsed: true };
      }

      return entry;
    });

  activities = postProcessActivities(activities);
  activities = mergeResponseActivities(activities);

  const summary = computeAgentTurnSummaryFromActivities(activities);

  activities = activities.filter((entry) => {
    if (entry.kind === 'status') {
      return Boolean(entry.label.trim());
    }

    return entry.kind === 'response' && sanitizeResponseText(entry.label).length > 0;
  });

  return {
    ...turn,
    activities,
    ...(summary ? { summary } : {}),
    running: false,
    completedAt: Date.now(),
  };
}

function extractResponseBlocksFromAgentOutput(
  output: string,
  userPrompt: string,
): AgentActivity[] {
  const lines = output.split('\n');
  const promptIndex = lines.findIndex((line) => {
    const sanitized = sanitizeAgentTranscriptLine(line) ?? line.trim();
    return sanitized.includes(userPrompt) || userPrompt.includes(sanitized);
  });
  const candidateLines = promptIndex === -1 ? lines : lines.slice(promptIndex + 1);
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  const flushBlock = () => {
    const text = currentBlock.join('\n').trim();

    if (text) {
      blocks.push(text);
    }

    currentBlock = [];
  };

  for (const rawLine of candidateLines) {
    const sanitized = sanitizeAgentTranscriptLine(rawLine);

    if (!sanitized) {
      if (currentBlock.length > 0) {
        flushBlock();
      }

      continue;
    }

    if (
      isAgentLiveStatusLine(sanitized) ||
      /^(?:Edited|Wrote|Read|Reading|Grepping|Searching|Explored|Planning|Working|Thinking|Editing)/i.test(
        sanitized,
      )
    ) {
      flushBlock();
      continue;
    }

    currentBlock.push(sanitized);
  }

  flushBlock();

  return blocks
    .map((block) => sanitizeResponseText(block))
    .filter((block) => block.length >= 8)
    .map((block) => createActivity('response', block));
}

export function rebuildTurnFromAgentOutput(turn: AgentTurn, output: string): AgentTurn {
  if (!output.trim()) {
    return turn;
  }

  const state = createAgentTranscriptParserState();
  let nextTurn: AgentTurn = {
    ...turn,
    activities: createInitialTurnActivities(),
    running: false,
  };

  nextTurn = feedAgentTranscriptChunk(nextTurn, output, state);

  if (state.lineBuffer.trim()) {
    nextTurn = feedAgentTranscriptChunk(nextTurn, '\n', state);
  }

  const hasResponse = nextTurn.activities.some((entry) => entry.kind === 'response');

  if (!hasResponse) {
    const extracted = extractResponseBlocksFromAgentOutput(output, turn.user.content);

    if (extracted.length > 0) {
      nextTurn = {
        ...nextTurn,
        activities: [...nextTurn.activities.filter((entry) => entry.kind !== 'response'), ...extracted],
      };
    }
  }

  return finalizeAgentTurn({ ...nextTurn, running: true }, state);
}

export function migrateMessagesToTurns(
  messages: Array<{ id: string; role: string; content: string; createdAt: number }>,
): AgentTurn[] {
  const turns: AgentTurn[] = [];
  let pendingUser: AgentTurn['user'] | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      pendingUser = {
        id: message.id,
        role: 'user',
        content: message.content,
        createdAt: message.createdAt,
      };
      continue;
    }

    if (message.role === 'assistant' && pendingUser) {
      turns.push({
        id: crypto.randomUUID(),
        user: pendingUser,
        activities: [
          createActivity('response', message.content, {
            createdAt: message.createdAt,
          }),
        ],
        running: false,
        startedAt: message.createdAt,
        completedAt: message.createdAt,
      });
      pendingUser = null;
    }
  }

  if (pendingUser) {
    turns.push({
      id: crypto.randomUUID(),
      user: pendingUser,
      activities: [],
      running: false,
      startedAt: pendingUser.createdAt,
    });
  }

  return turns;
}

export { sanitizeResponseText };
