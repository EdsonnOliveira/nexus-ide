import type { PasswordCollection, PasswordField } from '@/types/password';

export function summarizePasswordFields(fields: PasswordField[]): string {
  if (fields.length === 0) {
    return 'Nenhum campo';
  }

  return fields.map((field) => field.label.trim() || 'Campo').join(', ');
}

export function summarizePasswordCollectionMeta(collection: PasswordCollection): string {
  const fieldsSummary = summarizePasswordFields(collection.fields);

  if (collection.browserAutofillEnabled && collection.browserUrl?.trim()) {
    return `${fieldsSummary} · ${collection.browserUrl.trim()}`;
  }

  return fieldsSummary;
}

export function isSensitivePasswordFieldLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();

  return (
    normalized.includes('senha') ||
    normalized.includes('password') ||
    normalized.includes('token') ||
    normalized.includes('secret')
  );
}

export function formatPasswordCollectionClipboard(
  fields: PasswordField[],
  values: Record<string, string>,
): string {
  return fields
    .map((field) => {
      const label = field.label.trim() || 'Campo';
      return `${label}: ${values[field.id] ?? ''}`;
    })
    .join('\n');
}
