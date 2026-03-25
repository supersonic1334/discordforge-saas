'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const botManager = require('../services/botManager');
const { syncGuildsForUser, removeGuildForUser } = require('../services/guildSyncService');
const discordService = require('../services/discordService');
const { decrypt } = require('../services/encryptionService');
const { requireAuth, requireBotToken, requireGuildOwner } = require('../middleware');
const db = require('../database');
const logger = require('../utils/logger').child('BotRoutes');
const moduleRoutes = require('./modules');
const commandRoutes = require('./commands');
const logRoutes = require('./logs');
const moderationRoutes = require('./moderation');
const blockedRoutes = require('./blocked');
const messageRoutes = require('./messages');

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', requireAuth, requireBotToken, (req, res) => {
  const status = botManager.getBotStatus(req.user.id);
  const tokenRow = req.botToken;
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
router.get('/guilds', requireAuth, requireBotToken, (req, res) => {
  const guilds = db.findMany('guilds', { user_id: req.user.id, is_active: 1 });
  res.json({
    guilds: guilds.map((g) => ({
      ...g,
      features: JSON.parse(g.features || '[]'),
      iconUrl: g.guild_id && g.icon
        ? discordService.getGuildIconUrl(g.guild_id, g.icon)
        : null,
    })),
  });
});

// ── POST /guilds/sync ─────────────────────────────────────────────────────────
router.use('/guilds/:guildId/modules', moduleRoutes);
router.use('/guilds/:guildId/commands', commandRoutes);
router.use('/guilds/:guildId/logs', logRoutes);
router.use('/guilds/:guildId/moderation', moderationRoutes);
router.use('/guilds/:guildId/blocked', blockedRoutes);
router.use('/guilds/:guildId/messages', messageRoutes);

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
router.delete('/guilds/:guildId', requireAuth, requireBotToken, requireGuildOwner, async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    await removeGuildForUser(req.user.id, req.guild.guild_id, token);
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
