'use strict';

const express = require('express');

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { voiceGeneratorConfigSchema } = require('../validators/schemas');
const botManager = require('../services/botManager');
const guildAccessService = require('../services/guildAccessService');
const logger = require('../utils/logger').child('VoiceRoutes');
const wsServer = require('../websocket');
const {
  getVoiceRoomOverview,
  saveGuildVoiceGenerator,
} = require('../services/voiceGeneratorService');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireBotToken, requireGuildOwner);

function buildOverviewPayload(req, extra = {}) {
  const overview = getVoiceRoomOverview(req.guild.id);
  return {
    guildId: req.guild.id,
    discordGuildId: req.guild.guild_id,
    config: overview.config,
    rooms: overview.rooms,
    stats: overview.stats,
    ...extra,
  };
}

function broadcastVoiceGeneratorUpdate(req, extra = {}) {
  const recipients = guildAccessService.listGuildCollaborators(req.guild.id);
  const userIds = new Set(
    recipients
      .map((entry) => String(entry?.user_id || '').trim())
      .filter(Boolean)
  );

  if (req.guild?.user_id) {
    userIds.add(String(req.guild.user_id));
  }

  const payload = buildOverviewPayload(req, {
    actorUserId: req.user.id,
    actorUsername: req.user.username,
    updatedAt: new Date().toISOString(),
    ...extra,
  });

  for (const userId of userIds) {
    wsServer.broadcastToUser(userId, {
      event: 'voice:updated',
      data: payload,
    });
  }
}

function normalizeVoiceRouteError(error) {
  if (!error || error.status || error.statusCode) return error;

  const message = String(error.message || '').toLowerCase();
  if (
    message.includes('vocal')
    || message.includes('voice')
    || message.includes('permission')
    || message.includes('introuvable')
    || message.includes('salon')
    || message.includes('bot')
  ) {
    error.status = 409;
  }

  return error;
}

router.get('/', (req, res) => {
  res.json(buildOverviewPayload(req));
});

router.put('/config', validate(voiceGeneratorConfigSchema), async (req, res, next) => {
  try {
    saveGuildVoiceGenerator(req.guild.id, req.body);
    const payload = buildOverviewPayload(req, {
      message: 'Configuration vocaux temporaires mise a jour',
    });

    broadcastVoiceGeneratorUpdate(req, {
      reason: 'config_saved',
      message: payload.message,
    });

    res.json(payload);
  } catch (error) {
    logger.warn(`Voice config save failed: ${error.message}`, {
      guildId: req.guild?.id,
      discordGuildId: req.guild?.guild_id,
      userId: req.user?.id,
    });
    next(normalizeVoiceRouteError(error));
  }
});

router.post('/publish', async (req, res, next) => {
  try {
    const process = botManager.getProcess(req.botOwnerUserId);
    if (!process?.client) {
      return res.status(409).json({
        error: 'Le bot doit etre en ligne pour publier le createur vocal',
      });
    }

    const panel = await process.publishVoiceGeneratorPanel(req.guild.guild_id);
    const payload = buildOverviewPayload(req, {
      message: 'Createur vocal publie',
      panel,
    });

    broadcastVoiceGeneratorUpdate(req, {
      reason: 'panel_published',
      message: payload.message,
      panel,
    });

    res.json(payload);
  } catch (error) {
    logger.warn(`Voice panel publish failed: ${error.message}`, {
      guildId: req.guild?.id,
      discordGuildId: req.guild?.guild_id,
      userId: req.user?.id,
    });
    next(normalizeVoiceRouteError(error));
  }
});

module.exports = router;
