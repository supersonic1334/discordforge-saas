'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate, validateQuery } = require('../middleware');
const { paginationSchema, logChannelSchema } = require('../validators/schemas');
const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const { decrypt } = require('../services/encryptionService');
const discordService = require('../services/discordService');

router.use(requireAuth, requireBotToken, requireGuildOwner);

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function snowflakeToIso(snowflake) {
  if (!snowflake) return new Date().toISOString();
  try {
    const timestamp = Number((BigInt(snowflake) >> 22n) + 1420070400000n);
    return new Date(timestamp).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function getChangeValue(changes, key) {
  const change = (Array.isArray(changes) ? changes : []).find((entry) => entry?.key === key);
  if (!change) return null;
  return change.new_value ?? change.old_value ?? null;
}

function getActionTargetKind(actionType) {
  const type = Number(actionType || 0);

  if ([20, 22, 23, 24, 25, 26, 27, 28, 72, 73, 74, 75, 145].includes(type)) return 'user';
  if ([10, 11, 12].includes(type)) return 'channel';
  if ([30, 31, 32].includes(type)) return 'role';
  if ([40, 41, 42].includes(type)) return 'invite';
  if ([50, 51, 52].includes(type)) return 'webhook';
  if ([60, 61, 62].includes(type)) return 'emoji';
  if ([80, 81, 82].includes(type)) return 'integration';
  if ([83, 84, 85].includes(type)) return 'stage';
  if ([90, 91, 92].includes(type)) return 'sticker';
  if ([100, 101, 102].includes(type)) return 'event';
  if ([110, 111, 112].includes(type)) return 'thread';
  if ([121].includes(type)) return 'command';
  if ([140, 141, 142, 143, 144].includes(type)) return 'automod';
  if ([1].includes(type)) return 'guild';
  return 'unknown';
}

function shouldFetchUserTarget(actionType) {
  return getActionTargetKind(actionType) === 'user';
}

function normalizeChannelLabel(name, fallbackId) {
  if (name) return `#${String(name).replace(/^#/, '')}`;
  if (fallbackId) return `Salon ${fallbackId}`;
  return 'Salon Discord';
}

function normalizeRoleLabel(name, fallbackId) {
  if (name) return `@${String(name).replace(/^@/, '')}`;
  if (fallbackId) return `Role ${fallbackId}`;
  return 'Role Discord';
}

function formatAuditActionLabel(type, changes = []) {
  const actionType = Number(type || 0);
  if (actionType === 1) return 'guild_update';
  if (actionType === 10) return 'channel_create';
  if (actionType === 11) return 'channel_update';
  if (actionType === 12) return 'channel_delete';
  if (actionType === 13) return 'channel_overwrite_create';
  if (actionType === 14) return 'channel_overwrite_update';
  if (actionType === 15) return 'channel_overwrite_delete';
  if (actionType === 20) return 'kick';
  if (actionType === 22) return 'ban';
  if (actionType === 23) return 'unban';
  if (actionType === 24) {
    const isTimeout = changes.some((entry) => entry?.key === 'communication_disabled_until');
    return isTimeout ? 'timeout' : 'member_update';
  }
  if (actionType === 30) return 'role_create';
  if (actionType === 25) return 'role_update';
  if (actionType === 31) return 'role_update';
  if (actionType === 32) return 'role_delete';
  if (actionType === 26) return 'voice_move';
  if (actionType === 27) return 'voice_disconnect';
  if (actionType === 28) return 'bot_add';
  if (actionType === 40) return 'invite_create';
  if (actionType === 41) return 'invite_update';
  if (actionType === 42) return 'invite_delete';
  if (actionType === 50) return 'webhook_create';
  if (actionType === 51) return 'webhook_update';
  if (actionType === 52) return 'webhook_delete';
  if (actionType === 60) return 'emoji_create';
  if (actionType === 61) return 'emoji_update';
  if (actionType === 62) return 'emoji_delete';
  if (actionType === 72) return 'message_delete';
  if (actionType === 73) return 'message_bulk_delete';
  if (actionType === 74) return 'message_pin';
  if (actionType === 75) return 'message_unpin';
  if (actionType === 83) return 'stage_create';
  if (actionType === 84) return 'stage_update';
  if (actionType === 85) return 'stage_delete';
  if (actionType === 90) return 'sticker_create';
  if (actionType === 91) return 'sticker_update';
  if (actionType === 92) return 'sticker_delete';
  if (actionType === 100) return 'event_create';
  if (actionType === 101) return 'event_update';
  if (actionType === 102) return 'event_delete';
  if (actionType === 110) return 'thread_create';
  if (actionType === 111) return 'thread_update';
  if (actionType === 112) return 'thread_delete';
  if (actionType === 140) return 'automod_rule_create';
  if (actionType === 141) return 'automod_rule_update';
  if (actionType === 142) return 'automod_rule_delete';
  if (actionType === 143) return 'automod_block_message';
  if (actionType === 144) return 'automod_flag_message';
  if (actionType === 145) return 'timeout_remove';
  return `action_${actionType || 'unknown'}`;
}

const DISCORD_ACTION_LABELS = {
  guild_update: 'Serveur modifie',
  channel_create: 'Salon cree',
  channel_update: 'Salon modifie',
  channel_delete: 'Salon supprime',
  channel_overwrite_create: 'Permissions salon ajoutees',
  channel_overwrite_update: 'Permissions salon modifiees',
  channel_overwrite_delete: 'Permissions salon retirees',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Deban',
  timeout: 'Timeout',
  timeout_remove: 'Retrait timeout',
  member_update: 'Membre modifie',
  role_create: 'Role cree',
  role_update: 'Role modifie',
  role_delete: 'Role supprime',
  voice_move: 'Deplacement vocal',
  voice_disconnect: 'Deconnexion vocale',
  bot_add: 'Ajout du bot',
  invite_create: 'Invitation creee',
  invite_update: 'Invitation modifiee',
  invite_delete: 'Invitation supprimee',
  webhook_create: 'Webhook cree',
  webhook_update: 'Webhook modifie',
  webhook_delete: 'Webhook supprime',
  emoji_create: 'Emoji cree',
  emoji_update: 'Emoji modifie',
  emoji_delete: 'Emoji supprime',
  message_delete: 'Message supprime',
  message_bulk_delete: 'Suppression multiple',
  message_pin: 'Message epingle',
  message_unpin: 'Message desepingle',
  stage_create: 'Salon scene cree',
  stage_update: 'Salon scene modifie',
  stage_delete: 'Salon scene supprime',
  sticker_create: 'Sticker cree',
  sticker_update: 'Sticker modifie',
  sticker_delete: 'Sticker supprime',
  event_create: 'Evenement cree',
  event_update: 'Evenement modifie',
  event_delete: 'Evenement supprime',
  thread_create: 'Thread cree',
  thread_update: 'Thread modifie',
  thread_delete: 'Thread supprime',
  automod_rule_create: 'Regle AutoMod creee',
  automod_rule_update: 'Regle AutoMod modifiee',
  automod_rule_delete: 'Regle AutoMod supprimee',
  automod_block_message: 'Message bloque par AutoMod',
  automod_flag_message: 'Message signale par AutoMod',
};

function getDiscordActionLabel(actionName) {
  return DISCORD_ACTION_LABELS[actionName] || actionName || 'Evenement Discord';
}

function buildInClause(values) {
  return values.map(() => '?').join(', ');
}

async function buildDiscordUserMap(token, userIds) {
  const uniqueIds = [...new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean).map((value) => String(value)))];
  if (!uniqueIds.length) return new Map();

  const results = await Promise.allSettled(uniqueIds.map((userId) => discordService.getUser(token, userId)));
  const userMap = new Map();

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value?.id) {
      userMap.set(result.value.id, result.value);
    }
  });

  return userMap;
}

