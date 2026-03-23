'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate, validateQuery } = require('../middleware');
const { addWarningSchema, modActionSchema, paginationSchema } = require('../validators/schemas');
const { addWarning, getWarningCount, recordModAction, checkEscalation } = require('../bot/utils/modHelpers');
const discordService = require('../services/discordService');
const { decrypt } = require('../services/encryptionService');
const authService = require('../services/authService');
const db = require('../database');

router.use(requireAuth, requireBotToken, requireGuildOwner);

function parseJson(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildHttpError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  return error;
}

function isPrimaryFounder(user) {
  return authService.isPrimaryFounderEmail(user?.email);
}

function parseDiscordIdentity(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: '', id: null };

  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return { raw, id: mentionMatch[1] };
  if (/^\d+$/.test(raw)) return { raw, id: raw };

  return { raw, id: null };
}

async function resolveDiscordProfile(token, identityInput) {
  const identity = parseDiscordIdentity(identityInput);
  if (!identity.id) {
    return {
      identity,
      profile: null,
      avatarUrl: null,
    };
  }

  try {
    const profile = await discordService.getUser(token, identity.id);
    return {
      identity,
      profile,
      avatarUrl: discordService.getAvatarUrl(profile.id, profile.avatar),
    };
  } catch {
    return {
      identity,
      profile: null,
      avatarUrl: null,
    };
  }
}

async function buildModeratorMetadata(req, token, identityInput) {
  const trimmedIdentity = String(identityInput || '').trim();

  if (!isPrimaryFounder(req.user) && !trimmedIdentity) {
    throw buildHttpError(400, 'Discord moderator identity required');
  }

  const resolved = trimmedIdentity
    ? await resolveDiscordProfile(token, trimmedIdentity)
    : { identity: { raw: '', id: null }, profile: null, avatarUrl: null };

  const profile = resolved.profile;
  const displayName = profile?.global_name || profile?.username || trimmedIdentity || req.user.username;

  return {
    moderator_site_user_id: req.user.id,
    moderator_site_username: req.user.username,
    moderator_site_avatar_url: req.user.avatar_url || null,
    moderator_discord_identity: trimmedIdentity || null,
    moderator_discord_id: profile?.id || resolved.identity?.id || null,
    moderator_discord_username: profile?.username || null,
    moderator_discord_global_name: profile?.global_name || null,
    moderator_discord_avatar_url: resolved.avatarUrl || null,
    moderator_display_name: displayName,
  };
}

async function resolveTargetUser(token, targetUserId, targetUsername) {
  if (targetUsername) {
    return {
      username: targetUsername,
      avatarUrl: null,
    };
  }

  try {
    const profile = await discordService.getUser(token, targetUserId);
    return {
      username: profile.global_name || profile.username || targetUserId,
      avatarUrl: discordService.getAvatarUrl(profile.id, profile.avatar),
    };
  } catch {
    return {
      username: targetUserId,
      avatarUrl: null,
    };
  }
}

async function issueWarning(req, token, payload) {
  const { target_user_id, target_username, reason, points, moderator_discord_identity } = payload;
  const moderatorMetadata = await buildModeratorMetadata(req, token, moderator_discord_identity);
  const target = await resolveTargetUser(token, target_user_id, target_username);
  const moderatorId = moderatorMetadata.moderator_discord_id || req.user.id;
  const moderatorUsername = moderatorMetadata.moderator_display_name || req.user.username;

  await addWarning(
    req.guild.guild_id,
    target_user_id,
    target.username,
    moderatorId,
    moderatorUsername,
    reason,
    points,
    {
      ...moderatorMetadata,
      target_avatar_url: target.avatarUrl,
    }
  );

  await recordModAction(
    req.guild.guild_id,
    'warn',
    target_user_id,
    target.username,
    moderatorId,
    moderatorUsername,
    reason,
    null,
    'MANUAL',
    {
      ...moderatorMetadata,
      target_avatar_url: target.avatarUrl,
      points,
    }
  );

  const total = getWarningCount(req.guild.guild_id, target_user_id);
  const botProcess = require('../services/botManager').getProcess(req.user.id);
  if (botProcess?.client) {
    const discordGuild = botProcess.client.guilds.cache.get(req.guild.guild_id);
    if (discordGuild) {
      await checkEscalation(
        req.guild.guild_id,
        target_user_id,
        target.username,
        token,
        discordGuild
      );
    }
  }

  return {
    totalPoints: total,
    targetUsername: target.username,
    moderator: moderatorMetadata,
  };
}

