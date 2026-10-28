import { execFileSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { app, safeStorage } from 'electron';

const SAFE_STORAGE_PREFIX = 'v10';
const KEYCHAIN_NAMES = ['Nexus', 'Nexus IDE', 'nexus-ide', 'Electron'] as const;
const KEYCHAIN_SALT = 'saltysalt';
const KEYCHAIN_ITERATIONS = 1003;
const KEYCHAIN_IV = Buffer.alloc(16, 0x20);

let cachedKeychainPasswords: string[] | null = null;

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

function readKeychainPassword(name: string): string | null {
  try {
    const password = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', `${name} Safe Storage`, '-a', `${name} Key`, '-w'],
      {
        encoding: 'utf8',
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();

    return password || null;
  } catch {
    return null;
  }
}

function readLegacyKeychainPasswords(): string[] {
  if (cachedKeychainPasswords) {
    return cachedKeychainPasswords;
  }

  if (process.platform !== 'darwin') {
    cachedKeychainPasswords = [];
    return cachedKeychainPasswords;
  }

  const names = new Set<string>(KEYCHAIN_NAMES);
  const appName = app.getName().trim();

  if (appName) {
    names.add(appName);
  }

  const passwords: string[] = [];

  for (const name of names) {
    const password = readKeychainPassword(name);

    if (password && !passwords.includes(password)) {
      passwords.push(password);
    }
  }

  cachedKeychainPasswords = passwords;
  return passwords;
}

function decryptChromiumSafeStorage(buffer: Buffer, password: string): string | null {
  if (buffer.length <= SAFE_STORAGE_PREFIX.length) {
    return null;
  }

  if (buffer.subarray(0, SAFE_STORAGE_PREFIX.length).toString('utf8') !== SAFE_STORAGE_PREFIX) {
    return null;
  }

  try {
    const key = pbkdf2Sync(password, KEYCHAIN_SALT, KEYCHAIN_ITERATIONS, 16, 'sha1');
    const decipher = createDecipheriv('aes-128-cbc', key, KEYCHAIN_IV);
    const plain = Buffer.concat([
      decipher.update(buffer.subarray(SAFE_STORAGE_PREFIX.length)),
      decipher.final(),
    ]).toString('utf8');

    return isPlainCredentialSecret(plain) ? plain : null;
  } catch {
    return null;
  }
}

function decryptWithLegacyKeychain(buffer: Buffer): string | null {
  for (const password of readLegacyKeychainPasswords()) {
    const plain = decryptChromiumSafeStorage(buffer, password);

    if (plain) {
      return plain;
    }
  }

  return null;
}

export function decryptCredentialValue(value: string): string | null {
  const buffer = Buffer.from(value, 'base64');

  try {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const decrypted = safeStorage.decryptString(buffer);

        if (isPlainCredentialSecret(decrypted)) {
          return decrypted;
        }
      } catch {
        const legacy = decryptWithLegacyKeychain(buffer);

        if (legacy) {
          return legacy;
        }
      }
    } else {
      const legacy = decryptWithLegacyKeychain(buffer);

      if (legacy) {
        return legacy;
      }
    }

    const plain = buffer.toString('utf8');
    return isPlainCredentialSecret(plain) ? plain : null;
  } catch {
    return null;
  }
}
