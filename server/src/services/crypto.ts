/**
 * AES-256-GCM encryption/decryption for conversation content.
 * Uses Bun's native crypto (Web Crypto API).
 *
 * Every encrypted payload is a base64 string composed of:
 *   base64(iv + authTag + ciphertext)
 *
 * Fixed verifier pattern: "SUPACHAT_VERIFIED:{conversationId}"
 */

const IV_LENGTH = 12;      // 96 bits — standard for GCM
const TAG_LENGTH = 16;     // 128 bits — GCM auth tag

/**
 * Derives a 256-bit key from a password using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plaintext string with a password.
 * Returns a single base64 string: iv (12) + authTag (16) + ciphertext.
 * The salt for PBKDF2 is prepended: salt (16) + iv + authTag + ciphertext.
 */
export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  // AES-GCM returns ciphertext + authTag appended
  const ciphertext = new Uint8Array(encrypted.slice(0, encrypted.byteLength - TAG_LENGTH));
  const authTag = new Uint8Array(encrypted.slice(encrypted.byteLength - TAG_LENGTH));

  const combined = new Uint8Array(salt.length + iv.length + authTag.length + ciphertext.length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(authTag, salt.length + iv.length);
  combined.set(ciphertext, salt.length + iv.length + authTag.length);

  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypts a base64 string previously produced by encrypt().
 * Returns the plaintext string, or null if the password is wrong.
 */
export async function decrypt(encryptedStr: string, password: string): Promise<string | null> {
  try {
    const combined = Buffer.from(encryptedStr, 'base64');
    if (combined.length < 16 + IV_LENGTH + TAG_LENGTH + 1) return null;

    const salt = combined.subarray(0, 16);
    const iv = combined.subarray(16, 16 + IV_LENGTH);
    const authTag = combined.subarray(16 + IV_LENGTH, 16 + IV_LENGTH + TAG_LENGTH);
    const ciphertext = combined.subarray(16 + IV_LENGTH + TAG_LENGTH);

    const key = await deriveKey(password, salt);
    const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
    ciphertextWithTag.set(ciphertext, 0);
    ciphertextWithTag.set(authTag, ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertextWithTag
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Decryption failed (wrong password, tampered data)
    return null;
  }
}

/**
 * Creates a verifier token: encrypts a known string with the conversation password.
 * Used to quickly validate a password before attempting to decrypt actual content.
 */
export async function createVerifier(password: string, conversationId: string): Promise<string> {
  return encrypt(`SUPACHAT_VERIFIED:${conversationId}`, password);
}

/**
 * Validates a password against a verifier token.
 */
export async function verifyPassword(password: string, verifier: string, conversationId: string): Promise<boolean> {
  const plaintext = await decrypt(verifier, password);
  return plaintext === `SUPACHAT_VERIFIED:${conversationId}`;
}

/**
 * Encrypts a file buffer.
 * Returns the encrypted buffer.
 */
export async function encryptFile(buffer: Buffer, password: string): Promise<Buffer> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    buffer
  );

  const ciphertext = new Uint8Array(encrypted.slice(0, encrypted.byteLength - TAG_LENGTH));
  const authTag = new Uint8Array(encrypted.slice(encrypted.byteLength - TAG_LENGTH));

  const combined = new Uint8Array(salt.length + iv.length + authTag.length + ciphertext.length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(authTag, salt.length + iv.length);
  combined.set(ciphertext, salt.length + iv.length + authTag.length);

  return Buffer.from(combined);
}

/**
 * Decrypts a file buffer previously produced by encryptFile().
 * Returns the original buffer, or null if the password is wrong.
 */
export async function decryptFile(encryptedBuffer: Buffer, password: string): Promise<Buffer | null> {
  try {
    if (encryptedBuffer.length < 16 + IV_LENGTH + TAG_LENGTH + 1) return null;

    const salt = encryptedBuffer.subarray(0, 16);
    const iv = encryptedBuffer.subarray(16, 16 + IV_LENGTH);
    const authTag = encryptedBuffer.subarray(16 + IV_LENGTH, 16 + IV_LENGTH + TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(16 + IV_LENGTH + TAG_LENGTH);

    const key = await deriveKey(password, salt);
    const ciphertextWithTag = Buffer.concat([ciphertext, authTag]);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertextWithTag
    );

    return Buffer.from(decrypted);
  } catch {
    return null;
  }
}

/**
 * Given a plaintext value, encrypt it if a password is available.
 * Returns the encrypted string, or the original value if no password.
 */
export async function encryptIf(password: string | null | undefined, value: string): Promise<string> {
  if (!password || !value) return value;
  return encrypt(value, password);
}

/**
 * Given an encrypted string, decrypt it if a password is available.
 * Returns the decrypted string, or the original value if no password or if decryption fails.
 */
export async function decryptIf(password: string | null | undefined, encryptedValue: string): Promise<string> {
  if (!password || !encryptedValue) return encryptedValue;
  const plain = await decrypt(encryptedValue, password);
  return plain ?? encryptedValue;
}
