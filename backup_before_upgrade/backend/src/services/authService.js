'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const config = require('../config');
const logger = require('../utils/logger').child('AuthService');
const { SITE_LANGUAGES, AI_LANGUAGES } = require('../constants/languages');

const BCRYPT_ROUNDS = 12;
const FULLY_HIDDEN_EMAIL = '********@********.***';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isPrimaryFounderEmail(email) {
  return normalizeEmail(email) === normalizeEmail(config.FOUNDER_EMAIL);
}

function maskEmail(email, options = {}) {
  const { hideCompletely = false } = options;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || hideCompletely) return FULLY_HIDDEN_EMAIL;

  const [localPart = '', domainPart = ''] = normalizedEmail.split('@');
  if (!localPart || !domainPart) return FULLY_HIDDEN_EMAIL;

  const [domainName = '', ...domainSuffixParts] = domainPart.split('.');
  const domainSuffix = domainSuffixParts.join('.');
  const visibleLocal = localPart.slice(0, Math.min(2, localPart.length));
  const visibleDomain = domainName.slice(0, Math.min(1, domainName.length));
  const maskedLocal = `${visibleLocal}${'*'.repeat(Math.max(4, localPart.length - visibleLocal.length))}`;
  const maskedDomain = `${visibleDomain}${'*'.repeat(Math.max(3, domainName.length - visibleDomain.length))}`;
  const maskedSuffix = domainSuffix ? `.${'*'.repeat(Math.max(2, domainSuffix.length))}` : '';

  return `${maskedLocal}@${maskedDomain}${maskedSuffix}`;
}

function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  return db.db.prepare(
    'SELECT * FROM users WHERE lower(trim(email)) = ? LIMIT 1'
  ).get(normalizedEmail) ?? null;
}

