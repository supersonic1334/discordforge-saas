'use strict';

const logger = require('../../utils/logger').child('SecurityModules');
const discordService = require('../../services/discordService');
const { banUserAcrossBotNetwork } = require('../../services/botBlacklistService');
const { recordModAction, addWarning, getWarningCount } = require('../utils/modHelpers');

// ── URL / Invite Patterns ─────────────────────────────────────────────────────
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+/gi;
const DISCORD_INVITE_REGEX = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[^\s]+/gi;
const BOT_PATTERN_REGEX = /^[a-zA-Z]+#\d{4}$/; // Classic username#0000

// ── Violation counters (in-memory, resets on restart) ─────────────────────────
const violationTracker = new Map(); // `${guildId}:${userId}:${module}` -> count

function getViolationKey(guildId, userId, module) {
  return `${guildId}:${userId}:${module}`;
}

function incrementViolation(guildId, userId, module) {
  const key = getViolationKey(guildId, userId, module);
  const count = (violationTracker.get(key) ?? 0) + 1;
  violationTracker.set(key, count);
  return count;
}

// ── Anti-Link ─────────────────────────────────────────────────────────────────
async function handleAntiLink(message, config, botToken, ownerUserId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { member, guild, channel, author, content } = message;

  if (author.bot) return;

  const memberRoleIds = member?.roles?.cache?.map((r) => r.id) ?? [];
  if (ac.whitelist_channels?.includes(channel.id)) return;
  if (ac.whitelist_roles?.some((id) => memberRoleIds.includes(id))) return;

  const hasInvite = DISCORD_INVITE_REGEX.test(content);
  const hasUrl = URL_REGEX.test(content);

  // Reset regex lastIndex (global flag quirk)
  URL_REGEX.lastIndex = 0;
  DISCORD_INVITE_REGEX.lastIndex = 0;

  let violation = false;

  if (sc.block_invites && hasInvite) {
    violation = true;
  } else if (sc.block_all_links && hasUrl) {
    // Check allowed domains
    const urls = content.match(URL_REGEX) ?? [];
    const blocked = urls.some((url) => {
      if (!(ac.allowed_domains?.length)) return true;
      return !ac.allowed_domains.some((d) => url.includes(d));
    });
    if (blocked) violation = true;
  }

  if (!violation) return;

  logger.info(`Anti-link triggered: ${author.tag}`, { guildId: guild.id });

  // Always delete
  try { await message.delete(); } catch { /* no perms */ }

  const violations = incrementViolation(guild.id, author.id, 'ANTI_LINK');
  const threshold = ac.punishment_after_violations || 3;

  const punishmentAction = ac.punishment_action || sc.action || 'delete';
  if (violations >= threshold && punishmentAction && punishmentAction !== 'delete') {
    await punishSecurityAction(punishmentAction, guild, author, botToken, 'Anti-Link: repeated violations', ac.timeout_duration_ms, 'ANTI_LINK', ownerUserId);
  } else if (ac.delete_and_warn) {
    try {
      const m = await message.channel.send(`⚠️ ${author}, links are not allowed here!`);
      setTimeout(() => m.delete().catch(() => {}), 6000);
    } catch { /* no send perms */ }
  }
}

// ── Anti-Invite (Discord invite links specifically) ───────────────────────────
async function handleAntiInvite(message, config, botToken, ownerUserId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { member, guild, channel, author, content } = message;

  if (author.bot) return;
  const memberRoleIds = member?.roles?.cache?.map((r) => r.id) ?? [];
  if (ac.authorized_roles?.some((id) => memberRoleIds.includes(id))) return;
  if (ac.whitelist_channels?.includes(channel.id)) return;

  const inviteMatches = content.match(DISCORD_INVITE_REGEX);
  DISCORD_INVITE_REGEX.lastIndex = 0;
  if (!inviteMatches) return;

  // Allow invites to own server
  if (sc.allow_own_invites) {
    const allOwn = inviteMatches.every((inv) => {
      // Check if the invite code belongs to this guild — heuristic, can't verify without API call
      return ac.whitelist_servers?.includes(guild.id);
    });
    if (allOwn) return;
  }

  logger.info(`Anti-invite triggered: ${author.tag}`, { guildId: guild.id });
  try { await message.delete(); } catch { /* no perms */ }

  const violations = incrementViolation(guild.id, author.id, 'ANTI_INVITE');
  if (violations >= (ac.punishment_threshold || 3)) {
    await punishSecurityAction(ac.punishment_action || 'timeout', guild, author, botToken, 'Anti-Invite: repeated violations', ac.timeout_duration_ms, 'ANTI_INVITE', ownerUserId);
  }
}

// ── Anti-Mass Mention ─────────────────────────────────────────────────────────
async function handleAntiMassMention(message, config, botToken, ownerUserId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { member, guild, channel, author, mentions, content } = message;

  if (author.bot) return;
  const memberRoleIds = member?.roles?.cache?.map((r) => r.id) ?? [];
  if (ac.whitelist_roles?.some((id) => memberRoleIds.includes(id))) return;
  if (ac.whitelist_channels?.includes(channel.id)) return;

  const userMentionCount = mentions.users?.size ?? 0;
  const roleMentionCount = mentions.roles?.size ?? 0;
  const hasEveryone = mentions.everyone || content.includes('@everyone') || content.includes('@here');
  const violation = userMentionCount > 0 || roleMentionCount > 0 || hasEveryone;

  if (!violation) return;

  logger.info(`Anti-mention triggered: ${author.tag} (users=${userMentionCount} roles=${roleMentionCount})`, { guildId: guild.id });

  try { await message.delete(); } catch { /* no perms */ }

  await punishSecurityAction(
    sc.action || 'delete',
    guild,
    author,
    botToken,
    'Anti-Mention: unauthorized mention',
    ac.timeout_duration_ms,
    'ANTI_MASS_MENTION',
    ownerUserId
  );
}

