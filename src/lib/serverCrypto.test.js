import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  isEncrypted,
  maskSecret,
  safeEquals,
} from '@/lib/serverCrypto';

const SECRET = 'a'.repeat(48);
const KEY = 'gsk_abcdefghijklmnopqrstuvwxyz012345';

describe('serverCrypto', () => {
  const original = process.env.ENCRYPTION_SECRET;

  beforeEach(() => { process.env.ENCRYPTION_SECRET = SECRET; });
  afterEach(() => {
    if (original === undefined) delete process.env.ENCRYPTION_SECRET;
    else process.env.ENCRYPTION_SECRET = original;
  });

  it('round-trips a key', () => {
    expect(decryptSecret(encryptSecret(KEY))).toBe(KEY);
  });

  it('never emits the plaintext in the ciphertext', () => {
    // The failure this module exists for: a column called encrypted_key that
    // contained the key.
    const out = encryptSecret(KEY);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('gsk_');
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per encryption. Identical output for identical input would
    // reveal which users had saved the same key.
    const a = encryptSecret(KEY);
    const b = encryptSecret(KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('carries a version prefix so the format can change later', () => {
    expect(encryptSecret(KEY).startsWith('v1.')).toBe(true);
    expect(isEncrypted(encryptSecret(KEY))).toBe(true);
  });

  it('refuses to run without a real secret', () => {
    // A fallback key would mean encrypting with a value that lives in the
    // repository — plaintext with extra steps.
    delete process.env.ENCRYPTION_SECRET;
    expect(() => encryptSecret(KEY)).toThrow(/ENCRYPTION_SECRET/);
    expect(encryptionAvailable()).toBe(false);

    process.env.ENCRYPTION_SECRET = 'too short';
    expect(() => encryptSecret(KEY)).toThrow(/at least 32/);
  });

  it('detects tampering rather than returning garbage', () => {
    // GCM is authenticated; this is the property that makes it the right choice.
    const enc = encryptSecret(KEY);
    const [v, iv, tag, ct] = enc.split('.');

    const flipped = ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA');
    expect(decryptSecret([v, iv, tag, flipped].join('.'))).toBeNull();
    expect(decryptSecret([v, iv, 'AAAAAAAAAAAAAAAAAAAAAA', ct].join('.'))).toBeNull();
  });

  it('returns null when the secret has changed, instead of throwing', () => {
    // Rotating ENCRYPTION_SECRET must degrade to "re-enter your key", not to a
    // 500 on every generation.
    const enc = encryptSecret(KEY);
    process.env.ENCRYPTION_SECRET = 'b'.repeat(48);
    expect(decryptSecret(enc)).toBeNull();
  });

  it('returns null for anything that is not a v1 envelope', () => {
    // Rows written before encryption existed hold the raw key. They must be
    // recognised as unusable, not fed to a decipher.
    for (const junk of [KEY, '', null, undefined, 'v2.a.b.c', 'v1.only.three', 42]) {
      expect(decryptSecret(junk), String(junk)).toBeNull();
      expect(isEncrypted(junk), String(junk)).toBe(false);
    }
  });

  it('refuses to encrypt nothing', () => {
    expect(() => encryptSecret('')).toThrow();
    expect(() => encryptSecret(null)).toThrow();
  });

  it('handles unicode and long values', () => {
    const odd = 'gsk_ключ–значение–🔑'.repeat(20);
    expect(decryptSecret(encryptSecret(odd))).toBe(odd);
  });
});

describe('maskSecret', () => {
  it('shows only enough to recognise the key', () => {
    expect(maskSecret(KEY)).toBe('••••2345');
    expect(maskSecret(KEY)).not.toContain('gsk_');
  });

  it('does not leak short or absent values', () => {
    expect(maskSecret('ab')).toBe('••••');
    expect(maskSecret(null)).toBe('••••');
  });
});

describe('safeEquals', () => {
  it('compares equal strings as equal', () => {
    expect(safeEquals('abc', 'abc')).toBe(true);
  });

  it('rejects differing strings and differing lengths', () => {
    expect(safeEquals('abc', 'abd')).toBe(false);
    expect(safeEquals('abc', 'abcd')).toBe(false);
  });

  it('is false rather than throwing for non-strings', () => {
    expect(safeEquals(null, 'a')).toBe(false);
    expect(safeEquals(1, 1)).toBe(false);
  });
});
