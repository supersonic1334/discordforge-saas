'use strict';

const { v4: uuidv4 } = require('uuid');
const { randomBytes, createHash } = require('crypto');

const db = require('../database');

const DEFAULT_COLOR = '#06b6d4';
const DEFAULT_PANEL_TITLE = 'Verification CAPTCHA';
const DEFAULT_PANEL_DESCRIPTION = 'Clique sur le bouton de verification pour debloquer ton acces au serveur.';
const DEFAULT_CHANNEL_NAME = 'verification';
const DEFAULT_SUCCESS_MESSAGE = 'Verification reussie. Acces debloque.';
const DEFAULT_FAILURE_MESSAGE = 'Code invalide. Reessaie avec une nouvelle verification.';
const CHALLENGE_TTL_MINUTES = 10;
const MAX_CHALLENGE_ATTEMPTS = 3;

const DEFAULT_CHALLENGE_TYPES = Object.freeze([
  {
    key: 'image_code',
    label: 'Image securisee',
    description: 'Recopier le code genere dans une image unique.',
    enabled: true,
  },
  {
    key: 'quick_math',
    label: 'Calcul express',
    description: 'Resoudre un calcul court pour valider ton acces.',
    enabled: true,
  },
]);

const DEFAULT_CAPTCHA_CONFIG = Object.freeze({
  enabled: true,
  channel_mode: 'existing',
  panel_channel_id: '',
  panel_channel_name: DEFAULT_CHANNEL_NAME,
  panel_message_id: '',
  panel_title: DEFAULT_PANEL_TITLE,
  panel_description: DEFAULT_PANEL_DESCRIPTION,
  panel_color: DEFAULT_COLOR,
  panel_thumbnail_url: '',
  panel_image_url: '',
  verified_role_ids: [],
  log_channel_id: '',
  success_message: DEFAULT_SUCCESS_MESSAGE,
  failure_message: DEFAULT_FAILURE_MESSAGE,
  challenge_types: DEFAULT_CHALLENGE_TYPES,
});

function nowIso() {
  return new Date().toISOString();
}

function toExpiry(minutes = CHALLENGE_TTL_MINUTES) {
  return new Date(Date.now() + (minutes * 60 * 1000)).toISOString();
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSnowflake(value, fallback = '') {
  const raw = String(value ?? fallback ?? '').trim();
  return /^\d+$/.test(raw) ? raw : '';
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : !!fallback;
}

function normalizeText(value, maxLength, fallback = '') {
  return String(value ?? fallback ?? '').trim().slice(0, maxLength);
}

function normalizeColor(value, fallback = DEFAULT_COLOR) {
  const raw = String(value || fallback || '').trim();
  const next = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(next) ? next.toLowerCase() : fallback;
}

function normalizeAssetUrl(value, fallback = '') {
  const raw = String(value ?? fallback ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\/\S+$/i.test(raw)) return raw.slice(0, 1_200_000);
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw.slice(0, 1_200_000);
  return String(fallback || '').trim().slice(0, 1_200_000);
}

function normalizeRoleIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeSnowflake(value))
    .filter(Boolean))]
    .slice(0, 12);
}

function normalizeChannelMode(value, fallback = 'existing') {
  return ['existing', 'create'].includes(String(value || '').trim()) ? String(value).trim() : fallback;
}

function normalizeChallengeKey(value, fallback = 'image_code') {
  return ['image_code', 'quick_math'].includes(String(value || '').trim()) ? String(value).trim() : fallback;
}

function mergeChallengeTypes(rawTypes = []) {
  const map = new Map((Array.isArray(rawTypes) ? rawTypes : [])
    .map((item) => [normalizeChallengeKey(item?.key, ''), item])
    .filter(([key]) => !!key));

  return DEFAULT_CHALLENGE_TYPES.map((preset) => {
    const current = map.get(preset.key) || {};
    return {
      key: preset.key,
      label: normalizeText(current.label, 40, preset.label) || preset.label,
      description: normalizeText(current.description, 140, preset.description),
      enabled: normalizeBoolean(current.enabled, preset.enabled),
    };
  });
}

