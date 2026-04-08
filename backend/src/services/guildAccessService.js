'use strict';

const { v4: uuidv4 } = require('uuid');
const { randomBytes } = require('crypto');

const db = require('../database');
const { initializeDefaultModules } = require('./guildSyncService');
const {
  DEFAULT_TICKET_CONFIG,
  getGuildTicketGenerator,
  saveGuildTicketGenerator,
} = require('./ticketGeneratorService');
const {
  DEFAULT_CAPTCHA_CONFIG,
  getGuildCaptchaConfig,
  saveGuildCaptchaConfig,
} = require('./captchaGeneratorService');

const ACCESS_ROLES = ['admin', 'moderator', 'viewer'];

function normalizeLookup(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAccessRole(value) {
  return ACCESS_ROLES.includes(value) ? value : 'admin';
}

function buildAccessCode() {
  let raw = '';
  while (raw.length < 30) {
    raw += randomBytes(24)
      .toString('base64url')
      .toUpperCase()
      .replace(/[01ILO]/g, '')
      .replace(/[^A-Z2-9]/g, '');
  }

  return raw
    .slice(0, 30)
    .match(/.{1,6}/g)
    .join('-');
}

function maskAccessCode(code) {
  const raw = String(code || '').trim().toUpperCase();
  if (!raw) return '';
  return raw.length <= 4 ? raw : `${raw.slice(0, 4)}••••`;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeActivityDetails(details, metadata = {}) {
  if (Array.isArray(details)) {
    return details
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  if (typeof details === 'string') {
    const trimmed = details.trim();
    return trimmed ? [trimmed] : [];
  }
  if (details && typeof details === 'object') {
    return details;
  }

  const fallbackDetails = [];
  if (metadata.command_trigger) fallbackDetails.push(`Declencheur : ${metadata.command_trigger}`);
  if (metadata.command_type) fallbackDetails.push(`Mode : ${metadata.command_type}`);
  return fallbackDetails;
}

function mapCollabAuditRow(row) {
  return {
    id: row.id,
    source: 'collab',
    action_type: row.action_type,
    action_label: null,
    target: row.target || null,
    details: parseJson(row.raw_payload, {}),
    created_at: row.created_at,
    actor_user_id: row.actor_user_id || null,
    actor_display_name: row.actor_display_name || 'Inconnu',
    actor_avatar_url: row.actor_avatar_url || null,
  };
}

function mapSiteActionRow(row) {
  const metadata = parseJson(row.raw_payload, {});
  const details = normalizeActivityDetails(metadata.details, metadata);

  return {
    id: `site:${row.id}`,
    source: 'site_action',
    action_type: 'site_action',
    action_label: String(metadata.action_label || metadata.action || 'Action synchronisee').trim(),
    target: String(metadata.target_label || metadata.command_trigger || row.target || '').trim() || null,
    details,
    created_at: row.created_at,
    actor_user_id: row.actor_user_id || null,
    actor_display_name: row.actor_display_name || String(metadata.actor_name || 'Inconnu').trim() || 'Inconnu',
    actor_avatar_url: row.actor_avatar_url || null,
  };
}

function getDiscordDisplayName(row = {}) {
  return row.discord_global_name || row.discord_username || row.username || 'Inconnu';
}

function getProfileAvatarUrl(row = {}) {
  return row.discord_avatar_url || row.avatar_url || null;
}

// ── Audit logging ──────────────────────────────────────────────────────────────

function logCollabAction({ guildId, actorUserId, actorUsername, actionType, target, details }) {
  db.insert('collaboration_audit_log', {
    guild_id: guildId,
    actor_user_id: actorUserId,
    actor_username: actorUsername || null,
    action_type: actionType,
    target: target || null,
    details: JSON.stringify(details || {}),
    created_at: new Date().toISOString(),
  });
}

function listCollabAuditLog(guildId, { page = 1, limit = 30, excludeActorUserId = null } = {}) {
  const offset = (page - 1) * limit;
  const collabWhereSql = excludeActorUserId
    ? 'WHERE log.guild_id = ? AND log.actor_user_id != ?'
    : 'WHERE log.guild_id = ?';
  const siteActionWhereSql = excludeActorUserId
    ? 'WHERE bot.guild_id = ? AND bot.category = ? AND (bot.user_id IS NULL OR bot.user_id != ?)'
    : 'WHERE bot.guild_id = ? AND bot.category = ?';
  const collabParams = excludeActorUserId ? [guildId, excludeActorUserId] : [guildId];
  const siteActionParams = excludeActorUserId ? [guildId, 'site_action', excludeActorUserId] : [guildId, 'site_action'];
  const collabTotal = db.db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM collaboration_audit_log log
    ${collabWhereSql}
  `).get(...collabParams)?.cnt || 0;
  const siteActionTotal = db.db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM bot_logs bot
    ${siteActionWhereSql}
  `).get(...siteActionParams)?.cnt || 0;
  const total = Number(collabTotal || 0) + Number(siteActionTotal || 0);
  const rows = db.db.prepare(`
    SELECT *
    FROM (
      SELECT
        log.id AS id,
        'collab' AS source,
        log.action_type AS action_type,
        log.target AS target,
        log.details AS raw_payload,
        log.created_at AS created_at,
        log.actor_user_id AS actor_user_id,
        COALESCE(users.discord_global_name, users.discord_username, log.actor_username, 'Inconnu') AS actor_display_name,
        COALESCE(users.discord_avatar_url, users.avatar_url, NULL) AS actor_avatar_url
      FROM collaboration_audit_log log
      LEFT JOIN users ON users.id = log.actor_user_id
      ${collabWhereSql}

      UNION ALL

      SELECT
        bot.id AS id,
        'site_action' AS source,
        'site_action' AS action_type,
        bot.message AS target,
        bot.metadata AS raw_payload,
        bot.created_at AS created_at,
        bot.user_id AS actor_user_id,
        COALESCE(users.discord_global_name, users.discord_username, users.username, 'Inconnu') AS actor_display_name,
        COALESCE(users.discord_avatar_url, users.avatar_url, NULL) AS actor_avatar_url
      FROM bot_logs bot
      LEFT JOIN users ON users.id = bot.user_id
      ${siteActionWhereSql}
    ) merged
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...collabParams, ...siteActionParams, limit, offset);

  return {
    items: rows.map((row) => (row.source === 'site_action' ? mapSiteActionRow(row) : mapCollabAuditRow(row))),
    total,
    page,
    limit,
  };
}

// ── Expiration check ───────────────────────────────────────────────────────────

function isAccessExpired(member) {
  if (!member?.expires_at) return false;
  return new Date(member.expires_at) <= new Date();
}

function cleanupExpiredAccess(guildId) {
  const now = new Date().toISOString();
  const result = db.db.prepare(`
    DELETE FROM guild_access_members
    WHERE guild_id = ? AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(guildId, now);
  return result.changes || 0;
}

function clearExpiredSuspensions({ guildId = null, userId = null } = {}) {
  const conditions = ['is_suspended = 1', 'suspended_until IS NOT NULL', 'suspended_until <= ?'];
  const params = [new Date().toISOString()];

  if (guildId) {
    conditions.push('guild_id = ?');
    params.push(guildId);
  }
  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }

  const result = db.db.prepare(`
    UPDATE guild_access_members
    SET is_suspended = 0, suspended_until = NULL, updated_at = ?
    WHERE ${conditions.join(' AND ')}
  `).run(new Date().toISOString(), ...params);

  return result.changes || 0;
}

function cleanupExpiredCodes(guildId = null) {
  const now = new Date().toISOString();
  if (guildId) {
    const result = db.db.prepare(`
      DELETE FROM guild_access_codes
      WHERE guild_id = ?
        AND used_at IS NULL
        AND revoked_at IS NULL
        AND expires_at IS NOT NULL
        AND expires_at <= ?
    `).run(guildId, now);
    return result.changes || 0;
  }

  const result = db.db.prepare(`
    DELETE FROM guild_access_codes
    WHERE used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at <= ?
  `).run(now);
  return result.changes || 0;
}

// ── Core access logic ──────────────────────────────────────────────────────────

function getGuildAccess(userId, guildId) {
  // Cleanup expired members first
  cleanupExpiredAccess(guildId);
  clearExpiredSuspensions({ guildId, userId });

  const row = db.db.prepare(`
    SELECT
      g.*,
      owner.username AS owner_username,
      owner.avatar_url AS owner_avatar_url,
      owner.email AS owner_email,
      gam.id AS member_id,
      gam.access_role AS member_access_role,
      gam.is_suspended AS member_is_suspended,
      gam.suspended_until AS member_suspended_until,
      gam.expires_at AS member_expires_at,
      gam.accepted_at AS member_accepted_at
    FROM guilds g
    JOIN users owner ON owner.id = g.user_id
    LEFT JOIN guild_access_members gam
      ON gam.guild_id = g.id
      AND gam.user_id = ?
    WHERE g.id = ?
      AND g.is_active = 1
    LIMIT 1
  `).get(userId, guildId);

  if (!row) return null;

  const isOwner = row.user_id === userId;
  if (!isOwner && !row.member_id) return null;

  // Suspended members are denied access
  if (!isOwner && row.member_is_suspended) return null;

  return {
    guild: {
      id: row.id,
      user_id: row.user_id,
      guild_id: row.guild_id,
      name: row.name,
      icon: row.icon,
      member_count: row.member_count,
      owner_id: row.owner_id,
      features: row.features,
      is_active: row.is_active,
      bot_joined_at: row.bot_joined_at,
      last_synced_at: row.last_synced_at,
      discord_logs_cleared_before: row.discord_logs_cleared_before || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    owner_user_id: row.user_id,
    owner_username: row.owner_username,
    owner_avatar_url: row.owner_avatar_url || null,
    owner_email: row.owner_email,
    is_owner: isOwner,
    access_role: isOwner ? 'owner' : normalizeAccessRole(row.member_access_role),
    member_id: row.member_id || null,
    accepted_at: row.member_accepted_at || null,
  };
}

function listAccessibleGuilds(userId) {
  // Cleanup all expired access for this user
  const now = new Date().toISOString();
  db.db.prepare(`
    DELETE FROM guild_access_members
    WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?
  `).run(userId, now);
  clearExpiredSuspensions({ userId });

  return db.db.prepare(`
    SELECT
      g.*,
      owner.username AS owner_username,
      owner.avatar_url AS owner_avatar_url,
      CASE WHEN g.user_id = ? THEN 1 ELSE 0 END AS is_owner,
      CASE
        WHEN g.user_id = ? THEN 'owner'
        ELSE COALESCE(gam.access_role, 'viewer')
      END AS access_role
    FROM guilds g
    JOIN users owner ON owner.id = g.user_id
    LEFT JOIN guild_access_members gam
      ON gam.guild_id = g.id
      AND gam.user_id = ?
    WHERE g.is_active = 1
      AND (g.user_id = ? OR (gam.user_id IS NOT NULL AND gam.is_suspended = 0))
    ORDER BY
      CASE WHEN g.user_id = ? THEN 0 ELSE 1 END,
      lower(g.name) ASC
  `).all(userId, userId, userId, userId, userId);
}

function listGuildCollaborators(guildId) {
  // Cleanup expired
  cleanupExpiredAccess(guildId);
  clearExpiredSuspensions({ guildId });

  const guild = db.findOne('guilds', { id: guildId });
  if (!guild) return [];

  const owner = db.findOne('users', { id: guild.user_id });
  const members = db.db.prepare(`
    SELECT
      gam.*,
      u.username,
      u.avatar_url,
      u.email,
      u.discord_id,
      u.discord_username,
      u.discord_global_name,
      u.discord_avatar_url,
      gam.suspended_until
    FROM guild_access_members gam
    JOIN users u ON u.id = gam.user_id
    WHERE gam.guild_id = ?
    ORDER BY
      CASE gam.access_role
        WHEN 'admin' THEN 0
        WHEN 'moderator' THEN 1
        ELSE 2
      END,
      lower(u.username) ASC
  `).all(guildId);

  const rows = [];

  if (owner) {
    rows.push({
      id: `owner:${owner.id}`,
      user_id: owner.id,
      username: owner.username,
      avatar_url: owner.avatar_url || null,
      site_username: owner.username,
      site_avatar_url: owner.avatar_url || null,
      email: owner.email,
      discord_id: owner.discord_id || null,
      discord_username: owner.discord_username || null,
      discord_global_name: owner.discord_global_name || null,
      discord_avatar_url: owner.discord_avatar_url || null,
      display_name: getDiscordDisplayName(owner),
      profile_avatar_url: getProfileAvatarUrl(owner),
      access_role: 'owner',
      is_owner: true,
      is_suspended: false,
      suspended_until: null,
      expires_at: null,
      accepted_at: guild.created_at,
      created_at: guild.created_at,
      updated_at: guild.updated_at,
    });
  }

  for (const member of members) {
    rows.push({
      id: member.id,
      user_id: member.user_id,
      username: member.username,
      avatar_url: member.avatar_url || null,
      site_username: member.username,
      site_avatar_url: member.avatar_url || null,
      email: member.email,
      discord_id: member.discord_id || null,
      discord_username: member.discord_username || null,
      discord_global_name: member.discord_global_name || null,
      discord_avatar_url: member.discord_avatar_url || null,
      display_name: getDiscordDisplayName(member),
      profile_avatar_url: getProfileAvatarUrl(member),
      access_role: normalizeAccessRole(member.access_role),
      is_owner: false,
      is_suspended: !!member.is_suspended,
      suspended_until: member.suspended_until || null,
      expires_at: member.expires_at || null,
      accepted_at: member.accepted_at,
      created_at: member.created_at,
      updated_at: member.updated_at,
    });
  }

  return rows;
}

function listGuildJoinCodes(guildId) {
  cleanupExpiredCodes(guildId);

  return db.db.prepare(`
    SELECT
      codes.*,
      users.username AS created_by_username,
      users.avatar_url AS created_by_site_avatar_url,
      users.discord_username AS created_by_discord_username,
      users.discord_global_name AS created_by_discord_global_name,
      users.discord_avatar_url AS created_by_discord_avatar_url
    FROM guild_access_codes codes
    LEFT JOIN users ON users.id = codes.created_by_user_id
    WHERE codes.guild_id = ?
      AND codes.used_at IS NULL
      AND codes.revoked_at IS NULL
    ORDER BY codes.created_at DESC
  `).all(guildId).map((row) => ({
    id: row.id,
    code: row.code,
    code_masked: maskAccessCode(row.code),
    access_role: normalizeAccessRole(row.access_role),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at || null,
    created_by_user_id: row.created_by_user_id || null,
    created_by_username: row.created_by_username || 'Inconnu',
    created_by_display_name: getDiscordDisplayName({
      username: row.created_by_username,
      discord_username: row.created_by_discord_username,
      discord_global_name: row.created_by_discord_global_name,
    }),
    created_by_avatar_url: row.created_by_discord_avatar_url || row.created_by_site_avatar_url || null,
  }));
}

function listGuildJoinRequests(guildId, { status = 'pending' } = {}) {
  const params = [guildId];
  let statusSql = '';
  if (status) {
    statusSql = 'AND req.request_status = ?';
    params.push(String(status).trim().toLowerCase());
  }

  return db.db.prepare(`
    SELECT
      req.*,
      requester.username AS requester_username,
      requester.avatar_url AS requester_site_avatar_url,
      requester.discord_id AS requester_discord_id,
      requester.discord_username AS requester_discord_username,
      requester.discord_global_name AS requester_discord_global_name,
      requester.discord_avatar_url AS requester_discord_avatar_url,
      requester.email AS requester_email,
      decider.username AS decided_by_username,
      decider.discord_username AS decided_by_discord_username,
      decider.discord_global_name AS decided_by_discord_global_name
    FROM guild_join_requests req
    JOIN users requester ON requester.id = req.requested_by_user_id
    LEFT JOIN users decider ON decider.id = req.decided_by_user_id
    WHERE req.guild_id = ?
      ${statusSql}
    ORDER BY datetime(req.requested_at) DESC, req.id DESC
  `).all(...params).map((row) => ({
    id: row.id,
    guild_id: row.guild_id,
    code_id: row.code_id || null,
    code_masked: row.code_masked || null,
    access_role: normalizeAccessRole(row.access_role),
    request_status: row.request_status || 'pending',
    requested_at: row.requested_at || row.created_at,
    decided_at: row.decided_at || null,
    decided_by_display_name: row.decided_by_user_id
      ? getDiscordDisplayName({
        username: row.decided_by_username,
        discord_username: row.decided_by_discord_username,
        discord_global_name: row.decided_by_discord_global_name,
      })
      : null,
    requester: {
      user_id: row.requested_by_user_id,
      username: row.requester_username,
      email: row.requester_email || null,
      discord_id: row.requester_discord_id || null,
      discord_username: row.requester_discord_username || null,
      discord_global_name: row.requester_discord_global_name || null,
      display_name: getDiscordDisplayName({
        username: row.requester_username,
        discord_username: row.requester_discord_username,
        discord_global_name: row.requester_discord_global_name,
      }),
      avatar_url: row.requester_discord_avatar_url || row.requester_site_avatar_url || null,
    },
  }));
}

function resolveUserForInvite(target) {
  const normalized = normalizeLookup(target);
  if (!normalized) return null;

  return db.db.prepare(`
    SELECT *
    FROM users
    WHERE is_active = 1
      AND (
        lower(trim(email)) = ?
        OR lower(trim(username)) = ?
        OR id = ?
        OR discord_id = ?
      )
    ORDER BY CASE WHEN lower(trim(email)) = ? THEN 0 ELSE 1 END, created_at ASC
    LIMIT 1
  `).get(normalized, normalized, String(target || '').trim(), String(target || '').trim(), normalized) ?? null;
}

function createGuildJoinCode({ guildId, ownerUserId, actorUserId, accessRole, expiresInHours }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  cleanupExpiredCodes(guildId);

  const now = new Date().toISOString();
  const expiresAt = expiresInHours && expiresInHours > 0
    ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
    : null;

  let code = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = buildAccessCode();
    const existing = db.db.prepare('SELECT id FROM guild_access_codes WHERE code = ? LIMIT 1').get(candidate);
    if (!existing) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    throw Object.assign(new Error('Impossible de generer un code pour le moment'), { status: 503 });
  }

  const created = db.insert('guild_access_codes', {
    guild_id: guildId,
    code,
    access_role: normalizeAccessRole(accessRole),
    created_by_user_id: actorUserId,
    expires_at: expiresAt,
    used_by_user_id: null,
    used_at: null,
    revoked_at: null,
    created_at: now,
    updated_at: now,
  });

  const actor = db.findOne('users', { id: actorUserId });
  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: actor?.username,
    actionType: 'code_create',
    target: maskAccessCode(code),
    details: {
      role: normalizeAccessRole(accessRole),
      expires_in_hours: expiresInHours || null,
      single_use: true,
    },
  });

  return db.findOne('guild_access_codes', { id: created.id });
}

