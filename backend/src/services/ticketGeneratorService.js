'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');

const MAX_OPTIONS = 10;
const DEFAULT_COLOR = '#7c3aed';

const DEFAULT_OPTIONS = Object.freeze([
  {
    key: 'contact_staff',
    label: 'Contact staff',
    description: 'Parler directement avec l equipe du serveur',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: true,
    question_label: 'Pourquoi veux-tu contacter le staff ?',
    question_placeholder: 'Explique clairement ta demande...',
    modal_title: 'Contact staff',
    intro_message: 'Bonjour {mention}, ta demande a bien ete ouverte.\n\nCategorie: {label}\nRaison: {reason}',
    ticket_name_template: 'staff-{number}',
    ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}',
    enabled: true,
  },
  {
    key: 'report',
    label: 'Report',
    description: 'Signaler un membre ou un incident',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: true,
    question_label: 'Que veux-tu signaler ?',
    question_placeholder: 'Donne le plus de details possible...',
    modal_title: 'Report',
    intro_message: 'Signalement recu pour {mention}.\n\nRaison: {reason}',
    ticket_name_template: 'report-{number}',
    ticket_topic_template: 'Report #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'appeal',
    label: 'Appel sanction',
    description: 'Demander une revision de sanction',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: true,
    question_label: 'Quelle sanction veux-tu contester ?',
    question_placeholder: 'Explique la sanction et pourquoi tu fais appel...',
    modal_title: 'Appel sanction',
    intro_message: 'Appel de sanction recu pour {mention}.\n\nContexte: {reason}',
    ticket_name_template: 'appeal-{number}',
    ticket_topic_template: 'Appel #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'partnership',
    label: 'Partenariat',
    description: 'Proposer un partenariat ou une collaboration',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: false,
    question_label: 'Parle-nous de ton partenariat',
    question_placeholder: 'Serveur, objectifs, lien, idee...',
    modal_title: 'Partenariat',
    intro_message: 'Demande partenariat ouverte pour {mention}.\n\nDetails: {reason}',
    ticket_name_template: 'partner-{number}',
    ticket_topic_template: 'Partenariat #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'purchase',
    label: 'Achat',
    description: 'Question commerciale ou achat de service',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: false,
    question_label: 'De quoi as-tu besoin ?',
    question_placeholder: 'Produit, offre, budget, informations...',
    modal_title: 'Achat',
    intro_message: 'Demande commerciale ouverte pour {mention}.\n\nBesoin: {reason}',
    ticket_name_template: 'purchase-{number}',
    ticket_topic_template: 'Achat #{number} | {user_tag}',
    enabled: true,
  },
  {
    key: 'recruitment',
    label: 'Recrutement',
    description: 'Postuler ou contacter l equipe recrutement',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: false,
    question_label: 'Pourquoi souhaites-tu rejoindre l equipe ?',
    question_placeholder: 'Experience, disponibilites, motivations...',
    modal_title: 'Recrutement',
    intro_message: 'Candidature recue pour {mention}.\n\nProfil: {reason}',
    ticket_name_template: 'recruit-{number}',
    ticket_topic_template: 'Recrutement #{number} | {user_tag}',
    enabled: false,
  },
  {
    key: 'other_request',
    label: 'Autre demande',
    description: 'Toute autre demande a traiter par le staff',
    emoji: '',
    category_id: '',
    role_ids: [],
    ping_roles: false,
    question_label: 'Explique ta demande',
    question_placeholder: 'Decris precisement ce dont tu as besoin...',
    modal_title: 'Autre demande',
    intro_message: 'Nouvelle demande ouverte pour {mention}.\n\nDetails: {reason}',
    ticket_name_template: 'request-{number}',
    ticket_topic_template: 'Demande #{number} | {user_tag}',
    enabled: true,
  },
]);

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  panel_channel_id: '',
  panel_message_id: '',
  panel_title: 'Support & tickets',
  panel_description: 'Besoin d aide ? Ouvre un ticket depuis le menu ci-dessous et notre equipe te repondra dans un salon prive des que possible.',
  panel_footer: 'Une seule demande active par categorie si la protection anti-doublon est active.',
  menu_placeholder: 'Choisir le type de ticket',
  panel_color: DEFAULT_COLOR,
  panel_thumbnail_url: '',
  panel_image_url: '',
  default_category_id: '',
  ticket_name_template: 'ticket-{number}',
  ticket_topic_template: 'Ticket #{number} | {label} | {user_tag}',
  intro_message: 'Bonjour {mention}, ton ticket est bien cree.\n\nCategorie: {label}\nRaison: {reason}',
  claim_message: 'Ticket pris en charge par {claimer}.',
  close_message: 'Ticket ferme par {closer}.',
  auto_ping_support: true,
  allow_user_close: true,
  prevent_duplicates: true,
  options: DEFAULT_OPTIONS,
});

