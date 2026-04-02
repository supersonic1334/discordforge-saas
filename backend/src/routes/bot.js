'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const botManager = require('../services/botManager');
const { syncGuildsForUser, removeGuildForUser } = require('../services/guildSyncService');
const guildAccessService = require('../services/guildAccessService');
const discordService = require('../services/discordService');
const { decrypt } = require('../services/encryptionService');
const { requireAuth, requireBotToken, requireGuildOwner, requireGuildPrimaryOwner, validate } = require('../middleware');
const { guildAccessCodeRedeemSchema } = require('../validators/schemas');
const db = require('../database');
const logger = require('../utils/logger').child('BotRoutes');
const wsServer = require('../websocket');
const moduleRoutes = require('./modules');
const commandRoutes = require('./commands');
const ticketRoutes = require('./tickets');
const captchaRoutes = require('./captcha');
const logRoutes = require('./logs');
const moderationRoutes = require('./moderation');
const blockedRoutes = require('./blocked');
const messageRoutes = require('./messages');
const teamRoutes = require('./team');
const scanRoutes = require('./scan');

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

    wsServer.broadcastToUser(String(req.user.id), {
      event: 'account:profileUpdated',
      data: { reason: 'guild_access_joined' },
    });
    wsServer.broadcastToUser(String(redeemed.guild.user_id), {
      event: 'team:updated',
      data: { guildId: redeemed.guild.id },
    });

    res.status(201).json({
      message: 'Equipe rejointe',
      guild: {
        id: redeemed.guild.id,
        guild_id: redeemed.guild.guild_id,
        name: redeemed.guild.name,
      },
      access: redeemed.access,
    });
  } catch (error) {
    next(error);
  }
});

router.use('/guilds/:guildId/modules', moduleRoutes);
router.use('/guilds/:guildId/commands', commandRoutes);
router.use('/guilds/:guildId/tickets', ticketRoutes);
router.use('/guilds/:guildId/captcha', captchaRoutes);
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