router.get('/warnings', validateQuery(paginationSchema), (req, res) => {
  const { page, limit } = req.query;
  const offset = (page - 1) * limit;

  const warnings = db.raw(
    `SELECT * FROM warnings WHERE guild_id = ? AND active = 1
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [req.guild.id, limit, offset]
  );

  const total = db.raw(
    'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND active = 1',
    [req.guild.id]
  )[0]?.count ?? 0;

  res.json({
    warnings: warnings.map((warning) => ({
      ...warning,
      metadata: parseJson(warning.metadata),
    })),
    total,
    page,
    limit,
  });
});

router.get('/warnings/user/:discordUserId', (req, res) => {
  const warnings = db.raw(
    'SELECT * FROM warnings WHERE guild_id = ? AND target_user_id = ? ORDER BY created_at DESC',
    [req.guild.id, req.params.discordUserId]
  );

  const activePoints = warnings
    .filter((warning) => warning.active)
    .reduce((sum, warning) => sum + warning.points, 0);

  res.json({
    warnings: warnings.map((warning) => ({
      ...warning,
      metadata: parseJson(warning.metadata),
    })),
    activePoints,
    total: warnings.length,
  });
});

router.post('/warnings', validate(addWarningSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const result = await issueWarning(req, token, req.body);

    res.status(201).json({
      message: 'Warning issued',
      totalPoints: result.totalPoints,
      moderator: result.moderator,
      targetUsername: result.targetUsername,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/warnings/:warningId', (req, res) => {
  const warning = db.raw(
    'SELECT * FROM warnings WHERE id = ? AND guild_id = ?',
    [req.params.warningId, req.guild.id]
  )[0];

  if (!warning) return res.status(404).json({ error: 'Warning not found' });

  db.db.prepare('UPDATE warnings SET active = 0 WHERE id = ?').run(warning.id);
  res.json({ message: 'Warning removed' });
});

router.get('/actions', validateQuery(paginationSchema), (req, res) => {
  const { page, limit } = req.query;
  const offset = (page - 1) * limit;

  const actions = db.raw(
    `SELECT * FROM mod_actions WHERE guild_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [req.guild.id, limit, offset]
  );

  const total = db.raw(
    'SELECT COUNT(*) as count FROM mod_actions WHERE guild_id = ?',
    [req.guild.id]
  )[0]?.count ?? 0;

  res.json({
    actions: actions.map((action) => ({ ...action, metadata: parseJson(action.metadata) })),
    total,
    page,
    limit,
  });
});

router.post('/actions', validate(modActionSchema), async (req, res, next) => {
  try {
    const { target_user_id, target_username, action, reason, duration_ms, points, moderator_discord_identity } = req.body;
    const token = decrypt(req.botToken.encrypted_token);
    const guildId = req.guild.guild_id;
    const moderatorMetadata = await buildModeratorMetadata(req, token, moderator_discord_identity);
    const target = await resolveTargetUser(token, target_user_id, target_username);
    const moderatorId = moderatorMetadata.moderator_discord_id || req.user.id;
    const moderatorUsername = moderatorMetadata.moderator_display_name || req.user.username;

    if (action === 'warn') {
      const result = await issueWarning(req, token, req.body);
      return res.json({
        message: 'warn executed successfully',
        totalPoints: result.totalPoints,
        moderator: result.moderator,
      });
    }

    switch (action) {
      case 'timeout':
        if (!duration_ms) return res.status(400).json({ error: 'duration_ms required for timeout' });
        await discordService.timeoutMember(token, guildId, target_user_id, duration_ms, reason ?? 'Manual action');
        break;
      case 'untimeout':
        await discordService.timeoutMember(token, guildId, target_user_id, null, reason ?? 'Manual remove timeout');
        break;
      case 'kick':
        await discordService.kickMember(token, guildId, target_user_id, reason ?? 'Manual kick');
        break;
      case 'ban':
        await discordService.banMember(token, guildId, target_user_id, reason ?? 'Manual ban', 0);
        break;
      case 'unban':
        await discordService.unbanMember(token, guildId, target_user_id, reason ?? 'Manual unban');
        break;
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }

    await recordModAction(
      guildId,
      action,
      target_user_id,
      target.username,
      moderatorId,
      moderatorUsername,
      reason,
      duration_ms,
      'MANUAL',
      {
        ...moderatorMetadata,
        target_avatar_url: target.avatarUrl,
        points,
      }
    );

    res.json({
      message: `${action} executed successfully`,
      moderator: moderatorMetadata,
      targetUsername: target.username,
    });
  } catch (err) {
    if (err.httpStatus === 403) return res.status(403).json({ error: 'Bot lacks permission to perform this action' });
    if (err.httpStatus === 404) return res.status(404).json({ error: 'User not found in this server' });
    if (err.httpStatus === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