function buildBotLogAction(log, metadata) {
  return metadata.action_label
    || metadata.action
    || metadata.event
    || log.message
    || log.category
    || 'Site event';
}

function buildBotLogActor(log, metadata, siteUserMap, discordUserMap) {
  const discordUserId = metadata.userId
    || metadata.user_id
    || metadata.discord_user_id
    || metadata.target_user_id
    || metadata.targetUserId
    || null;

  if (discordUserId && discordUserMap.has(String(discordUserId))) {
    const discordUser = discordUserMap.get(String(discordUserId));
    return {
      source: 'discord',
      user_id: discordUser.id,
      username: discordUser.global_name || discordUser.username || discordUser.id,
      avatar_url: discordService.getAvatarUrl(discordUser.id, discordUser.avatar),
    };
  }

  if (log.user_id && siteUserMap.has(log.user_id)) {
    const siteUser = siteUserMap.get(log.user_id);
    return {
      source: 'site',
      user_id: siteUser.discord_id || siteUser.id,
      username: siteUser.username || siteUser.email || siteUser.id,
      avatar_url: siteUser.avatar_url || null,
    };
  }

  return {
    source: 'system',
    user_id: String(discordUserId || log.user_id || 'system'),
    username: metadata.username || metadata.target_username || 'System',
    avatar_url: null,
  };
}

