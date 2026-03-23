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

// ── Bot event logs ─────────────────────────────────────────────────────────────
router.get('/', validateQuery(paginationSchema), (req, res) => {
  const { page, limit } = req.query;
  const { level, category } = req.query;
  const offset = (page - 1) * limit;

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

  res.json({
    logs: logs.map((l) => ({ ...l, metadata: parseJson(l.metadata) })),
    total, page, limit,
  });
});

router.get('/discord', validateQuery(paginationSchema), async (req, res, next) => {
  try {
    const { limit } = req.query;
    const token = decrypt(req.botToken.encrypted_token);
    const [auditLogPayload, channels, roles] = await Promise.all([
      discordService.getGuildAuditLogs(token, req.guild.guild_id, { limit }),
      discordService.getGuildChannels(token, req.guild.guild_id).catch(() => []),
      discordService.getGuildRoles(token, req.guild.guild_id).catch(() => []),
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

    const logs = entries.map((entry) => {
      const executor = userMap.get(entry.user_id);
      const target = buildTargetDescriptor(entry, {
        userMap,
        channelMap,
        roleMap,
        guildId: req.guild.guild_id,
        guildName: req.guild.name,
      });

      return {
        id: entry.id,
        action_type: entry.action_type,
        target_id: entry.target_id || null,
        reason: entry.reason || '',
        created_at: snowflakeToIso(entry.id),
        executor: executor ? {
          id: executor.id,
          username: executor.username,
          global_name: executor.global_name || null,
          avatar_url: discordService.getAvatarUrl(executor.id, executor.avatar),
        } : {
          id: entry.user_id || null,
          username: null,
          global_name: null,
          avatar_url: null,
        },
        target,
        options: entry.options || {},
        changes: Array.isArray(entry.changes) ? entry.changes : [],
      };
    });

    res.json({
      logs,
      total: logs.length,
      page: req.query.page,
      limit,
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
