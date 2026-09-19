import { safeStorage } from 'electron';

const SAFE_STORAGE_PREFIX = 'v10';

function isPrintableSecret(value: string): boolean {
  return value.length > 0 && /^[\x20-\x7E]+$/.test(value);
}

export function isPlainCredentialSecret(value: string): boolean {
  const trimmed = value.trim();
  return isPrintableSecret(trimmed) && !trimmed.startsWith(SAFE_STORAGE_PREFIX);
}

export function encryptCredentialValue(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64');
  }

  return Buffer.from(value, 'utf8').toString('base64');
}

export function decryptCredentialValue(value: string): string | null {
  const buffer = Buffer.from(value, 'base64');

  try {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decrypted = safeStorage.decryptString(buffer);
        return isPlainCredentialSecret(decrypted) ? decrypted : null;
      } catch {
        const plain = buffer.toString('utf8');
        return isPlainCredentialSecret(plain) ? plain : null;
      }
    }

    const plain = buffer.toString('utf8');
    return isPlainCredentialSecret(plain) ? plain : null;
  } catch {
    return null;
  }
}
