'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const botManager = require('../services/botManager');
const { syncGuildsForUser, removeGuildForUser } = require('../services/guildSyncService');
const guildAccessService = require('../services/guildAccessService');
const discordService = require('../services/discordService');
const { decrypt } = require('../services/encryptionService');
const { getBotProfileSettings, saveBotProfileSettings } = require('../services/botProfileService');
const { requireAuth, requireBotToken, requireGuildOwner, requireGuildPrimaryOwner, validate } = require('../middleware');
const { guildAccessCodeRedeemSchema, botProfileSchema } = require('../validators/schemas');
const db = require('../database');
const logger = require('../utils/logger').child('BotRoutes');
const wsServer = require('../websocket');
const moduleRoutes = require('./modules');
const commandRoutes = require('./commands');
const ticketRoutes = require('./tickets');
const captchaRoutes = require('./captcha');
const voiceRoutes = require('./voice');
const logRoutes = require('./logs');
const moderationRoutes = require('./moderation');
const blockedRoutes = require('./blocked');
const messageRoutes = require('./messages');
const teamRoutes = require('./team');
const scanRoutes = require('./scan');

function requireBotPrimaryOwner(req, res, next) {
  if (String(req.botToken?.user_id || '') !== String(req.user?.id || '')) {
    return res.status(403).json({ error: 'Primary bot owner access required' });
  }

  return next();
}

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => {
  const ownTokenRow = db.findOne('bot_tokens', { user_id: req.user.id });
  const accessibleGuilds = ownTokenRow ? [] : guildAccessService.listAccessibleGuilds(req.user.id);
  const effectiveOwnerUserId = ownTokenRow
    ? req.user.id
    : (accessibleGuilds.find((entry) => entry.user_id)?.user_id || req.user.id);
  const tokenRow = ownTokenRow || db.findOne('bot_tokens', { user_id: effectiveOwnerUserId });

  if (!tokenRow) {
    return res.json({
      status: 'stopped',
      ping: -1,
      guildCount: 0,
      startedAt: null,
      restartCount: 0,
      lastError: null,
      bot: null,
    });
  }

  const status = botManager.getBotStatus(effectiveOwnerUserId);
  res.json({
    status: status?.status ?? 'stopped',
    ping: status?.ping ?? status?.ping_ms ?? -1,
    guildCount: status?.guildCount ?? status?.guilds_count ?? 0,
    startedAt: status?.startedAt ?? status?.started_at ?? null,
    restartCount: status?.restartCount ?? status?.restart_count ?? 0,
    lastError: status?.lastError ?? status?.last_error ?? null,
    bot: {
      id: tokenRow.bot_id,
      username: tokenRow.bot_username,
      discriminator: tokenRow.bot_discriminator,
      inviteUrl: discordService.buildBotInviteUrl(tokenRow.bot_id),
      avatarUrl: tokenRow.bot_id && tokenRow.bot_avatar
        ? discordService.getAvatarUrl(tokenRow.bot_id, tokenRow.bot_avatar)
        : null,
    },
  });
});