function mapCaptchaConfigRow(row) {
  const source = row || {};
  return {
    id: source.id || '',
    guild_id: source.guild_id || '',
    enabled: !!source.enabled,
    channel_mode: normalizeChannelMode(source.channel_mode, DEFAULT_CAPTCHA_CONFIG.channel_mode),
    panel_channel_id: normalizeSnowflake(source.panel_channel_id),
    panel_channel_name: normalizeText(source.panel_channel_name, 90, DEFAULT_CHANNEL_NAME) || DEFAULT_CHANNEL_NAME,
    panel_message_id: normalizeSnowflake(source.panel_message_id),
    panel_title: normalizeText(source.panel_title, 120, DEFAULT_PANEL_TITLE) || DEFAULT_PANEL_TITLE,
    panel_description: normalizeText(source.panel_description, 2000, DEFAULT_PANEL_DESCRIPTION),
    panel_color: normalizeColor(source.panel_color, DEFAULT_COLOR),
    panel_thumbnail_url: normalizeAssetUrl(source.panel_thumbnail_url),
    panel_image_url: normalizeAssetUrl(source.panel_image_url),
    verified_role_ids: normalizeRoleIds(parseJsonArray(source.verified_role_ids)),
    log_channel_id: normalizeSnowflake(source.log_channel_id),
    success_message: normalizeText(source.success_message, 240, DEFAULT_SUCCESS_MESSAGE) || DEFAULT_SUCCESS_MESSAGE,
    failure_message: normalizeText(source.failure_message, 240, DEFAULT_FAILURE_MESSAGE) || DEFAULT_FAILURE_MESSAGE,
    challenge_types: mergeChallengeTypes(parseJsonArray(source.challenge_types_json)),
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
  };
}

