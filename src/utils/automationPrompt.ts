import type {
  Automation,
  AutomationAgentMode,
  AutomationHttpMethod,
  AutomationStep,
  AutomationStepOpenMode,
  AutomationStepType,
  AutomationTrigger,
} from '@/types/automation';
import { AUTOMATION_MAX_STEPS } from '@/types/automation';
import { normalizeAutomationSteps } from '@/utils/normalizeAutomation';

const PROMPT_VERSION = 1;

const STEP_TYPES: AutomationStepType[] = ['terminal', 'agent', 'browser', 'emulator', 'api'];
const TRIGGERS: AutomationTrigger[] = ['manual', 'interval', 'app_open'];
const AGENT_MODES: AutomationAgentMode[] = ['agent', 'plan', 'debug', 'multitask', 'ask'];
const OPEN_MODES: AutomationStepOpenMode[] = ['separate', 'split-with-previous'];
const HTTP_METHODS: AutomationHttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];
const PLATFORMS = ['android', 'ios'] as const;

export interface AutomationPromptStepV1 {
  type: AutomationStepType;
  title?: string;
  tabTitle?: string;
  pinned?: boolean;
  cwd?: string;
  command?: string;
  agentMode?: AutomationAgentMode;
  agentModel?: string;
  url?: string;
  platform?: 'android' | 'ios';
  deviceId?: string;
  autoStartEmulator?: boolean;
  method?: AutomationHttpMethod;
  headers?: string;
  body?: string;
  openMode?: AutomationStepOpenMode;
}

export interface AutomationPromptV1 {
  version: typeof PROMPT_VERSION;
  name: string;
  trigger: AutomationTrigger;
  intervalMinutes?: number;
  closeOpenTabsBeforeRun: boolean;
  defaultActiveStepIndex?: number;
  steps: AutomationPromptStepV1[];
}

export type AutomationPromptParseResult =
  | { ok: true; data: Omit<Automation, 'id'> }
  | { ok: false; error: string };

function stripStepForPrompt(step: AutomationStep): AutomationPromptStepV1 {
  const promptStep: AutomationPromptStepV1 = { type: step.type };

  if (step.title) {
    promptStep.title = step.title;
  }

  if (step.tabTitle) {
    promptStep.tabTitle = step.tabTitle;
  }

  if (step.pinned) {
    promptStep.pinned = step.pinned;
  }

  if (step.cwd) {
    promptStep.cwd = step.cwd;
  }

  if (step.command) {
    promptStep.command = step.command;
  }

  if (step.agentMode) {
    promptStep.agentMode = step.agentMode;
  }

  if (step.agentModel) {
    promptStep.agentModel = step.agentModel;
  }

  if (step.url) {
    promptStep.url = step.url;
  }

  if (step.platform) {
    promptStep.platform = step.platform;
  }

  if (step.deviceId) {
    promptStep.deviceId = step.deviceId;
  }

  if (step.autoStartEmulator === false) {
    promptStep.autoStartEmulator = false;
  }

  if (step.method && step.method !== 'GET') {
    promptStep.method = step.method;
  }

  if (step.headers) {
    promptStep.headers = step.headers;
  }

  if (step.body) {
    promptStep.body = step.body;
  }

  if (step.openMode && step.openMode !== 'separate') {
    promptStep.openMode = step.openMode;
  }

  return promptStep;
}

export function isAutomationStepEmpty(step: AutomationStep): boolean {
  return Object.keys(stripStepForPrompt(step)).length === 1;
}

export function serializeAutomationPrompt(automation: Automation): string {
  const payload: AutomationPromptV1 = {
    version: PROMPT_VERSION,
    name: automation.name,
    trigger: automation.trigger,
    closeOpenTabsBeforeRun: automation.closeOpenTabsBeforeRun,
    steps: automation.steps.map(stripStepForPrompt),
  };

  if (automation.trigger === 'interval' && automation.intervalMinutes) {
    payload.intervalMinutes = automation.intervalMinutes;
  }

  if (automation.defaultActiveStepId) {
    const defaultActiveStepIndex = automation.steps.findIndex(
      (step) => step.id === automation.defaultActiveStepId,
    );

    if (defaultActiveStepIndex >= 0) {
      payload.defaultActiveStepIndex = defaultActiveStepIndex;
    }
  }

  return JSON.stringify(payload, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`O campo "${field}" deve ser texto.`);
  }

  return value;
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`O campo "${field}" deve ser verdadeiro ou falso.`);
  }

  return value;
}

