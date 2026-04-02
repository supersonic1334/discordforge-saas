'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const config = require('../config');
const logger = require('../utils/logger').child('AuthService');
const { SITE_LANGUAGES, AI_LANGUAGES } = require('../constants/languages');
const emailPolicyService = require('./emailPolicyService');
const mailService = require('./mailService');
const authChallengeService = require('./authChallengeService');
const { buildRequestInsight } = require('./requestInsightService');

const BCRYPT_ROUNDS = 12;
const FULLY_HIDDEN_EMAIL = '********@********.***';

function normalizeEmail(email) {
  return emailPolicyService.normalizeEmail(email);
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

function buildDiscordIdentityPatch({ providerId, username, globalName, avatarUrl, accessToken }, currentUser = null) {
  return {
    discord_id: providerId || currentUser?.discord_id || null,
    discord_username: username || currentUser?.discord_username || null,
    discord_global_name: globalName || currentUser?.discord_global_name || null,
    discord_avatar_url: avatarUrl || currentUser?.discord_avatar_url || null,
    discord_token: accessToken || currentUser?.discord_token || null,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSecurityEmailTemplate({ title, lead, buttonLabel, buttonUrl, details = [], footer }) {
  const listHtml = details
    .filter((item) => item?.label && item?.value)
    .map((item) => `
      <tr>
        <td style="padding:8px 0;color:#94a3b8;font-size:13px;font-family:Arial,sans-serif;">${escapeHtml(item.label)}</td>
        <td style="padding:8px 0;color:#f8fafc;font-size:13px;font-family:Arial,sans-serif;text-align:right;">${escapeHtml(item.value)}</td>
      </tr>
    `)
    .join('');

  const html = `<!doctype html>
  <html lang="fr">
    <body style="margin:0;padding:24px;background:#05070d;font-family:Arial,sans-serif;color:#f8fafc;">
      <div style="max-width:640px;margin:0 auto;background:linear-gradient(180deg,#111827,#090c14);border:1px solid rgba(255,255,255,.08);border-radius:28px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45);">
        <div style="padding:28px 28px 14px;background:linear-gradient(135deg,rgba(0,229,255,.14),rgba(124,58,237,.14));border-bottom:1px solid rgba(255,255,255,.06);">
          <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.28);color:#67e8f9;font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;">DiscordForger Security</div>
          <h1 style="margin:18px 0 10px;font-size:28px;line-height:1.1;">${escapeHtml(title)}</h1>
          <p style="margin:0;color:#cbd5e1;font-size:15px;line-height:1.7;">${escapeHtml(lead)}</p>
        </div>
        <div style="padding:28px;">
          <div style="margin:0 0 22px;">
            <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:linear-gradient(135deg,#00e5ff,#7c3aed);color:#fff;text-decoration:none;font-weight:700;">${escapeHtml(buttonLabel)}</a>
          </div>
          ${listHtml ? `<table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid rgba(255,255,255,.06);border-radius:18px;background:rgba(255,255,255,.03);padding:16px 18px;">${listHtml}</table>` : ''}
          <p style="margin:${listHtml ? '20px' : '0'} 0 0;color:#94a3b8;font-size:13px;line-height:1.7;">${escapeHtml(footer)}</p>
        </div>
      </div>
    </body>
  </html>`;

  const text = [
    title,
    '',
    lead,
    '',
    `${buttonLabel}: ${buttonUrl}`,
    '',
    ...details.filter((item) => item?.label && item?.value).map((item) => `${item.label}: ${item.value}`),
    '',
    footer,
  ].join('\n');

  return { html, text };
}

function buildRequestEmailDetails(requestInsight) {
  return [
    { label: 'Adresse IP', value: requestInsight?.ipAddress || 'Inconnue' },
    { label: 'Localisation approx.', value: requestInsight?.locationLabel || 'Indisponible' },
    { label: 'Appareil', value: requestInsight?.userAgentLabel || 'Navigateur inconnu' },
  ];
}

async function sendRegistrationVerificationEmail({ email, username, passwordHash, requestInsight }) {
  if (!mailService.isMailConfigured()) {
    throw Object.assign(new Error('La verification e-mail est indisponible pour le moment'), { status: 503 });
  }

  const challenge = authChallengeService.createEmailChallenge({
    userId: null,
    email,
    challengeType: 'register_verify',
    requestInsight,
    metadata: {
      email,
      username,
      password_hash: passwordHash,
    },
    ttlMinutes: config.AUTH_VERIFICATION_TTL_MINUTES,
  });

  const verifyUrl = authChallengeService.buildVerificationUrl(challenge.token, 'register_verify');
  const mail = buildSecurityEmailTemplate({
    title: 'Valide ton adresse e-mail',
    lead: 'Confirme ton inscription pour activer ton acces au site et finaliser la creation du compte.',
    buttonLabel: 'Valider mon adresse',
    buttonUrl: verifyUrl,
    details: buildRequestEmailDetails(requestInsight),
    footer: 'Si ce n etait pas toi, ignore simplement cet e-mail. Aucun compte ne sera active sans validation.',
  });

  await mailService.sendEmail({
    to: email,
    subject: 'Validation e-mail DiscordForger',
    html: mail.html,
    text: mail.text,
  });
}

async function sendExistingAccountVerificationEmail(user, requestInsight) {
  if (!mailService.isMailConfigured()) {
    throw Object.assign(new Error('La verification e-mail est indisponible pour le moment'), { status: 503 });
  }

  const challenge = authChallengeService.createEmailChallenge({
    userId: user.id,
    email: user.email,
    challengeType: 'register_verify',
    requestInsight,
    metadata: {},
    ttlMinutes: config.AUTH_VERIFICATION_TTL_MINUTES,
  });

  const verifyUrl = authChallengeService.buildVerificationUrl(challenge.token, 'register_verify');
  const mail = buildSecurityEmailTemplate({
    title: 'Confirme cette adresse e-mail',
    lead: 'Un acces au compte a ete demande. Valide cette adresse pour autoriser la connexion.',
    buttonLabel: 'Confirmer mon e-mail',
    buttonUrl: verifyUrl,
    details: buildRequestEmailDetails(requestInsight),
    footer: 'Si tu n es pas a l origine de cette demande, ignore cet e-mail et change ton mot de passe.',
  });

  await mailService.sendEmail({
    to: user.email,
    subject: 'Confirmation d adresse e-mail DiscordForger',
    html: mail.html,
    text: mail.text,
  });
}

async function sendLoginApprovalEmail(user, requestInsight) {
  if (!mailService.isMailConfigured()) {
    throw Object.assign(new Error('La validation de connexion est indisponible pour le moment'), { status: 503 });
  }

  const challenge = authChallengeService.createEmailChallenge({
    userId: user.id,
    email: user.email,
    challengeType: 'login_approve',
    requestInsight,
    metadata: {},
    ttlMinutes: config.AUTH_LOGIN_APPROVAL_TTL_MINUTES,
  });

  const approveUrl = authChallengeService.buildVerificationUrl(challenge.token, 'login_approve');
  const mail = buildSecurityEmailTemplate({
    title: 'Nouvelle connexion a approuver',
    lead: 'Une tentative de connexion depuis un appareil non reconnu vient d etre detectee. Autorise-la uniquement si c est bien toi.',
    buttonLabel: 'Autoriser cette connexion',
    buttonUrl: approveUrl,
    details: buildRequestEmailDetails(requestInsight),
    footer: 'Si tu ne reconnais pas cette tentative, n approuve rien et change immediatement ton mot de passe.',
  });

  await mailService.sendEmail({
    to: user.email,
    subject: 'Nouvelle connexion DiscordForger',
    html: mail.html,
    text: mail.text,
  });
}

// ── JWT ───────────────────────────────────────────────────────────────────────
function signToken(userId, role) {
  return jwt.sign({ userId, role }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });
}

function safeUser(user) {
  const { password_hash, discord_token, ...safe } = user;
  const isDiscordOauthAccount = !password_hash && !!safe.discord_id;
  safe.site_language = SITE_LANGUAGES.includes(safe.site_language) ? safe.site_language : 'auto';
  safe.ai_language = AI_LANGUAGES.includes(safe.ai_language) ? safe.ai_language : 'auto';
  safe.analytics_layout = parseJsonObject(safe.analytics_layout, null);
  safe.is_discord_oauth_account = isDiscordOauthAccount;
  safe.display_avatar_url = safe.avatar_url || (isDiscordOauthAccount ? safe.discord_avatar_url || null : null);
  safe.is_primary_founder = isPrimaryFounderEmail(safe.email);
  safe.email_verified = !!safe.email_verified;
  if (isPrimaryFounderEmail(safe.email)) {
    safe.email = maskEmail(safe.email, { hideCompletely: true });
  }
  return safe;
}

// ── Register ──────────────────────────────────────────────────────────────────
async function register({ email, username, password, req }) {
  const normalizedEmail = normalizeEmail(email);
  const emailVerificationEnabled = config.AUTH_REQUIRE_EMAIL_VERIFICATION && mailService.isMailConfigured();
  await emailPolicyService.assertAllowedRegistrationEmail(normalizedEmail, {
    allowKnownBypass: isPrimaryFounderEmail(normalizedEmail),
  });
  const existing = findUserByEmail(normalizedEmail);
  if (existing) throw Object.assign(new Error('Email already in use'), { status: 409 });

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const requestInsight = await buildRequestInsight(req);

  if (!emailVerificationEnabled) {
    const id = uuidv4();

    db.insert('users', {
      id,
      email: normalizedEmail,
      username,
      password_hash,
      role: 'member',
      email_verified: 1,
      email_verified_at: new Date().toISOString(),
      is_active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    authChallengeService.trustDevice(id, requestInsight, 'Appareil d inscription');

    const user = db.findOne('users', { id });
    const token = signToken(id, 'member');
    logger.info(`New user registered: ${normalizedEmail}`);
    return { token, user: safeUser(user) };
  }

  await sendRegistrationVerificationEmail({
    email: normalizedEmail,
    username,
    passwordHash: password_hash,
    requestInsight,
  });

  logger.info(`Registration pending email verification: ${normalizedEmail}`);
  return {
    requires_verification: true,
    email_masked: maskEmail(normalizedEmail),
    message: 'Verification e-mail requise',
  };
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function login({ email, password, req }) {
  const normalizedEmail = normalizeEmail(email);
  const loginApprovalEnabled = config.AUTH_REQUIRE_LOGIN_APPROVAL_NEW_DEVICE && mailService.isMailConfigured();
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

  const requestInsight = await buildRequestInsight(req);

  if (!user.email_verified && mailService.isMailConfigured()) {
    await sendExistingAccountVerificationEmail(user, requestInsight);
    return {
      requires_verification: true,
      email_masked: maskEmail(user.email),
      message: 'Validation e-mail requise',
    };
  }

  if (loginApprovalEnabled && !authChallengeService.isTrustedDevice(user.id, requestInsight)) {
    await sendLoginApprovalEmail(user, requestInsight);
    return {
      requires_login_approval: true,
      email_masked: maskEmail(user.email),
      message: 'Nouvelle connexion a approuver par e-mail',
    };
  }

  authChallengeService.trustDevice(user.id, requestInsight, 'Appareil approuve');
  db.update('users', { last_login_at: new Date().toISOString() }, { id: user.id });

  const token = signToken(user.id, user.role);
  logger.info(`User logged in: ${normalizedEmail}`);
  return { token, user: safeUser(user) };
}

// ── OAuth upsert (Discord / Google) ──────────────────────────────────────────
async function upsertOAuthUser({ provider, providerId, email, username, globalName, avatarUrl, accessToken }) {
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
    const discordIdentityPatch = provider === 'discord'
      ? buildDiscordIdentityPatch({ providerId, username, globalName, avatarUrl, accessToken }, user)
      : {};
    db.update('users', {
      [providerField]: providerId,
      username: username ?? user.username,
      avatar_url: avatarUrl ?? user.avatar_url,
      email_verified: 1,
      email_verified_at: user.email_verified_at || now,
      last_login_at: now,
      ...discordIdentityPatch,
    }, { id: user.id });
    user = db.findOne('users', { id: user.id });
  } else {
    const discordIdentityPatch = provider === 'discord'
      ? buildDiscordIdentityPatch({ providerId, username, globalName, avatarUrl, accessToken })
      : {};
    const id = uuidv4();
    db.insert('users', {
      id,
      email: normalizedEmail ?? `${provider}_${providerId}@oauth.local`,
      username: username ?? `user_${providerId.slice(0, 8)}`,
      password_hash: null,
      avatar_url: avatarUrl,
      role: 'member',
      email_verified: 1,
      email_verified_at: now,
      [providerField]: providerId,
      ...discordIdentityPatch,
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

function linkDiscordAccount(userId, { providerId, username, globalName, avatarUrl, accessToken }) {
  const user = db.findOne('users', { id: userId });
  if (!user || !user.is_active) {
    throw Object.assign(new Error('Account not found or deactivated'), { status: 404 });
  }

  const existingOwner = db.raw(
    'SELECT id FROM users WHERE discord_id = ? AND id != ? LIMIT 1',
    [providerId, userId]
  )[0] ?? null;

  if (existingOwner) {
    throw Object.assign(new Error('Ce compte Discord est deja lie a un autre compte'), { status: 409 });
  }

  db.update('users', {
    ...buildDiscordIdentityPatch({ providerId, username, globalName, avatarUrl, accessToken }, user),
    updated_at: new Date().toISOString(),
  }, { id: userId });

  const updatedUser = db.findOne('users', { id: userId });
  return safeUser(updatedUser);
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

async function verifyPassword(userId, password) {
  const user = db.findOne('users', { id: userId });
  if (!user) throw Object.assign(new Error('Account not found'), { status: 404 });
  if (!user.password_hash) return true;
  return bcrypt.compare(String(password || ''), user.password_hash);
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
    if (!existing.email_verified) {
      updates.email_verified = 1;
      updates.email_verified_at = existing.email_verified_at || new Date().toISOString();
    }
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
    email_verified: 1,
    email_verified_at: new Date().toISOString(),
    is_active: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  logger.info(`Founder account created: ${founderEmail}`);
}

async function completeEmailVerification(token) {
  const challenge = authChallengeService.getActiveChallengeByToken(token, 'register_verify');
  if (!challenge) {
    throw Object.assign(new Error('Lien de verification invalide ou expire'), { status: 400 });
  }

  const metadata = authChallengeService.parseChallengeMetadata(challenge);
  const now = new Date().toISOString();
  let user = challenge.user_id ? db.findOne('users', { id: challenge.user_id }) : findUserByEmail(challenge.email);

  if (!user) {
    if (!metadata?.email || !metadata?.username || !metadata?.password_hash) {
      throw Object.assign(new Error('Verification invalide'), { status: 400 });
    }

    user = db.insert('users', {
      id: uuidv4(),
      email: normalizeEmail(metadata.email),
      username: metadata.username,
      password_hash: metadata.password_hash,
      role: 'member',
      email_verified: 1,
      email_verified_at: now,
      is_active: 1,
      last_login_at: now,
      created_at: now,
      updated_at: now,
    });
  } else {
    db.update('users', {
      email_verified: 1,
      email_verified_at: user.email_verified_at || now,
      last_login_at: now,
    }, { id: user.id });
    user = db.findOne('users', { id: user.id });
  }

  authChallengeService.consumeChallenge(challenge.id);
  authChallengeService.trustDevice(user.id, {
    deviceHash: challenge.device_hash || null,
    clientSignatureHash: challenge.client_signature_hash || null,
    userAgent: challenge.user_agent || null,
    ipHash: challenge.ip_hash || null,
  }, 'Appareil verifie');

  const freshUser = db.findOne('users', { id: user.id });
  return {
    token: signToken(freshUser.id, freshUser.role),
    user: safeUser(freshUser),
  };
}

async function approveLoginChallenge(token) {
  const challenge = authChallengeService.getActiveChallengeByToken(token, 'login_approve');
  if (!challenge) {
    throw Object.assign(new Error('Lien d approbation invalide ou expire'), { status: 400 });
  }

  const user = db.findOne('users', { id: challenge.user_id });
  if (!user || !user.is_active) {
    throw Object.assign(new Error('Compte introuvable ou desactive'), { status: 404 });
  }
  if (!user.email_verified) {
    throw Object.assign(new Error('Adresse e-mail non verifiee'), { status: 403 });
  }

  authChallengeService.consumeChallenge(challenge.id);
  authChallengeService.trustDevice(user.id, {
    deviceHash: challenge.device_hash || null,
    clientSignatureHash: challenge.client_signature_hash || null,
    userAgent: challenge.user_agent || null,
    ipHash: challenge.ip_hash || null,
  }, 'Connexion approuvee par e-mail');
  db.update('users', { last_login_at: new Date().toISOString() }, { id: user.id });

  const freshUser = db.findOne('users', { id: user.id });
  return {
    token: signToken(freshUser.id, freshUser.role),
    user: safeUser(freshUser),
  };
}

module.exports = {
  register,
  login,
  upsertOAuthUser,
  linkDiscordAccount,
  changePassword,
  changeUsername,
  updateAvatar,
  setPassword,
  verifyPassword,
  signToken,
  safeUser,
  ensureFounder,
  completeEmailVerification,
  approveLoginChallenge,
  maskEmail,
  isPrimaryFounderEmail,
};