// ── Anti-Bot (on member join) ─────────────────────────────────────────────────
async function handleAntiBotJoin(member, config, botToken, ownerUserId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { guild, user } = member;

  // If the user is already whitelisted
  if (ac.whitelist_bots?.includes(user.id)) return;

  // Must be a bot account to trigger anti-bot
  if (!user.bot) return;

  const isWhitelistedByRole = ac.whitelist_roles?.some((id) => member.roles?.cache?.has(id));
  if (isWhitelistedByRole) return;

  logger.info(`Anti-bot triggered: bot ${user.tag} joined`, { guildId: guild.id });

  const action = sc.action || 'kick';
  await punishSecurityAction(action, guild, user, botToken, 'Anti-Bot: unauthorized bot account', null, 'ANTI_BOT', ownerUserId);
}

// ── Anti-Raid (on member join) ────────────────────────────────────────────────
// Track recent joins per guild
const raidTracker = new Map(); // guildId -> { timestamps: number[], raidActive: boolean, raidUntil: number }

async function handleAntiRaid(member, config, botToken, ownerUserId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { guild, user } = member;

  const now = Date.now();
  const guildId = guild.id;

  if (!raidTracker.has(guildId)) {
    raidTracker.set(guildId, { timestamps: [], raidActive: false, raidUntil: 0 });
  }

  const data = raidTracker.get(guildId);
  const window = ac.join_window_ms || 10000;
  data.timestamps = data.timestamps.filter((t) => now - t < window);
  data.timestamps.push(now);

  // Check account age
  const accountAgeDays = (now - user.createdTimestamp) / 86400000;
  const minAge = ac.account_age_min_days || 7;

  if (accountAgeDays < minAge) {
    logger.warn(`Suspicious new account joined: ${user.tag} (age: ${accountAgeDays.toFixed(1)} days)`, { guildId });
    if (ac.new_account_action) {
      await punishSecurityAction(ac.new_account_action, guild, user, botToken, 'Anti-Raid: account too new', ac.new_account_timeout_duration_ms, 'ANTI_RAID', ownerUserId);
    }
    return;
  }

  const threshold = ac.join_threshold || 10;
  if (data.timestamps.length >= threshold) {
    // RAID DETECTED
    if (!data.raidActive) {
      data.raidActive = true;
      data.raidUntil = now + (ac.raid_duration_ms || 300000);
      logger.warn(`🚨 RAID DETECTED in guild ${guildId}! ${data.timestamps.length} joins in ${window}ms`);

      // Alert channel
      if (ac.alert_channel_id) {
        try {
          await discordService.sendMessage(botToken, ac.alert_channel_id, {
            embeds: [{
              title: '🚨 Raid Detected!',
              description: `**${data.timestamps.length}** members joined in the last ${window / 1000}s.\nRaid mode active for ${ac.raid_duration_ms / 60000} minutes.`,
              color: 0xFF0000,
              timestamp: new Date().toISOString(),
            }],
          });
        } catch { /* no perms */ }
      }
    }

    if (data.raidActive && now < data.raidUntil) {
      await punishSecurityAction(sc.action || 'kick', guild, user, botToken, 'Anti-Raid: raid in progress', sc.timeout_duration_ms, 'ANTI_RAID', ownerUserId);
    } else {
      data.raidActive = false;
    }
  }
}

// ── Shared punishment helper ──────────────────────────────────────────────────
async function punishSecurityAction(action, guild, userOrMember, botToken, reason, timeoutMs, moduleSource, ownerUserId) {
  const user = userOrMember.user ?? userOrMember;
  const userTag = user.tag || user.username || user.id;
  const guildId = guild.id;
  const userId = user.id;
  const botId = guild.members.me?.id;
  const botTag = guild.members.me?.user?.tag;
  const normalizedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : 300000;

  try {
    switch (action) {
      case 'timeout':
        await discordService.timeoutMember(botToken, guildId, userId, normalizedTimeoutMs, reason);
        await recordModAction(guildId, 'timeout', userId, userTag, botId, botTag, reason, normalizedTimeoutMs, moduleSource);
        break;
      case 'kick':
        await discordService.kickMember(botToken, guildId, userId, reason);
        await recordModAction(guildId, 'kick', userId, userTag, botId, botTag, reason, null, moduleSource);
        break;
      case 'ban':
        await discordService.banMember(botToken, guildId, userId, reason);
        await recordModAction(guildId, 'ban', userId, userTag, botId, botTag, reason, null, moduleSource);
        break;
      case 'blacklist':
        if (ownerUserId) {
          await banUserAcrossBotNetwork(ownerUserId, userId, userTag, botToken, reason, moduleSource);
        } else {
          await discordService.banMember(botToken, guildId, userId, reason);
          await recordModAction(guildId, 'ban', userId, userTag, botId, botTag, reason, null, moduleSource, {
            blacklist_scope: 'current-guild-fallback',
          });
        }
        break;
      default:
        break;
    }
  } catch (err) {
    logger.error(`Punishment ${action} failed for ${userTag}`, { error: err.message, guildId, userId });
  }
}

module.exports = {
  handleAntiLink,
  handleAntiInvite,
  handleAntiMassMention,
  handleAntiBotJoin,
  handleAntiRaid,
  punishSecurityAction,
};
