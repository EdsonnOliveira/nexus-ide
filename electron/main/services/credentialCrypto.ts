import { safeStorage } from 'electron';

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
        return safeStorage.decryptString(buffer);
      } catch {
        const plain = buffer.toString('utf8');

        if (plain && /^[\x20-\x7E]+$/.test(plain)) {
          return plain;
        }

        return null;
      }
    }

    return buffer.toString('utf8');
  } catch {
    return null;
  }
}