function parseJsonObject(value, fallback = null) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ── JWT ───────────────────────────────────────────────────────────────────────
function signToken(userId, role) {
  return jwt.sign({ userId, role }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
}

function safeUser(user) {
  const { password_hash, discord_token, ...safe } = user;
  safe.site_language = SITE_LANGUAGES.includes(safe.site_language) ? safe.site_language : 'auto';
  safe.ai_language = AI_LANGUAGES.includes(safe.ai_language) ? safe.ai_language : 'auto';
  safe.analytics_layout = parseJsonObject(safe.analytics_layout, null);
  safe.is_primary_founder = isPrimaryFounderEmail(safe.email);
  if (isPrimaryFounderEmail(safe.email)) {
    safe.email = maskEmail(safe.email, { hideCompletely: true });
  }
  return safe;
}

// ── Register ──────────────────────────────────────────────────────────────────
async function register({ email, username, password }) {
  const normalizedEmail = normalizeEmail(email);
  const existing = findUserByEmail(normalizedEmail);
  if (existing) throw Object.assign(new Error('Email already in use'), { status: 409 });

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const id = uuidv4();

  db.insert('users', {
    id,
    email: normalizedEmail,
    username,
    password_hash,
    role: 'member',
    is_active: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const user = db.findOne('users', { id });
  const token = signToken(id, 'member');
  logger.info(`New user registered: ${normalizedEmail}`);
  return { token, user: safeUser(user) };
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const user = findUserByEmail(normalizedEmail);
  if (!user) {
    logger.warn(`Failed login: unknown email attempted`, { email: normalizedEmail });
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }
  if (!user.is_active) {
    logger.warn(`Failed login: deactivated account`, { userId: user.id, email: normalizedEmail });
    throw Object.assign(new Error('Account deactivated'), { status: 403 });
  }
  if (!user.password_hash) {
    logger.warn(`Failed login: OAuth-only account attempted password login`, { userId: user.id });
    throw Object.assign(new Error('Use OAuth to login'), { status: 400 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    logger.warn(`Failed login: wrong password`, { userId: user.id, email: normalizedEmail });
    throw Object.assign(new Error('Invalid credentials'), { status: 401 });
  }

  db.update('users', { last_login_at: new Date().toISOString() }, { id: user.id });

  const token = signToken(user.id, user.role);
  logger.info(`User logged in: ${normalizedEmail}`);
  return { token, user: safeUser(user) };
}

// ── OAuth upsert (Discord / Google) ──────────────────────────────────────────
async function upsertOAuthUser({ provider, providerId, email, username, avatarUrl, accessToken }) {
  const providerField = provider === 'discord' ? 'discord_id' : 'google_id';
  const normalizedEmail = email ? normalizeEmail(email) : null;

  // Try find by provider ID
  let user = db.raw(`SELECT * FROM users WHERE ${providerField} = ?`, [providerId])[0] ?? null;

  // Try find by email (link accounts)
  if (!user && normalizedEmail) {
    user = findUserByEmail(normalizedEmail);
  }

  const now = new Date().toISOString();

  if (user && !user.is_active) {
    throw Object.assign(new Error('Account deactivated'), { status: 403 });
  }

  if (user) {
    db.update('users', {
      [providerField]: providerId,
      username: username ?? user.username,
      avatar_url: avatarUrl ?? user.avatar_url,
      last_login_at: now,
      ...(provider === 'discord' && accessToken ? { discord_token: accessToken } : {}),
    }, { id: user.id });
    user = db.findOne('users', { id: user.id });
  } else {
    const id = uuidv4();
    db.insert('users', {
      id,
      email: normalizedEmail ?? `${provider}_${providerId}@oauth.local`,
      username: username ?? `user_${providerId.slice(0, 8)}`,
      password_hash: null,
      avatar_url: avatarUrl,
      role: 'member',
      [providerField]: providerId,
      ...(provider === 'discord' && accessToken ? { discord_token: accessToken } : {}),
      is_active: 1,
      created_at: now,
      updated_at: now,
    });
    user = db.findOne('users', { id });
    logger.info(`New OAuth user created: ${normalizedEmail} via ${provider}`);
  }

  const token = signToken(user.id, user.role);
  return { token, user: safeUser(user) };
}

// ── Change password ───────────────────────────────────────────────────────────
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = db.findOne('users', { id: userId });
  if (!user.password_hash) throw Object.assign(new Error('No password set (OAuth account)'), { status: 400 });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw Object.assign(new Error('Current password incorrect'), { status: 401 });

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.update('users', { password_hash: newHash }, { id: userId });
}

// ── Change username ───────────────────────────────────────────────────────────
function changeUsername(userId, username) {
  db.update('users', { username, updated_at: new Date().toISOString() }, { id: userId });
}

// ── Update avatar ─────────────────────────────────────────────────────────────
function updateAvatar(userId, avatarUrl) {
  db.update('users', { avatar_url: avatarUrl, updated_at: new Date().toISOString() }, { id: userId });
}

async function setPassword(userId, newPassword) {
  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.update('users', { password_hash: newHash }, { id: userId });
}

// ── Create founder account if it doesn't exist ────────────────────────────────
async function ensureFounder() {
  const founderEmail = normalizeEmail(config.FOUNDER_EMAIL);
  const founderUsername = String(config.FOUNDER_USERNAME || 'Founder').trim() || 'Founder';
  const { FOUNDER_PASSWORD } = config;
  const existing = findUserByEmail(founderEmail);
  if (existing) {
    const updates = {};
    if (existing.role !== 'founder') updates.role = 'founder';
    if (existing.email !== founderEmail) updates.email = founderEmail;
    if (Object.keys(updates).length) {
      db.update('users', updates, { id: existing.id });
      logger.info(`Upgraded ${founderEmail} to founder`);
    }
    return;
  }

  const hash = await bcrypt.hash(FOUNDER_PASSWORD, BCRYPT_ROUNDS);
  db.insert('users', {
    id: uuidv4(),
    email: founderEmail,
    username: founderUsername,
    password_hash: hash,
    role: 'founder',
    is_active: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  logger.info(`Founder account created: ${founderEmail}`);
}

module.exports = {
  register,
  login,
  upsertOAuthUser,
  changePassword,
  changeUsername,
  updateAvatar,
  setPassword,
  signToken,
  safeUser,
  ensureFounder,
  maskEmail,
  isPrimaryFounderEmail,
};
