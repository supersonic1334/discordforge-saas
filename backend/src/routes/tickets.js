'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { ticketGeneratorConfigSchema } = require('../validators/schemas');
const botManager = require('../services/botManager');
const guildAccessService = require('../services/guildAccessService');
const logger = require('../utils/logger').child('TicketsRoutes');
const wsServer = require('../websocket');
const {
  getTicketOverview,
  saveGuildTicketGenerator,
} = require('../services/ticketGeneratorService');

router.use(requireAuth, requireBotToken, requireGuildOwner);

function buildOverviewPayload(req, extra = {}) {
  const overview = getTicketOverview(req.guild.id);
  return {
    guildId: req.guild.id,
    discordGuildId: req.guild.guild_id,
    config: overview.config,
    tickets: overview.tickets,
    stats: overview.stats,
    ...extra,
  };
}

function broadcastTicketGeneratorUpdate(req, extra = {}) {
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
      event: 'tickets:updated',
      data: payload,
    });
  }
}

function normalizeTicketRouteError(error) {
  if (!error) return error;
  if (error.status || error.statusCode) return error;

  const message = String(error.message || '').toLowerCase();
  if (
    message.includes('desactive')
    || message.includes('choisis un salon')
    || message.includes('au moins un type')
    || message.includes('salon texte')
    || message.includes('permission')
    || message.includes('introuvable')
    || message.includes('doit etre en ligne')
    || message.includes('ne peut pas')
  ) {
    error.status = 409;
  }

  return error;
}

router.get('/', (req, res) => {
  res.json(buildOverviewPayload(req));
});

router.put('/config', validate(ticketGeneratorConfigSchema), async (req, res, next) => {
  try {
    saveGuildTicketGenerator(req.guild.id, req.body);
    const payload = buildOverviewPayload(req, {
      message: 'Configuration tickets mise a jour',
    });

    broadcastTicketGeneratorUpdate(req, {
      reason: 'config_saved',
      message: payload.message,
    });

    res.json(payload);
  } catch (error) {
    logger.warn(`Ticket config save failed: ${error.message}`, {
      guildId: req.guild?.id,
      discordGuildId: req.guild?.guild_id,
      userId: req.user?.id,
    });
    next(normalizeTicketRouteError(error));
  }
});

router.post('/publish', async (req, res, next) => {
  try {
    const process = botManager.getProcess(req.botOwnerUserId);
    if (!process?.client) {
      return res.status(409).json({
        error: 'Le bot doit etre en ligne pour publier le panel tickets',
      });
    }

    const panel = await process.publishTicketGeneratorPanel(req.guild.guild_id);
    const payload = buildOverviewPayload(req, {
      message: 'Panel tickets publie',
      panel,
    });

    broadcastTicketGeneratorUpdate(req, {
      reason: 'panel_published',
      message: payload.message,
      panel,
    });

    res.json(payload);
  } catch (error) {
    logger.warn(`Ticket panel publish failed: ${error.message}`, {
      guildId: req.guild?.id,
      discordGuildId: req.guild?.guild_id,
      userId: req.user?.id,
    });
    next(normalizeTicketRouteError(error));
  }
});

module.exports = router;
