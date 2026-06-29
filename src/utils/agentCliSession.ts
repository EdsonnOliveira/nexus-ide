import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { cleanAgentPtyChunk } from '@/utils/stripAnsi';

const AGENT_PROMPT_ECHO = /^(?:->|→|›|◆|>|❯|»|▶)\s+/;
const AGENT_PATH_LINE = /^~\/|^\/(?:Users|home|var|tmp|opt|dev|\w)/i;
const AGENT_MODE_LINE = /^(Auto|Agent|Plan|Debug|Ask|Multitask)(?:\s*·|\s|$)/i;
const AGENT_APPROVAL_LINE =
  /^(Run Everything|Run All|Allow once|Allow all|Approve|Continue|Review)$/i;
const SPINNER_PREFIX = /^[\s\u2800-\u28FF.:]+/;

export function stripAgentSpinnerPrefix(line: string): string {
  return line
    .replace(SPINNER_PREFIX, '')
    .replace(/^\.{1,3}\s*/, '')
    .replace(/^:+/, '')
    .trim();
}

function stripAgentLineLeadIn(line: string): string {
  return line.replace(/^[^A-Za-zÀ-ú*./\\~]+/, '').trim();
}

const AGENT_LIVE_STATUS_PREFIX =
  /^(?:Planning next moves|Planning|Globbing|Globbed|Grepping|Grepped|Searching|Searched|Working|Generating|Reading|Running|Thinking|Editing|Explored)(?:\s|,|$)/i;

const AGENT_LIVE_STATUS_FRAGMENT =
  /^(?:Planning next moves|Planning|Globbing|Globbed|Grepping|Grepped|Searching|Searched|Working|Generating|Reading|Running|Thinking|Editing|Explored|Glo(?:bb?(?:ing|ed)?)?|Gre(?:pp?(?:ing|ed)?)?|Read(?:ing)?|Work(?:ing)?|Globb?|Glob|Gre|Rea|Wor)$/i;

const AGENT_TOKEN_COUNT_LINE = /^[\d.]+\s*k?\s*tokens?\b/i;

const AGENT_TOKEN_COUNT_ANYWHERE = /\b[\d.]+\s*k?\s*tokens?\b/i;

const AGENT_TOOL_PROGRESS_LINE =
  /\b(?:globbing|globbed|reading|grepping|grepped|searching|searched)\b.*\b(?:globs?|files?|greps?)\b/i;

function prepareAgentLiveStatusLine(line: string): string {
  return stripAgentLineLeadIn(stripAgentSpinnerPrefix(normalizeAgentTranscriptRawLine(line)));
}

export function isAgentToolSummaryLine(line: string): boolean {
  const sanitized = prepareAgentLiveStatusLine(line);

  if (!sanitized) {
    return true;
  }

  if (AGENT_TOOL_PROGRESS_LINE.test(sanitized)) {
    return true;
  }

  if (/\b(?:globbing|reading|grepping|globbed|read|grepped),?\s+(?:globbing|reading|grepping|globbed|read|grepped)/i.test(sanitized)) {
    return true;
  }

  return false;
}

export function isAgentLiveStatusLine(line: string): boolean {
  const sanitized = prepareAgentLiveStatusLine(line);

  if (!sanitized) {
    return true;
  }

  if (isAgentToolSummaryLine(sanitized)) {
    return true;
  }

  if (AGENT_TOKEN_COUNT_LINE.test(sanitized)) {
    return true;
  }

  if (AGENT_TOKEN_COUNT_ANYWHERE.test(sanitized) && AGENT_LIVE_STATUS_PREFIX.test(sanitized)) {
    return true;
  }

  if (/^[\d;]+m$/i.test(sanitized)) {
    return true;
  }

  if (AGENT_LIVE_STATUS_PREFIX.test(sanitized)) {
    return true;
  }

  if (/^(?:Globbing|Globbed|Reading|Grepping|Grepped|Searching|Searched|Working|Generating|Running|Planning)\s+[\d.]+(?:k)?(?:\s*tokens?)?$/i.test(sanitized)) {
    return true;
  }

  if (/^(?:Globbing|Reading|Working|Grepping|Searching|Generating|Running|Planning)\b/i.test(sanitized) && AGENT_TOKEN_COUNT_ANYWHERE.test(sanitized)) {
    return true;
  }

  return false;
}