function nowIso() {
  return new Date().toISOString();
}

function parseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeSnowflake(value, fallbackValue = '') {
  const raw = String(value ?? fallbackValue ?? '').trim();
  return /^\d+$/.test(raw) ? raw : '';
}

function normalizeBoolean(value, fallbackValue = false) {
  return !!(value ?? fallbackValue);
}

function normalizeColor(value, fallbackValue = DEFAULT_COLOR) {
  const raw = String(value || fallbackValue || '').trim();
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_COLOR;
}

function normalizeAssetUrl(value, fallbackValue = '') {
  const raw = String(value ?? fallbackValue ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\/\S+$/i.test(raw)) return raw.slice(0, 1_200_000);
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw.slice(0, 1_200_000);
  return String(fallbackValue || '').trim().slice(0, 1_200_000);
}

function sanitizeOptionKey(value, fallback = 'ticket') {
  const raw = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return raw || fallback;
}

function normalizeRoleIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeSnowflake(value))
    .filter(Boolean))]
    .slice(0, 12);
}

function normalizeText(value, maxLength, fallback = '') {
  const trimmed = String(value ?? fallback ?? '').trim();
  return trimmed.slice(0, maxLength);
}

function normalizeOption(rawOption = {}, fallback = {}, index = 0) {
  const baseLabel = normalizeText(rawOption.label, 40, fallback.label || `Ticket ${index + 1}`) || `Ticket ${index + 1}`;
  return {
    key: sanitizeOptionKey(rawOption.key, fallback.key || `ticket_${index + 1}`),
    label: baseLabel,
    description: normalizeText(rawOption.description, 100, fallback.description || ''),
    emoji: normalizeText(rawOption.emoji, 10, fallback.emoji || ''),
    category_id: normalizeSnowflake(rawOption.category_id, fallback.category_id),
    role_ids: normalizeRoleIds(rawOption.role_ids ?? fallback.role_ids ?? []),
    ping_roles: normalizeBoolean(rawOption.ping_roles, fallback.ping_roles ?? true),
    question_label: normalizeText(rawOption.question_label, 45, fallback.question_label || 'Pourquoi ouvres-tu ce ticket ?') || 'Pourquoi ouvres-tu ce ticket ?',
    question_placeholder: normalizeText(rawOption.question_placeholder, 100, fallback.question_placeholder || 'Explique ta demande...'),
    modal_title: normalizeText(rawOption.modal_title, 45, fallback.modal_title || baseLabel) || baseLabel,
    intro_message: normalizeText(rawOption.intro_message, 1600, fallback.intro_message || ''),
    ticket_name_template: normalizeText(rawOption.ticket_name_template, 80, fallback.ticket_name_template || ''),
    ticket_topic_template: normalizeText(rawOption.ticket_topic_template, 220, fallback.ticket_topic_template || ''),
    enabled: normalizeBoolean(rawOption.enabled, fallback.enabled ?? true),
  };
}

