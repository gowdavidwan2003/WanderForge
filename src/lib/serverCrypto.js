import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Encryption for secrets at rest.
 *
 * Written because `user_api_keys.encrypted_key` held raw API keys. The column
 * was named for an intention nobody implemented:
 *
 *     encrypted_key: key, // In production, encrypt before storing
 *
 * A user's Groq key in plaintext is a credential this application is not
 * entitled to hold. Anyone with a database backup, a leaked service-role key or
 * SQL access reads every one of them, and they are keys to somebody else's paid
 * account.
 *
 * AES-256-GCM, which is authenticated: decryption fails loudly if the ciphertext
 * was altered rather than returning plausible garbage. Server-side only — this
 * imports node:crypto and must never be pulled into a client bundle.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;      // 96 bits, the size GCM is defined for
const KEY_BYTES = 32;     // AES-256
const VERSION = 'v1';

/**
 * A fixed salt, which is fine here and would not be for passwords.
 *
 * Salts exist to stop one precomputed table attacking many hashes. There is one
 * secret in this system, not millions of user-chosen passwords, so per-value
 * salting would only mean storing the salt next to the ciphertext for no gain.
 * The secret itself must carry the entropy.
 */
const SALT = 'wanderforge:user-api-keys:v1';

// Keyed on the secret itself, not just "have we derived one". scrypt is
// deliberately slow and the secret does not change within a process, so caching
// is worth it — but caching it unconditionally means a changed secret is
// silently ignored, which hides a misconfiguration and makes rotation untestable.
let cachedKey = null;
let cachedFor = null;

/**
 * Derive the AES key from ENCRYPTION_SECRET.
 *
 * scrypt rather than a raw hash so a weak secret costs an attacker something,
 * and cached because it is deliberately slow and the input never changes within
 * a process.
 */
function encryptionKey() {
  const secret = process.env.ENCRYPTION_SECRET;
  if (cachedKey && cachedFor === secret) return cachedKey;

  // Refusing to start is the point. A fallback key — a default, a hash of the
  // project URL, anything derivable — would mean secrets encrypted with a value
  // that is in the repository, which is storing them in plaintext with extra
  // steps and the false comfort of a column called `encrypted_key`.
  if (!secret || secret.length < 32) {
    throw new Error(
      'ENCRYPTION_SECRET must be set and at least 32 characters. Generate one with: openssl rand -base64 48'
    );
  }

  cachedKey = scryptSync(secret, SALT, KEY_BYTES);
  cachedFor = secret;
  return cachedKey;
}

/** True when a usable secret is configured, without throwing. */
export function encryptionAvailable() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a string.
 *
 * @returns `v1.<iv>.<authTag>.<ciphertext>`, all base64url. The version prefix
 *          is what makes a future key rotation or algorithm change possible
 *          without guessing at what each stored row is.
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Nothing to encrypt');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a value produced by encryptSecret.
 *
 * @returns the plaintext, or null if the value is malformed, was encrypted with
 *          a different secret, or has been tampered with. Null rather than a
 *          throw because every caller's correct response is the same — treat the
 *          key as absent and fall back to the operator's own.
 */
export function decryptSecret(stored) {
  if (typeof stored !== 'string') return null;

  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const [, iv, authTag, ciphertext] = parts;
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM's authentication check failed, or the secret has changed. Either way
    // this value cannot be trusted and the user must re-enter the key.
    return null;
  }
}

/**
 * Whether a stored value is in the encrypted format at all.
 *
 * Used by the migration path: rows written before this module existed hold raw
 * keys, and they must be recognised and destroyed rather than fed to a decipher
 * that will simply return null for them anyway.
 */
export function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(`${VERSION}.`) && stored.split('.').length === 4;
}

/**
 * The only representation of a key that may reach the browser.
 *
 * Enough for someone to recognise which key they saved, useless to anyone who
 * intercepts it. The full value never leaves the server again once stored.
 */
export function maskSecret(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length < 4) return '••••';
  return `••••${plaintext.slice(-4)}`;
}

/**
 * Constant-time string comparison, for anywhere a secret is compared.
 *
 * `===` on strings short-circuits at the first differing byte, which leaks the
 * length of the matching prefix to anything that can time it.
 */
export function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
