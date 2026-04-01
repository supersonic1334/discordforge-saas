'use strict';

const { v4: uuidv4 } = require('uuid');

const db = require('../database');
const discordService = require('./discordService');
const logger = require('../utils/logger').child('BotBlacklistService');
const { recordModAction } = require('../bot/utils/modHelpers');

function getBlacklistEntry(ownerUserId, targetUserId) {
  return db.raw(
    'SELECT * FROM bot_blacklist_entries WHERE owner_user_id = ? AND target_user_id = ? LIMIT 1',
    [ownerUserId, targetUserId]
  )[0] ?? null;
}

function listBlacklistEntries(ownerUserId) {
  return db.raw(
    'SELECT * FROM bot_blacklist_entries WHERE owner_user_id = ? ORDER BY updated_at DESC, created_at DESC',
    [ownerUserId]
  );
}

function upsertBlacklistEntry(ownerUserId, targetUserId, targetUsername, reason, sourceModule) {
  const now = new Date().toISOString();
  const existing = getBlacklistEntry(ownerUserId, targetUserId);

  if (existing) {
    const nextUsername = targetUsername ?? existing.target_username ?? 'Unknown';
    const nextReason = reason ?? existing.reason ?? '';
    const nextSourceModule = sourceModule ?? existing.source_module ?? 'SYSTEM';

    db.db.prepare(
      `UPDATE bot_blacklist_entries
       SET target_username = ?, reason = ?, source_module = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextUsername,
      nextReason,
      nextSourceModule,
      now,
      existing.id
    );

    return { ...existing, target_username: nextUsername, reason: nextReason, source_module: nextSourceModule, updated_at: now };
  }

  const entry = {
    id: uuidv4(),
    owner_user_id: ownerUserId,
    target_user_id: targetUserId,
    target_username: targetUsername ?? 'Unknown',
    reason: reason ?? '',
    source_module: sourceModule ?? 'SYSTEM',
    created_at: now,
    updated_at: now,
  };

  db.insert('bot_blacklist_entries', entry);
  return entry;
}

async function banUserAcrossBotNetwork(ownerUserId, targetUserId, targetUsername, botToken, reason, sourceModule, deleteMessageSeconds = 0) {
  const entry = upsertBlacklistEntry(ownerUserId, targetUserId, targetUsername, reason, sourceModule);
  const guildRows = db.raw(
    'SELECT guild_id FROM guilds WHERE user_id = ? AND is_active = 1',
    [ownerUserId]
  );

  for (const guildRow of guildRows) {
    try {
      await discordService.banMember(
        botToken,
        guildRow.guild_id,
        targetUserId,
        reason || 'Blacklisted on bot network',
        deleteMessageSeconds
      );
      await recordModAction(
        guildRow.guild_id,
        'ban',
        targetUserId,
        targetUsername,
        null,
        null,
        reason || 'Blacklisted on bot network',
        null,
        sourceModule,
        { blacklist_scope: 'bot-network', delete_message_seconds: deleteMessageSeconds }
      );
    } catch (error) {
      if (error?.httpStatus === 404 || error?.discordCode === 10026) continue;
      logger.warn(`Failed to blacklist ${targetUserId} in guild ${guildRow.guild_id}`, {
        ownerUserId,
        targetUserId,
        guildId: guildRow.guild_id,
        error: error.message,
      });
    }
  }

  return entry;
}

async function enforceBlacklistOnJoin(ownerUserId, member, botToken) {
  const entry = getBlacklistEntry(ownerUserId, member.user.id);
  if (!entry) return false;

  const reason = entry.reason || 'Blacklisted on bot network';

  try {
    await discordService.banMember(botToken, member.guild.id, member.user.id, reason);
    await recordModAction(
      member.guild.id,
      'ban',
      member.user.id,
      member.user.tag,
      null,
      null,
      reason,
      null,
      entry.source_module || 'BOT_BLACKLIST',
      { blacklist_scope: 'bot-network', enforced_on_join: true }
    );
    return true;
  } catch (error) {
    logger.warn(`Failed to enforce bot blacklist for ${member.user.id}`, {
      ownerUserId,
      guildId: member.guild.id,
      error: error.message,
    });
    return false;
  }
}

function removeBlacklistEntry(ownerUserId, targetUserId) {
  return db.remove('bot_blacklist_entries', {
    owner_user_id: ownerUserId,
    target_user_id: targetUserId,
  });
}

module.exports = {
  getBlacklistEntry,
  listBlacklistEntries,
  removeBlacklistEntry,
  banUserAcrossBotNetwork,
  enforceBlacklistOnJoin,
};