function mergeOptions(rawOptions = []) {
  const input = Array.isArray(rawOptions) && rawOptions.length > 0 ? rawOptions : DEFAULT_OPTIONS;
  const seenKeys = new Set();
  const normalized = [];

  input.slice(0, MAX_OPTIONS).forEach((option, index) => {
    const fallback = DEFAULT_OPTIONS.find((item) => item.key === String(option?.key || '').trim()) || DEFAULT_OPTIONS[index] || {};
    const nextOption = normalizeOption(option, fallback, index);
    let nextKey = nextOption.key;

    while (seenKeys.has(nextKey)) {
      nextKey = sanitizeOptionKey(`${nextOption.key}_${normalized.length + 1}`);
    }

    seenKeys.add(nextKey);
    normalized.push({
      ...nextOption,
      key: nextKey,
    });
  });

  return normalized;
}

function ensureGeneratorRow(internalGuildId) {
  const existing = db.findOne('guild_ticket_generators', { guild_id: internalGuildId });
  if (existing) return existing;

  const timestamp = nowIso();
  const created = db.insert('guild_ticket_generators', {
    id: uuidv4(),
    guild_id: internalGuildId,
    enabled: 1,
    panel_channel_id: '',
    panel_message_id: '',
    panel_title: DEFAULT_CONFIG.panel_title,
    panel_description: DEFAULT_CONFIG.panel_description,
    panel_footer: DEFAULT_CONFIG.panel_footer,
    menu_placeholder: DEFAULT_CONFIG.menu_placeholder,
    panel_color: DEFAULT_CONFIG.panel_color,
    panel_thumbnail_url: DEFAULT_CONFIG.panel_thumbnail_url,
    panel_image_url: DEFAULT_CONFIG.panel_image_url,
    default_category_id: '',
    ticket_name_template: DEFAULT_CONFIG.ticket_name_template,
    ticket_topic_template: DEFAULT_CONFIG.ticket_topic_template,
    intro_message: DEFAULT_CONFIG.intro_message,
    claim_message: DEFAULT_CONFIG.claim_message,
    close_message: DEFAULT_CONFIG.close_message,
    auto_ping_support: 1,
    allow_user_close: 1,
    prevent_duplicates: 1,
    options_json: JSON.stringify(DEFAULT_OPTIONS),
    created_at: timestamp,
    updated_at: timestamp,
  });

  return created;
}

function mapGeneratorRow(row) {
  const source = row || {};
  return {
    id: source.id || '',
    guild_id: source.guild_id || '',
    enabled: !!source.enabled,
    panel_channel_id: normalizeSnowflake(source.panel_channel_id),
    panel_message_id: normalizeSnowflake(source.panel_message_id),
    panel_title: normalizeText(source.panel_title, 120, DEFAULT_CONFIG.panel_title) || DEFAULT_CONFIG.panel_title,
    panel_description: normalizeText(source.panel_description, 2000, DEFAULT_CONFIG.panel_description),
    panel_footer: normalizeText(source.panel_footer, 200, DEFAULT_CONFIG.panel_footer),
    menu_placeholder: normalizeText(source.menu_placeholder, 120, DEFAULT_CONFIG.menu_placeholder) || DEFAULT_CONFIG.menu_placeholder,
    panel_color: normalizeColor(source.panel_color, DEFAULT_CONFIG.panel_color),
    panel_thumbnail_url: normalizeAssetUrl(source.panel_thumbnail_url, DEFAULT_CONFIG.panel_thumbnail_url),
    panel_image_url: normalizeAssetUrl(source.panel_image_url, DEFAULT_CONFIG.panel_image_url),
    default_category_id: normalizeSnowflake(source.default_category_id),
    ticket_name_template: normalizeText(source.ticket_name_template, 80, DEFAULT_CONFIG.ticket_name_template) || DEFAULT_CONFIG.ticket_name_template,
    ticket_topic_template: normalizeText(source.ticket_topic_template, 220, DEFAULT_CONFIG.ticket_topic_template) || DEFAULT_CONFIG.ticket_topic_template,
    intro_message: normalizeText(source.intro_message, 1600, DEFAULT_CONFIG.intro_message),
    claim_message: normalizeText(source.claim_message, 240, DEFAULT_CONFIG.claim_message) || DEFAULT_CONFIG.claim_message,
    close_message: normalizeText(source.close_message, 240, DEFAULT_CONFIG.close_message) || DEFAULT_CONFIG.close_message,
    auto_ping_support: !!source.auto_ping_support,
    allow_user_close: !!source.allow_user_close,
    prevent_duplicates: !!source.prevent_duplicates,
    options: mergeOptions(parseJsonArray(source.options_json)),
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
  };
}