export function isAgentLiveStatusFragment(line: string): boolean {
  const sanitized = prepareAgentLiveStatusLine(line);

  if (!sanitized) {
    return true;
  }

  if (isAgentLiveStatusLine(sanitized) || isAgentToolSummaryLine(sanitized)) {
    return true;
  }

  if (sanitized.length <= 24 && AGENT_LIVE_STATUS_FRAGMENT.test(sanitized)) {
    return true;
  }

  if (sanitized.length <= 24 && /^(?:Globbing|Reading|Working|Grepping|Searching|Globbed|Grepped)/i.test(sanitized)) {
    return true;
  }

  return false;
}

export function stripAgentLiveStatusLabel(line: string): string {
  const sanitized = prepareAgentLiveStatusLine(line);

  return sanitized
    .replace(/\s+[\d.]+\s*k?\s*tokens?.*$/i, '')
    .replace(/,.*$/, '')
    .trim();
}

export function normalizeAgentTranscriptRawLine(line: string): string {
  let value = cleanAgentPtyChunk(line);
  value = value.replace(/\]0;[^\x07]*(?:\x07|$)?/g, '');
  value = value.replace(/^[\[\.:\s\u2800-\u28FF]+/, '');
  value = value.replace(/^[0-9]+(?:;[0-9]+)*m\s*/, '');
  return value.trim();
}

function isAgentChromeLine(trimmed: string): boolean {
  if (/^Tip:\s*/i.test(trimmed)) {
    return true;
  }

  if (/^\/run-everything\b/i.test(trimmed)) {
    return true;
  }

  if (/^Cursor Agent Tip:/i.test(trimmed)) {
    return true;
  }

  if (/^\]0;/.test(trimmed)) {
    return true;
  }

  if (/^Auto\s*·/.test(trimmed)) {
    return true;
  }

  if (/^Auto\s+\d+%/.test(trimmed)) {
    return true;
  }

  if (/^Run Everything$/i.test(trimmed)) {
    return true;
  }

  if (/^Auto\b.*\bRun Everything\b/i.test(trimmed)) {
    return true;
  }

  if (/^[\[\.:\s\u2800-\u28FFKk]{2,}$/.test(trimmed)) {
    return true;
  }

  if (/^\.{3}\s*\d+\s*earlier/i.test(trimmed)) {
    return true;
  }

  if (/^;+$/.test(trimmed)) {
    return true;
  }

  if (/^A\s*:\s*:\s*$/.test(trimmed)) {
    return true;
  }

  return false;
}

export function isCursorAgentStreamJsonCli(cliAgent: string): boolean {
  return extractCliAgentCommand(cliAgent.trim() || 'cursor-agent') === 'cursor-agent';
}

export function shellEscapeSingleQuotes(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type CursorAgentPrintMode = 'plan' | 'ask';

export function resolveCursorAgentPrintMode(
  mode: string | null | undefined,
): CursorAgentPrintMode | undefined {
  if (mode === 'plan' || mode === 'ask') {
    return mode;
  }

  return undefined;
}

export interface AgentPrintPromptOptions {
  prompt: string;
  model?: string | null;
  mode?: CursorAgentPrintMode;
  continueSession?: boolean;
  autoReview?: boolean;
}

export function buildAgentSkillPrompt(skillCommand: string, context = ''): string {
  const command = skillCommand.trim().replace(/\n$/, '');
  const trimmedContext = context.trim();

  if (trimmedContext) {
    return `${command}\n\n${trimmedContext}`;
  }

  return `${command}\n\nApply this skill using the current project context.`;
}

export function buildAgentPrintPromptCommand(options: AgentPrintPromptOptions): string {
  const prompt = options.prompt.trim();

  if (!prompt) {
    return '';
  }

  const parts = ['cursor-agent', '-p', '--output-format', 'stream-json', '--trust', '--force'];

  if (options.continueSession) {
    parts.push('--continue');
  }

  if (options.mode) {
    parts.push('--mode', options.mode);
  }

  const model = options.model?.trim();

  if (model && model !== 'auto') {
    parts.push('--model', shellEscapeSingleQuotes(model));
  }

  if (options.autoReview) {
    parts.push('--auto-review');
  }

  parts.push(shellEscapeSingleQuotes(prompt));

  return `${parts.join(' ')} 2>&1 | cat`;
}

export function buildAgentPaneLaunchCommand(command: string): string {
  const trimmed = command.trim();
  const base = extractCliAgentCommand(trimmed || 'cursor-agent');

  if (base === 'cursor-agent') {
    return '';
  }

  if (!trimmed) {
    return 'cursor-agent --force';
  }

  return trimmed;
}

const SHELL_ERROR_LINE =
  /^(?:zsh|bash|fish|sh):\s*.+(?:\s*:\s*)?command not found/i;

function normalizePromptEcho(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^o+(?=\s*[a-záàâãéêíóôõúç])/i, 'o')
    .trim();
}

