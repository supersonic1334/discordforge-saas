'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../database');
const config = require('../config');
const { encrypt, decrypt, generateToken, hash } = require('./encryptionService');
const { getRequestAccessMetadata } = require('./accessControlService');
const { buildCaptchaSvgDataUrl } = require('./captchaImageService');

const DEFAULT_COLOR = '#06b6d4';
const CAPTCHA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOCK_RULES = [
  { failures: 3, level: 1, durationMs: 5 * 60 * 1000, message: 'Trop d erreurs CAPTCHA. Reessaie dans 5 minutes.' },
  { failures: 6, level: 2, durationMs: 30 * 60 * 1000, message: 'Trop d erreurs CAPTCHA. Reessaie dans 30 minutes.' },
  { failures: 9, level: 3, durationMs: 24 * 60 * 60 * 1000, message: 'Trop d erreurs CAPTCHA. Reessaie dans 24 heures.' },
  { failures: 10, level: 4, permanent: true, message: 'Acces inscription bloque apres trop d echecs CAPTCHA.' },
];

function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function getCaptchaLength() {
  const value = Number(config.AUTH_SIGNUP_CAPTCHA_LENGTH || 6);
  return Math.max(4, Math.min(8, Number.isFinite(value) ? value : 6));
}

function getCaptchaTtlMinutes() {
  const value = Number(config.AUTH_SIGNUP_CAPTCHA_TTL_MINUTES || 10);
  return Math.max(2, Math.min(30, Number.isFinite(value) ? value : 10));
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.ceil(safeMs / 1000);

  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} h`;

  return `${Math.ceil(totalHours / 24)} j`;
}

function generateCode(length = getCaptchaLength()) {
  return Array.from({ length }, () => CAPTCHA_ALPHABET[crypto.randomInt(0, CAPTCHA_ALPHABET.length)]).join('');
}

function signCipher(ciphertext) {
  return crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(String(ciphertext || ''))
    .digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function encodeChallengeToken(payload) {
  const ciphertext = encrypt(JSON.stringify(payload));
  const signature = signCipher(ciphertext);
  return `${signature}.${ciphertext}`;
}

function decodeChallengeToken(token) {
  const raw = String(token || '').trim();
  const separatorIndex = raw.indexOf('.');
  if (separatorIndex <= 0) {
    throw Object.assign(new Error('Challenge CAPTCHA invalide'), { status: 400 });
  }

  const signature = raw.slice(0, separatorIndex);
  const ciphertext = raw.slice(separatorIndex + 1);
  if (!safeEqualHex(signature, signCipher(ciphertext))) {
    throw Object.assign(new Error('Challenge CAPTCHA invalide'), { status: 400 });
  }

  const decrypted = decrypt(ciphertext);
  if (!decrypted) {
    throw Object.assign(new Error('Challenge CAPTCHA invalide'), { status: 400 });
  }

  let payload = null;
  try {
    payload = JSON.parse(decrypted);
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('Challenge CAPTCHA invalide'), { status: 400 });
  }

  return payload;
}

function buildFingerprintKey(requestMeta) {
  return hash([
    requestMeta?.ipHash || '',
    requestMeta?.deviceHash || '',
    requestMeta?.clientSignatureHash || '',
  ].join(':'));
}

function findMatchingGuard(requestMeta) {
  const fingerprintKey = buildFingerprintKey(requestMeta);
  return db.db.prepare(`
    SELECT *
    FROM register_captcha_guards
    WHERE fingerprint_key = ?
       OR (? IS NOT NULL AND ip_hash = ?)
       OR (? IS NOT NULL AND device_hash = ?)
       OR (? IS NOT NULL AND client_signature_hash = ?)
    ORDER BY permanently_locked DESC, failure_count DESC, datetime(updated_at) DESC
    LIMIT 1
  `).get(
    fingerprintKey,
    requestMeta?.ipHash || null,
    requestMeta?.ipHash || null,
    requestMeta?.deviceHash || null,
    requestMeta?.deviceHash || null,
    requestMeta?.clientSignatureHash || null,
    requestMeta?.clientSignatureHash || null
  ) || null;
}

function buildStatusFromGuard(guard) {
  if (!guard) {
    return {
      blocked: false,
      permanent: false,
      retry_after_seconds: 0,
      blocked_until: null,
      lock_level: 0,
      failure_count: 0,
      message: '',
    };
  }

  const permanent = Boolean(Number(guard.permanently_locked || 0));
  const lockedUntilMs = guard.locked_until ? Date.parse(String(guard.locked_until || '')) : NaN;
  const activeTimedLock = Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now();
  const blocked = permanent || activeTimedLock;
  const retryAfterMs = activeTimedLock ? Math.max(0, lockedUntilMs - Date.now()) : 0;

  let message = '';
  if (permanent) {
    message = 'Acces inscription bloque apres trop d echecs CAPTCHA.';
  } else if (activeTimedLock) {
    message = `Trop d erreurs CAPTCHA. Reessaie dans ${formatDuration(retryAfterMs)}.`;
  }

  return {
    blocked,
    permanent,
    retry_after_seconds: activeTimedLock ? Math.ceil(retryAfterMs / 1000) : 0,
    blocked_until: activeTimedLock ? new Date(lockedUntilMs).toISOString() : null,
    lock_level: Number(guard.lock_level || 0),
    failure_count: Number(guard.failure_count || 0),
    message,
  };
}

function createLockedError(status) {
  return Object.assign(new Error(status.message || 'Acces inscription temporairement bloque'), {
    status: 429,
    code: 'REGISTER_CAPTCHA_LOCKED',
    blocked_until: status.blocked_until || null,
    retry_after_seconds: Number(status.retry_after_seconds || 0),
    permanent: !!status.permanent,
    lock_level: Number(status.lock_level || 0),
    failure_count: Number(status.failure_count || 0),
  });
}

function getRegisterCaptchaStatus(req) {
  const requestMeta = getRequestAccessMetadata(req);
  const guard = findMatchingGuard(requestMeta);
  return buildStatusFromGuard(guard);
}

function assertRegisterCaptchaAllowed(req) {
  const status = getRegisterCaptchaStatus(req);
  if (status.blocked) {
    throw createLockedError(status);
  }
  return status;
}

function upsertGuard(requestMeta, updates) {
  const existing = findMatchingGuard(requestMeta);
  const payload = {
    fingerprint_key: buildFingerprintKey(requestMeta),
    ip_hash: requestMeta?.ipHash || null,
    device_hash: requestMeta?.deviceHash || null,
    client_signature_hash: requestMeta?.clientSignatureHash || null,
    ...updates,
  };

  if (existing?.id) {
    db.update('register_captcha_guards', payload, { id: existing.id });
    return db.findOne('register_captcha_guards', { id: existing.id });
  }

  const inserted = db.insert('register_captcha_guards', {
    id: uuidv4(),
    failure_count: 0,
    lock_level: 0,
    permanently_locked: 0,
    ...payload,
  });

  return db.findOne('register_captcha_guards', { id: inserted.id });
}

function nextLockThreshold(failureCount) {
  return LOCK_RULES.find((rule) => Number(failureCount || 0) < rule.failures) || null;
}

function registerFailure(requestMeta) {
  const current = findMatchingGuard(requestMeta);
  const previousFailures = Number(current?.failure_count || 0);
  const nextFailures = previousFailures + 1;
  const triggeredRule = LOCK_RULES.find((rule) => previousFailures < rule.failures && nextFailures >= rule.failures) || null;
  const nowIso = new Date().toISOString();

  const updates = {
    failure_count: nextFailures,
    last_failure_at: nowIso,
  };

  if (triggeredRule?.permanent) {
    updates.permanently_locked = 1;
    updates.lock_level = triggeredRule.level;
    updates.locked_until = null;
  } else if (triggeredRule?.durationMs) {
    updates.lock_level = triggeredRule.level;
    updates.locked_until = new Date(Date.now() + triggeredRule.durationMs).toISOString();
  }

  const guard = upsertGuard(requestMeta, updates);
  const status = buildStatusFromGuard(guard);
  const upcomingRule = nextLockThreshold(nextFailures);

  return {
    ...status,
    failure_count: nextFailures,
    next_lock_after: upcomingRule ? Math.max(0, upcomingRule.failures - nextFailures) : 0,
  };
}

function clearFailures(requestMeta) {
  const guard = findMatchingGuard(requestMeta);
  if (!guard?.id) return;

  db.update('register_captcha_guards', {
    failure_count: 0,
    lock_level: 0,
    locked_until: null,
    permanently_locked: 0,
    last_success_at: new Date().toISOString(),
  }, { id: guard.id });
}

function createRegisterCaptcha(req, options = {}) {
  assertRegisterCaptchaAllowed(req);

  const requestMeta = getRequestAccessMetadata(req);
  const code = generateCode();
  const nonce = generateToken(16);
  const ttlMinutes = getCaptchaTtlMinutes();
  const expiresAt = new Date(Date.now() + (ttlMinutes * 60 * 1000)).toISOString();
  const payload = {
    type: 'register-captcha',
    nonce,
    expires_at: expiresAt,
    answer_hash: hash(`register-captcha:${nonce}:${normalizeAnswer(code)}`),
    ip_hash: requestMeta.ipHash || null,
    device_hash: requestMeta.deviceHash || null,
    client_signature_hash: requestMeta.clientSignatureHash || null,
  };

  return {
    token: encodeChallengeToken(payload),
    image_data_url: buildCaptchaSvgDataUrl(code, nonce, options.color || DEFAULT_COLOR),
    prompt: `Recopie les ${code.length} caracteres affiches`,
    expires_at: expiresAt,
    code_length: code.length,
  };
}

function verifyRegisterCaptcha(req, token, answer) {
  assertRegisterCaptchaAllowed(req);

  const payload = decodeChallengeToken(token);
  if (payload.type !== 'register-captcha') {
    throw Object.assign(new Error('Challenge CAPTCHA invalide'), { status: 400 });
  }

  const expiresAt = Date.parse(String(payload.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw Object.assign(new Error('Le CAPTCHA a expire, recharge-le'), { status: 400 });
  }

  const requestMeta = getRequestAccessMetadata(req);
  if (payload.ip_hash && payload.ip_hash !== requestMeta.ipHash) {
    throw Object.assign(new Error('Challenge CAPTCHA invalide pour cette session'), { status: 400 });
  }
  if (payload.device_hash && payload.device_hash !== requestMeta.deviceHash) {
    throw Object.assign(new Error('Challenge CAPTCHA invalide pour cet appareil'), { status: 400 });
  }
  if (payload.client_signature_hash && payload.client_signature_hash !== requestMeta.clientSignatureHash) {
    throw Object.assign(new Error('Challenge CAPTCHA invalide pour ce navigateur'), { status: 400 });
  }

  const normalizedAnswer = normalizeAnswer(answer);
  if (!normalizedAnswer) {
    throw Object.assign(new Error('Saisis le code CAPTCHA'), { status: 400 });
  }

  const answerHash = hash(`register-captcha:${payload.nonce}:${normalizedAnswer}`);
  if (answerHash !== payload.answer_hash) {
    const status = registerFailure(requestMeta);
    if (status.blocked) {
      throw createLockedError(status);
    }

    const remainingBeforeLock = Number(status.next_lock_after || 0);
    const suffix = remainingBeforeLock > 0
      ? ` Encore ${remainingBeforeLock} erreur${remainingBeforeLock > 1 ? 's' : ''} avant blocage.`
      : '';

    throw Object.assign(new Error(`Code CAPTCHA incorrect.${suffix}`), { status: 400 });
  }

  clearFailures(requestMeta);
  return true;
}

module.exports = {
  createRegisterCaptcha,
  getRegisterCaptchaStatus,
  verifyRegisterCaptcha,
};