function mapTicketEntry(row) {
  const source = row || {};
  return {
    id: source.id || '',
    guild_id: source.guild_id || '',
    generator_id: source.generator_id || '',
    option_key: source.option_key || '',
    ticket_number: Number(source.ticket_number || 0),
    channel_id: normalizeSnowflake(source.channel_id),
    creator_discord_user_id: normalizeSnowflake(source.creator_discord_user_id),
    creator_username: source.creator_username || '',
    claimed_by_discord_user_id: normalizeSnowflake(source.claimed_by_discord_user_id),
    claimed_by_username: source.claimed_by_username || '',
    closed_by_discord_user_id: normalizeSnowflake(source.closed_by_discord_user_id),
    closed_by_username: source.closed_by_username || '',
    reason: source.reason || '',
    subject: source.subject || '',
    status: ['open', 'claimed', 'closed'].includes(source.status) ? source.status : 'open',
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
    claimed_at: source.claimed_at || null,
    closed_at: source.closed_at || null,
  };
}

function getGuildTicketGenerator(internalGuildId) {
  return mapGeneratorRow(ensureGeneratorRow(internalGuildId));
}

function getGuildTicketGeneratorById(generatorId) {
  const row = db.findOne('guild_ticket_generators', { id: generatorId });
  return row ? mapGeneratorRow(row) : null;
}

function getGuildTicketGeneratorForDiscord(ownerUserId, discordGuildId) {
  const guildRow = db.raw(
    `SELECT id
     FROM guilds
     WHERE user_id = ? AND guild_id = ? AND is_active = 1
     LIMIT 1`,
    [ownerUserId, discordGuildId]
  )[0];

  if (!guildRow?.id) return null;
  return getGuildTicketGenerator(guildRow.id);
}

function listTicketEntries(internalGuildId, limit = 30) {
  const rows = db.raw(
    `SELECT *
     FROM guild_ticket_entries
     WHERE guild_id = ?
     ORDER BY updated_at DESC, ticket_number DESC
     LIMIT ?`,
    [internalGuildId, Math.max(1, Math.min(Number(limit || 30), 100))]
  );

  return rows.map(mapTicketEntry);
}

