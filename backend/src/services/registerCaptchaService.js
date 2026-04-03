'use strict';

const crypto = require('crypto');
const config = require('../config');
const { encrypt, decrypt, generateToken, hash } = require('./encryptionService');
const { getRequestAccessMetadata } = require('./accessControlService');
const { buildCaptchaPngDataUrl } = require('./captchaImageService');

const DEFAULT_COLOR = '#06b6d4';

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

function generateCode(length = getCaptchaLength()) {
  return Array.from({ length }, () => String(crypto.randomInt(0, 10))).join('');
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

function createRegisterCaptcha(req, options = {}) {
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
    image_data_url: buildCaptchaPngDataUrl(code, nonce, options.color || DEFAULT_COLOR),
    prompt: `Recopie les ${code.length} chiffres affiches`,
    expires_at: expiresAt,
  };
}

function verifyRegisterCaptcha(req, token, answer) {
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
    throw Object.assign(new Error('Code CAPTCHA incorrect'), { status: 400 });
  }

  return true;
}

module.exports = {
  createRegisterCaptcha,
  verifyRegisterCaptcha,
};
