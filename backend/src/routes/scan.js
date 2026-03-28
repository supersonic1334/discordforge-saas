'use strict';

const express = require('express');
const { z } = require('zod');

const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validateQuery } = require('../middleware');
const { decrypt } = require('../services/encryptionService');
const discordService = require('../services/discordService');
const authService = require('../services/authService');
const db = require('../database');

router.use(requireAuth, requireBotToken, requireGuildOwner);

const DISCORD_PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MODERATE_MEMBERS: 1n << 40n,
};

const SCAN_TTL_MS = 45_000;
const BATCH_LIMIT = 1000;
const MAX_BATCHES = 30;
const RECENT_ACTION_LIMIT = 900;
const RECENT_WARNING_LIMIT = 600;
const RECENT_LOG_LIMIT = 900;
const MAX_SNIPPETS_PER_USER = 12;

const scanCache = new Map();

const scanQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(48).optional().default(18),
  q: z.string().trim().max(120).optional().default(''),
  risk: z.enum(['all', 'critical', 'high', 'medium', 'low']).optional().default('all'),
  scope: z.enum(['all', 'humans', 'bots', 'suspicious']).optional().default('all'),
  refresh: z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }, z.boolean().optional().default(false)),
});

function isPrimaryFounder(user) {
  return authService.isPrimaryFounderEmail(user?.email);
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function truncateText(value, max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function snowflakeToIso(snowflake) {
  if (!snowflake) return null;
  try {
    const timestamp = Number((BigInt(String(snowflake)) >> 22n) + 1420070400000n);
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function diffDays(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function getRiskTier(score) {
  if (score >= 85) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function formatRiskLabel(tier) {
  if (tier === 'critical') return 'Critique';
  if (tier === 'high') return '\u00c9lev\u00e9';
  if (tier === 'medium') return 'Mod\u00e9r\u00e9';
  return 'Faible';
}

function parsePermissions(value) {
  try {
    return BigInt(String(value || '0'));
  } catch {
    return 0n;
  }
}

function computeMemberPermissions(member, context = {}) {
  if (!member) return 0n;

  const roleMap = context.roleMap instanceof Map ? context.roleMap : new Map();
  const guildId = String(context.guildId || '');
  const ownerId = String(context.ownerId || '');
  const memberUserId = String(member?.user?.id || member?.user_id || '');

  if (ownerId && memberUserId && ownerId === memberUserId) {
    return DISCORD_PERMISSIONS.ADMINISTRATOR;
  }

  const explicitPermissions = parsePermissions(member?.permissions);
  if (explicitPermissions > 0n) return explicitPermissions;

  let permissions = 0n;
  const includeRole = (roleId) => {
    const role = roleMap.get(String(roleId));
    if (role) permissions |= parsePermissions(role.permissions);
  };

  if (guildId) includeRole(guildId);
  for (const roleId of Array.isArray(member?.roles) ? member.roles : []) {
    includeRole(roleId);
  }

  return permissions;
}

function memberHasPermission(member, permission, context = {}) {
  if (!permission) return true;
  const permissions = computeMemberPermissions(member, context);
  if ((permissions & DISCORD_PERMISSIONS.ADMINISTRATOR) === DISCORD_PERMISSIONS.ADMINISTRATOR) return true;
  return (permissions & permission) === permission;
}

function buildViewer(member, user, context = {}) {
  const linkedDiscordId = user?.discord_id || null;
  const linkedIsGuildOwner = linkedDiscordId && String(linkedDiscordId) === String(context.ownerId || '');
  if (!linkedDiscordId) {
    return {
      linked_discord: false,
      linked_discord_id: null,
      in_server: false,
      can_warn: false,
      can_timeout: false,
      can_kick: false,
      can_ban: false,
    };
  }

  if ((isPrimaryFounder(user) && !member) || linkedIsGuildOwner) {
    return {
      linked_discord: true,
      linked_discord_id: linkedDiscordId,
      in_server: Boolean(member || linkedIsGuildOwner),
      can_warn: true,
      can_timeout: true,
      can_kick: true,
      can_ban: true,
    };
  }

  if (!member) {
    return {
      linked_discord: true,
      linked_discord_id: linkedDiscordId,
      in_server: false,
      can_warn: false,
      can_timeout: false,
      can_kick: false,
      can_ban: false,
    };
  }

  return {
    linked_discord: true,
    linked_discord_id: linkedDiscordId,
    in_server: true,
    can_warn: memberHasPermission(member, DISCORD_PERMISSIONS.MODERATE_MEMBERS, context),
    can_timeout: memberHasPermission(member, DISCORD_PERMISSIONS.MODERATE_MEMBERS, context),
    can_kick: memberHasPermission(member, DISCORD_PERMISSIONS.KICK_MEMBERS, context),
    can_ban: memberHasPermission(member, DISCORD_PERMISSIONS.BAN_MEMBERS, context),
  };
}

function createEvidenceBucket() {
  return {
    suspicious_message_count: 0,
    deleted_message_count: 0,
    risk_boost: 0,
    flags: new Set(),
    highlights: new Set(),
    snippets: [],
    last_seen_at: null,
  };
}

function getEvidenceBucket(map, userId) {
  if (!userId) return null;
  if (!map.has(userId)) {
    map.set(userId, createEvidenceBucket());
  }
  return map.get(userId);
}

const SUSPICION_RULES = [
  {
    id: 'scam',
    label: 'scam ou phishing',
    score: 26,
    pattern: /\b(nitro|gift|robux|steam|bitcoin|btc|crypto|wallet|claim|free\s+nitro|gift\s+card|password|token|airdrop)\b/i,
  },
  {
    id: 'spam',
    label: 'spam ou pub',
    score: 18,
    pattern: /(discord\.gg\/|https?:\/\/\S+.*https?:\/\/\S+|@everyone|@here|mass dm|promo|invite)/i,
  },
  {
    id: 'toxique',
    label: 'contenu toxique',
    score: 18,
    pattern: /\b(nazi|racis|raciste|fdp|encule|pute|nigger|kys|suicide toi)\b/i,
  },
  {
    id: 'selfbot',
    label: 'automatisation suspecte',
    score: 32,
    pattern: /\b(self ?bot|raid ?tool|nuker|token ?grabber|sniper|macro|autofarm|captcha ?bot)\b/i,
  },
];

function detectSuspicion(text) {
  const source = String(text || '');
  if (!source.trim()) return [];
  return SUSPICION_RULES.filter((rule) => rule.pattern.test(source));
}

function pushEvidence(map, userId, payload) {
  const bucket = getEvidenceBucket(map, userId);
  if (!bucket) return;

  if (payload.deleted) bucket.deleted_message_count += 1;
  if (payload.suspicious) bucket.suspicious_message_count += 1;
  bucket.risk_boost += Number(payload.risk_boost || 0);
  if (payload.created_at && (!bucket.last_seen_at || payload.created_at > bucket.last_seen_at)) {
    bucket.last_seen_at = payload.created_at;
  }

  for (const flag of payload.flags || []) bucket.flags.add(flag);
  for (const highlight of payload.highlights || []) bucket.highlights.add(highlight);

  if (bucket.snippets.length < MAX_SNIPPETS_PER_USER) {
    bucket.snippets.push({
      id: payload.id,
      kind: payload.kind,
      label: payload.label,
      excerpt: payload.excerpt,
      created_at: payload.created_at,
      highlights: payload.highlights || [],
      source: payload.source || 'logs',
    });
  }
}

async function getGuildMemberSafe(token, guildId, userId) {
  try {
    return await discordService.getGuildMember(token, guildId, userId);
  } catch (error) {
    if (error?.httpStatus === 404) return null;
    throw error;
  }
}

async function fetchGuildMembersSafely(token, guildId, memberCountHint = 0) {
  const members = [];
  let after = '0';
  let partial = false;

  for (let batchIndex = 0; batchIndex < MAX_BATCHES; batchIndex += 1) {
    const batch = await discordService.getGuildMembers(token, guildId, BATCH_LIMIT, after);
    if (!Array.isArray(batch) || batch.length === 0) break;

    members.push(...batch);
    const lastUserId = batch[batch.length - 1]?.user?.id;
    if (!lastUserId) break;
    after = lastUserId;

    if (batch.length < BATCH_LIMIT) break;
  }

  if (memberCountHint && members.length < memberCountHint && members.length >= MAX_BATCHES * BATCH_LIMIT) {
    partial = true;
  }

  return {
    members,
    partial,
    scanned_count: members.length,
    total_members_hint: Math.max(Number(memberCountHint || 0), members.length),
  };
}

function buildRoleMap(roles) {
  return new Map(
    (Array.isArray(roles) ? roles : []).map((role) => [String(role.id), {
      id: String(role.id),
      name: role.name || String(role.id),
      color: Number(role.color || 0),
      position: Number(role.position || 0),
      permissions: String(role.permissions || '0'),
    }])
  );
}

function buildRoleSummary(member, roleMap, guildSnowflake) {
  return (Array.isArray(member?.roles) ? member.roles : [])
    .filter((roleId) => roleId && roleId !== guildSnowflake)
    .map((roleId) => roleMap.get(String(roleId)))
    .filter(Boolean)
    .sort((a, b) => b.position - a.position)
    .slice(0, 10);
}

function buildWarningMap(guildInternalId) {
  const rows = db.raw(
    `SELECT
      target_user_id,
      COUNT(*) AS total_warnings,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_warnings,
      SUM(CASE WHEN active = 1 THEN points ELSE 0 END) AS active_points,
      MAX(created_at) AS last_warning_at
    FROM warnings
    WHERE guild_id = ?
    GROUP BY target_user_id`,
    [guildInternalId]
  );

  return new Map(rows.map((row) => [String(row.target_user_id), {
    total_warnings: Number(row.total_warnings || 0),
    active_warnings: Number(row.active_warnings || 0),
    active_points: Number(row.active_points || 0),
    last_warning_at: row.last_warning_at || null,
  }]));
}

function buildActionMap(guildInternalId) {
  const rows = db.raw(
    `SELECT
      target_user_id,
      COUNT(*) AS total_actions,
      SUM(CASE WHEN action_type = 'warn' THEN 1 ELSE 0 END) AS warns,
      SUM(CASE WHEN action_type = 'timeout' THEN 1 ELSE 0 END) AS timeouts,
      SUM(CASE WHEN action_type = 'kick' THEN 1 ELSE 0 END) AS kicks,
      SUM(CASE WHEN action_type = 'ban' THEN 1 ELSE 0 END) AS bans,
      SUM(CASE WHEN action_type = 'unban' THEN 1 ELSE 0 END) AS unbans,
      MAX(created_at) AS last_action_at
    FROM mod_actions
    WHERE guild_id = ?
    GROUP BY target_user_id`,
    [guildInternalId]
  );

  return new Map(rows.map((row) => [String(row.target_user_id), {
    total_actions: Number(row.total_actions || 0),
    warns: Number(row.warns || 0),
    timeouts: Number(row.timeouts || 0),
    kicks: Number(row.kicks || 0),
    bans: Number(row.bans || 0),
    unbans: Number(row.unbans || 0),
    last_action_at: row.last_action_at || null,
  }]));
}

function buildBlacklistMap(ownerUserId) {
  const rows = db.raw(
    `SELECT target_user_id, target_username, reason, source_module, created_at
     FROM bot_blacklist_entries
     WHERE owner_user_id = ?`,
    [ownerUserId]
  );

  return new Map(rows.map((row) => [String(row.target_user_id), {
    target_username: row.target_username || null,
    reason: row.reason || '',
    source_module: row.source_module || '',
    created_at: row.created_at || null,
  }]));
}

function buildRecentWarningsMap(guildInternalId) {
  const rows = db.raw(
    `SELECT target_user_id, reason, points, active, metadata, created_at
     FROM warnings
     WHERE guild_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [guildInternalId, RECENT_WARNING_LIMIT]
  );

  const map = new Map();
  for (const row of rows) {
    const userId = String(row.target_user_id || '');
    if (!userId) continue;
    if (!map.has(userId)) map.set(userId, []);
    if (map.get(userId).length >= 8) continue;
    map.get(userId).push({
      reason: row.reason || '',
      points: Number(row.points || 0),
      active: Boolean(row.active),
      created_at: row.created_at || null,
      metadata: parseJson(row.metadata),
    });
  }
  return map;
}

function buildRecentActionsMap(guildInternalId, evidenceMap) {
  const rows = db.raw(
    `SELECT target_user_id, action_type, reason, module_source, duration_ms, metadata, created_at
     FROM mod_actions
     WHERE guild_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [guildInternalId, RECENT_ACTION_LIMIT]
  );

  const map = new Map();

  for (const row of rows) {
    const userId = String(row.target_user_id || '');
    if (!userId) continue;

    if (!map.has(userId)) map.set(userId, []);
    if (map.get(userId).length < 14) {
      map.get(userId).push({
        action_type: row.action_type,
        reason: row.reason || '',
        module_source: row.module_source || '',
        duration_ms: Number(row.duration_ms || 0),
        created_at: row.created_at || null,
        metadata: parseJson(row.metadata),
      });
    }

    const reasonMatches = detectSuspicion(row.reason);
    const moduleName = String(row.module_source || '').trim();
    const flags = reasonMatches.map((match) => match.id);
    const highlights = reasonMatches.map((match) => match.label);
    let riskBoost = reasonMatches.reduce((sum, match) => sum + match.score, 0);

    if (moduleName && moduleName !== 'MANUAL') {
      highlights.push(`module ${moduleName}`);
      flags.push(normalizeText(moduleName));
      riskBoost += 8;
    }

    if (riskBoost > 0 || moduleName) {
      pushEvidence(evidenceMap, userId, {
        id: `action-${userId}-${row.created_at}-${row.action_type}`,
        kind: 'moderation_action',
        label: `Action ${row.action_type}`,
        excerpt: truncateText(row.reason || `${row.action_type} via ${moduleName || 'manual'}`, 220),
        created_at: row.created_at || null,
        deleted: false,
        suspicious: reasonMatches.length > 0,
        flags,
        highlights,
        risk_boost: riskBoost,
        source: 'actions',
      });
    }
  }

  return map;
}

function buildRecentLogEvidenceMap(guildInternalId, evidenceMap) {
  const rows = db.raw(
    `SELECT id, category, level, message, metadata, created_at
     FROM bot_logs
     WHERE guild_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [guildInternalId, RECENT_LOG_LIMIT]
  );

  for (const row of rows) {
    const metadata = parseJson(row.metadata);
    const category = String(row.category || '').trim();
    const eventType = String(metadata.event_type || '').trim();

    if (category === 'discord_event' && eventType === 'message_delete_content') {
      const userId = String(metadata.target_id || '');
      const content = String(metadata.content || '').trim();
      const matches = detectSuspicion(content);
      const riskBoost = matches.reduce((sum, match) => sum + match.score, 0) + (content ? 3 : 0);
      pushEvidence(evidenceMap, userId, {
        id: row.id,
        kind: 'deleted_message',
        label: 'Message supprime',
        excerpt: truncateText(content || row.message || 'Contenu non lisible', 280),
        created_at: row.created_at || null,
        deleted: true,
        suspicious: matches.length > 0,
        flags: matches.map((match) => match.id),
        highlights: matches.map((match) => match.label),
        risk_boost: riskBoost,
        source: 'logs',
      });
      continue;
    }

    if (category === 'discord_event' && eventType === 'message_bulk_delete_content') {
      const authors = Array.isArray(metadata.authors) ? metadata.authors : [];
      const contents = Array.isArray(metadata.contents) ? metadata.contents : [];
      const excerpt = truncateText(
        contents
          .map((entry) => String(entry?.content || '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(' | '),
        280
      ) || truncateText(row.message, 180);
      const matches = detectSuspicion(excerpt);
      const riskBoost = matches.reduce((sum, match) => sum + match.score, 0) + 4;

      for (const author of authors) {
        const userId = String(author?.id || '');
        if (!userId) continue;
        pushEvidence(evidenceMap, userId, {
          id: `${row.id}-${userId}`,
          kind: 'bulk_delete',
          label: 'Suppression multiple',
          excerpt,
          created_at: row.created_at || null,
          deleted: true,
          suspicious: matches.length > 0,
          flags: matches.map((match) => match.id),
          highlights: matches.map((match) => match.label),
          risk_boost: riskBoost,
          source: 'logs',
        });
      }
      continue;
    }

    const messageMatches = detectSuspicion(`${row.message || ''} ${metadata.reason || ''}`);
    const relatedUserId = String(metadata.target_user_id || metadata.target_id || metadata.userId || metadata.user_id || '');
    if (relatedUserId && messageMatches.length > 0) {
      pushEvidence(evidenceMap, relatedUserId, {
        id: row.id,
        kind: 'bot_log',
        label: metadata.action_label || row.message || 'Log bot',
        excerpt: truncateText(metadata.reason || row.message, 240),
        created_at: row.created_at || null,
        deleted: false,
        suspicious: true,
        flags: messageMatches.map((match) => match.id),
        highlights: messageMatches.map((match) => match.label),
        risk_boost: messageMatches.reduce((sum, match) => sum + match.score, 0),
        source: 'logs',
      });
    }
  }
}

function buildMemberSummary(member, context) {
  const user = member.user || {};
  const userId = String(user.id || '');
  const username = user.username || null;
  const globalName = user.global_name || null;
  const nickname = member.nick || null;
  const displayName = nickname || globalName || username || userId;
  const createdAt = snowflakeToIso(userId);
  const joinedAt = member.joined_at || null;
  const accountAgeDays = diffDays(createdAt);
  const joinedAgeDays = diffDays(joinedAt);
  const warnings = context.warningMap.get(userId) || {
    total_warnings: 0,
    active_warnings: 0,
    active_points: 0,
    last_warning_at: null,
  };
  const actions = context.actionMap.get(userId) || {
    total_actions: 0,
    warns: 0,
    timeouts: 0,
    kicks: 0,
    bans: 0,
    unbans: 0,
    last_action_at: null,
  };
  const blacklist = context.blacklistMap.get(userId) || null;
  const evidence = context.evidenceMap.get(userId) || createEvidenceBucket();

  const usernameSignals = detectSuspicion(`${username || ''} ${globalName || ''} ${nickname || ''}`);
  const reasons = [];
  let score = 0;

  if (user.bot) {
    score += 22;
    reasons.push('Bot detecte');
  }

  if (blacklist) {
    score += 70;
    reasons.push('Present dans la blacklist reseau');
  }

  if (warnings.active_points > 0) {
    score += Math.min(30, warnings.active_points * 7);
    reasons.push(`${warnings.active_points} point(s) actifs`);
  }

  if (actions.timeouts > 0) {
    score += Math.min(18, actions.timeouts * 6);
    reasons.push(`${actions.timeouts} timeout(s)`);
  }

  if (actions.kicks > 0) {
    score += Math.min(18, actions.kicks * 8);
    reasons.push(`${actions.kicks} kick(s)`);
  }

  if (actions.bans > 0) {
    score += Math.min(34, actions.bans * 14);
    reasons.push(`${actions.bans} ban(s)`);
  }

  if (accountAgeDays !== null && accountAgeDays <= 7) {
    score += 16;
    reasons.push('Compte tres recent');
  } else if (accountAgeDays !== null && accountAgeDays <= 30) {
    score += 8;
    reasons.push('Compte recent');
  }

  if (joinedAgeDays !== null && joinedAgeDays <= 3) {
    score += 10;
    reasons.push('Arrivee recente sur le serveur');
  }

  if (member.pending) {
    score += 8;
    reasons.push('Verification membre inachevee');
  }

  if (usernameSignals.length > 0) {
    score += usernameSignals.reduce((sum, match) => sum + Math.round(match.score * 0.7), 0);
    reasons.push(...usernameSignals.map((match) => match.label));
  }

  score += Math.min(46, Number(evidence.risk_boost || 0));
  reasons.push(...evidence.highlights);

  const hasSelfbotSuspicion = !user.bot && (
    evidence.flags.has('selfbot')
    || (usernameSignals.some((signal) => signal.id === 'selfbot') && evidence.suspicious_message_count > 0)
  );
  if (hasSelfbotSuspicion) {
    score += 18;
    reasons.push('Self-bot suspect');
  }

  const uniqueReasons = [...new Set(reasons.filter(Boolean))].slice(0, 6);
  const riskScore = Math.min(100, Math.max(0, score));
  const riskTier = getRiskTier(riskScore);

  return {
    id: userId,
    username,
    global_name: globalName,
    nickname,
    display_name: displayName,
    avatar_url: discordService.getAvatarUrl(userId, user.avatar, 128, user.discriminator),
    bot: Boolean(user.bot),
    pending: Boolean(member.pending),
    account_created_at: createdAt,
    joined_at: joinedAt,
    account_age_days: accountAgeDays,
    joined_age_days: joinedAgeDays,
    roles: buildRoleSummary(member, context.roleMap, context.guildSnowflake),
    timeout_active: Boolean(member.communication_disabled_until && Date.parse(member.communication_disabled_until) > Date.now()),
    timeout_until: member.communication_disabled_until || null,
    warning_summary: warnings,
    action_summary: actions,
    blacklist,
    evidence_summary: {
      suspicious_message_count: Number(evidence.suspicious_message_count || 0),
      deleted_message_count: Number(evidence.deleted_message_count || 0),
      last_seen_at: evidence.last_seen_at || null,
      flags: [...evidence.flags],
    },
    risk_score: riskScore,
    risk_tier: riskTier,
    risk_label: formatRiskLabel(riskTier),
    suspicious: riskScore >= 25 || Boolean(blacklist) || hasSelfbotSuspicion,
    selfbot_suspect: hasSelfbotSuspicion,
    reasons: uniqueReasons,
  };
}

function buildDetail(summary, recentWarnings, recentActions, evidence) {
  return {
    ...summary,
    recent_warnings: recentWarnings || [],
    recent_actions: recentActions || [],
    suspicious_messages: evidence?.snippets || [],
    evidence_flags: evidence ? [...evidence.flags] : [],
  };
}

function filterMembers(members, query) {
  const q = normalizeText(query.q);
  const risk = query.risk;
  const scope = query.scope;

  return members.filter((member) => {
    if (risk !== 'all' && member.risk_tier !== risk) return false;
    if (scope === 'bots' && !member.bot) return false;
    if (scope === 'humans' && member.bot) return false;
    if (scope === 'suspicious' && !member.suspicious) return false;

    if (!q) return true;
    const haystack = normalizeText([
      member.display_name,
      member.username,
      member.global_name,
      member.nickname,
      member.id,
      member.reasons.join(' '),
    ].join(' '));
    return haystack.includes(q);
  });
}

function buildSnapshotResponse(snapshot, query) {
  const filtered = filterMembers(snapshot.members, query);
  const startIndex = (query.page - 1) * query.limit;
  const pageMembers = filtered.slice(startIndex, startIndex + query.limit);

  return {
    scanned_at: snapshot.scanned_at,
    partial: snapshot.partial,
    partial_reason: snapshot.partial_reason,
    summary: snapshot.summary,
    viewer: snapshot.viewer,
    page: query.page,
    limit: query.limit,
    total_filtered: filtered.length,
    members: pageMembers,
  };
}

async function runGuildScan(req) {
  const token = decrypt(req.botToken.encrypted_token);
  const [roles, memberResult, viewerMember] = await Promise.all([
    discordService.getGuildRoles(token, req.guild.guild_id).catch(() => []),
    fetchGuildMembersSafely(token, req.guild.guild_id, req.guild.member_count || 0),
    req.user.discord_id ? getGuildMemberSafe(token, req.guild.guild_id, req.user.discord_id) : Promise.resolve(null),
  ]);

  const roleMap = buildRoleMap(roles);
  const viewerPermissionContext = {
    roleMap,
    guildId: req.guild.guild_id,
    ownerId: req.guild.owner_id,
  };
  const warningMap = buildWarningMap(req.guild.id);
  const actionMap = buildActionMap(req.guild.id);
  const blacklistMap = buildBlacklistMap(req.guildOwnerUserId || req.user.id);
  const evidenceMap = new Map();
  const recentWarningsMap = buildRecentWarningsMap(req.guild.id);
  const recentActionsMap = buildRecentActionsMap(req.guild.id, evidenceMap);
  buildRecentLogEvidenceMap(req.guild.id, evidenceMap);

  const context = {
    roleMap,
    guildSnowflake: req.guild.guild_id,
    warningMap,
    actionMap,
    blacklistMap,
    evidenceMap,
  };

  const members = memberResult.members
    .filter((member) => member?.user?.id)
    .map((member) => buildMemberSummary(member, context))
    .sort((left, right) => (
      right.risk_score - left.risk_score
      || Number(right.evidence_summary.suspicious_message_count || 0) - Number(left.evidence_summary.suspicious_message_count || 0)
      || String(left.display_name || '').localeCompare(String(right.display_name || ''), 'fr', { sensitivity: 'base' })
    ));

  const detailMap = new Map();
  for (const member of members) {
    detailMap.set(member.id, buildDetail(
      member,
      recentWarningsMap.get(member.id),
      recentActionsMap.get(member.id),
      evidenceMap.get(member.id)
    ));
  }

  const summary = {
    scanned_members: memberResult.scanned_count,
    total_members_hint: memberResult.total_members_hint,
    suspicious_members: members.filter((member) => member.suspicious).length,
    bots: members.filter((member) => member.bot).length,
    critical: members.filter((member) => member.risk_tier === 'critical').length,
    high: members.filter((member) => member.risk_tier === 'high').length,
    medium: members.filter((member) => member.risk_tier === 'medium').length,
    low: members.filter((member) => member.risk_tier === 'low').length,
  };

  return {
    scanned_at: new Date().toISOString(),
    partial: memberResult.partial,
    partial_reason: memberResult.partial ? 'Scan limite pour garder une reponse stable sur tres gros serveurs.' : '',
    summary,
    viewer: buildViewer(viewerMember, req.user, viewerPermissionContext),
    members,
    detailMap,
  };
}

async function getScanSnapshot(req, forceRefresh = false) {
  const cacheKey = `${req.guild.id}:${req.user.id}`;
  const cached = scanCache.get(cacheKey);
  const isFresh = cached && cached.data && (Date.now() - cached.fetched_at) < SCAN_TTL_MS;

  if (!forceRefresh && isFresh) {
    return cached.data;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = runGuildScan(req)
    .then((data) => {
      scanCache.set(cacheKey, {
        data,
        fetched_at: Date.now(),
        promise: null,
      });
      return data;
    })
    .catch((error) => {
      const previous = scanCache.get(cacheKey);
      if (previous?.data) {
        scanCache.set(cacheKey, {
          data: previous.data,
          fetched_at: previous.fetched_at,
          promise: null,
        });
      } else {
        scanCache.delete(cacheKey);
      }
      throw error;
    });

  scanCache.set(cacheKey, {
    data: cached?.data || null,
    fetched_at: cached?.fetched_at || 0,
    promise,
  });

  return promise;
}

router.get('/', validateQuery(scanQuerySchema), async (req, res, next) => {
  try {
    const snapshot = await getScanSnapshot(req, req.query.refresh);
    res.json(buildSnapshotResponse(snapshot, req.query));
  } catch (error) {
    next(error);
  }
});

router.get('/members/:userId', async (req, res, next) => {
  try {
    const snapshot = await getScanSnapshot(req, false);
    const detail = snapshot.detailMap.get(String(req.params.userId || ''));
    if (!detail) {
      return res.status(404).json({ error: 'Membre introuvable dans le scan' });
    }

    res.json({
      scanned_at: snapshot.scanned_at,
      partial: snapshot.partial,
      viewer: snapshot.viewer,
      member: detail,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
