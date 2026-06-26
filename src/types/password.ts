export type PasswordFieldAction = 'none' | 'tab' | 'enter';

export interface PasswordField {
  id: string;
  label: string;
  action?: PasswordFieldAction;
}

export interface PasswordCollection {
  id: string;
  name: string;
  fields: PasswordField[];
  browserAutofillEnabled?: boolean;
  browserUrl?: string | null;
}

export type PasswordFieldValues = Record<string, string>;

export interface PasswordInputFocusPayload {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export const PASSWORD_FOCUS_CONSOLE_PREFIX = '__NEXUS_PW_FOCUS__';