function revokeGuildJoinCode({ guildId, ownerUserId, codeId, actorUserId = ownerUserId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const codeRow = db.db.prepare(`
    SELECT *
    FROM guild_access_codes
    WHERE id = ? AND guild_id = ?
    LIMIT 1
  `).get(codeId, guildId);

  if (!codeRow || codeRow.used_at || codeRow.revoked_at) {
    throw Object.assign(new Error('Code introuvable'), { status: 404 });
  }

  db.db.prepare(`
    UPDATE guild_access_codes
    SET revoked_at = ?, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), new Date().toISOString(), codeId);

  const actor = db.findOne('users', { id: actorUserId });
  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: actor?.username,
    actionType: 'code_revoke',
    target: maskAccessCode(codeRow.code),
    details: {
      role: normalizeAccessRole(codeRow.access_role),
    },
  });
}

function redeemGuildJoinCode({ userId, code }) {
  cleanupExpiredCodes();

  const normalizedCode = String(code || '').trim().toUpperCase();
  const user = db.findOne('users', { id: userId });
  if (!user || !user.is_active) {
    throw Object.assign(new Error('Compte introuvable'), { status: 404 });
  }
  if (!user.discord_id) {
    throw Object.assign(new Error('Connecte d abord ton compte Discord pour rejoindre une equipe'), { status: 403 });
  }

  const codeRow = db.db.prepare(`
    SELECT *
    FROM guild_access_codes
    WHERE code = ?
      AND used_at IS NULL
      AND revoked_at IS NULL
    LIMIT 1
  `).get(normalizedCode);

  if (!codeRow) {
    throw Object.assign(new Error('Code invalide ou deja utilise'), { status: 404 });
  }

  if (codeRow.expires_at && new Date(codeRow.expires_at) <= new Date()) {
    db.remove('guild_access_codes', { id: codeRow.id });
    throw Object.assign(new Error('Ce code a expire'), { status: 410 });
  }

  const guild = db.findOne('guilds', { id: codeRow.guild_id });
  if (!guild || !guild.is_active) {
    throw Object.assign(new Error('Serveur introuvable'), { status: 404 });
  }
  if (guild.user_id === userId) {
    throw Object.assign(new Error('Tu es deja proprietaire de cet espace'), { status: 400 });
  }

  const existingPending = db.db.prepare(`
    SELECT id
    FROM guild_join_requests
    WHERE guild_id = ?
      AND requested_by_user_id = ?
      AND request_status = 'pending'
    LIMIT 1
  `).get(guild.id, userId);

  if (existingPending) {
    throw Object.assign(new Error('Une demande est deja en attente pour cet espace'), { status: 409 });
  }

  ensureAutoBackupOnFirstInvite(guild.id, guild.user_id);

  const now = new Date().toISOString();
  const existing = db.db.prepare(`
    SELECT id
    FROM guild_access_members
    WHERE guild_id = ? AND user_id = ?
    LIMIT 1
  `).get(guild.id, userId);

  if (existing) {
    throw Object.assign(new Error('Tu as deja acces a cet espace'), { status: 400 });
  }

  const requestId = db.transaction(() => {
    db.db.prepare(`
      UPDATE guild_access_codes
      SET used_by_user_id = ?, used_at = ?, updated_at = ?
      WHERE id = ?
    `).run(userId, now, now, codeRow.id);

    const request = db.insert('guild_join_requests', {
      guild_id: guild.id,
      code_id: codeRow.id,
      requested_by_user_id: userId,
      inviter_user_id: codeRow.created_by_user_id || null,
      access_role: normalizeAccessRole(codeRow.access_role),
      code_masked: maskAccessCode(codeRow.code),
      request_status: 'pending',
      decided_by_user_id: null,
      decided_at: null,
      requested_at: now,
      created_at: now,
      updated_at: now,
    });

    return request.id;
  });

  logCollabAction({
    guildId: guild.id,
    actorUserId: userId,
    actorUsername: user.username,
    actionType: 'join_request_create',
    target: getDiscordDisplayName(user),
    details: {
      role: normalizeAccessRole(codeRow.access_role),
      code: maskAccessCode(codeRow.code),
      source: 'join_code_request',
    },
  });

  const request = db.findOne('guild_join_requests', { id: requestId });

  return {
    guild,
    request,
  };
}

function approveGuildJoinRequest({ guildId, ownerUserId, requestId, actorUserId = ownerUserId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const requestRow = db.db.prepare(`
    SELECT req.*, requester.username AS requester_username
    FROM guild_join_requests req
    JOIN users requester ON requester.id = req.requested_by_user_id
    WHERE req.id = ? AND req.guild_id = ?
    LIMIT 1
  `).get(requestId, guildId);

  if (!requestRow || requestRow.request_status !== 'pending') {
    throw Object.assign(new Error('Demande introuvable'), { status: 404 });
  }

  const requester = db.findOne('users', { id: requestRow.requested_by_user_id });
  if (!requester || !requester.is_active) {
    throw Object.assign(new Error('Compte demandeur introuvable'), { status: 404 });
  }

  const existing = db.db.prepare(`
    SELECT id
    FROM guild_access_members
    WHERE guild_id = ? AND user_id = ?
    LIMIT 1
  `).get(guildId, requester.id);

  const now = new Date().toISOString();
  db.transaction(() => {
    if (existing) {
      db.db.prepare(`
        UPDATE guild_access_members
        SET access_role = ?, invited_by_user_id = ?, is_suspended = 0, suspended_until = NULL, expires_at = NULL, accepted_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        normalizeAccessRole(requestRow.access_role),
        requestRow.inviter_user_id || actorUserId,
        now,
        now,
        existing.id
      );
    } else {
      db.insert('guild_access_members', {
        guild_id: guildId,
        user_id: requester.id,
        access_role: normalizeAccessRole(requestRow.access_role),
        invited_by_user_id: requestRow.inviter_user_id || actorUserId,
        is_suspended: 0,
        suspended_until: null,
        expires_at: null,
        accepted_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    db.db.prepare(`
      UPDATE guild_join_requests
      SET request_status = 'approved', decided_by_user_id = ?, decided_at = ?, updated_at = ?
      WHERE id = ?
    `).run(actorUserId, now, now, requestId);
  });

  const actor = db.findOne('users', { id: actorUserId });
  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: actor?.username,
    actionType: 'join_request_approve',
    target: getDiscordDisplayName(requester),
    details: {
      role: normalizeAccessRole(requestRow.access_role),
      code: requestRow.code_masked || null,
    },
  });

  return {
    request: db.findOne('guild_join_requests', { id: requestId }),
    collaborator: db.db.prepare(`
      SELECT *
      FROM guild_access_members
      WHERE guild_id = ? AND user_id = ?
      LIMIT 1
    `).get(guildId, requester.id),
    requester,
  };
}

