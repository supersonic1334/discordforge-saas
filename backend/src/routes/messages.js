'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate, validateQuery } = require('../middleware');
const { moderationSearchSchema, guildDmConfigSchema, directMessageSchema, channelMessageSchema } = require('../validators/schemas');
const { decrypt } = require('../services/encryptionService');
const discordService = require('../services/discordService');
const authService = require('../services/authService');
const guildAccessService = require('../services/guildAccessService');
const { recordModAction } = require('../bot/utils/modHelpers');
const wsServer = require('../websocket');
const {
  DEFAULT_SETTINGS,
  getGuildDmSettings,
  saveGuildDmSettings,
  sendDirectStaffMessage,
} = require('../services/moderationDmService');

router.use(requireAuth, requireBotToken, requireGuildOwner);

function buildHttpError(status, message, code = null) {
  const error = new Error(message);
  error.httpStatus = status;
  if (code) error.code = code;
  return error;
}

function isPrimaryFounder(user) {
  return authService.isPrimaryFounderEmail(user?.email);
}

function notifyGuildMessageSync(req, settings) {
  const recipients = guildAccessService.listGuildCollaborators(req.guild.id);
  const userIds = new Set(
    recipients
      .map((entry) => String(entry?.user_id || '').trim())
      .filter(Boolean)
  );

  if (req.guild?.user_id) {
    userIds.add(String(req.guild.user_id));
  }

  const eventPayload = {
    guildId: req.guild.id,
    discordGuildId: req.guild.guild_id,
    actorUserId: req.user.id,
    actorUsername: req.user.username,
    updatedAt: new Date().toISOString(),
    settings,
  };

  for (const userId of userIds) {
    wsServer.broadcastToUser(userId, {
      event: 'messages:updated',
      data: eventPayload,
    });
  }
}

function buildSearchResult(user, member = null, banned = false) {
  if (!user?.id) return null;
  return {
    id: user.id,
    username: user.username || null,
    global_name: user.global_name || null,
    display_name: member?.nick || user.global_name || user.username || user.id,
    avatar_url: discordService.getAvatarUrl(user.id, user.avatar),
    nickname: member?.nick || null,
    joined_at: member?.joined_at || null,
    in_server: !!member,
    banned: !!banned,
    bot: Boolean(user.bot),
  };
}

async function getGuildMemberSafe(token, guildId, userId) {
  try {
    return await discordService.getGuildMember(token, guildId, userId);
  } catch (error) {
    if (error?.httpStatus === 404) return null;
    throw error;
  }
}

async function getGuildBanSafe(token, guildId, userId) {
  try {
    return await discordService.getGuildBan(token, guildId, userId);
  } catch (error) {
    if (error?.httpStatus === 404) return null;
    throw error;
  }
}

async function ensureDirectMessageAccess(req, token) {
  const linkedDiscordId = req.user.discord_id || null;
  if (!linkedDiscordId) {
    throw buildHttpError(403, 'Connecte d abord ton compte Discord pour envoyer un MP', 'DISCORD_LINK_REQUIRED');
  }

  if (String(linkedDiscordId) === String(req.guild.owner_id || '') || isPrimaryFounder(req.user)) {
    return {
      discordId: linkedDiscordId,
      linked: true,
    };
  }

  const member = await getGuildMemberSafe(token, req.guild.guild_id, linkedDiscordId);
  if (!member) {
    throw buildHttpError(403, 'Le compte Discord lie doit etre present sur ce serveur pour envoyer un MP', 'DISCORD_LINK_NOT_IN_GUILD');
  }

  return {
    discordId: linkedDiscordId,
    linked: true,
    member,
  };
}

router.get('/config', (req, res) => {
  res.json({
    settings: getGuildDmSettings(req.guild.id),
    defaults: { ...DEFAULT_SETTINGS },
  });
});

router.put('/config', validate(guildDmConfigSchema), (req, res) => {
  const settings = saveGuildDmSettings(req.guild.id, req.body || {});
  notifyGuildMessageSync(req, settings);
  res.json({
    message: 'DM settings updated',
    settings,
  });
});