function ensureCaptchaRow(guildId) {
  const existing = db.findOne('guild_captcha_configs', { guild_id: guildId });
  if (existing) return existing;

  const timestamp = nowIso();
  return db.insert('guild_captcha_configs', {
    id: uuidv4(),
    guild_id: guildId,
    enabled: 1,
    channel_mode: DEFAULT_CAPTCHA_CONFIG.channel_mode,
    panel_channel_id: '',
    panel_channel_name: DEFAULT_CHANNEL_NAME,
    panel_message_id: '',
    panel_title: DEFAULT_PANEL_TITLE,
    panel_description: DEFAULT_PANEL_DESCRIPTION,
    panel_color: DEFAULT_COLOR,
    panel_thumbnail_url: '',
    panel_image_url: '',
    verified_role_ids: '[]',
    log_channel_id: '',
    success_message: DEFAULT_SUCCESS_MESSAGE,
    failure_message: DEFAULT_FAILURE_MESSAGE,
    challenge_types_json: JSON.stringify(DEFAULT_CHALLENGE_TYPES),
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function getGuildCaptchaConfig(guildId) {
  return mapCaptchaConfigRow(ensureCaptchaRow(guildId));
}

function getGuildCaptchaConfigById(configId) {
  if (!configId) return null;
  const row = db.findOne('guild_captcha_configs', { id: configId });
  return row ? mapCaptchaConfigRow(row) : null;
}

function saveGuildCaptchaConfig(guildId, rawConfig = {}) {
  const current = getGuildCaptchaConfig(guildId);
  const next = mapCaptchaConfigRow({
    ...current,
    ...rawConfig,
    guild_id: guildId,
    challenge_types_json: JSON.stringify(mergeChallengeTypes(rawConfig.challenge_types ?? current.challenge_types)),
    verified_role_ids: JSON.stringify(normalizeRoleIds(rawConfig.verified_role_ids ?? current.verified_role_ids)),
  });

  db.update('guild_captcha_configs', {
    enabled: next.enabled ? 1 : 0,
    channel_mode: next.channel_mode,
    panel_channel_id: next.panel_channel_id,
    panel_channel_name: next.panel_channel_name,
    panel_message_id: next.panel_message_id,
    panel_title: next.panel_title,
    panel_description: next.panel_description,
    panel_color: next.panel_color,
    panel_thumbnail_url: next.panel_thumbnail_url,
    panel_image_url: next.panel_image_url,
    verified_role_ids: JSON.stringify(next.verified_role_ids),
    log_channel_id: next.log_channel_id,
    success_message: next.success_message,
    failure_message: next.failure_message,
    challenge_types_json: JSON.stringify(next.challenge_types),
    updated_at: nowIso(),
  }, { guild_id: guildId });

  return getGuildCaptchaConfig(guildId);
}

function recordPublishedCaptchaPanel(guildId, { panel_channel_id, panel_message_id }) {
  ensureCaptchaRow(guildId);
  db.update('guild_captcha_configs', {
    panel_channel_id: normalizeSnowflake(panel_channel_id),
    panel_message_id: normalizeSnowflake(panel_message_id),
    updated_at: nowIso(),
  }, { guild_id: guildId });
  return getGuildCaptchaConfig(guildId);
}

function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function hashAnswer(value) {
  return createHash('sha256').update(normalizeAnswer(value)).digest('hex');
}

function buildCaptchaCode(length = 5) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

function buildNumericCaptchaCode(length = 6) {
  const alphabet = '23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

function expirePendingChallengesForUser(guildId, discordUserId) {
  db.db.prepare(`
    UPDATE guild_captcha_challenges
    SET status = 'expired',
        updated_at = ?,
        consumed_at = COALESCE(consumed_at, ?)
    WHERE guild_id = ?
      AND discord_user_id = ?
      AND status = 'pending'
  `).run(nowIso(), nowIso(), guildId, String(discordUserId || '').trim());
}

function createCaptchaChallenge({
  guildId,
  configId,
  discordUserId,
  discordChannelId = '',
  challengeType,
  promptText = '',
  expectedAnswer,
  metadata = {},
  ttlMinutes = CHALLENGE_TTL_MINUTES,
}) {
  const id = uuidv4();
  const timestamp = nowIso();

  expirePendingChallengesForUser(guildId, discordUserId);

  db.insert('guild_captcha_challenges', {
    id,
    guild_id: guildId,
    config_id: configId,
    discord_user_id: String(discordUserId || '').trim(),
    discord_channel_id: normalizeSnowflake(discordChannelId),
    challenge_type: normalizeChallengeKey(challengeType, 'image_code'),
    prompt_text: normalizeText(promptText, 140, ''),
    expected_answer_hash: hashAnswer(expectedAnswer),
    attempt_count: 0,
    metadata_json: JSON.stringify(metadata || {}),
    status: 'pending',
    expires_at: toExpiry(ttlMinutes),
    created_at: timestamp,
    updated_at: timestamp,
  });

  return getCaptchaChallengeById(id);
}

function mapCaptchaChallengeRow(row) {
  const source = row || {};
  return {
    id: source.id || '',
    guild_id: source.guild_id || '',
    config_id: source.config_id || '',
    discord_user_id: normalizeSnowflake(source.discord_user_id),
    discord_channel_id: normalizeSnowflake(source.discord_channel_id),
    challenge_type: normalizeChallengeKey(source.challenge_type, 'image_code'),
    prompt_text: normalizeText(source.prompt_text, 140, ''),
    attempt_count: Number(source.attempt_count || 0),
    metadata: parseJsonObject(source.metadata_json, {}),
    status: ['pending', 'completed', 'expired'].includes(source.status) ? source.status : 'pending',
    expires_at: source.expires_at || null,
    consumed_at: source.consumed_at || null,
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
  };
}

function getCaptchaChallengeById(challengeId) {
  if (!challengeId) return null;
  const row = db.findOne('guild_captcha_challenges', { id: challengeId });
  return row ? mapCaptchaChallengeRow(row) : null;
}

function getActiveCaptchaChallengeById(challengeId) {
  const challenge = getCaptchaChallengeById(challengeId);
  if (!challenge || challenge.status !== 'pending') return null;
  if (!challenge.expires_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    db.update('guild_captcha_challenges', {
      status: 'expired',
      consumed_at: nowIso(),
      updated_at: nowIso(),
    }, { id: challengeId });
    return null;
  }
  return challenge;
}

function validateCaptchaChallenge(challengeId, submittedAnswer) {
  const challenge = getActiveCaptchaChallengeById(challengeId);
  if (!challenge) {
    return { ok: false, reason: 'expired', challenge: null };
  }

  const normalizedSubmitted = normalizeAnswer(submittedAnswer);
  if (!normalizedSubmitted) {
    return { ok: false, reason: 'empty', challenge };
  }

  if (hashAnswer(normalizedSubmitted) !== db.findOne('guild_captcha_challenges', { id: challengeId })?.expected_answer_hash) {
    const nextAttempts = challenge.attempt_count + 1;
    const expired = nextAttempts >= MAX_CHALLENGE_ATTEMPTS;
    db.update('guild_captcha_challenges', {
      attempt_count: nextAttempts,
      status: expired ? 'expired' : 'pending',
      consumed_at: expired ? nowIso() : null,
      updated_at: nowIso(),
    }, { id: challengeId });

    return {
      ok: false,
      reason: expired ? 'max_attempts' : 'invalid',
      challenge: {
        ...challenge,
        attempt_count: nextAttempts,
      },
    };
  }

  db.update('guild_captcha_challenges', {
    attempt_count: challenge.attempt_count + 1,
    status: 'completed',
    consumed_at: nowIso(),
    updated_at: nowIso(),
  }, { id: challengeId });

  return {
    ok: true,
    challenge: {
      ...challenge,
      attempt_count: challenge.attempt_count + 1,
      status: 'completed',
      consumed_at: nowIso(),
    },
  };
}

module.exports = {
  DEFAULT_CAPTCHA_CONFIG,
  DEFAULT_CHALLENGE_TYPES,
  DEFAULT_PANEL_TITLE,
  DEFAULT_PANEL_DESCRIPTION,
  DEFAULT_CHANNEL_NAME,
  DEFAULT_SUCCESS_MESSAGE,
  DEFAULT_FAILURE_MESSAGE,
  CHALLENGE_TTL_MINUTES,
  buildCaptchaCode,
  buildNumericCaptchaCode,
  getGuildCaptchaConfig,
  getGuildCaptchaConfigById,
  saveGuildCaptchaConfig,
  recordPublishedCaptchaPanel,
  createCaptchaChallenge,
  getCaptchaChallengeById,
  getActiveCaptchaChallengeById,
  validateCaptchaChallenge,
  normalizeAnswer,
};
