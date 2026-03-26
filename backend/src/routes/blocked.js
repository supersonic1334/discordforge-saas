'use strict';

const express = require('express');

const { requireAuth, requireBotToken, requireGuildOwner } = require('../middleware');
const { decrypt } = require('../services/encryptionService');
const discordService = require('../services/discordService');
const botBlacklistService = require('../services/botBlacklistService');
const logger = require('../utils/logger').child('BlockedRoutes');

const router = express.Router({ mergeParams: true });

router.use(requireAuth, requireBotToken, requireGuildOwner);

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesQuery(query, values) {
  if (!query) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(query));
}

function buildBanItem(entry) {
  const user = entry?.user || {};
  const displayName = user.global_name || user.username || user.id || 'Inconnu';

  return {
    id: user.id || null,
    username: user.username || null,
    global_name: user.global_name || null,
    display_name: displayName,
    avatar_url: user.id ? discordService.getAvatarUrl(user.id, user.avatar) : null,
    reason: entry?.reason || '',
    banned_at: null,
    source: 'guild_ban',
  };
}

function buildBlacklistItem(entry, profile) {
  const user = profile || null;
  const displayName = user?.global_name || user?.username || entry.target_username || entry.target_user_id || 'Inconnu';

  return {
    id: entry.target_user_id,
    username: user?.username || null,
    global_name: user?.global_name || null,
    display_name: displayName,
    avatar_url: user?.id ? discordService.getAvatarUrl(user.id, user.avatar) : null,
    reason: entry.reason || '',
    created_at: entry.created_at || null,
    updated_at: entry.updated_at || null,
    source_module: entry.source_module || 'SYSTEM',
    source: 'bot_blacklist',
  };
}

async function enrichBlacklistEntries(token, entries) {
  const uniqueIds = [...new Set(entries.map((entry) => entry.target_user_id).filter(Boolean))];
  const profiles = await Promise.all(uniqueIds.map(async (userId) => {
    try {
      const profile = await discordService.getUser(token, userId);
      return [userId, profile];
    } catch {
      return [userId, null];
    }
  }));

  const profileMap = new Map(profiles);
  return entries.map((entry) => buildBlacklistItem(entry, profileMap.get(entry.target_user_id)));
}

router.get('/', async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const query = normalizeQuery(req.query.q);
    const [guildBans, blacklistEntries] = await Promise.all([
      discordService.getGuildBans(token, req.guild.guild_id, 1000),
      Promise.resolve(botBlacklistService.listBlacklistEntries(req.guildOwnerUserId || req.user.id)),
    ]);

    const bans = (Array.isArray(guildBans) ? guildBans : [])
      .map(buildBanItem)
      .filter((entry) => matchesQuery(query, [
        entry.id,
        entry.username,
        entry.global_name,
        entry.display_name,
        entry.reason,
      ]));

    const blacklist = (await enrichBlacklistEntries(token, blacklistEntries))
      .filter((entry) => matchesQuery(query, [
        entry.id,
        entry.username,
        entry.global_name,
        entry.display_name,
        entry.reason,
        entry.source_module,
      ]));

    res.json({
      q: String(req.query.q || ''),
      bans,
      blacklist,
      totals: {
        bans: bans.length,
        blacklist: blacklist.length,
      },
    });
  } catch (error) {
    if (error.httpStatus === 403) {
      return res.status(403).json({ error: 'Bot lacks permission to view bans' });
    }
    next(error);
  }
});

router.delete('/bans/:discordUserId', async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    await discordService.unbanMember(token, req.guild.guild_id, req.params.discordUserId, 'Manual unban from blocked users page');

    logger.info(`User unbanned via blocked page`, {
      guildId: req.guild.guild_id,
      targetUserId: req.params.discordUserId,
      actorUserId: req.user.id,
    });

    res.json({
      message: 'Utilisateur debanni',
      userId: req.params.discordUserId,
    });
  } catch (error) {
    if (error.httpStatus === 403) {
      return res.status(403).json({ error: 'Bot lacks permission to unban members' });
    }
    if (error.httpStatus === 404) {
      return res.status(404).json({ error: 'User is not banned or not found' });
    }
    next(error);
  }
});

router.delete('/blacklist/:discordUserId', async (req, res, next) => {
  try {
    const ownerUserId = req.guildOwnerUserId || req.user.id;
    const targetUserId = req.params.discordUserId;

    const removed = botBlacklistService.removeBlacklistEntry(ownerUserId, targetUserId);
    if (!removed) {
      logger.warn(`Blacklist removal failed: entry not found`, {
        ownerUserId,
        targetUserId,
      });
      return res.status(404).json({ error: 'Entree de blacklist introuvable' });
    }

    logger.info(`User removed from blacklist`, {
      ownerUserId,
      targetUserId,
      actorUserId: req.user.id,
    });

    res.json({
      message: 'Utilisateur retire de la blacklist',
      userId: targetUserId,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
