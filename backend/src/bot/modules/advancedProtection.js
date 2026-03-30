'use strict';

const logger = require('../../utils/logger').child('AdvancedProtection');
const discordService = require('../../services/discordService');
const { punishSecurityAction } = require('./securityModules');
const { logBotEvent } = require('../utils/modHelpers');

const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const SEND_MESSAGES_BIT = 1n << 11n;
const SEND_MESSAGES_IN_THREADS_BIT = 1n << 38n;
const LOCKDOWN_DENY_MASK = SEND_MESSAGES_BIT | SEND_MESSAGES_IN_THREADS_BIT;

const channelBurstTracker = new Map();
const slowmodeState = new Map();
const quarantineTimers = new Map();
const activeLockdowns = new Map();
const nukeTracker = new Map();
const processedAuditEntries = new Map();

const TOKEN_SCAM_RULES = [
  {
    id: 'token_leak',
    label: 'token Discord expose',
    score: 42,
    pattern: /\bmfa\.[A-Za-z0-9_-]{20,}\b|[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}/i,
  },
  {
    id: 'nitro_scam',
    label: 'scam Nitro ou cadeau',
    score: 28,
    pattern: /\b(free\s+nitro|gift\s*nitro|nitro\s+gift|steam\s+gift|gift\s+card|robux\s+gratuits?|free\s+robux)\b/i,
  },
  {
    id: 'phishing',
    label: 'lien de phishing',
    score: 30,
    pattern: /\b(airdrop|wallet|seed phrase|verify your account|verify account|dm me|viens mp|connexion cadeau|claim now|token grabber)\b/i,
  },
];

