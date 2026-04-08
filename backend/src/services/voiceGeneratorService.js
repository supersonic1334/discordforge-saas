'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const DEFAULT_COLOR = '#22c55e';
const DEFAULT_REGION = 'auto';
const DEFAULT_CREATOR_CHANNEL_NAME = 'Creer ta voc';
const DEFAULT_ROOM_NAME_TEMPLATE = 'Vocal de {username}';
const DEFAULT_CONTROL_TITLE = 'Ta vocale temporaire';
const DEFAULT_CONTROL_DESCRIPTION = 'Utilise les menus ci-dessous pour gerer ta vocale temporaire.';
const DEFAULT_SITE_BUTTON_LABEL = 'Ouvrir DiscordForger';

const SUPPORTED_REGIONS = new Set([
  'auto',
  'brazil',
  'hongkong',
  'india',
  'japan',
  'rotterdam',
  'russia',
  'singapore',
  'southafrica',
  'sydney',
  'us-central',
  'us-east',
  'us-south',
  'us-west',
]);

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  channel_mode: 'create',
  creator_channel_id: '',
  creator_channel_name: DEFAULT_CREATOR_CHANNEL_NAME,
  creator_category_id: '',
  control_title: DEFAULT_CONTROL_TITLE,
  control_description: DEFAULT_CONTROL_DESCRIPTION,
  panel_color: DEFAULT_COLOR,
  panel_thumbnail_url: '',
  panel_image_url: '',
  site_button_label: DEFAULT_SITE_BUTTON_LABEL,
  show_site_link: true,
  room_name_template: DEFAULT_ROOM_NAME_TEMPLATE,
  default_user_limit: 0,
  default_region: DEFAULT_REGION,
  delete_when_empty: true,
  allow_claim: true,
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeSnowflake(value, fallback = '') {
  const raw = String(value ?? fallback ?? '').trim();
  return /^\d+$/.test(raw) ? raw : '';
}

function normalizeText(value, maxLength, fallback = '') {
  return String(value ?? fallback ?? '').trim().slice(0, maxLength);
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : !!fallback;
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

function normalizeChannelMode(value, fallback = 'create') {
  return ['existing', 'create'].includes(String(value || '').trim()) ? String(value || '').trim() : fallback;
}

function normalizeRegion(value, fallback = DEFAULT_REGION) {
  const next = String(value || fallback || '').trim().toLowerCase();
  return SUPPORTED_REGIONS.has(next) ? next : fallback;
}

function normalizeUserLimit(value, fallback = 0) {
  const parsed = Number(value ?? fallback ?? 0);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.min(Number(fallback || 0), 99));
  return Math.max(0, Math.min(Math.round(parsed), 99));
}

function parseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeUserIdArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((item) => normalizeSnowflake(item))
    .filter(Boolean))]
    .slice(0, 50);
}

function replaceVoiceTemplate(template, values = {}) {
  const source = String(template || DEFAULT_ROOM_NAME_TEMPLATE).trim() || DEFAULT_ROOM_NAME_TEMPLATE;
  return source
    .replace(/\{username\}/gi, String(values.username || '').trim())
    .replace(/\{display_name\}/gi, String(values.display_name || values.username || '').trim())
    .replace(/\{user_tag\}/gi, String(values.user_tag || values.username || '').trim())
    .replace(/\{number\}/gi, String(values.number || '').trim());
}

function sanitizeVoiceChannelName(value, fallback = 'vocale-temporaire') {
  const raw = String(value || fallback)
    .trim()
    .replace(/[^\p{L}\p{N}\- _]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 90);
  return raw || fallback;
}

function buildVoiceRoomName(template, values = {}) {
  return sanitizeVoiceChannelName(replaceVoiceTemplate(template, values), 'vocale-temporaire');
}