export function isAgentShellNoiseLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.includes('NEXUS_CWD')) {
    return true;
  }

  if (SHELL_ERROR_LINE.test(trimmed)) {
    return true;
  }

  if (/^[\s]*[%#$]\s*$/.test(trimmed)) {
    return true;
  }

  if (/^[^\s]+ [%#$]\s*$/.test(trimmed)) {
    return true;
  }

  if (/^~(?:\/[^\s]*)?\s[%#$]\s*$/.test(trimmed)) {
    return true;
  }

  if (/%\s*$/.test(trimmed) && /\/.+\//.test(trimmed)) {
    return true;
  }

  if (/^(?:c+)?cursor-agent(?:\s|$)/i.test(trimmed)) {
    return true;
  }

  if (/^c{1,3}cur(?:sor)?(?:-|$)/i.test(trimmed)) {
    return true;
  }

  if (/^cursor-retrieval:/i.test(trimmed)) {
    return true;
  }

  if (/^Error:\s/i.test(trimmed)) {
    return true;
  }

  if (/~\/.*%\s+\S/.test(trimmed)) {
    return true;
  }

  return false;
}

export function isUserPromptEchoLine(line: string, userPrompt: string): boolean {
  const trimmed = line.trim();
  const prompt = userPrompt.trim();

  if (!trimmed || !prompt) {
    return false;
  }

  const normalizedLine = normalizePromptEcho(trimmed);
  const normalizedPrompt = normalizePromptEcho(prompt);

  if (normalizedLine === normalizedPrompt) {
    return true;
  }

  if (normalizedLine.includes(normalizedPrompt) || normalizedPrompt.includes(normalizedLine)) {
    return true;
  }

  if (normalizedLine.replace(/^o+/, '') === normalizedPrompt.replace(/^o+/, '')) {
    return true;
  }

  return false;
}

export function isAgentTuiNoiseLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  if (isAgentShellNoiseLine(trimmed)) {
    return true;
  }

  if (AGENT_PROMPT_ECHO.test(trimmed)) {
    return true;
  }

  if (AGENT_PATH_LINE.test(trimmed)) {
    return true;
  }

  if (AGENT_MODE_LINE.test(trimmed)) {
    return true;
  }

  if (AGENT_APPROVAL_LINE.test(trimmed)) {
    return true;
  }

  if (isAgentChromeLine(trimmed)) {
    return true;
  }

  if (isAgentLiveStatusLine(trimmed)) {
    return true;
  }

  if (isAgentToolSummaryLine(trimmed)) {
    return true;
  }

  if (isAgentLiveStatusFragment(trimmed)) {
    return true;
  }

  return false;
}

export function sanitizeAgentTranscriptLine(line: string): string | null {
  const trimmed = stripAgentSpinnerPrefix(normalizeAgentTranscriptRawLine(line));

  if (!trimmed) {
    return null;
  }

  if (isAgentShellNoiseLine(trimmed) || isAgentTuiNoiseLine(trimmed)) {
    return null;
  }

  return trimmed;
}

export function detectSmartModeApprovalInTail(tail: string): boolean {
  return (
    /\bRun Everything\b/i.test(tail) ||
    /\bRun All\b/i.test(tail) ||
    /\bAllow once\b/i.test(tail) ||
    /\bSmart Mode\b/i.test(tail)
  );
}

export function detectAgentLaunchErrorInTail(tail: string): string | null {
  const recent = tail.slice(-4096);

  if (/Error:\s*--trust can only be used/i.test(recent)) {
    return 'Não foi possível iniciar o agent — abra uma nova aba Agent';
  }

  const match = recent.match(/Error:\s*(.+)$/m);

  if (match && /(?:c+)?cursor-agent|cursor-retrieval/i.test(recent)) {
    return match[1]?.trim() ?? null;
  }

  return null;
}

export async function sendAgentInterruptSequence(
  write: (text: string) => void,
  gapMs = 80,
): Promise<void> {
  for (const sequence of ['\x03', '\x1b', '\x03', '\x15']) {
    write(sequence);
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, gapMs);
    });
  }
}