function rejectGuildJoinRequest({ guildId, ownerUserId, requestId, actorUserId = ownerUserId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const requestRow = db.db.prepare(`
    SELECT req.*, requester.username AS requester_username
    FROM guild_join_requests req
    JOIN users requester ON requester.id = req.requested_by_user_id
    WHERE req.id = ? AND req.guild_id = ?
    LIMIT 1
  `).get(requestId, guildId);

  if (!requestRow || requestRow.request_status !== 'pending') {
    throw Object.assign(new Error('Demande introuvable'), { status: 404 });
  }

  const now = new Date().toISOString();
  db.db.prepare(`
    UPDATE guild_join_requests
    SET request_status = 'rejected', decided_by_user_id = ?, decided_at = ?, updated_at = ?
    WHERE id = ?
  `).run(actorUserId, now, now, requestId);

  const requester = db.findOne('users', { id: requestRow.requested_by_user_id });
  const actor = db.findOne('users', { id: actorUserId });
  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: actor?.username,
    actionType: 'join_request_reject',
    target: requester ? getDiscordDisplayName(requester) : requestRow.requester_username,
    details: {
      role: normalizeAccessRole(requestRow.access_role),
      code: requestRow.code_masked || null,
    },
  });

  return {
    request: db.findOne('guild_join_requests', { id: requestId }),
    requester,
  };
}