function ensureVoiceGeneratorRow(internalGuildId) {
  const existing = db.findOne('guild_voice_generators', { guild_id: internalGuildId });
  if (existing) return existing;

  const timestamp = nowIso();
  return db.insert('guild_voice_generators', {
    id: uuidv4(),
    guild_id: internalGuildId,
    enabled: 1,
    channel_mode: DEFAULT_CONFIG.channel_mode,
    creator_channel_id: '',
    creator_channel_name: DEFAULT_CONFIG.creator_channel_name,
    creator_category_id: '',
    control_title: DEFAULT_CONFIG.control_title,
    control_description: DEFAULT_CONFIG.control_description,
    panel_color: DEFAULT_CONFIG.panel_color,
    panel_thumbnail_url: '',
    panel_image_url: '',
    site_button_label: DEFAULT_CONFIG.site_button_label,
    show_site_link: 1,
    room_name_template: DEFAULT_CONFIG.room_name_template,
    default_user_limit: DEFAULT_CONFIG.default_user_limit,
    default_region: DEFAULT_CONFIG.default_region,
    delete_when_empty: 1,
    allow_claim: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function mapVoiceGeneratorRow(row) {
  const source = row || {};
  return {
    id: source.id || '',
    guild_id: source.guild_id || '',
    enabled: !!source.enabled,
    channel_mode: normalizeChannelMode(source.channel_mode, DEFAULT_CONFIG.channel_mode),
    creator_channel_id: normalizeSnowflake(source.creator_channel_id),
    creator_channel_name: normalizeText(source.creator_channel_name, 90, DEFAULT_CONFIG.creator_channel_name) || DEFAULT_CONFIG.creator_channel_name,
    creator_category_id: normalizeSnowflake(source.creator_category_id),
    control_title: normalizeText(source.control_title, 120, DEFAULT_CONFIG.control_title) || DEFAULT_CONFIG.control_title,
    control_description: normalizeText(source.control_description, 2000, DEFAULT_CONFIG.control_description) || DEFAULT_CONFIG.control_description,
    panel_color: normalizeColor(source.panel_color, DEFAULT_CONFIG.panel_color),
    panel_thumbnail_url: normalizeAssetUrl(source.panel_thumbnail_url),
    panel_image_url: normalizeAssetUrl(source.panel_image_url),
    site_button_label: normalizeText(source.site_button_label, 80, DEFAULT_CONFIG.site_button_label) || DEFAULT_CONFIG.site_button_label,
    show_site_link: !!source.show_site_link,
    room_name_template: normalizeText(source.room_name_template, 90, DEFAULT_CONFIG.room_name_template) || DEFAULT_CONFIG.room_name_template,
    default_user_limit: normalizeUserLimit(source.default_user_limit, DEFAULT_CONFIG.default_user_limit),
    default_region: normalizeRegion(source.default_region, DEFAULT_CONFIG.default_region),
    delete_when_empty: !!source.delete_when_empty,
    allow_claim: !!source.allow_claim,
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
  };
}

function mapVoiceRoomRow(row) {
  const source = row || {};
  return {
    id: source.id || '',
    guild_id: source.guild_id || '',
    generator_id: source.generator_id || '',
    owner_discord_user_id: normalizeSnowflake(source.owner_discord_user_id),
    owner_username: String(source.owner_username || ''),
    source_channel_id: normalizeSnowflake(source.source_channel_id),
    channel_id: normalizeSnowflake(source.channel_id),
    control_message_id: normalizeSnowflake(source.control_message_id),
    name: normalizeText(source.name, 90, ''),
    user_limit: normalizeUserLimit(source.user_limit, 0),
    rtc_region: normalizeRegion(source.rtc_region, DEFAULT_REGION),
    is_locked: !!source.is_locked,
    is_hidden: !!source.is_hidden,
    allowed_user_ids: normalizeUserIdArray(parseJsonArray(source.allowed_user_ids)),
    blocked_user_ids: normalizeUserIdArray(parseJsonArray(source.blocked_user_ids)),
    status: ['open', 'closed'].includes(String(source.status || '')) ? String(source.status) : 'open',
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
    closed_at: source.closed_at || null,
  };
}

function getGuildVoiceGenerator(internalGuildId) {
  return mapVoiceGeneratorRow(ensureVoiceGeneratorRow(internalGuildId));
}

function getGuildVoiceGeneratorById(generatorId) {
  const row = db.findOne('guild_voice_generators', { id: generatorId });
  return row ? mapVoiceGeneratorRow(row) : null;
}

function getGuildVoiceGeneratorForDiscord(ownerUserId, discordGuildId) {
  const guildRow = db.raw(
    `SELECT id
     FROM guilds
     WHERE user_id = ? AND guild_id = ? AND is_active = 1
     LIMIT 1`,
    [ownerUserId, discordGuildId]
  )[0];

  if (!guildRow?.id) return null;
  return getGuildVoiceGenerator(guildRow.id);
}

function saveGuildVoiceGenerator(internalGuildId, payload = {}) {
  const current = getGuildVoiceGenerator(internalGuildId);
  const nextConfig = {
    ...current,
    enabled: normalizeBoolean(payload.enabled, current.enabled),
    channel_mode: normalizeChannelMode(payload.channel_mode, current.channel_mode),
    creator_channel_id: normalizeSnowflake(payload.creator_channel_id, current.creator_channel_id),
    creator_channel_name: normalizeText(payload.creator_channel_name, 90, current.creator_channel_name) || current.creator_channel_name,
    creator_category_id: normalizeSnowflake(payload.creator_category_id, current.creator_category_id),
    control_title: normalizeText(payload.control_title, 120, current.control_title) || current.control_title,
    control_description: normalizeText(payload.control_description, 2000, current.control_description) || current.control_description,
    panel_color: normalizeColor(payload.panel_color, current.panel_color),
    panel_thumbnail_url: normalizeAssetUrl(payload.panel_thumbnail_url, current.panel_thumbnail_url),
    panel_image_url: normalizeAssetUrl(payload.panel_image_url, current.panel_image_url),
    site_button_label: normalizeText(payload.site_button_label, 80, current.site_button_label) || current.site_button_label,
    show_site_link: normalizeBoolean(payload.show_site_link, current.show_site_link),
    room_name_template: normalizeText(payload.room_name_template, 90, current.room_name_template) || current.room_name_template,
    default_user_limit: normalizeUserLimit(payload.default_user_limit, current.default_user_limit),
    default_region: normalizeRegion(payload.default_region, current.default_region),
    delete_when_empty: normalizeBoolean(payload.delete_when_empty, current.delete_when_empty),
    allow_claim: normalizeBoolean(payload.allow_claim, current.allow_claim),
  };

  db.update('guild_voice_generators', {
    enabled: nextConfig.enabled ? 1 : 0,
    channel_mode: nextConfig.channel_mode,
    creator_channel_id: nextConfig.creator_channel_id,
    creator_channel_name: nextConfig.creator_channel_name,
    creator_category_id: nextConfig.creator_category_id,
    control_title: nextConfig.control_title,
    control_description: nextConfig.control_description,
    panel_color: nextConfig.panel_color,
    panel_thumbnail_url: nextConfig.panel_thumbnail_url,
    panel_image_url: nextConfig.panel_image_url,
    site_button_label: nextConfig.site_button_label,
    show_site_link: nextConfig.show_site_link ? 1 : 0,
    room_name_template: nextConfig.room_name_template,
    default_user_limit: nextConfig.default_user_limit,
    default_region: nextConfig.default_region,
    delete_when_empty: nextConfig.delete_when_empty ? 1 : 0,
    allow_claim: nextConfig.allow_claim ? 1 : 0,
    updated_at: nowIso(),
  }, { id: current.id });

  return getGuildVoiceGenerator(internalGuildId);
}

function recordPublishedVoiceGenerator(internalGuildId, creatorChannelId) {
  const current = getGuildVoiceGenerator(internalGuildId);
  db.update('guild_voice_generators', {
    creator_channel_id: normalizeSnowflake(creatorChannelId, current.creator_channel_id),
    updated_at: nowIso(),
  }, { id: current.id });
  return getGuildVoiceGenerator(internalGuildId);
}

function listActiveVoiceRooms(internalGuildId, limit = 30) {
  const rows = db.raw(
    `SELECT *
     FROM guild_temp_voice_rooms
     WHERE guild_id = ?
       AND status = 'open'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`,
    [internalGuildId, Math.max(1, Math.min(Number(limit || 30), 100))]
  );

  return rows.map(mapVoiceRoomRow);
}

function getVoiceRoomOverview(internalGuildId) {
  const config = getGuildVoiceGenerator(internalGuildId);
  const counts = db.db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_count
    FROM guild_temp_voice_rooms
    WHERE guild_id = ?
  `).get(internalGuildId) || {};

  return {
    config,
    rooms: listActiveVoiceRooms(internalGuildId, 24),
    stats: {
      total: Number(counts.total || 0),
      open: Number(counts.open_count || 0),
      closed: Number(counts.closed_count || 0),
      published: Boolean(config.creator_channel_id),
    },
  };
}

function getTempVoiceRoomById(internalGuildId, roomId) {
  const row = db.raw(
    `SELECT *
     FROM guild_temp_voice_rooms
     WHERE guild_id = ? AND id = ?
     LIMIT 1`,
    [internalGuildId, roomId]
  )[0];

  return row ? mapVoiceRoomRow(row) : null;
}

function getTempVoiceRoomByChannelId(internalGuildId, channelId) {
  const row = db.raw(
    `SELECT *
     FROM guild_temp_voice_rooms
     WHERE guild_id = ? AND channel_id = ? AND status = 'open'
     LIMIT 1`,
    [internalGuildId, normalizeSnowflake(channelId)]
  )[0];

  return row ? mapVoiceRoomRow(row) : null;
}

function getActiveTempVoiceRoomByOwner(internalGuildId, ownerDiscordUserId) {
  const row = db.raw(
    `SELECT *
     FROM guild_temp_voice_rooms
     WHERE guild_id = ?
       AND owner_discord_user_id = ?
       AND status = 'open'
     ORDER BY created_at DESC
     LIMIT 1`,
    [internalGuildId, normalizeSnowflake(ownerDiscordUserId)]
  )[0];

  return row ? mapVoiceRoomRow(row) : null;
}

function createTempVoiceRoomEntry({
  internalGuildId,
  generatorId,
  ownerDiscordUserId,
  ownerUsername,
  sourceChannelId,
  channelId,
  name,
  userLimit = 0,
  rtcRegion = DEFAULT_REGION,
}) {
  const timestamp = nowIso();
  const created = db.insert('guild_temp_voice_rooms', {
    id: uuidv4(),
    guild_id: internalGuildId,
    generator_id: generatorId,
    owner_discord_user_id: normalizeSnowflake(ownerDiscordUserId),
    owner_username: normalizeText(ownerUsername, 120, ''),
    source_channel_id: normalizeSnowflake(sourceChannelId),
    channel_id: normalizeSnowflake(channelId),
    control_message_id: '',
    name: normalizeText(name, 90, ''),
    user_limit: normalizeUserLimit(userLimit, 0),
    rtc_region: normalizeRegion(rtcRegion, DEFAULT_REGION),
    is_locked: 0,
    is_hidden: 0,
    allowed_user_ids: '[]',
    blocked_user_ids: '[]',
    status: 'open',
    created_at: timestamp,
    updated_at: timestamp,
    closed_at: null,
  });

  return getTempVoiceRoomById(internalGuildId, created.id);
}

function updateTempVoiceRoom(internalGuildId, roomId, patch = {}) {
  const current = getTempVoiceRoomById(internalGuildId, roomId);
  if (!current) return null;

  const next = {
    ...current,
    owner_discord_user_id: normalizeSnowflake(patch.owner_discord_user_id, current.owner_discord_user_id),
    owner_username: normalizeText(patch.owner_username, 120, current.owner_username),
    channel_id: normalizeSnowflake(patch.channel_id, current.channel_id),
    control_message_id: normalizeSnowflake(patch.control_message_id, current.control_message_id),
    name: normalizeText(patch.name, 90, current.name),
    user_limit: normalizeUserLimit(patch.user_limit, current.user_limit),
    rtc_region: normalizeRegion(patch.rtc_region, current.rtc_region),
    is_locked: normalizeBoolean(patch.is_locked, current.is_locked),
    is_hidden: normalizeBoolean(patch.is_hidden, current.is_hidden),
    allowed_user_ids: normalizeUserIdArray(patch.allowed_user_ids ?? current.allowed_user_ids),
    blocked_user_ids: normalizeUserIdArray(patch.blocked_user_ids ?? current.blocked_user_ids),
    status: ['open', 'closed'].includes(String(patch.status || '')) ? String(patch.status) : current.status,
    closed_at: patch.status === 'closed'
      ? (patch.closed_at || nowIso())
      : (patch.closed_at === null ? null : current.closed_at),
  };

  db.update('guild_temp_voice_rooms', {
    owner_discord_user_id: next.owner_discord_user_id,
    owner_username: next.owner_username,
    channel_id: next.channel_id,
    control_message_id: next.control_message_id,
    name: next.name,
    user_limit: next.user_limit,
    rtc_region: next.rtc_region,
    is_locked: next.is_locked ? 1 : 0,
    is_hidden: next.is_hidden ? 1 : 0,
    allowed_user_ids: JSON.stringify(next.allowed_user_ids),
    blocked_user_ids: JSON.stringify(next.blocked_user_ids),
    status: next.status,
    closed_at: next.status === 'closed' ? (next.closed_at || nowIso()) : null,
    updated_at: nowIso(),
  }, { id: current.id });

  return getTempVoiceRoomById(internalGuildId, current.id);
}

function closeTempVoiceRoom(internalGuildId, roomId) {
  return updateTempVoiceRoom(internalGuildId, roomId, {
    status: 'closed',
    closed_at: nowIso(),
  });
}

module.exports = {
  SUPPORTED_REGIONS,
  DEFAULT_CONFIG,
  getGuildVoiceGenerator,
  getGuildVoiceGeneratorById,
  getGuildVoiceGeneratorForDiscord,
  getVoiceRoomOverview,
  saveGuildVoiceGenerator,
  recordPublishedVoiceGenerator,
  getTempVoiceRoomById,
  getTempVoiceRoomByChannelId,
  getActiveTempVoiceRoomByOwner,
  createTempVoiceRoomEntry,
  updateTempVoiceRoom,
  closeTempVoiceRoom,
  listActiveVoiceRooms,
  replaceVoiceTemplate,
  buildVoiceRoomName,
};