router.get('/profile', requireAuth, requireBotToken, requireBotPrimaryOwner, async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const botUser = await discordService.validateToken(token);
    const application = await discordService.getCurrentApplication(token).catch(() => null);
    const presence = getBotProfileSettings(req.user.id);

    res.json({
      profile: {
        id: botUser.id,
        username: botUser.username,
        discriminator: botUser.discriminator,
        avatar_url: discordService.getAvatarUrl(botUser.id, botUser.avatar, 256, botUser.discriminator),
        invite_url: discordService.buildBotInviteUrl(botUser.id),
        bio: String(application?.description || '').trim(),
        presence_status: presence.presence_status,
        activity_type: presence.activity_type,
        activity_text: presence.activity_text,
        is_running: botManager.isRunning(req.user.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/profile', requireAuth, requireBotToken, requireBotPrimaryOwner, validate(botProfileSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const process = botManager.getProcess(req.user.id);
    const updates = req.body || {};
    let currentUser = null;
    let currentApplication = null;
    let savedPresence = getBotProfileSettings(req.user.id);
    const userPayload = {};

    if (typeof updates.username === 'string' && updates.username.trim()) {
      userPayload.username = updates.username.trim();
    }
    if (typeof updates.avatar === 'string' && updates.avatar.trim()) {
      userPayload.avatar = updates.avatar.trim();
    }

    if (Object.keys(userPayload).length > 0) {
      currentUser = await discordService.modifyCurrentUser(token, userPayload);

      db.update('bot_tokens', {
        bot_username: currentUser.username,
        bot_discriminator: currentUser.discriminator,
        bot_avatar: currentUser.avatar,
        last_validated_at: new Date().toISOString(),
      }, { user_id: req.user.id });
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'bio')) {
      currentApplication = await discordService.modifyCurrentApplication(token, {
        description: String(updates.bio || '').trim(),
      });
    }

    const shouldPersistPresence = (
      Object.prototype.hasOwnProperty.call(updates, 'presence_status')
      || Object.prototype.hasOwnProperty.call(updates, 'activity_type')
      || Object.prototype.hasOwnProperty.call(updates, 'activity_text')
    );

    if (shouldPersistPresence) {
      savedPresence = saveBotProfileSettings(req.user.id, {
        presence_status: updates.presence_status,
        activity_type: updates.activity_type,
        activity_text: updates.activity_text,
      });

      if (process?.client?.user) {
        await process.applyStoredPresence();
      }
    }

    if (!currentUser) {
      currentUser = await discordService.validateToken(token);
    }

    if (!currentApplication) {
      currentApplication = await discordService.getCurrentApplication(token).catch(() => null);
    }

    res.json({
      message: 'Bot profile updated',
      profile: {
        id: currentUser.id,
        username: currentUser.username,
        discriminator: currentUser.discriminator,
        avatar_url: discordService.getAvatarUrl(currentUser.id, currentUser.avatar, 256, currentUser.discriminator),
        invite_url: discordService.buildBotInviteUrl(currentUser.id),
        bio: String(currentApplication?.description || '').trim(),
        presence_status: savedPresence.presence_status,
        activity_type: savedPresence.activity_type,
        activity_text: savedPresence.activity_text,
        is_running: botManager.isRunning(req.user.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /start ───────────────────────────────────────────────────────────────
router.post('/start', requireAuth, requireBotToken, async (req, res, next) => {
  try {
    const result = await botManager.startBot(req.user.id);
    res.json({ message: 'Bot starting…', status: result });
  } catch (err) {
    next(err);
  }
});

// ── POST /stop ────────────────────────────────────────────────────────────────
router.post('/stop', requireAuth, requireBotToken, async (req, res, next) => {
  try {
    await botManager.stopBot(req.user.id);
    res.json({ message: 'Bot stopped' });
  } catch (err) {
    next(err);
  }
});

// ── POST /restart ─────────────────────────────────────────────────────────────
router.post('/restart', requireAuth, requireBotToken, async (req, res, next) => {
  try {
    const result = await botManager.restartBot(req.user.id);
    res.json({ message: 'Bot restarting…', status: result });
  } catch (err) {
    next(err);
  }
});

// ── GET /guilds ───────────────────────────────────────────────────────────────
router.get('/guilds', requireAuth, (req, res) => {
  const guilds = guildAccessService.listAccessibleGuilds(req.user.id);
  res.json({
    guilds: guilds.map((g) => ({
      ...g,
      is_owner: !!g.is_owner,
      is_shared: !g.is_owner,
      features: JSON.parse(g.features || '[]'),
      blocked_features: guildAccessService.normalizeBlockedFeatures(g.blocked_features),
      iconUrl: g.guild_id && g.icon
        ? discordService.getGuildIconUrl(g.guild_id, g.icon)
        : null,
    })),
  });
});

// ── POST /guilds/sync ─────────────────────────────────────────────────────────
router.post('/team/join-code/redeem', requireAuth, validate(guildAccessCodeRedeemSchema), async (req, res, next) => {
  try {
    const redeemed = guildAccessService.redeemGuildJoinCode({
      userId: req.user.id,
      code: req.body.code,
    });

    wsServer.broadcastToUser(String(redeemed.guild.user_id), {
      event: 'team:updated',
      data: { guildId: redeemed.guild.id },
    });

    res.status(202).json({
      message: 'Demande en attente',
      request: {
        id: redeemed.request?.id || null,
        guild_id: redeemed.guild.id,
        status: redeemed.request?.request_status || 'pending',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.use('/guilds/:guildId/modules', moduleRoutes);
router.use('/guilds/:guildId/commands', commandRoutes);
router.use('/guilds/:guildId/tickets', ticketRoutes);
router.use('/guilds/:guildId/captcha', captchaRoutes);
router.use('/guilds/:guildId/voice-rooms', voiceRoutes);
router.use('/guilds/:guildId/logs', logRoutes);
router.use('/guilds/:guildId/moderation', moderationRoutes);
router.use('/guilds/:guildId/blocked', blockedRoutes);
router.use('/guilds/:guildId/messages', messageRoutes);
router.use('/guilds/:guildId/team', teamRoutes);
router.use('/guilds/:guildId/scan', scanRoutes);
router.use('/guilds/:guildId/rassican', scanRoutes);

router.post('/guilds/sync', requireAuth, requireBotToken, async (req, res, next) => {
  try {
    const process = botManager.getProcess(req.user.id);
    if (!process?.client) {
      return res.status(400).json({ error: 'Bot is not running — start the bot first' });
    }

    const token = decrypt(req.botToken.encrypted_token);
    await syncGuildsForUser(req.user.id, process.client, token);

    const guilds = db.findMany('guilds', { user_id: req.user.id, is_active: 1 });
    res.json({
      message: 'Guilds synced',
      guilds: guilds.map((g) => ({
        ...g,
        features: JSON.parse(g.features || '[]'),
        blocked_features: [],
        iconUrl: g.guild_id && g.icon
          ? discordService.getGuildIconUrl(g.guild_id, g.icon)
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /guilds/:guildId — remove bot from server ─────────────────────────
router.delete('/guilds/:guildId', requireAuth, requireBotToken, requireGuildOwner, requireGuildPrimaryOwner, async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    await removeGuildForUser(req.guild.user_id, req.guild.guild_id, token);
    res.json({ message: 'Bot left the server' });
  } catch (err) {
    if (err.httpStatus === 404) return res.status(404).json({ error: 'Bot is not in that server' });
    next(err);
  }
});

// ── GET /guilds/:guildId — single guild info ──────────────────────────────────
router.get('/guilds/:guildId', requireAuth, requireBotToken, requireGuildOwner, (req, res) => {
  const g = req.guild;
  res.json({
    ...g,
    is_owner: req.guildAccess?.is_owner ?? g.user_id === req.user.id,
    access_role: req.guildAccess?.access_role || 'owner',
    owner_user_id: req.guildAccess?.owner_user_id || g.user_id,
    owner_username: req.guildAccess?.owner_username || null,
    blocked_features: req.guildAccess?.blocked_features || [],
    features: JSON.parse(g.features || '[]'),
    iconUrl: g.guild_id && g.icon
      ? discordService.getGuildIconUrl(g.guild_id, g.icon)
      : null,
  });
});

// ── GET /guilds/:guildId/channels — fetch channels from Discord ───────────────
router.get('/guilds/:guildId/channels', requireAuth, requireBotToken, requireGuildOwner, async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const channels = await discordService.getGuildChannels(token, req.guild.guild_id);
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

// ── GET /guilds/:guildId/roles — fetch roles from Discord ────────────────────
router.get('/guilds/:guildId/roles', requireAuth, requireBotToken, requireGuildOwner, async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const roles = await discordService.getGuildRoles(token, req.guild.guild_id);
    res.json({ roles });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