function buildTargetDescriptor(entry, context) {
  const actionType = Number(entry.action_type || 0);
  const options = entry.options && typeof entry.options === 'object' ? entry.options : {};
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const targetId = entry.target_id || null;
  const kind = getActionTargetKind(actionType);

  if (kind === 'user') {
    const user = context.userMap.get(targetId) || null;
    if (user) {
      return {
        kind,
        id: user.id,
        label: user.global_name || user.username || user.id,
        subtitle: 'Utilisateur Discord',
        avatar_url: discordService.getAvatarUrl(user.id, user.avatar),
        username: user.username || null,
        global_name: user.global_name || null,
      };
    }

    return {
      kind,
      id: targetId,
      label: targetId ? `Utilisateur ${targetId}` : 'Utilisateur Discord',
      subtitle: 'Utilisateur Discord',
      avatar_url: null,
      username: null,
      global_name: null,
    };
  }

  if (kind === 'channel' || kind === 'thread') {
    const channel = context.channelMap.get(targetId) || null;
    const channelName = channel?.name || getChangeValue(changes, 'name') || options.channel_name || null;
    return {
      kind,
      id: targetId,
      label: normalizeChannelLabel(channelName, targetId),
      subtitle: kind === 'thread' ? 'Thread Discord' : 'Salon Discord',
      avatar_url: null,
      username: null,
      global_name: null,
    };
  }

  if (kind === 'role') {
    const role = context.roleMap.get(targetId) || null;
    const roleName = role?.name || getChangeValue(changes, 'name') || options.role_name || null;
    return {
      kind,
      id: targetId,
      label: normalizeRoleLabel(roleName, targetId),
      subtitle: 'Role Discord',
      avatar_url: null,
      username: null,
      global_name: null,
    };
  }

  if (kind === 'invite') {
    const inviteCode = getChangeValue(changes, 'code') || targetId;
    const channel = context.channelMap.get(options.channel_id) || null;
    return {
      kind,
      id: inviteCode || targetId,
      label: inviteCode ? `Invitation ${inviteCode}` : 'Invitation Discord',
      subtitle: channel?.name ? `Dans #${channel.name}` : 'Lien d invitation',
      avatar_url: null,
      username: null,
      global_name: null,
    };
  }

  if (kind === 'guild') {
    return {
      kind,
      id: targetId || context.guildId,
      label: context.guildName || 'Serveur Discord',
      subtitle: 'Serveur Discord',
      avatar_url: null,
      username: null,
      global_name: null,
    };
  }

  const genericName = getChangeValue(changes, 'name') || options.name || targetId || null;

  return {
    kind,
    id: targetId,
    label: genericName || 'Element Discord',
    subtitle: 'Element Discord',
    avatar_url: null,
    username: null,
    global_name: null,
  };
}

function buildDiscordLogMessage(entry, target, executorName) {
  const parts = [];

  if (executorName && executorName !== 'System') {
    parts.push(`Par ${executorName}`);
  }

  if (target?.label) {
    parts.push(`Cible : ${target.label}`);
  }

  if (entry.reason) {
    parts.push(`Raison : ${entry.reason}`);
  }

  const changesCount = Array.isArray(entry.changes) ? entry.changes.length : 0;
  if (changesCount > 0) {
    parts.push(`${changesCount} changement${changesCount > 1 ? 's' : ''}`);
  }

  return parts.join(' - ');
}