router.get('/search', validateQuery(moderationSearchSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const guildId = req.guild.guild_id;
    const query = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 8);
    const results = [];
    const seen = new Set();

    if (/^\d+$/.test(query)) {
      const member = await getGuildMemberSafe(token, guildId, query);
      const memberResult = buildSearchResult(member?.user, member, false);
      if (memberResult && !seen.has(memberResult.id)) {
        seen.add(memberResult.id);
        results.push(memberResult);
      }

      const banned = await getGuildBanSafe(token, guildId, query);
      const bannedResult = buildSearchResult(banned?.user, null, true);
      if (bannedResult && !seen.has(bannedResult.id)) {
        seen.add(bannedResult.id);
        results.push(bannedResult);
      }

      if (!memberResult && !bannedResult) {
        const user = await discordService.getUser(token, query).catch(() => null);
        const userResult = buildSearchResult(user, null, false);
        if (userResult && !seen.has(userResult.id)) {
          seen.add(userResult.id);
          results.push(userResult);
        }
      }
    }

    if (results.length < limit) {
      const members = await discordService.searchGuildMembers(token, guildId, query, limit).catch(() => []);
      for (const member of Array.isArray(members) ? members : []) {
        const entry = buildSearchResult(member?.user, member, false);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        results.push(entry);
        if (results.length >= limit) break;
      }
    }

    res.json({
      results: results.slice(0, limit),
      total: results.length,
      q: query,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/direct', validate(directMessageSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const { target_user_id, target_username, title, message, hide_sender_identity } = req.body;
    const access = await ensureDirectMessageAccess(req, token);
    const safeTitle = String(title || 'Message du staff').trim() || 'Message du staff';
    const safeTargetUsername = String(target_username || '').trim() || target_user_id;

    await sendDirectStaffMessage({
      botToken: token,
      guildRow: req.guild,
      targetUserId: target_user_id,
      title: safeTitle,
      message,
      senderName: req.user.username,
      hideSenderIdentity: Boolean(hide_sender_identity),
    });

    await recordModAction(
      req.guild.guild_id,
      'direct_message',
      target_user_id,
      safeTargetUsername,
      access.discordId || req.user.id,
      req.user.username,
      safeTitle,
      null,
      'MANUAL_DM',
      {
        sender_site_user_id: req.user.id,
        sender_site_username: req.user.username,
        sender_discord_id: access.discordId || null,
        hide_sender_identity: Boolean(hide_sender_identity),
        message_preview: String(message || '').trim().slice(0, 240),
      }
    );

    res.status(201).json({
      message: 'Direct message sent',
      target_user_id,
    });
  } catch (error) {
    if (error?.code === 'DISCORD_LINK_REQUIRED' || error?.code === 'DISCORD_LINK_NOT_IN_GUILD') {
      return res.status(error.httpStatus || 403).json({ error: error.message, code: error.code });
    }
    if (error?.httpStatus === 403) {
      return res.status(403).json({ error: 'Impossible d envoyer un MP a cet utilisateur' });
    }
    next(error);
  }
});

router.post('/channel', validate(channelMessageSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const { channel_id, message } = req.body;
    const channels = await discordService.getGuildChannels(token, req.guild.guild_id);
    const targetChannel = (Array.isArray(channels) ? channels : []).find((channel) => String(channel?.id || '') === String(channel_id));

    if (!targetChannel) {
      return res.status(404).json({ error: 'Salon introuvable' });
    }

    if (![0, 5].includes(Number(targetChannel.type))) {
      return res.status(400).json({ error: 'Choisis un salon textuel' });
    }

    const sent = await discordService.sendMessage(token, channel_id, {
      content: String(message || '').trim(),
      allowed_mentions: { parse: [] },
    });

    res.status(201).json({
      message: 'Message envoye',
      sent_message_id: sent?.id || null,
      channel_id,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
