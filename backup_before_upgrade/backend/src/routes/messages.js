'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate, validateQuery } = require('../middleware');
const { moderationSearchSchema, guildDmConfigSchema, directMessageSchema } = require('../validators/schemas');
const { decrypt } = require('../services/encryptionService');
const discordService = require('../services/discordService');
const {
  DEFAULT_SETTINGS,
  getGuildDmSettings,
  saveGuildDmSettings,
  sendDirectStaffMessage,
} = require('../services/moderationDmService');

router.use(requireAuth, requireBotToken, requireGuildOwner);

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

router.get('/config', (req, res) => {
  res.json({
    settings: getGuildDmSettings(req.guild.id),
    defaults: { ...DEFAULT_SETTINGS },
  });
});

router.put('/config', validate(guildDmConfigSchema), (req, res) => {
  const settings = saveGuildDmSettings(req.guild.id, req.body || {});
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
    const { target_user_id, title, message } = req.body;

    await sendDirectStaffMessage({
      botToken: token,
      guildRow: req.guild,
      targetUserId: target_user_id,
      title,
      message,
      senderName: req.user.username,
    });

    res.status(201).json({
      message: 'Direct message sent',
      target_user_id,
    });
  } catch (error) {
    if (error?.httpStatus === 403) {
      return res.status(403).json({ error: 'Impossible d envoyer un MP a cet utilisateur' });
    }
    next(error);
  }
});

module.exports = router;