function truncateText(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function compactLines(lines) {
  return [...new Set((Array.isArray(lines) ? lines : []).map((line) => String(line || '').trim()).filter(Boolean))];
}

function formatContentSamples(samples) {
  return (Array.isArray(samples) ? samples : []).map((sample) => {
    const count = Number(sample?.count || 0);
    const text = truncateText(sample?.content, 280) || 'Contenu non lisible';
    return count > 1 ? `${text} x${count}` : text;
  });
}

function formatAuthorSamples(samples) {
  return (Array.isArray(samples) ? samples : []).map((sample) => {
    const count = Number(sample?.count || 0);
    const label = String(sample?.label || sample?.id || 'Utilisateur inconnu').trim();
    return count > 1 ? `${label} (${count} messages)` : label;
  });
}

function formatChangeLine(change, roleMap, channelMap) {
  if (!change || typeof change !== 'object') return null;
  const key = String(change.key || '').trim();
  const oldValue = change.old_value;
  const newValue = change.new_value;

  if (key === '$add' || key === '$remove') {
    const roles = Array.isArray(newValue) ? newValue : [];
    const labels = roles.map((role) => {
      const roleId = role?.id || role;
      return normalizeRoleLabel(role?.name || roleMap.get(roleId)?.name, roleId);
    }).filter(Boolean);
    if (!labels.length) return null;
    return key === '$add' ? `Roles ajoutes : ${labels.join(', ')}` : `Roles retires : ${labels.join(', ')}`;
  }

  if (key === 'communication_disabled_until') {
    if (newValue) return `Restriction de parole jusqu'au ${new Date(newValue).toLocaleString('fr-FR')}`;
    if (oldValue && !newValue) return 'Restriction de parole retiree';
  }

  if (key === 'channel_id') {
    const channelId = newValue || oldValue;
    const channelName = channelMap.get(channelId)?.name || null;
    return `Salon : ${normalizeChannelLabel(channelName, channelId)}`;
  }

  if (key === 'nick') {
    return `Surnom : ${oldValue || 'aucun'} -> ${newValue || 'aucun'}`;
  }

  if (key === 'permissions') {
    return 'Permissions du role modifiees';
  }

  if (key === 'allow' || key === 'deny') {
    return 'Permissions du salon modifiees';
  }

  if (key === 'rate_limit_per_user') {
    return `Slowmode : ${oldValue ?? 0}s -> ${newValue ?? 0}s`;
  }

  const labelMap = { name: 'Nom', topic: 'Sujet', code: 'Code', max_age: 'Duree max', max_uses: 'Utilisations max' };
  const label = labelMap[key] || key || 'Champ';
  const before = Array.isArray(oldValue) ? oldValue.join(', ') : oldValue;
  const after = Array.isArray(newValue) ? newValue.join(', ') : newValue;
  if (before === undefined && after === undefined) return null;
  return `${label} : ${before ?? 'vide'} -> ${after ?? 'vide'}`;
}

function buildAuditDetailLines(entry, target, executorName, context) {
  const actionName = formatAuditActionLabel(entry.action_type, Array.isArray(entry.changes) ? entry.changes : []);
  const options = entry.options && typeof entry.options === 'object' ? entry.options : {};
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const lines = [];
  const channelId = options.channel_id || getChangeValue(changes, 'channel_id') || null;
  const channelName = context.channelMap.get(channelId)?.name || options.channel_name || null;

  if (executorName && executorName !== 'System') lines.push(`Par : ${executorName}`);
  if (actionName === 'ban' && target?.label) lines.push(`Utilisateur banni : ${target.label}`);
  else if (actionName === 'unban' && target?.label) lines.push(`Utilisateur debanni : ${target.label}`);
  else if (actionName === 'kick' && target?.label) lines.push(`Utilisateur expulse : ${target.label}`);
  else if (actionName === 'timeout' && target?.label) lines.push(`Utilisateur restreint : ${target.label}`);
  else if (actionName === 'timeout_remove' && target?.label) lines.push(`Restriction retiree pour : ${target.label}`);
  else if (actionName === 'channel_create' && target?.label) lines.push(`Salon cree : ${target.label}`);
  else if (actionName === 'channel_update' && target?.label) lines.push(`Salon modifie : ${target.label}`);
  else if (actionName === 'channel_delete' && target?.label) lines.push(`Salon supprime : ${target.label}`);
  else if (actionName === 'role_create' && target?.label) lines.push(`Role cree : ${target.label}`);
  else if (actionName === 'role_update' && target?.label) lines.push(`Role modifie : ${target.label}`);
  else if (actionName === 'role_delete' && target?.label) lines.push(`Role supprime : ${target.label}`);
  else if (actionName === 'thread_create' && target?.label) lines.push(`Thread cree : ${target.label}`);
  else if (actionName === 'thread_update' && target?.label) lines.push(`Thread modifie : ${target.label}`);
  else if (actionName === 'thread_delete' && target?.label) lines.push(`Thread supprime : ${target.label}`);
  else if (target?.label) lines.push(`Cible : ${target.label}`);

  if (channelId || channelName) lines.push(`Salon : ${normalizeChannelLabel(channelName, channelId)}`);
  if (entry.reason) lines.push(`Raison : ${entry.reason}`);
  if (actionName === 'message_bulk_delete' && Number(options.count || 0) > 0) {
    lines.push(`Nombre de messages supprimes : ${options.count}`);
  }
  if (entry.created_at || entry.timestamp) {
    lines.push(`Horodatage : ${new Date(entry.created_at || entry.timestamp).toLocaleString('fr-FR')}`);
  }

  for (const change of changes) {
    const line = formatChangeLine(change, context.roleMap, context.channelMap);
    if (line) lines.push(line);
  }

  if (!changes.length && (actionName === 'channel_delete' || actionName === 'role_delete' || actionName === 'ban' || actionName === 'kick')) {
    lines.push('Aucun changement technique supplementaire n a ete remonte par Discord pour cette action.');
  }

  return compactLines(lines);
}

function buildRuntimeDiscordLog(log) {
  const metadata = parseJson(log.metadata);
  const eventType = String(metadata.event_type || 'discord_event').trim();
  const targetLabel = metadata.target_label || metadata.channel_name || 'Evenement Discord';
  const actor = metadata.actor_name ? {
    id: metadata.actor_id || null,
    username: metadata.actor_name,
    global_name: metadata.actor_name,
    avatar_url: metadata.actor_avatar_url || null,
  } : {
    id: null,
    username: null,
    global_name: null,
    avatar_url: null,
  };

  const target = {
    kind: 'runtime',
    id: metadata.target_id || null,
    label: targetLabel,
    subtitle: metadata.channel_name ? normalizeChannelLabel(metadata.channel_name, metadata.channel_id) : 'Discord',
    avatar_url: metadata.target_avatar_url || null,
    username: null,
    global_name: null,
  };

  const details = [];
  if (metadata.channel_name || metadata.channel_id) {
    details.push(`Salon : ${normalizeChannelLabel(metadata.channel_name, metadata.channel_id)}`);
  }
  if (metadata.target_label) {
    details.push(`Cible : ${metadata.target_label}`);
  }
  if (metadata.target_count) {
    details.push(`Nombre de messages supprimes : ${metadata.target_count}`);
  }
  if (metadata.content) {
    details.push(`Contenu : ${truncateText(metadata.content, 320)}`);
  }

  const authorLines = formatAuthorSamples(metadata.authors);
  if (authorLines.length) details.push(`Auteurs concernes : ${authorLines.join(' - ')}`);

  for (const line of formatContentSamples(metadata.contents).slice(0, 5)) {
    details.push(`Message supprime : ${line}`);
  }

  if (Array.isArray(metadata.attachments) && metadata.attachments.length) {
    details.push(`Fichiers joints : ${metadata.attachments.map((attachment) => attachment?.name || 'fichier').join(', ')}`);
  }

  return {
    id: `runtime-${log.id}`,
    action_type: eventType,
    action_name: eventType,
    target_id: metadata.target_id || null,
    reason: '',
    created_at: log.created_at,
    timestamp: log.created_at,
    level: log.level || 'info',
    event_type: metadata.action_label || log.message || 'Evenement Discord',
    guild_name: null,
    executor: actor,
    actor,
    target,
    options: metadata,
    changes: [],
    details,
    message: metadata.target_count
      ? `${metadata.target_count} message${Number(metadata.target_count) > 1 ? 's' : ''} supprime${Number(metadata.target_count) > 1 ? 's' : ''}`
      : truncateText(metadata.content, 180) || log.message || 'Evenement Discord',
    metadata: {
      actor_name: metadata.actor_name || 'Systeme',
      target_label: target.label,
      target_subtitle: target.subtitle,
      changes_count: 0,
      source_kind: 'runtime',
    },
  };
}

router.get('/', validateQuery(paginationSchema), async (req, res, next) => {
  try {
  const { page, limit } = req.query;
  const { level, category } = req.query;
  const offset = (page - 1) * limit;
  const token = decrypt(req.botToken.encrypted_token);

  let query = 'SELECT * FROM bot_logs WHERE guild_id = ?';
  const params = [req.guild.id];

  if (level) { query += ' AND level = ?'; params.push(level); }
  if (category) { query += ' AND category = ?'; params.push(category); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.raw(query, params);
  const total = db.raw(
    'SELECT COUNT(*) as count FROM bot_logs WHERE guild_id = ?',
    [req.guild.id]
  )[0]?.count ?? 0;

  const parsedLogs = logs.map((log) => ({
    ...log,
    metadata: parseJson(log.metadata),
  }));

  const internalUserIds = [...new Set(parsedLogs.map((log) => log.user_id).filter(Boolean))];
  const siteUsers = internalUserIds.length
    ? db.raw(
        `SELECT id, email, username, avatar_url, discord_id FROM users WHERE id IN (${buildInClause(internalUserIds)})`,
        internalUserIds
      )
    : [];
  const siteUserMap = new Map(siteUsers.map((user) => [user.id, user]));

  const discordUserIds = [...new Set(parsedLogs.flatMap((log) => {
    const metadata = log.metadata || {};
    return [
      metadata.userId,
      metadata.user_id,
      metadata.discord_user_id,
      metadata.target_user_id,
      metadata.targetUserId,
    ].filter(Boolean).map((value) => String(value));
  }))];
  const discordUserMap = await buildDiscordUserMap(token, discordUserIds);

  res.json({
    logs: parsedLogs.map((log) => ({
      ...log,
      actor: buildBotLogActor(log, log.metadata, siteUserMap, discordUserMap),
      action_performed: buildBotLogAction(log, log.metadata),
    })),
    total, page, limit,
  });
  } catch (err) {
    next(err);
  }
});

router.get('/discord', validateQuery(paginationSchema), async (req, res, next) => {
  try {
    const { limit } = req.query;
    const token = decrypt(req.botToken.encrypted_token);
    const clearedBeforeTs = req.guild.discord_logs_cleared_before
      ? new Date(req.guild.discord_logs_cleared_before).getTime()
      : 0;

    const runtimeLimit = Math.max(60, Number(limit || 50) * 4);
    const [auditLogPayload, channels, roles, runtimeRows] = await Promise.all([
      discordService.getGuildAuditLogs(token, req.guild.guild_id, { limit }),
      discordService.getGuildChannels(token, req.guild.guild_id).catch(() => []),
      discordService.getGuildRoles(token, req.guild.guild_id).catch(() => []),
      Promise.resolve(
        db.raw(
          'SELECT * FROM bot_logs WHERE guild_id = ? AND category = ? ORDER BY created_at DESC LIMIT ?',
          [req.guild.id, 'discord_event', runtimeLimit]
        )
      ),
    ]);

    const users = Array.isArray(auditLogPayload?.users) ? auditLogPayload.users : [];
    const entries = Array.isArray(auditLogPayload?.audit_log_entries) ? auditLogPayload.audit_log_entries : [];
    const userMap = new Map(users.map((user) => [user.id, user]));
    const channelMap = new Map((Array.isArray(channels) ? channels : []).map((channel) => [channel.id, channel]));
    const roleMap = new Map((Array.isArray(roles) ? roles : []).map((role) => [role.id, role]));

    const missingUserIds = [...new Set(entries.flatMap((entry) => {
      const ids = [];
      if (entry?.user_id && !userMap.has(entry.user_id)) ids.push(entry.user_id);
      if (entry?.target_id && shouldFetchUserTarget(entry.action_type) && !userMap.has(entry.target_id)) ids.push(entry.target_id);
      return ids.filter((value) => /^\d+$/.test(String(value || '')));
    }))];

    if (missingUserIds.length) {
      const fetchedUsers = await Promise.allSettled(
        missingUserIds.map(async (userId) => discordService.getUser(token, userId))
      );

      for (const result of fetchedUsers) {
        if (result.status === 'fulfilled' && result.value?.id) {
          userMap.set(result.value.id, result.value);
        }
      }
    }

    const auditLogs = entries.map((entry) => {
      const executor = userMap.get(entry.user_id);
      const target = buildTargetDescriptor(entry, {
        userMap,
        channelMap,
        roleMap,
        guildId: req.guild.guild_id,
        guildName: req.guild.name,
      });
      const actionName = formatAuditActionLabel(entry.action_type, Array.isArray(entry.changes) ? entry.changes : []);
      const createdAt = snowflakeToIso(entry.id);
      const executorName = executor?.global_name || executor?.username || entry.user_id || 'System';
      const actor = {
        id: executor?.id || entry.user_id || null,
        username: executor?.username || null,
        global_name: executor?.global_name || null,
        avatar_url: executor ? discordService.getAvatarUrl(executor.id, executor.avatar, 128, executor.discriminator) : null,
      };
      const details = buildAuditDetailLines(entry, target, executorName, { channelMap, roleMap });

      return {
        id: entry.id,
        action_type: entry.action_type,
        action_name: actionName,
        target_id: entry.target_id || null,
        reason: entry.reason || '',
        created_at: createdAt,
        timestamp: createdAt,
        level: 'info',
        event_type: getDiscordActionLabel(actionName),
        guild_name: req.guild.name || 'Discord',
        executor: actor,
        actor,
        target,
        options: entry.options || {},
        changes: Array.isArray(entry.changes) ? entry.changes : [],
        details,
        message: buildDiscordLogMessage(entry, target, executorName),
        metadata: {
          actor_name: executorName,
          target_label: target?.label || null,
          target_subtitle: target?.subtitle || null,
          changes_count: Array.isArray(entry.changes) ? entry.changes.length : 0,
          source_kind: 'audit',
        },
      };
    });

    const runtimeLogs = runtimeRows.map(buildRuntimeDiscordLog);

    const logs = [...auditLogs, ...runtimeLogs]
      .filter((entry) => {
        if (!clearedBeforeTs) return true;
        const entryTs = new Date(entry.created_at || entry.timestamp).getTime();
        return Number.isFinite(entryTs) && entryTs > clearedBeforeTs;
      })
      .sort((a, b) => new Date(b.created_at || b.timestamp || 0).getTime() - new Date(a.created_at || a.timestamp || 0).getTime())
      .slice(0, Number(limit || 50));

    res.json({
      logs,
      total: logs.length,
      page: req.query.page,
      limit,
      cleared_before: req.guild.discord_logs_cleared_before || null,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/discord', async (req, res, next) => {
  try {
    const clearedBefore = new Date().toISOString();
    db.update('guilds', { discord_logs_cleared_before: clearedBefore }, { id: req.guild.id });
    db.db.prepare(
      'DELETE FROM bot_logs WHERE guild_id = ? AND category = ? AND datetime(created_at) <= datetime(?)'
    ).run(req.guild.id, 'discord_event', clearedBefore);
    res.json({
      message: 'Discord logs cleared',
      cleared_before: clearedBefore,
    });
  } catch (err) {
    next(err);
  }
});

// ── Analytics summary ──────────────────────────────────────────────────────────
router.get('/analytics', (req, res) => {
  const guildId = req.guild.id;

  const modStats = db.raw(
    `SELECT action_type, COUNT(*) as count FROM mod_actions
     WHERE guild_id = ? AND created_at > datetime('now', '-30 days')
     GROUP BY action_type`,
    [guildId]
  );

  const warnStats = db.raw(
    `SELECT COUNT(*) as total, SUM(points) as totalPoints, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active
     FROM warnings WHERE guild_id = ? AND created_at > datetime('now', '-30 days')`,
    [guildId]
  )[0];

  const topOffenders = db.raw(
    `SELECT target_user_id, target_username, SUM(points) as total_points
     FROM warnings WHERE guild_id = ? AND active = 1
     GROUP BY target_user_id ORDER BY total_points DESC LIMIT 5`,
    [guildId]
  );

  const moduleActivity = db.raw(
    `SELECT category, COUNT(*) as count FROM bot_logs
     WHERE guild_id = ? AND created_at > datetime('now', '-7 days')
     GROUP BY category ORDER BY count DESC LIMIT 10`,
    [guildId]
  );

  const commandUsage = db.raw(
    `SELECT trigger, command_type, command_prefix, command_name, use_count
     FROM custom_commands
     WHERE guild_id = ? ORDER BY use_count DESC, updated_at DESC LIMIT 8`,
    [guildId]
  );

  const logStats = db.raw(
    `SELECT COUNT(*) as total
     FROM bot_logs
     WHERE guild_id = ? AND created_at > datetime('now', '-30 days')`,
    [guildId]
  )[0];

  const moduleStats = db.raw(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
     FROM modules
     WHERE guild_id = ?`,
    [guildId]
  )[0];

  const commandStats = db.raw(
    `SELECT
       COUNT(*) as total,
       SUM(use_count) as totalUses
     FROM custom_commands
     WHERE guild_id = ?`,
    [guildId]
  )[0];

  const actionTotals = modStats.reduce((acc, action) => {
    acc[action.action_type] = Number(action.count || 0);
    return acc;
  }, {});

  const totalActions = Object.values(actionTotals).reduce((sum, count) => sum + Number(count || 0), 0);

  res.json({
    modActions: modStats,
    warnings: warnStats,
    topOffenders,
    moduleActivity,
    commandUsage,
    logs: {
      total: Number(logStats?.total || 0),
    },
    modules: {
      total: Number(moduleStats?.total || 0),
      enabled: Number(moduleStats?.enabled || 0),
    },
    commands: {
      total: Number(commandStats?.total || 0),
      totalUses: Number(commandStats?.totalUses || 0),
      topCommand: commandUsage[0] || null,
    },
    actions: {
      total: totalActions,
    },
    actionTotals,
  });
});

// ── Log channel config ─────────────────────────────────────────────────────────
router.get('/channel', (req, res) => {
  const config = db.raw(
    'SELECT * FROM guild_log_channels WHERE guild_id = ?',
    [req.guild.id]
  )[0] ?? null;

  if (!config) return res.json({ configured: false });

  res.json({
    configured: true,
    channel_id: config.channel_id,
    log_events: JSON.parse(config.log_events || '[]'),
    enabled: !!config.enabled,
  });
});

router.put('/channel', validate(logChannelSchema), (req, res) => {
  const { channel_id, log_events, enabled } = req.body;
  const now = new Date().toISOString();

  const existing = db.raw(
    'SELECT id FROM guild_log_channels WHERE guild_id = ?',
    [req.guild.id]
  )[0];

  if (existing) {
    db.db.prepare(
      'UPDATE guild_log_channels SET channel_id = ?, log_events = ?, enabled = ?, updated_at = ? WHERE id = ?'
    ).run(channel_id, JSON.stringify(log_events), enabled ? 1 : 0, now, existing.id);
  } else {
    db.insert('guild_log_channels', {
      id: uuidv4(),
      guild_id: req.guild.id,
      channel_id,
      log_events: JSON.stringify(log_events),
      enabled: enabled ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
  }

  res.json({ message: 'Log channel configured', channel_id, log_events });
});

module.exports = router;
