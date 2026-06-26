export type AutomationStepType = 'terminal' | 'agent' | 'browser' | 'emulator' | 'api';

export type AutomationTrigger = 'manual' | 'interval' | 'app_open';

export type AutomationStepOpenMode = 'separate' | 'split-with-previous';

export type AutomationAgentMode = 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';

export type AutomationHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export interface AutomationStep {
  id: string;
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

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  intervalMinutes?: number;
  closeOpenTabsBeforeRun: boolean;
  defaultActiveStepId: string | null;
  steps: AutomationStep[];
}

export const AUTOMATION_MAX_STEPS = 64;

export const AUTOMATION_ACTION_DRAG_MIME = 'application/x-nexus-automation-action';

export const AUTOMATION_STEP_DRAG_MIME = 'application/x-nexus-automation-step';