const ALT_NAME_PATTERN = /\b(raid|nuke|spam|nitro|gift|airdrop|promo|shop|boost|giveaway|sniper|selfbot|captcha)\b|[Il1|]{7,}/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function truncateText(value, max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function buildAvatarUrl(user) {
  const userId = user?.id || null;
  if (!userId) return null;
  return discordService.getAvatarUrl(userId, user?.avatar || null, 128, user?.discriminator || null);
}

function detectTokenScamSignals(content) {
  const source = String(content || '');
  if (!source.trim()) return [];

  const hasLink = /(https?:\/\/|discord\.gg\/|discord\.com\/invite\/)/i.test(source);
  return TOKEN_SCAM_RULES.filter((rule) => {
    if (!rule.pattern.test(source)) return false;
    if (rule.id === 'phishing') return hasLink;
    return true;
  });
}

function normalizeOverwriteType(type) {
  if (type === 0 || type === '0' || type === 'role') return 0;
  return 1;
}

function serializeChannelOverwrites(channel) {
  return [...(channel?.permissionOverwrites?.cache?.values?.() || [])].map((overwrite) => ({
    id: overwrite.id,
    type: normalizeOverwriteType(overwrite.type),
    allow: overwrite.allow?.bitfield?.toString?.() || '0',
    deny: overwrite.deny?.bitfield?.toString?.() || '0',
  }));
}

function buildLockdownOverwrites(overwrites, guildId) {
  const entries = Array.isArray(overwrites) ? [...overwrites] : [];
  const index = entries.findIndex((entry) => String(entry.id) === String(guildId));
  const current = index >= 0
    ? entries[index]
    : { id: guildId, type: 0, allow: '0', deny: '0' };

  const allow = BigInt(String(current.allow || '0')) & ~LOCKDOWN_DENY_MASK;
  const deny = BigInt(String(current.deny || '0')) | LOCKDOWN_DENY_MASK;
  const next = {
    id: guildId,
    type: 0,
    allow: allow.toString(),
    deny: deny.toString(),
  };

  if (index >= 0) {
    entries[index] = next;
  } else {
    entries.push(next);
  }

  return entries;
}

function cleanupProcessedAuditEntries() {
  const now = Date.now();
  for (const [entryId, seenAt] of processedAuditEntries.entries()) {
    if (now - seenAt > 120000) processedAuditEntries.delete(entryId);
  }
}

function snowflakeToTimestamp(value) {
  if (!value) return 0;
  try {
    return Number((BigInt(String(value)) >> 22n) + 1420070400000n);
  } catch {
    return 0;
  }
}

function getNukeTrackerEntry(guildId, executorId) {
  const key = `${guildId}:${executorId}`;
  if (!nukeTracker.has(key)) {
    nukeTracker.set(key, []);
  }
  return nukeTracker.get(key);
}

async function sendAlert(botToken, channelId, title, description, color = 0xffb347) {
  if (!channelId) return;
  try {
    await discordService.sendMessage(botToken, channelId, {
      embeds: [{
        title,
        description,
        color,
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (error) {
    logger.debug(`Alert channel send failed: ${error.message}`);
  }
}

function logProtectionSignal({ ownerUserId, internalGuildId, level = 'warn', message, metadata }) {
  if (!internalGuildId) return;
  logBotEvent(ownerUserId, internalGuildId, level, 'protection', message, {
    event_type: 'protection_signal',
    ...metadata,
  });
}

async function applyAutoQuarantine({ guild, member, configs, botToken, ownerUserId, internalGuildId, sourceModule, reason, flags = [] }) {
  const quarantineConfig = configs?.AUTO_QUARANTINE;
  if (!quarantineConfig?.enabled) return false;
  const roleId = quarantineConfig.simple_config?.role_id || null;
  if (!roleId || !member?.user?.id) return false;

  if (sourceModule === 'ANTI_ALT_ACCOUNT' && !quarantineConfig.advanced_config?.on_alt_account) return false;
  if (sourceModule === 'ANTI_TOKEN_SCAM' && !quarantineConfig.advanced_config?.on_token_scam) return false;
  if (member.roles?.cache?.has?.(roleId)) return false;

  try {
    await discordService.addRole(botToken, guild.id, member.user.id, roleId, reason || 'Quarantaine automatique');
    logProtectionSignal({
      ownerUserId,
      internalGuildId,
      message: 'Membre place en quarantaine',
      metadata: {
        action_label: 'Quarantaine automatique',
        source_module: sourceModule,
        target_user_id: member.user.id,
        target_label: member.user.globalName || member.user.tag || member.user.username || member.user.id,
        target_avatar_url: buildAvatarUrl(member.user),
        flags,
        highlights: ['quarantine'],
        excerpt: reason || 'Quarantaine automatique',
        risk_boost: 16,
      },
    });

    const releaseAfterMs = Number(quarantineConfig.advanced_config?.release_after_ms || 0);
    if (releaseAfterMs > 0) {
      const timerKey = `${guild.id}:${member.user.id}`;
      clearTimeout(quarantineTimers.get(timerKey));
      const timeout = setTimeout(async () => {
        try {
          await discordService.removeRole(botToken, guild.id, member.user.id, roleId, 'Fin de quarantaine automatique');
          logProtectionSignal({
            ownerUserId,
            internalGuildId,
            level: 'info',
            message: 'Fin de quarantaine automatique',
            metadata: {
              action_label: 'Fin de quarantaine',
              source_module: sourceModule,
              target_user_id: member.user.id,
              target_label: member.user.globalName || member.user.tag || member.user.username || member.user.id,
              target_avatar_url: buildAvatarUrl(member.user),
              flags: ['quarantine_release'],
              highlights: ['quarantine_release'],
              excerpt: 'La quarantaine automatique a ete retiree.',
              risk_boost: 0,
            },
          });
        } catch (error) {
          logger.debug(`Auto quarantine release failed for ${member.user.id}: ${error.message}`);
        } finally {
          quarantineTimers.delete(timerKey);
        }
      }, clamp(releaseAfterMs, 1000, 2147483647));
      quarantineTimers.set(timerKey, timeout);
    }

    return true;
  } catch (error) {
    logger.warn(`Auto quarantine failed for ${member.user.id}: ${error.message}`, { guildId: guild.id, sourceModule });
    return false;
  }
}

async function stripExecutorRoles({ guild, member, botToken, ownerUserId, internalGuildId, reason }) {
  if (!member?.roles?.cache) return 0;

  const removableRoles = [...member.roles.cache.values()].filter((role) => (
    role
    && role.id !== guild.id
    && !role.managed
    && role.editable
  ));

  if (!removableRoles.length) return 0;

  const removedNames = [];
  await Promise.allSettled(removableRoles.map(async (role) => {
    await discordService.removeRole(botToken, guild.id, member.user.id, role.id, reason || 'Neutralisation anti-nuke');
    removedNames.push(role.name || role.id);
  }));

  if (!removedNames.length) return 0;

  logProtectionSignal({
    ownerUserId,
    internalGuildId,
    message: 'Roles staff retires automatiquement',
    metadata: {
      action_label: 'Neutralisation staff',
      source_module: 'ANTI_NUKE',
      target_user_id: member.user.id,
      target_label: member.user.globalName || member.user.tag || member.user.username || member.user.id,
      target_avatar_url: buildAvatarUrl(member.user),
      flags: ['anti_nuke', 'role_strip'],
      highlights: removedNames.slice(0, 6),
      excerpt: reason || 'Retrait automatique des roles staff.',
      risk_boost: 0,
    },
  });

  return removedNames.length;
}

async function restoreLockdown(guildId, botToken) {
  const state = activeLockdowns.get(guildId);
  if (!state) return;

  clearTimeout(state.timer);
  for (const snapshot of state.snapshots) {
    try {
      await discordService.modifyChannel(botToken, snapshot.channelId, {
        permission_overwrites: snapshot.overwrites,
      }, 'Fin du lockdown automatique');
    } catch (error) {
      logger.debug(`Lockdown restore skipped for channel ${snapshot.channelId}: ${error.message}`);
    }
  }

  activeLockdowns.delete(guildId);
}

async function activateLockdown({ guild, configs, botToken, ownerUserId, internalGuildId, source = 'system', reason = 'Lockdown automatique' }) {
  const lockdownConfig = configs?.LOCKDOWN;
  if (!lockdownConfig?.enabled) return { activated: false };

  const excludedChannels = new Set(lockdownConfig.advanced_config?.excluded_channels || []);
  const durationMs = clamp(Number(lockdownConfig.advanced_config?.duration_ms || 300000), 10000, 2147483647);
  const current = activeLockdowns.get(guild.id);

  if (current) {
    clearTimeout(current.timer);
    current.expiresAt = Date.now() + durationMs;
    current.timer = setTimeout(() => restoreLockdown(guild.id, botToken), durationMs);
    return { activated: false, extended: true };
  }

  const channels = [...(guild.channels?.cache?.values?.() || [])]
    .filter((channel) => TEXT_CHANNEL_TYPES.has(Number(channel?.type)) && !excludedChannels.has(channel.id));

  if (channels.length === 0) {
    return { activated: false };
  }

  const snapshots = [];
  for (const channel of channels) {
    const overwrites = serializeChannelOverwrites(channel);
    try {
      await discordService.modifyChannel(botToken, channel.id, {
        permission_overwrites: buildLockdownOverwrites(overwrites, guild.id),
      }, reason);
      snapshots.push({ channelId: channel.id, overwrites });
    } catch (error) {
      logger.warn(`Lockdown patch failed on channel ${channel.id}: ${error.message}`, { guildId: guild.id });
    }
  }

  if (snapshots.length === 0) {
    return { activated: false };
  }

  const timer = setTimeout(() => restoreLockdown(guild.id, botToken), durationMs);
  activeLockdowns.set(guild.id, {
    snapshots,
    timer,
    expiresAt: Date.now() + durationMs,
  });

  logProtectionSignal({
    ownerUserId,
    internalGuildId,
    message: 'Lockdown automatique active',
    metadata: {
      action_label: 'Lockdown',
      source_module: 'LOCKDOWN',
      flags: ['lockdown', source],
      highlights: ['lockdown'],
      excerpt: reason,
      risk_boost: 0,
    },
  });

  await sendAlert(
    botToken,
    lockdownConfig.advanced_config?.alert_channel_id || null,
    'Lockdown automatique',
    `Le serveur a ete verrouille temporairement.\nSource: ${source}\nRaison: ${reason}`,
    0xff6b6b
  );

  return { activated: true };
}

async function handleAntiTokenScam(message, config, botToken, ownerUserId, internalGuildId, configs) {
  const author = message?.author;
  const member = message?.member;
  const guild = message?.guild;
  const channel = message?.channel;
  if (!guild || !author || author.bot) return { triggered: false };

  const whitelistChannels = new Set(config.advanced_config?.whitelist_channels || []);
  if (whitelistChannels.has(channel?.id)) return { triggered: false };

  const memberRoleIds = member?.roles?.cache?.map?.((role) => role.id) || [];
  if ((config.advanced_config?.whitelist_roles || []).some((roleId) => memberRoleIds.includes(roleId))) {
    return { triggered: false };
  }

  const signals = detectTokenScamSignals(message.content || '');
  if (!signals.length) return { triggered: false };

  const action = config.simple_config?.action || 'timeout';
  const timeoutDurationMs = Number(config.simple_config?.timeout_duration_ms || 1800000);
  const reason = `Anti-Token Scam: ${signals.map((signal) => signal.label).join(', ')}`;

  try {
    await message.delete().catch(() => {});
    if (action && action !== 'delete') {
      await punishSecurityAction(
        action,
        guild,
        member || author,
        botToken,
        reason,
        timeoutDurationMs,
        'ANTI_TOKEN_SCAM',
        ownerUserId
      );
    }

    if (member && !['kick', 'ban', 'blacklist'].includes(action)) {
      await applyAutoQuarantine({
        guild,
        member,
        configs,
        botToken,
        ownerUserId,
        internalGuildId,
        sourceModule: 'ANTI_TOKEN_SCAM',
        reason,
        flags: signals.map((signal) => signal.id),
      });
    }

    logProtectionSignal({
      ownerUserId,
      internalGuildId,
      message: 'Scam token detecte',
      metadata: {
        action_label: 'Scam token detecte',
        source_module: 'ANTI_TOKEN_SCAM',
        target_user_id: author.id,
        target_label: author.globalName || author.tag || author.username || author.id,
        target_avatar_url: buildAvatarUrl(author),
        flags: signals.map((signal) => signal.id),
        highlights: signals.map((signal) => signal.label),
        excerpt: truncateText(message.content),
        risk_boost: signals.reduce((sum, signal) => sum + signal.score, 0),
      },
    });

    await sendAlert(
      botToken,
      config.advanced_config?.alert_channel_id || null,
      'Scam token detecte',
      `Message bloque pour <@${author.id}>.\nSignaux: ${signals.map((signal) => signal.label).join(', ')}`,
      0xffb347
    );

    return { triggered: true, action, flags: signals.map((signal) => signal.id) };
  } catch (error) {
    logger.warn(`Anti token scam failed for ${author.id}: ${error.message}`, { guildId: guild.id });
    return { triggered: false, error: error.message };
  }
}

async function handleAntiAltAccount(member, config, botToken, ownerUserId, internalGuildId, configs) {
  const guild = member?.guild;
  const user = member?.user;
  if (!guild || !user || user.bot) return { triggered: false };

  const maxAccountAgeDays = Number(config.advanced_config?.max_account_age_days || 14);
  const accountAgeDays = Math.max(0, (Date.now() - Number(user.createdTimestamp || Date.now())) / 86400000);
  const flags = [];
  const highlights = [];
  let riskBoost = 0;

  if (accountAgeDays <= maxAccountAgeDays) {
    flags.push('fresh_account');
    highlights.push(`compte recent (${accountAgeDays.toFixed(1)}j)`);
    riskBoost += 18;
  }

  if (config.advanced_config?.require_custom_avatar && !user.avatar) {
    flags.push('default_avatar');
    highlights.push('avatar par defaut');
    riskBoost += 12;
  }

  const identitySource = `${user.username || ''} ${user.globalName || ''} ${member.nick || ''}`;
  if (config.advanced_config?.suspicious_name_patterns && ALT_NAME_PATTERN.test(identitySource)) {
    flags.push('suspicious_name');
    highlights.push('pseudo suspect');
    riskBoost += 14;
  }

  const veryFresh = accountAgeDays <= Math.max(1, Math.min(2, maxAccountAgeDays));
  if (flags.length < 2 && !veryFresh) {
    return { triggered: false };
  }

  const action = config.simple_config?.action || 'timeout';
  const timeoutDurationMs = Number(config.simple_config?.timeout_duration_ms || 300000);
  const reason = `Anti-Alt: ${highlights.join(', ')}`;

  try {
    if (action && action !== 'delete') {
      await punishSecurityAction(
        action,
        guild,
        member,
        botToken,
        reason,
        timeoutDurationMs,
        'ANTI_ALT_ACCOUNT',
        ownerUserId
      );
    }

    if (!['kick', 'ban', 'blacklist'].includes(action)) {
      await applyAutoQuarantine({
        guild,
        member,
        configs,
        botToken,
        ownerUserId,
        internalGuildId,
        sourceModule: 'ANTI_ALT_ACCOUNT',
        reason,
        flags,
      });
    }

    logProtectionSignal({
      ownerUserId,
      internalGuildId,
      message: 'Compte suspect detecte a l entree',
      metadata: {
        action_label: 'Anti-Alt',
        source_module: 'ANTI_ALT_ACCOUNT',
        target_user_id: user.id,
        target_label: user.globalName || user.tag || user.username || user.id,
        target_avatar_url: buildAvatarUrl(user),
        flags,
        highlights,
        excerpt: reason,
        risk_boost: riskBoost,
      },
    });

    await sendAlert(
      botToken,
      config.advanced_config?.alert_channel_id || null,
      'Compte suspect detecte',
      `Surveillance de <@${user.id}>.\nSignaux: ${highlights.join(', ')}`,
      0xffc107
    );

    return { triggered: true, flags, action };
  } catch (error) {
    logger.warn(`Anti alt account failed for ${user.id}: ${error.message}`, { guildId: guild.id });
    return { triggered: false, error: error.message };
  }
}

async function handleAutoSlowmode(message, config, botToken, ownerUserId, internalGuildId) {
  const guild = message?.guild;
  const channel = message?.channel;
  const author = message?.author;
  if (!guild || !channel || !author || author.bot) return { triggered: false };

  if ((config.advanced_config?.whitelist_channels || []).includes(channel.id)) {
    return { triggered: false };
  }

  const key = `${guild.id}:${channel.id}`;
  const now = Date.now();
  const windowMs = Number(config.advanced_config?.window_ms || 10000);
  const triggerMessages = Number(config.advanced_config?.trigger_messages || 8);
  const timestamps = channelBurstTracker.get(key) || [];
  const recent = timestamps.filter((timestamp) => now - timestamp <= windowMs);
  recent.push(now);
  channelBurstTracker.set(key, recent);

  const activeState = slowmodeState.get(key);
  if (activeState && activeState.expiresAt > now) {
    clearTimeout(activeState.timer);
    activeState.expiresAt = now + Number(config.advanced_config?.duration_ms || 180000);
    activeState.timer = setTimeout(async () => {
      try {
        await discordService.modifyChannel(botToken, channel.id, { rate_limit_per_user: activeState.previousSlowmode }, 'Fin du slowmode automatique');
      } catch (error) {
        logger.debug(`Auto slowmode restore failed for ${channel.id}: ${error.message}`);
      } finally {
        slowmodeState.delete(key);
      }
    }, clamp(Number(config.advanced_config?.duration_ms || 180000), 5000, 2147483647));
    return { triggered: false, extended: true };
  }

  if (recent.length < triggerMessages) return { triggered: false };

  const previousSlowmode = Number(channel.rateLimitPerUser || 0);
  const slowmodeSeconds = clamp(Number(config.simple_config?.slowmode_seconds || 15), 1, 21600);
  try {
    await discordService.modifyChannel(botToken, channel.id, {
      rate_limit_per_user: Math.max(previousSlowmode, slowmodeSeconds),
    }, 'Auto Slowmode');

    const durationMs = clamp(Number(config.advanced_config?.duration_ms || 180000), 5000, 2147483647);
    const timer = setTimeout(async () => {
      try {
        await discordService.modifyChannel(botToken, channel.id, { rate_limit_per_user: previousSlowmode }, 'Fin du slowmode automatique');
      } catch (error) {
        logger.debug(`Auto slowmode restore failed for ${channel.id}: ${error.message}`);
      } finally {
        slowmodeState.delete(key);
      }
    }, durationMs);

    slowmodeState.set(key, {
      previousSlowmode,
      expiresAt: now + durationMs,
      timer,
    });

    logProtectionSignal({
      ownerUserId,
      internalGuildId,
      level: 'info',
      message: 'Slowmode automatique active',
      metadata: {
        action_label: 'Slowmode automatique',
        source_module: 'AUTO_SLOWMODE',
        flags: ['slowmode_spike'],
        highlights: [`${recent.length} messages rapides`],
        excerpt: `Le salon #${channel.name || channel.id} passe en slowmode ${slowmodeSeconds}s.`,
        risk_boost: 0,
      },
    });

    return { triggered: true };
  } catch (error) {
    logger.warn(`Auto slowmode failed for ${channel.id}: ${error.message}`, { guildId: guild.id });
    return { triggered: false, error: error.message };
  }
}

async function handleAntiNukeEvent(payload, config, botToken, ownerUserId, internalGuildId, configs) {
  const guild = payload?.guild;
  if (!guild || !payload?.auditActionType) return { triggered: false };

  try {
    cleanupProcessedAuditEntries();
    const auditLogs = await discordService.getGuildAuditLogs(botToken, guild.id, {
      actionType: payload.auditActionType,
      limit: 6,
    });
    const entries = Array.isArray(auditLogs?.audit_log_entries) ? auditLogs.audit_log_entries : [];
    const users = Array.isArray(auditLogs?.users) ? auditLogs.users : [];
    const executorMap = new Map(users.map((user) => [String(user.id), user]));

    const targetId = String(payload.targetId || '');
    const matchingEntry = entries.find((entry) => {
      if (!entry?.id || processedAuditEntries.has(entry.id)) return false;
      if (targetId && String(entry.target_id || '') !== targetId) return false;
      return Date.now() - snowflakeToTimestamp(entry.id) <= 20000;
    });

    if (!matchingEntry) return { triggered: false };
    processedAuditEntries.set(matchingEntry.id, Date.now());

    const executorId = String(matchingEntry.user_id || '');
    if (!executorId || executorId === String(guild.members?.me?.id || guild.client?.user?.id || '')) {
      return { triggered: false };
    }

    if ((config.advanced_config?.whitelist_users || []).includes(executorId)) {
      return { triggered: false };
    }

    const executorMember = await guild.members.fetch(executorId).catch(() => null);
    const executorRoleIds = executorMember?.roles?.cache?.map?.((role) => role.id) || [];
    if ((config.advanced_config?.whitelist_roles || []).some((roleId) => executorRoleIds.includes(roleId))) {
      return { triggered: false };
    }

    const tracker = getNukeTrackerEntry(guild.id, executorId);
    const windowMs = Number(config.advanced_config?.window_ms || 15000);
    const now = Date.now();
    const nextEvents = tracker.filter((item) => now - item.at <= windowMs);
    nextEvents.push({
      at: now,
      kind: payload.kind,
      label: payload.targetLabel || payload.kind,
    });
    nukeTracker.set(`${guild.id}:${executorId}`, nextEvents);

    const executorUser = executorMap.get(executorId) || executorMember?.user || { id: executorId, username: executorId };
    const highlights = [payload.kind, `${nextEvents.length} action(s) rapides`];

    logProtectionSignal({
      ownerUserId,
      internalGuildId,
      message: 'Action destructive detectee',
      metadata: {
        action_label: 'Anti-Nuke',
        source_module: 'ANTI_NUKE',
        target_user_id: executorId,
        target_label: executorUser.globalName || executorUser.tag || executorUser.username || executorId,
        target_avatar_url: buildAvatarUrl(executorUser),
        flags: ['anti_nuke', payload.kind],
        highlights,
        excerpt: `${payload.kind} sur ${payload.targetLabel || payload.targetId || 'element inconnu'}`,
        risk_boost: 18,
      },
    });

    const threshold = Number(config.advanced_config?.event_threshold || 3);
    if (nextEvents.length < threshold) {
      return { triggered: false };
    }

    const reason = `Anti-Nuke: ${nextEvents.length} actions destructives en ${Math.round(windowMs / 1000)}s`;
    if (config.advanced_config?.strip_executor_roles && executorMember) {
      await stripExecutorRoles({
        guild,
        member: executorMember,
        botToken,
        ownerUserId,
        internalGuildId,
        reason: 'Neutralisation automatique anti-nuke',
      });
    }

    await punishSecurityAction(
      config.simple_config?.action || 'ban',
      guild,
      executorMember || executorUser,
      botToken,
      reason,
      Number(config.advanced_config?.timeout_duration_ms || 300000),
      'ANTI_NUKE',
      ownerUserId
    );

    if (configs?.LOCKDOWN?.enabled && configs.LOCKDOWN.simple_config?.trigger_on_nuke) {
      await activateLockdown({
        guild,
        configs,
        botToken,
        ownerUserId,
        internalGuildId,
        source: 'anti_nuke',
        reason,
      });
    }

    await sendAlert(
      botToken,
      config.advanced_config?.alert_channel_id || null,
      'Anti-Nuke declenche',
      `<@${executorId}> a depasse le seuil de ${threshold} action(s) destructives.\nRaison: ${reason}`,
      0xff4d6d
    );

    return { triggered: true, executorId };
  } catch (error) {
    logger.warn(`Anti nuke failed for guild ${guild.id}: ${error.message}`);
    return { triggered: false, error: error.message };
  }
}

module.exports = {
  activateLockdown,
  handleAntiAltAccount,
  handleAntiNukeEvent,
  handleAntiTokenScam,
  handleAutoSlowmode,
};