function getTicketOverview(internalGuildId) {
  const config = getGuildTicketGenerator(internalGuildId);
  const counts = db.db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_count
    FROM guild_ticket_entries
    WHERE guild_id = ?
  `).get(internalGuildId) || {};

  return {
    config,
    tickets: listTicketEntries(internalGuildId, 24),
    stats: {
      total: Number(counts.total || 0),
      open: Number(counts.open_count || 0),
      claimed: Number(counts.claimed_count || 0),
      closed: Number(counts.closed_count || 0),
      forms: config.options.filter((option) => option.enabled).length,
    },
  };
}

function saveGuildTicketGenerator(internalGuildId, payload = {}) {
  const current = getGuildTicketGenerator(internalGuildId);
  const timestamp = nowIso();
  const nextConfig = {
    ...current,
    enabled: normalizeBoolean(payload.enabled, current.enabled),
    panel_channel_id: normalizeSnowflake(payload.panel_channel_id, current.panel_channel_id),
    panel_message_id: normalizeSnowflake(payload.panel_message_id, current.panel_message_id),
    panel_title: normalizeText(payload.panel_title, 120, current.panel_title) || current.panel_title,
    panel_description: normalizeText(payload.panel_description, 2000, current.panel_description),
    panel_footer: normalizeText(payload.panel_footer, 200, current.panel_footer),
    menu_placeholder: normalizeText(payload.menu_placeholder, 120, current.menu_placeholder) || current.menu_placeholder,
    panel_color: normalizeColor(payload.panel_color, current.panel_color),
    panel_thumbnail_url: normalizeAssetUrl(payload.panel_thumbnail_url, current.panel_thumbnail_url),
    panel_image_url: normalizeAssetUrl(payload.panel_image_url, current.panel_image_url),
    default_category_id: normalizeSnowflake(payload.default_category_id, current.default_category_id),
    ticket_name_template: normalizeText(payload.ticket_name_template, 80, current.ticket_name_template) || current.ticket_name_template,
    ticket_topic_template: normalizeText(payload.ticket_topic_template, 220, current.ticket_topic_template) || current.ticket_topic_template,
    intro_message: normalizeText(payload.intro_message, 1600, current.intro_message),
    claim_message: normalizeText(payload.claim_message, 240, current.claim_message) || current.claim_message,
    close_message: normalizeText(payload.close_message, 240, current.close_message) || current.close_message,
    auto_ping_support: normalizeBoolean(payload.auto_ping_support, current.auto_ping_support),
    allow_user_close: normalizeBoolean(payload.allow_user_close, current.allow_user_close),
    prevent_duplicates: normalizeBoolean(payload.prevent_duplicates, current.prevent_duplicates),
    options: mergeOptions(payload.options ?? current.options),
    updated_at: timestamp,
  };

  db.update('guild_ticket_generators', {
    enabled: nextConfig.enabled ? 1 : 0,
    panel_channel_id: nextConfig.panel_channel_id,
    panel_message_id: nextConfig.panel_message_id,
    panel_title: nextConfig.panel_title,
    panel_description: nextConfig.panel_description,
    panel_footer: nextConfig.panel_footer,
    menu_placeholder: nextConfig.menu_placeholder,
    panel_color: nextConfig.panel_color,
    panel_thumbnail_url: nextConfig.panel_thumbnail_url,
    panel_image_url: nextConfig.panel_image_url,
    default_category_id: nextConfig.default_category_id,
    ticket_name_template: nextConfig.ticket_name_template,
    ticket_topic_template: nextConfig.ticket_topic_template,
    intro_message: nextConfig.intro_message,
    claim_message: nextConfig.claim_message,
    close_message: nextConfig.close_message,
    auto_ping_support: nextConfig.auto_ping_support ? 1 : 0,
    allow_user_close: nextConfig.allow_user_close ? 1 : 0,
    prevent_duplicates: nextConfig.prevent_duplicates ? 1 : 0,
    options_json: JSON.stringify(nextConfig.options),
    updated_at: timestamp,
  }, { id: current.id });

  return getGuildTicketGenerator(internalGuildId);
}

function recordPublishedPanel(internalGuildId, panelChannelId, panelMessageId) {
  const current = getGuildTicketGenerator(internalGuildId);
  db.update('guild_ticket_generators', {
    panel_channel_id: normalizeSnowflake(panelChannelId, current.panel_channel_id),
    panel_message_id: normalizeSnowflake(panelMessageId, current.panel_message_id),
    updated_at: nowIso(),
  }, { id: current.id });
  return getGuildTicketGenerator(internalGuildId);
}

function getTicketEntryById(internalGuildId, entryId) {
  const row = db.raw(
    `SELECT *
     FROM guild_ticket_entries
     WHERE guild_id = ? AND id = ?
     LIMIT 1`,
    [internalGuildId, entryId]
  )[0];

  return row ? mapTicketEntry(row) : null;
}

function getOpenTicketByChannelId(internalGuildId, channelId) {
  const row = db.raw(
    `SELECT *
     FROM guild_ticket_entries
     WHERE guild_id = ? AND channel_id = ? AND status IN ('open', 'claimed')
     LIMIT 1`,
    [internalGuildId, normalizeSnowflake(channelId)]
  )[0];

  return row ? mapTicketEntry(row) : null;
}

function findDuplicateOpenTicket(internalGuildId, creatorDiscordUserId, optionKey) {
  const row = db.raw(
    `SELECT *
     FROM guild_ticket_entries
     WHERE guild_id = ?
       AND creator_discord_user_id = ?
       AND option_key = ?
       AND status IN ('open', 'claimed')
     ORDER BY created_at DESC
     LIMIT 1`,
    [internalGuildId, normalizeSnowflake(creatorDiscordUserId), String(optionKey || '')]
  )[0];

  return row ? mapTicketEntry(row) : null;
}

function getNextTicketNumber(internalGuildId) {
  return Number(
    db.db.prepare(
      'SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number FROM guild_ticket_entries WHERE guild_id = ?'
    ).get(internalGuildId)?.next_number || 1
  );
}

function createTicketEntry({
  internalGuildId,
  generatorId,
  optionKey,
  channelId,
  creatorDiscordUserId,
  creatorUsername,
  reason,
  subject,
  ticketNumber,
}) {
  const timestamp = nowIso();
  const entry = db.insert('guild_ticket_entries', {
    id: uuidv4(),
    guild_id: internalGuildId,
    generator_id: generatorId,
    option_key: String(optionKey || '').trim(),
    ticket_number: Number(ticketNumber || getNextTicketNumber(internalGuildId)),
    channel_id: normalizeSnowflake(channelId),
    creator_discord_user_id: normalizeSnowflake(creatorDiscordUserId),
    creator_username: normalizeText(creatorUsername, 120, ''),
    claimed_by_discord_user_id: '',
    claimed_by_username: '',
    closed_by_discord_user_id: '',
    closed_by_username: '',
    reason: normalizeText(reason, 2000, ''),
    subject: normalizeText(subject, 240, ''),
    status: 'open',
    created_at: timestamp,
    updated_at: timestamp,
    claimed_at: null,
    closed_at: null,
  });

  return mapTicketEntry(entry);
}

function claimTicketEntry(internalGuildId, entryId, claimerUserId, claimerUsername) {
  const timestamp = nowIso();
  const current = getTicketEntryById(internalGuildId, entryId);
  if (!current) return null;

  db.update('guild_ticket_entries', {
    status: 'claimed',
    claimed_by_discord_user_id: normalizeSnowflake(claimerUserId),
    claimed_by_username: normalizeText(claimerUsername, 120, ''),
    claimed_at: timestamp,
    updated_at: timestamp,
  }, { id: entryId });

  return getTicketEntryById(internalGuildId, entryId);
}

function closeTicketEntry(internalGuildId, entryId, closerUserId, closerUsername) {
  const timestamp = nowIso();
  const current = getTicketEntryById(internalGuildId, entryId);
  if (!current) return null;

  db.update('guild_ticket_entries', {
    status: 'closed',
    closed_by_discord_user_id: normalizeSnowflake(closerUserId),
    closed_by_username: normalizeText(closerUsername, 120, ''),
    closed_at: timestamp,
    updated_at: timestamp,
  }, { id: entryId });

  return getTicketEntryById(internalGuildId, entryId);
}

function replaceTicketTemplate(template, values = {}) {
  return String(template || '').replace(/\{([a-z_]+)\}/gi, (_, key) => {
    const lookup = String(key || '').toLowerCase();
    return String(values[lookup] ?? '');
  });
}

function buildTicketChannelName(template, values = {}) {
  const replaced = replaceTicketTemplate(template, values)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);

  return replaced || `ticket-${String(values.number || '1')}`;
}

module.exports = {
  DEFAULT_TICKET_CONFIG: DEFAULT_CONFIG,
  getGuildTicketGenerator,
  getGuildTicketGeneratorById,
  getGuildTicketGeneratorForDiscord,
  getTicketOverview,
  listTicketEntries,
  saveGuildTicketGenerator,
  recordPublishedPanel,
  getNextTicketNumber,
  getTicketEntryById,
  getOpenTicketByChannelId,
  findDuplicateOpenTicket,
  createTicketEntry,
  claimTicketEntry,
  closeTicketEntry,
  replaceTicketTemplate,
  buildTicketChannelName,
};