function parsePromptStep(raw: unknown, index: number): AutomationStep {
  if (!isRecord(raw)) {
    throw new Error(`A ação ${index + 1} é inválida.`);
  }

  const type = raw.type;

  if (typeof type !== 'string' || !STEP_TYPES.includes(type as AutomationStepType)) {
    throw new Error(`A ação ${index + 1} tem um tipo inválido.`);
  }

  const stepType = type as AutomationStepType;
  const step: AutomationStep = {
    id: crypto.randomUUID(),
    type: stepType,
  };

  const title = readOptionalString(raw.title, 'title');

  if (title) {
    step.title = title;
  }

  const tabTitle = readOptionalString(raw.tabTitle, 'tabTitle');

  if (tabTitle) {
    step.tabTitle = tabTitle;
  }

  const pinned = readOptionalBoolean(raw.pinned, 'pinned');

  if (pinned !== undefined) {
    step.pinned = pinned;
  }

  const cwd = readOptionalString(raw.cwd, 'cwd');

  if (cwd) {
    step.cwd = cwd;
  }

  const command = readOptionalString(raw.command, 'command');

  if (command) {
    step.command = command;
  }

  const agentMode = raw.agentMode;

  if (agentMode !== undefined && agentMode !== null) {
    if (typeof agentMode !== 'string' || !AGENT_MODES.includes(agentMode as AutomationAgentMode)) {
      throw new Error(`A ação ${index + 1} tem um modo de agent inválido.`);
    }

    step.agentMode = agentMode as AutomationAgentMode;
  }

  const agentModel = readOptionalString(raw.agentModel, 'agentModel');

  if (agentModel) {
    step.agentModel = agentModel;
  }

  const url = readOptionalString(raw.url, 'url');

  if (url) {
    step.url = url;
  }

  const platform = raw.platform;

  if (platform !== undefined && platform !== null) {
    if (typeof platform !== 'string' || !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
      throw new Error(`A ação ${index + 1} tem uma plataforma inválida.`);
    }

    step.platform = platform as 'android' | 'ios';
  }

  const deviceId = readOptionalString(raw.deviceId, 'deviceId');

  if (deviceId) {
    step.deviceId = deviceId;
  }

  const autoStartEmulator = readOptionalBoolean(raw.autoStartEmulator, 'autoStartEmulator');

  if (autoStartEmulator === false) {
    step.autoStartEmulator = false;
  }

  const method = raw.method;

  if (method !== undefined && method !== null) {
    if (typeof method !== 'string' || !HTTP_METHODS.includes(method as AutomationHttpMethod)) {
      throw new Error(`A ação ${index + 1} tem um método HTTP inválido.`);
    }

    step.method = method as AutomationHttpMethod;
  } else if (stepType === 'api') {
    step.method = 'GET';
  }

  const headers = readOptionalString(raw.headers, 'headers');

  if (headers) {
    step.headers = headers;
  }

  const body = readOptionalString(raw.body, 'body');

  if (body) {
    step.body = body;
  }

  const openMode = raw.openMode;

  if (openMode !== undefined && openMode !== null) {
    if (typeof openMode !== 'string' || !OPEN_MODES.includes(openMode as AutomationStepOpenMode)) {
      throw new Error(`A ação ${index + 1} tem uma disposição inválida.`);
    }

    step.openMode = openMode as AutomationStepOpenMode;
  }

  return step;
}

export function parseAutomationPrompt(text: string): AutomationPromptParseResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return { ok: false, error: 'Cole um prompt JSON válido.' };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'O prompt não é um JSON válido.' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'O prompt deve ser um objeto JSON.' };
  }

  if (parsed.version !== PROMPT_VERSION) {
    return { ok: false, error: 'Versão do prompt não suportada.' };
  }

  const name = parsed.name;

  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'O campo "name" é obrigatório.' };
  }

  const trigger = parsed.trigger;

  if (typeof trigger !== 'string' || !TRIGGERS.includes(trigger as AutomationTrigger)) {
    return { ok: false, error: 'O campo "trigger" é inválido.' };
  }

  const closeOpenTabsBeforeRun = parsed.closeOpenTabsBeforeRun;

  if (typeof closeOpenTabsBeforeRun !== 'boolean') {
    return { ok: false, error: 'O campo "closeOpenTabsBeforeRun" é obrigatório.' };
  }

  const stepsRaw = parsed.steps;

  if (!Array.isArray(stepsRaw)) {
    return { ok: false, error: 'O campo "steps" deve ser uma lista.' };
  }

  if (stepsRaw.length === 0) {
    return { ok: false, error: 'A automação precisa de pelo menos uma ação.' };
  }

  if (stepsRaw.length > AUTOMATION_MAX_STEPS) {
    return { ok: false, error: `A automação pode ter no máximo ${AUTOMATION_MAX_STEPS} ações.` };
  }

  let intervalMinutes: number | undefined;

  if (trigger === 'interval') {
    const rawInterval = parsed.intervalMinutes;

    if (typeof rawInterval !== 'number' || rawInterval < 1) {
      return { ok: false, error: 'O campo "intervalMinutes" deve ser maior que zero.' };
    }

    intervalMinutes = Math.floor(rawInterval);
  }

  try {
    const steps = normalizeAutomationSteps(stepsRaw.map((step, index) => parsePromptStep(step, index)));
    const rawDefaultActiveStepIndex = parsed.defaultActiveStepIndex;
    let defaultActiveStepId: string | null = null;

    if (typeof rawDefaultActiveStepIndex === 'number') {
      const stepIndex = Math.floor(rawDefaultActiveStepIndex);
      const matchedStep = steps[stepIndex];

      if (matchedStep) {
        defaultActiveStepId = matchedStep.id;
      }
    }

    return {
      ok: true,
      data: {
        name: name.trim(),
        trigger: trigger as AutomationTrigger,
        intervalMinutes,
        closeOpenTabsBeforeRun,
        defaultActiveStepId,
        steps,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Prompt inválido.',
    };
  }
}

export const AUTOMATION_PROMPT_PLACEHOLDER = `{
  "version": 1,
  "name": "INIT",
  "trigger": "manual",
  "closeOpenTabsBeforeRun": false,
  "steps": [
    { "type": "terminal", "command": "yarn dev" },
    { "type": "agent", "agentMode": "agent", "agentModel": "claude-4" },
    { "type": "browser", "url": "http://localhost:3000" }
  ]
}`;
