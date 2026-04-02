'use strict';

const express = require('express');

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { captchaConfigSchema } = require('../validators/schemas');
const botManager = require('../services/botManager');
const guildAccessService = require('../services/guildAccessService');
const wsServer = require('../websocket');
const logger = require('../utils/logger').child('CaptchaRoutes');
const {
  getGuildCaptchaConfig,
  saveGuildCaptchaConfig,
} = require('../services/captchaGeneratorService');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireBotToken, requireGuildOwner);

function buildOverviewPayload(req, extra = {}) {
  const config = getGuildCaptchaConfig(req.guild.id);
  return {
    guildId: req.guild.id,
    discordGuildId: req.guild.guild_id,
    config,
    stats: {
      enabledChallenges: (config.challenge_types || []).filter((item) => item.enabled).length,
      verifiedRoleCount: Array.isArray(config.verified_role_ids) ? config.verified_role_ids.length : 0,
      published: Boolean(config.panel_channel_id && config.panel_message_id),
    },
    ...extra,
  };
}

function broadcastCaptchaUpdate(req, extra = {}) {
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
      event: 'captcha:updated',
      data: payload,
    });
  }
}

function normalizeCaptchaRouteError(error) {
  if (!error || error.status || error.statusCode) return error;

  const message = String(error.message || '').toLowerCase();
  if (
    message.includes('salon')
    || message.includes('role')
    || message.includes('captcha')
    || message.includes('permission')
    || message.includes('introuvable')
    || message.includes('verification')
  ) {
    error.status = 409;
  }

  return error;
}

router.get('/', (req, res) => {
  res.json(buildOverviewPayload(req));
});

router.put('/config', validate(captchaConfigSchema), async (req, res, next) => {
  try {
    saveGuildCaptchaConfig(req.guild.id, req.body);
    const payload = buildOverviewPayload(req, {
      message: 'Configuration CAPTCHA mise a jour',
    });

    broadcastCaptchaUpdate(req, {
      reason: 'config_saved',
      message: payload.message,
    });

    res.json(payload);
  } catch (error) {
    logger.warn(`Captcha config save failed: ${error.message}`, {
      guildId: req.guild?.id,
      discordGuildId: req.guild?.guild_id,
      userId: req.user?.id,
    });
    next(normalizeCaptchaRouteError(error));
  }
});

router.post('/publish', async (req, res, next) => {
  try {
    const process = botManager.getProcess(req.botOwnerUserId);
    if (!process?.client) {
      return res.status(409).json({
        error: 'Le bot doit etre en ligne pour publier le panel CAPTCHA',
      });
    }

    const panel = await process.publishCaptchaPanel(req.guild.guild_id);
    const payload = buildOverviewPayload(req, {
      message: 'Panel CAPTCHA publie',
      panel,
    });

    broadcastCaptchaUpdate(req, {
      reason: 'panel_published',
      message: payload.message,
      panel,
    });

    res.json(payload);
  } catch (error) {
    logger.warn(`Captcha panel publish failed: ${error.message}`, {
      guildId: req.guild?.id,
      discordGuildId: req.guild?.guild_id,
      userId: req.user?.id,
    });
    next(normalizeCaptchaRouteError(error));
  }
});

module.exports = router;
