'use strict';

const logger = require('../../utils/logger').child('AntiSpam');
const discordService = require('../../services/discordService');
const { banUserAcrossBotNetwork } = require('../../services/botBlacklistService');
const { recordModAction, addWarning, getWarningCount } = require('../utils/modHelpers');

// Map<guildId, Map<userId, { messages: Array<{ timestamp: number, message: Message }> }>>
const messageTracker = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [guildId, users] of messageTracker.entries()) {
    for (const [userId, data] of users.entries()) {
      data.messages = data.messages.filter((entry) => now - entry.timestamp < 60_000);
      if (!data.messages.length) users.delete(userId);
    }
    if (!users.size) messageTracker.delete(guildId);
  }
}, 60_000);

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getUserTracker(guildId, userId) {
  if (!messageTracker.has(guildId)) messageTracker.set(guildId, new Map());
  const guildTracker = messageTracker.get(guildId);
  if (!guildTracker.has(userId)) guildTracker.set(userId, { messages: [] });
  return guildTracker.get(userId);
}

/**
 * @param {import('discord.js').Message} message
 * @param {{ simple_config?: Record<string, any>, advanced_config?: Record<string, any> }} config
 * @param {string} botToken
 * @param {string} ownerUserId
 */
async function handleAntiSpam(message, config, botToken, ownerUserId) {
  const sc = config.simple_config || {};
  const ac = config.advanced_config || {};
  const { member, guild, channel, author } = message;

  if (author.bot) return;

  const memberRoleIds = member?.roles?.cache?.map((role) => role.id) ?? [];
  if (ac.whitelist_roles?.some((id) => memberRoleIds.includes(id))) return;
  if (ac.whitelist_channels?.includes(channel.id)) return;

  const guildId = guild.id;
  const userId = author.id;
  const now = Date.now();

  const windowMs = toPositiveNumber(ac.window_ms, 5000);
  const maxMessages = Math.max(2, Math.floor(toPositiveNumber(ac.max_messages, 5)));
  const retentionWindowMs = Math.max(windowMs, 60_000);

  const tracker = getUserTracker(guildId, userId);
  tracker.messages = tracker.messages.filter((entry) => now - entry.timestamp < retentionWindowMs);
  tracker.messages.push({ timestamp: now, message });

  const burstMessages = tracker.messages.filter((entry) => now - entry.timestamp < windowMs);
  const burstCount = burstMessages.length;
  if (burstCount < maxMessages) return;

  const reason = `Anti-Spam: message flood (${burstCount} messages en ${Math.round(windowMs / 1000)}s)`;

  logger.info(`Spam detected for ${author.tag}`, {
    guildId,
    userId,
    burstCount,
    burstWindowMs: windowMs,
  });

  if (ac.delete_messages !== false) {
    const handledIds = new Set();
    for (const entry of burstMessages) {
      const targetMessage = entry.message;
      if (!targetMessage?.id || handledIds.has(targetMessage.id)) continue;
      handledIds.add(targetMessage.id);
      try {
        await targetMessage.delete();
      } catch {
        // ignored
      }
    }
  }

  if (ac.warn_before_action) {
    const warnThreshold = Math.max(1, Math.floor(toPositiveNumber(ac.warn_threshold, 3)));
    const warnCount = await getWarningCount(guildId, userId);
    if (warnCount < warnThreshold) {
      await addWarning(
        guildId,
        userId,
        author.tag,
        guild.members.me?.id,
        guild.members.me?.user?.tag,
        `${reason} (auto)`,
        1
      );
      try {
        await message.channel.send({
          content: `${author}, ralentis un peu. Une sanction automatique sera appliquee si ca continue.`,
        }).then((sentMessage) => setTimeout(() => sentMessage.delete().catch(() => {}), 8000));
      } catch {
        // ignored
      }

      tracker.messages = [];
      return;
    }
  }

  await executePunishment(
    sc.action,
    guild,
    author,
    botToken,
    reason,
    sc.timeout_duration_ms,
    ownerUserId
  );

  tracker.messages = [];
}

async function executePunishment(action, guild, author, botToken, reason, timeoutMs, ownerUserId) {
  const guildId = guild.id;
  const userId = author.id;
  const durationMs = toPositiveNumber(timeoutMs, 300000);

  try {
    switch (action) {
      case 'timeout':
        await discordService.timeoutMember(botToken, guildId, userId, durationMs, reason);
        await recordModAction(guildId, 'timeout', userId, author.tag, guild.members.me?.id, guild.members.me?.user?.tag, reason, durationMs, 'ANTI_SPAM');
        break;
      case 'kick':
        await discordService.kickMember(botToken, guildId, userId, reason);
        await recordModAction(guildId, 'kick', userId, author.tag, guild.members.me?.id, guild.members.me?.user?.tag, reason, null, 'ANTI_SPAM');
        break;
      case 'ban':
        await discordService.banMember(botToken, guildId, userId, reason, 86400);
        await recordModAction(guildId, 'ban', userId, author.tag, guild.members.me?.id, guild.members.me?.user?.tag, reason, null, 'ANTI_SPAM');
        break;
      case 'blacklist':
        if (ownerUserId) {
          await banUserAcrossBotNetwork(ownerUserId, userId, author.tag, botToken, reason, 'ANTI_SPAM');
        } else {
          await discordService.banMember(botToken, guildId, userId, reason, 86400);
          await recordModAction(guildId, 'ban', userId, author.tag, guild.members.me?.id, guild.members.me?.user?.tag, reason, null, 'ANTI_SPAM', {
            blacklist_scope: 'current-guild-fallback',
          });
        }
        break;
      case 'delete':
      default:
        break;
    }
  } catch (error) {
    logger.error(`Failed to execute anti-spam action ${action}`, { error: error.message, guildId, userId });
  }
}

module.exports = { handleAntiSpam };
