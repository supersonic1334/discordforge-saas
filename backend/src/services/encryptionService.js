'use strict';

const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-cbc';

// Derive a 32-byte key and 16-byte IV from env strings
const KEY = Buffer.from(config.ENCRYPTION_KEY.padEnd(32).slice(0, 32));
const IV_BASE = Buffer.from(config.ENCRYPTION_IV.padEnd(16).slice(0, 16));

/**
 * Encrypt a plaintext string.
 * Returns "iv_hex:ciphertext_hex" so each encryption uses a fresh random IV.
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  // Use a random IV per encryption for better security
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a "iv_hex:ciphertext_hex" string.
 * Handles legacy format (no IV prefix) by falling back to IV_BASE.
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    let iv, encrypted;
    if (ciphertext.includes(':')) {
      const [ivHex, encHex] = ciphertext.split(':');
      iv = Buffer.from(ivHex, 'hex');
      encrypted = Buffer.from(encHex, 'hex');
    } else {
      // Legacy fallback
      iv = IV_BASE;
      encrypted = Buffer.from(ciphertext, 'hex');
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Hash a value with SHA-256 (for indexing/comparison without decryption).
 */
function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Generate a cryptographically secure random token.
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { encrypt, decrypt, hash, generateToken };