// ── Auto-backup on first invite ────────────────────────────────────────────────

function ensureAutoBackupOnFirstInvite(guildId, ownerUserId) {
  // Check if this guild already has any collaborators
  const existingCount = db.db.prepare(`
    SELECT COUNT(*) AS cnt FROM guild_access_members WHERE guild_id = ?
  `).get(guildId)?.cnt || 0;

  // First collaborator → auto-create a backup
  if (existingCount === 0) {
    const payload = buildSnapshotPayload(guildId);
    db.insert('guild_config_snapshots', {
      guild_id: guildId,
      created_by_user_id: ownerUserId,
      label: '🔒 Sauvegarde automatique (premier partage)',
      payload: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    });
  }
}

function inviteGuildCollaborator({ guildId, ownerUserId, actorUserId, target, accessRole, expiresInHours }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const user = resolveUserForInvite(target);
  if (!user) {
    throw Object.assign(new Error('Aucun compte du site ne correspond a cette recherche'), { status: 404 });
  }
  if (!user.is_active) {
    throw Object.assign(new Error('Ce compte est desactive'), { status: 403 });
  }
  if (user.id === ownerUserId) {
    throw Object.assign(new Error('Le proprietaire a deja acces a ce serveur'), { status: 400 });
  }

  // Auto-backup on first colaborator invite
  ensureAutoBackupOnFirstInvite(guildId, ownerUserId);

  const now = new Date().toISOString();
  const expiresAt = (expiresInHours && expiresInHours > 0)
    ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
    : null;

  const existing = db.db.prepare(`
    SELECT id
    FROM guild_access_members
    WHERE guild_id = ? AND user_id = ?
    LIMIT 1
  `).get(guildId, user.id);

  if (existing) {
    db.db.prepare(`
      UPDATE guild_access_members
      SET access_role = ?, invited_by_user_id = ?, is_suspended = 0, expires_at = ?, accepted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(normalizeAccessRole(accessRole), actorUserId, expiresAt, now, now, existing.id);
  } else {
    db.insert('guild_access_members', {
      guild_id: guildId,
      user_id: user.id,
      access_role: normalizeAccessRole(accessRole),
      invited_by_user_id: actorUserId,
      is_suspended: 0,
      expires_at: expiresAt,
      accepted_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  // Audit log
  const actor = db.findOne('users', { id: actorUserId });
  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: actor?.username,
    actionType: 'invite',
    target: user.username || user.email,
    details: { role: accessRole, expires_in_hours: expiresInHours || null },
  });

  return db.findOne('users', { id: user.id });
}

function updateGuildCollaboratorRole({ guildId, ownerUserId, memberUserId, accessRole }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }
  if (memberUserId === ownerUserId) {
    throw Object.assign(new Error('Le proprietaire principal ne peut pas etre modifie ici'), { status: 400 });
  }

  const result = db.db.prepare(`
    UPDATE guild_access_members
    SET access_role = ?, updated_at = ?
    WHERE guild_id = ? AND user_id = ?
  `).run(normalizeAccessRole(accessRole), new Date().toISOString(), guildId, memberUserId);

  if (!result.changes) {
    throw Object.assign(new Error('Acces introuvable'), { status: 404 });
  }

  const targetUser = db.findOne('users', { id: memberUserId });
  logCollabAction({
    guildId,
    actorUserId: ownerUserId,
    actorUsername: db.findOne('users', { id: ownerUserId })?.username,
    actionType: 'role_change',
    target: targetUser?.username,
    details: { new_role: accessRole },
  });
}

function suspendGuildCollaborator({ guildId, ownerUserId, memberUserId, isSuspended, durationHours = 0 }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }
  if (memberUserId === ownerUserId) {
    throw Object.assign(new Error('Le proprietaire principal ne peut pas etre suspendu'), { status: 400 });
  }

  const suspendedUntil = isSuspended && Number(durationHours) > 0
    ? new Date(Date.now() + Number(durationHours) * 3600000).toISOString()
    : null;
  const result = db.db.prepare(`
    UPDATE guild_access_members
    SET is_suspended = ?, suspended_until = ?, updated_at = ?
    WHERE guild_id = ? AND user_id = ?
  `).run(isSuspended ? 1 : 0, suspendedUntil, new Date().toISOString(), guildId, memberUserId);

  if (!result.changes) {
    throw Object.assign(new Error('Acces introuvable'), { status: 404 });
  }

  const targetUser = db.findOne('users', { id: memberUserId });
  logCollabAction({
    guildId,
    actorUserId: ownerUserId,
    actorUsername: db.findOne('users', { id: ownerUserId })?.username,
    actionType: isSuspended ? 'suspend' : 'unsuspend',
    target: targetUser?.username,
    details: isSuspended && suspendedUntil ? { suspended_until: suspendedUntil } : {},
  });
}

function removeGuildCollaborator({ guildId, ownerUserId, memberUserId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }
  if (memberUserId === ownerUserId) {
    throw Object.assign(new Error('Le proprietaire principal ne peut pas etre retire'), { status: 400 });
  }

  const targetUser = db.findOne('users', { id: memberUserId });

  const result = db.db.prepare(`
    DELETE FROM guild_access_members
    WHERE guild_id = ? AND user_id = ?
  `).run(guildId, memberUserId);

  if (!result.changes) {
    throw Object.assign(new Error('Acces introuvable'), { status: 404 });
  }

  logCollabAction({
    guildId,
    actorUserId: ownerUserId,
    actorUsername: db.findOne('users', { id: ownerUserId })?.username,
    actionType: 'revoke',
    target: targetUser?.username,
  });
}

// ── Snapshots ──────────────────────────────────────────────────────────────────

function buildSnapshotPayload(guildId) {
  return {
    version: 4,
    modules: db.raw('SELECT module_type, enabled, simple_config, advanced_config FROM modules WHERE guild_id = ? ORDER BY module_type ASC', [guildId]),
    custom_commands: db.raw(`
      SELECT trigger, command_type, command_prefix, command_name, description, response, reply_in_dm, response_mode,
             delete_trigger, allowed_roles, allowed_channels, aliases, cooldown_ms, delete_response_after_ms,
             embed_enabled, embed_title, embed_color, mention_user, require_args, usage_hint, use_count, enabled
      FROM custom_commands
      WHERE guild_id = ?
      ORDER BY created_at ASC
    `, [guildId]),
    guild_log_channel: db.raw('SELECT channel_id, log_events, enabled FROM guild_log_channels WHERE guild_id = ? LIMIT 1', [guildId])[0] || null,
    guild_dm_settings: db.raw(`
      SELECT
        auto_dm_warn,
        auto_dm_timeout,
        auto_dm_kick,
        auto_dm_ban,
        auto_dm_blacklist,
        appeal_server_name,
        appeal_server_url,
        brand_name,
        brand_icon_url,
        brand_logo_url,
        brand_site_url,
        site_button_label,
        show_site_link,
        show_brand_logo,
        footer_text
      FROM guild_dm_settings
      WHERE guild_id = ?
      LIMIT 1
    `, [guildId])[0] || null,
    ticket_generator: getGuildTicketGenerator(guildId),
    captcha_config: getGuildCaptchaConfig(guildId),
  };
}

function extractSnapshotPayload(source = {}) {
  const candidate = source && typeof source === 'object'
    ? (
      source.backup && typeof source.backup === 'object'
        ? source.backup
        : source.payload && typeof source.payload === 'object'
          ? source.payload
          : source
    )
    : {};

  return {
    version: Number(candidate.version || 4),
    modules: Array.isArray(candidate.modules) ? candidate.modules : [],
    custom_commands: Array.isArray(candidate.custom_commands) ? candidate.custom_commands : [],
    guild_log_channel: candidate.guild_log_channel && typeof candidate.guild_log_channel === 'object' ? candidate.guild_log_channel : null,
    guild_dm_settings: candidate.guild_dm_settings && typeof candidate.guild_dm_settings === 'object' ? candidate.guild_dm_settings : null,
    ticket_generator: candidate.ticket_generator && typeof candidate.ticket_generator === 'object' ? candidate.ticket_generator : null,
    captcha_config: candidate.captcha_config && typeof candidate.captcha_config === 'object' ? candidate.captcha_config : null,
  };
}

function applySnapshotPayload(guildId, source = {}) {
  const payload = extractSnapshotPayload(source);
  const now = new Date().toISOString();

  db.transaction(() => {
    db.db.prepare('DELETE FROM modules WHERE guild_id = ?').run(guildId);
    db.db.prepare('DELETE FROM custom_commands WHERE guild_id = ?').run(guildId);
    db.db.prepare('DELETE FROM guild_log_channels WHERE guild_id = ?').run(guildId);
    db.db.prepare('DELETE FROM guild_dm_settings WHERE guild_id = ?').run(guildId);

    for (const module of payload.modules) {
      db.insert('modules', {
        guild_id: guildId,
        module_type: module.module_type,
        enabled: module.enabled ? 1 : 0,
        simple_config: module.simple_config || '{}',
        advanced_config: module.advanced_config || '{}',
        created_at: now,
        updated_at: now,
      });
    }

    initializeDefaultModules(guildId);

    for (const command of payload.custom_commands) {
      db.insert('custom_commands', {
        guild_id: guildId,
        trigger: command.trigger,
        command_type: command.command_type || 'prefix',
        command_prefix: command.command_prefix || '',
        command_name: command.command_name || '',
        description: command.description || '',
        response: command.response || '',
        reply_in_dm: command.reply_in_dm ? 1 : 0,
        response_mode: command.response_mode || 'channel',
        delete_trigger: command.delete_trigger ? 1 : 0,
        allowed_roles: command.allowed_roles || '[]',
        allowed_channels: command.allowed_channels || '[]',
        aliases: command.aliases || '[]',
        cooldown_ms: Number(command.cooldown_ms || 0),
        delete_response_after_ms: Number(command.delete_response_after_ms || 0),
        embed_enabled: command.embed_enabled ? 1 : 0,
        embed_title: command.embed_title || '',
        embed_color: command.embed_color || '#22d3ee',
        mention_user: command.mention_user ? 1 : 0,
        require_args: command.require_args ? 1 : 0,
        usage_hint: command.usage_hint || '',
        use_count: Number(command.use_count || 0),
        enabled: command.enabled ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
    }

    if (payload.guild_log_channel?.channel_id) {
      db.insert('guild_log_channels', {
        guild_id: guildId,
        channel_id: payload.guild_log_channel.channel_id,
        log_events: payload.guild_log_channel.log_events || '[]',
        enabled: payload.guild_log_channel.enabled ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
    }

    if (payload.guild_dm_settings) {
      db.insert('guild_dm_settings', {
        guild_id: guildId,
        auto_dm_warn: payload.guild_dm_settings.auto_dm_warn ? 1 : 0,
        auto_dm_timeout: payload.guild_dm_settings.auto_dm_timeout ? 1 : 0,
        auto_dm_kick: payload.guild_dm_settings.auto_dm_kick ? 1 : 0,
        auto_dm_ban: payload.guild_dm_settings.auto_dm_ban ? 1 : 0,
        auto_dm_blacklist: payload.guild_dm_settings.auto_dm_blacklist ? 1 : 0,
        appeal_server_name: payload.guild_dm_settings.appeal_server_name || '',
        appeal_server_url: payload.guild_dm_settings.appeal_server_url || '',
        brand_name: payload.guild_dm_settings.brand_name || '',
        brand_icon_url: payload.guild_dm_settings.brand_icon_url || '',
        brand_logo_url: payload.guild_dm_settings.brand_logo_url || '',
        brand_site_url: payload.guild_dm_settings.brand_site_url || '',
        site_button_label: payload.guild_dm_settings.site_button_label || '',
        show_site_link: payload.guild_dm_settings.show_site_link ? 1 : 0,
        show_brand_logo: payload.guild_dm_settings.show_brand_logo ? 1 : 0,
        footer_text: payload.guild_dm_settings.footer_text || '',
        created_at: now,
        updated_at: now,
      });
    }
  });

  saveGuildTicketGenerator(guildId, payload.ticket_generator || DEFAULT_TICKET_CONFIG);
  saveGuildCaptchaConfig(guildId, payload.captcha_config || DEFAULT_CAPTCHA_CONFIG);
  return payload;
}

function listGuildSnapshots(guildId) {
  return db.db.prepare(`
    SELECT
      snap.*,
      users.username AS created_by_username,
      users.avatar_url AS created_by_avatar_url
    FROM guild_config_snapshots snap
    LEFT JOIN users ON users.id = snap.created_by_user_id
    WHERE snap.guild_id = ?
    ORDER BY snap.created_at DESC
  `).all(guildId).map((row) => {
    const payload = parseJson(row.payload, {});
    return {
      id: row.id,
      label: row.label || '',
      created_at: row.created_at,
      created_by_user_id: row.created_by_user_id || null,
      created_by_username: row.created_by_username || 'Compte inconnu',
      created_by_avatar_url: row.created_by_avatar_url || null,
      module_count: Array.isArray(payload.modules) ? payload.modules.length : 0,
      command_count: Array.isArray(payload.custom_commands) ? payload.custom_commands.length : 0,
      has_log_channel: Boolean(payload.guild_log_channel),
      has_dm_settings: Boolean(payload.guild_dm_settings),
    };
  });
}

function createGuildSnapshot({ guildId, ownerUserId, actorUserId, label }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const payload = buildSnapshotPayload(guildId);
  const row = db.insert('guild_config_snapshots', {
    guild_id: guildId,
    created_by_user_id: actorUserId,
    label: String(label || '').trim() || `Snapshot ${new Date().toLocaleString('fr-FR')}`,
    payload: JSON.stringify(payload),
    created_at: new Date().toISOString(),
  });

  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: db.findOne('users', { id: actorUserId })?.username,
    actionType: 'snapshot_create',
    target: label || 'Sans nom',
  });

  return db.findOne('guild_config_snapshots', { id: row.id });
}

function exportGuildBackup({ guildId, ownerUserId, actorUserId = ownerUserId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  return {
    kind: 'discordforge-guild-backup',
    exported_at: new Date().toISOString(),
    exported_by_user_id: actorUserId,
    guild: {
      id: guild.id,
      guild_id: guild.guild_id,
      name: guild.name,
    },
    backup: buildSnapshotPayload(guildId),
  };
}

function restoreGuildSnapshot({ guildId, ownerUserId, snapshotId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const snapshot = db.db.prepare(`
    SELECT *
    FROM guild_config_snapshots
    WHERE id = ? AND guild_id = ?
    LIMIT 1
  `).get(snapshotId, guildId);

  if (!snapshot) {
    throw Object.assign(new Error('Sauvegarde introuvable'), { status: 404 });
  }

  const payload = applySnapshotPayload(guildId, parseJson(snapshot.payload, {}));

  logCollabAction({
    guildId,
    actorUserId: ownerUserId,
    actorUsername: db.findOne('users', { id: ownerUserId })?.username,
    actionType: 'snapshot_restore',
    target: snapshot.label || 'Sans nom',
  });

  return {
    snapshot,
    restored: {
      module_count: payload.modules.length,
      command_count: payload.custom_commands.length,
      ticket_form_count: Array.isArray(payload.ticket_generator?.options)
        ? payload.ticket_generator.options.filter((option) => option?.enabled !== false).length
        : 0,
    },
  };
}

function importGuildBackup({ guildId, ownerUserId, actorUserId, backup }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const payload = applySnapshotPayload(guildId, backup);

  logCollabAction({
    guildId,
    actorUserId,
    actorUsername: db.findOne('users', { id: actorUserId })?.username,
    actionType: 'snapshot_restore',
    target: 'Import JSON',
  });

  return {
    restored: {
      module_count: payload.modules.length,
      command_count: payload.custom_commands.length,
      ticket_form_count: Array.isArray(payload.ticket_generator?.options)
        ? payload.ticket_generator.options.filter((option) => option?.enabled !== false).length
        : 0,
    },
  };
}

function deleteGuildSnapshot({ guildId, ownerUserId, snapshotId }) {
  const guild = db.findOne('guilds', { id: guildId });
  if (!guild || guild.user_id !== ownerUserId) {
    throw Object.assign(new Error('Guild not found'), { status: 404 });
  }

  const snapshot = db.db.prepare('SELECT label FROM guild_config_snapshots WHERE id = ? AND guild_id = ? LIMIT 1').get(snapshotId, guildId);

  const result = db.db.prepare(`
    DELETE FROM guild_config_snapshots
    WHERE id = ? AND guild_id = ?
  `).run(snapshotId, guildId);

  if (!result.changes) {
    throw Object.assign(new Error('Sauvegarde introuvable'), { status: 404 });
  }

  logCollabAction({
    guildId,
    actorUserId: ownerUserId,
    actorUsername: db.findOne('users', { id: ownerUserId })?.username,
    actionType: 'snapshot_delete',
    target: snapshot?.label || 'Sans nom',
  });
}

function getSharedGuildCounts(userId) {
  clearExpiredSuspensions({ userId });
  const row = db.db.prepare(`
    SELECT
      COUNT(DISTINCT g.id) AS total_count,
      COUNT(DISTINCT CASE WHEN g.user_id != ? THEN g.id END) AS shared_count
    FROM guilds g
    LEFT JOIN guild_access_members gam
      ON gam.guild_id = g.id
      AND gam.user_id = ?
    WHERE g.is_active = 1
      AND (g.user_id = ? OR (gam.user_id IS NOT NULL AND gam.is_suspended = 0))
  `).get(userId, userId, userId);

  return {
    total: Number(row?.total_count || 0),
    shared: Number(row?.shared_count || 0),
  };
}

module.exports = {
  ACCESS_ROLES,
  normalizeAccessRole,
  getGuildAccess,
  listAccessibleGuilds,
  listGuildCollaborators,
  listGuildJoinCodes,
  listGuildJoinRequests,
  inviteGuildCollaborator,
  createGuildJoinCode,
  revokeGuildJoinCode,
  redeemGuildJoinCode,
  approveGuildJoinRequest,
  rejectGuildJoinRequest,
  updateGuildCollaboratorRole,
  suspendGuildCollaborator,
  removeGuildCollaborator,
  logCollabAction,
  listCollabAuditLog,
  listGuildSnapshots,
  createGuildSnapshot,
  exportGuildBackup,
  restoreGuildSnapshot,
  importGuildBackup,
  deleteGuildSnapshot,
  getSharedGuildCounts,
};
