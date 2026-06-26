import type { ApiEnvironment } from '@/types/api';

export function substituteApiVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, rawName: string) => {
    const name = rawName.trim();
    return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : `{{${name}}}`;
  });
}

export function variablesFromEnvironment(environment: ApiEnvironment | null): Record<string, string> {
  if (!environment) {
    return {};
  }

  const variables: Record<string, string> = {};

  for (const entry of environment.variables) {
    if (entry.enabled && entry.key.trim()) {
      variables[entry.key.trim()] = entry.value;
    }
  }

  return variables;
}

export function renameApiVariableReference(text: string, oldName: string, newName: string): string {
  const escapedName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{\\{\\s*${escapedName}\\s*\\}\\}`, 'g');

  return text.replace(pattern, `{{${newName}}}`);
}
