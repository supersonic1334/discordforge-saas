'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { moduleToggleSchema, moduleConfigSchema, moduleTypeSchema } = require('../validators/schemas');
const { MODULE_DEFINITIONS, MODULE_TYPES } = require('../bot/modules/definitions');
const botManager = require('../services/botManager');
const { syncNativeAutoModRules } = require('../services/discordAutoModService');
const guildAccessService = require('../services/guildAccessService');
const { decrypt } = require('../services/encryptionService');
const wsServer = require('../websocket');
const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const { logBotEvent } = require('../bot/utils/modHelpers');
const ANTI_SPAM_LEGACY_KEYS = ['duplicate_max_messages', 'duplicate_window_ms'];
const ANTI_MENTION_LEGACY_SIMPLE_KEYS = ['max_mentions'];
const ANTI_MENTION_LEGACY_ADVANCED_KEYS = ['max_role_mentions', 'max_everyone_here', 'include_replied_user', 'whitelist_roles', 'punishment_action'];

function normalizeLegacyAction(value) {
  if (value === 'tempmute' || value === 'mute') return 'timeout';
  return value;
}

function parseConfig(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function logModuleSiteAction(req, actionLabel, moduleType, moduleName, details = []) {
  logBotEvent(req.user.id, req.guild.id, 'info', 'site_action', `${req.user.username} - ${actionLabel} - ${moduleName}`, {
    action: actionLabel,
    action_label: actionLabel,
    actor_name: req.user.username,
    actor_user_id: req.user.id,
    target_label: moduleName,
    module_type: moduleType,
    module_name: moduleName,
    details,
  });
}

function notifyGuildModuleSync(req, payload = {}) {
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
    ...payload,
  };

  for (const userId of userIds) {
    wsServer.broadcastToUser(userId, {
      event: 'modules:updated',
      data: eventPayload,
    });
  }
}

const PROTECTION_PRESET_PROFILES = {
  balanced: {
    ANTI_SPAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 300000 },
      advanced_config: { max_messages: 5, window_ms: 5000, delete_messages: true, warn_before_action: true, warn_threshold: 2 },
    },
    ANTI_RAID: {
      simple_config: { action: 'kick', timeout_duration_ms: 300000, lockdown_on_raid: true },
      advanced_config: { join_threshold: 10, join_window_ms: 10000, account_age_min_days: 7, new_account_action: 'timeout', new_account_timeout_duration_ms: 600000, raid_duration_ms: 300000 },
    },
    LOCKDOWN: {
      simple_config: { trigger_on_raid: true, trigger_on_nuke: true },
      advanced_config: { duration_ms: 300000 },
    },
    ANTI_NUKE: {
      simple_config: { action: 'ban' },
      advanced_config: { event_threshold: 3, window_ms: 15000, timeout_duration_ms: 300000 },
    },
    ANTI_ALT_ACCOUNT: {
      simple_config: { action: 'timeout', timeout_duration_ms: 600000 },
      advanced_config: { max_account_age_days: 14, require_custom_avatar: true, suspicious_name_patterns: true },
    },
    ANTI_TOKEN_SCAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 1800000 },
      advanced_config: {},
    },
    AUTO_SLOWMODE: {
      simple_config: { slowmode_seconds: 15 },
      advanced_config: { trigger_messages: 8, window_ms: 10000, duration_ms: 180000 },
    },
    AUTO_QUARANTINE: {
      simple_config: {},
      advanced_config: { release_after_ms: 0, on_alt_account: true, on_token_scam: true },
    },
    TRUST_SCORE: {
      simple_config: { trusted_after_days: 30 },
      advanced_config: { warning_penalty: 8, action_penalty: 10, suspicious_penalty: 14, role_bonus: 6 },
    },
  },
  community: {
    ANTI_SPAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 180000 },
      advanced_config: { max_messages: 6, window_ms: 6000, delete_messages: true, warn_before_action: true, warn_threshold: 3 },
    },
    ANTI_RAID: {
      simple_config: { action: 'timeout', timeout_duration_ms: 300000, lockdown_on_raid: true },
      advanced_config: { join_threshold: 14, join_window_ms: 12000, account_age_min_days: 5, new_account_action: 'timeout', new_account_timeout_duration_ms: 300000, raid_duration_ms: 240000 },
    },
    LOCKDOWN: {
      simple_config: { trigger_on_raid: true, trigger_on_nuke: true },
      advanced_config: { duration_ms: 240000 },
    },
    ANTI_NUKE: {
      simple_config: { action: 'timeout' },
      advanced_config: { event_threshold: 4, window_ms: 15000, timeout_duration_ms: 900000 },
    },
    ANTI_ALT_ACCOUNT: {
      simple_config: { action: 'timeout', timeout_duration_ms: 300000 },
      advanced_config: { max_account_age_days: 10, require_custom_avatar: true, suspicious_name_patterns: true },
    },
    ANTI_TOKEN_SCAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 1200000 },
      advanced_config: {},
    },
    AUTO_SLOWMODE: {
      simple_config: { slowmode_seconds: 10 },
      advanced_config: { trigger_messages: 10, window_ms: 12000, duration_ms: 120000 },
    },
    AUTO_QUARANTINE: {
      simple_config: {},
      advanced_config: { release_after_ms: 3600000, on_alt_account: true, on_token_scam: true },
    },
    TRUST_SCORE: {
      simple_config: { trusted_after_days: 21 },
      advanced_config: { warning_penalty: 7, action_penalty: 9, suspicious_penalty: 12, role_bonus: 6 },
    },
  },
  fortress: {
    ANTI_SPAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 900000 },
      advanced_config: { max_messages: 4, window_ms: 4000, delete_messages: true, warn_before_action: false, warn_threshold: 1 },
    },
    ANTI_RAID: {
      simple_config: { action: 'ban', timeout_duration_ms: 900000, lockdown_on_raid: true },
      advanced_config: { join_threshold: 6, join_window_ms: 8000, account_age_min_days: 21, new_account_action: 'ban', new_account_timeout_duration_ms: 900000, raid_duration_ms: 600000 },
    },
    LOCKDOWN: {
      simple_config: { trigger_on_raid: true, trigger_on_nuke: true },
      advanced_config: { duration_ms: 600000 },
    },
    ANTI_NUKE: {
      simple_config: { action: 'ban' },
      advanced_config: { event_threshold: 2, window_ms: 12000, timeout_duration_ms: 900000 },
    },
    ANTI_ALT_ACCOUNT: {
      simple_config: { action: 'timeout', timeout_duration_ms: 1800000 },
      advanced_config: { max_account_age_days: 21, require_custom_avatar: true, suspicious_name_patterns: true },
    },
    ANTI_TOKEN_SCAM: {
      simple_config: { action: 'blacklist', timeout_duration_ms: 1800000 },
      advanced_config: {},
    },
    AUTO_SLOWMODE: {
      simple_config: { slowmode_seconds: 20 },
      advanced_config: { trigger_messages: 6, window_ms: 8000, duration_ms: 240000 },
    },
    AUTO_QUARANTINE: {
      simple_config: {},
      advanced_config: { release_after_ms: 0, on_alt_account: true, on_token_scam: true },
    },
    TRUST_SCORE: {
      simple_config: { trusted_after_days: 45 },
      advanced_config: { warning_penalty: 10, action_penalty: 12, suspicious_penalty: 18, role_bonus: 5 },
    },
  },
};

const ULTIMATE_PROTECTION_PROFILES = {
  smart: {
    ANTI_SPAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 300000 },
      advanced_config: { max_messages: 5, window_ms: 5000, delete_messages: true, warn_before_action: true, warn_threshold: 2 },
    },
    ANTI_LINK: {
      simple_config: { block_invites: true, block_all_links: false },
      advanced_config: { delete_and_warn: true, punishment_after_violations: 2, punishment_action: 'timeout', timeout_duration_ms: 600000 },
    },
    ANTI_INVITE: {
      simple_config: { allow_own_invites: true },
      advanced_config: { punishment_action: 'timeout', timeout_duration_ms: 300000 },
    },
    ANTI_MASS_MENTION: {
      simple_config: { action: 'timeout' },
      advanced_config: { timeout_duration_ms: 300000 },
    },
    ANTI_RAID: {
      simple_config: { action: 'kick', timeout_duration_ms: 300000, lockdown_on_raid: true },
      advanced_config: { join_threshold: 10, join_window_ms: 10000, account_age_min_days: 7, new_account_action: 'timeout', new_account_timeout_duration_ms: 600000, raid_duration_ms: 300000 },
    },
    LOCKDOWN: {
      simple_config: { trigger_on_raid: true, trigger_on_nuke: true },
      advanced_config: { duration_ms: 300000 },
    },
    ANTI_NUKE: {
      simple_config: { action: 'ban' },
      advanced_config: { event_threshold: 3, window_ms: 15000, timeout_duration_ms: 300000, watch_ban_bursts: true, watch_kick_bursts: true },
    },
    ANTI_ALT_ACCOUNT: {
      simple_config: { action: 'timeout', timeout_duration_ms: 600000 },
      advanced_config: { max_account_age_days: 14, require_custom_avatar: true, suspicious_name_patterns: true },
    },
    ANTI_BOT: {
      simple_config: { action: 'kick', check_pfp: true },
      advanced_config: { block_default_avatar: true, min_account_age_days: 7, block_pattern_usernames: true },
    },
    ANTI_TOKEN_SCAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 1800000 },
      advanced_config: {},
    },
    AUTO_SLOWMODE: {
      simple_config: { slowmode_seconds: 15 },
      advanced_config: { trigger_messages: 8, window_ms: 10000, duration_ms: 180000 },
    },
    AUTO_MOD: {
      simple_config: { filter_profanity: true },
      advanced_config: { punishment_action: 'warn', dm_warning: true },
    },
    AUTO_QUARANTINE: {
      simple_config: {},
      advanced_config: { release_after_ms: 0, on_alt_account: true, on_token_scam: true },
    },
  },
  strict: {
    ANTI_SPAM: {
      simple_config: { action: 'timeout', timeout_duration_ms: 600000 },
      advanced_config: { max_messages: 4, window_ms: 4500, delete_messages: true, warn_before_action: false, warn_threshold: 1 },
    },
    ANTI_LINK: {
      simple_config: { block_invites: true, block_all_links: true },
      advanced_config: { delete_and_warn: true, punishment_after_violations: 1, punishment_action: 'timeout', timeout_duration_ms: 900000 },
    },
    ANTI_INVITE: {
      simple_config: { allow_own_invites: false },
      advanced_config: { punishment_action: 'timeout', timeout_duration_ms: 600000 },
    },
    ANTI_MASS_MENTION: {
      simple_config: { action: 'timeout' },
      advanced_config: { timeout_duration_ms: 600000 },
    },
    ANTI_RAID: {
      simple_config: { action: 'ban', timeout_duration_ms: 900000, lockdown_on_raid: true },
      advanced_config: { join_threshold: 8, join_window_ms: 9000, account_age_min_days: 14, new_account_action: 'ban', new_account_timeout_duration_ms: 900000, raid_duration_ms: 420000 },
    },
    LOCKDOWN: {
      simple_config: { trigger_on_raid: true, trigger_on_nuke: true },
      advanced_config: { duration_ms: 420000 },
    },
    ANTI_NUKE: {
      simple_config: { action: 'ban' },
      advanced_config: { event_threshold: 2, window_ms: 12000, timeout_duration_ms: 900000, watch_ban_bursts: true, watch_kick_bursts: true },
    },
    ANTI_ALT_ACCOUNT: {
      simple_config: { action: 'timeout', timeout_duration_ms: 900000 },
      advanced_config: { max_account_age_days: 21, require_custom_avatar: true, suspicious_name_patterns: true },
    },
    ANTI_BOT: {
      simple_config: { action: 'ban', check_pfp: true },
      advanced_config: { block_default_avatar: true, min_account_age_days: 14, block_pattern_usernames: true },
    },
    ANTI_TOKEN_SCAM: {
      simple_config: { action: 'blacklist', timeout_duration_ms: 1800000 },
      advanced_config: {},
    },
    AUTO_SLOWMODE: {
      simple_config: { slowmode_seconds: 20 },
      advanced_config: { trigger_messages: 6, window_ms: 8000, duration_ms: 240000 },
    },
    AUTO_MOD: {
      simple_config: { filter_profanity: true },
      advanced_config: { punishment_action: 'timeout', timeout_duration_ms: 900000, dm_warning: false },
    },
    AUTO_QUARANTINE: {
      simple_config: {},
      advanced_config: { release_after_ms: 0, on_alt_account: true, on_token_scam: true },
    },
  },
  fortress: {
    ANTI_SPAM: {
      simple_config: { action: 'ban', timeout_duration_ms: 900000 },
      advanced_config: { max_messages: 3, window_ms: 3500, delete_messages: true, warn_before_action: false, warn_threshold: 1 },
    },
    ANTI_LINK: {
      simple_config: { block_invites: true, block_all_links: true },
      advanced_config: { delete_and_warn: false, punishment_after_violations: 1, punishment_action: 'ban', timeout_duration_ms: 900000 },
    },
    ANTI_INVITE: {
      simple_config: { allow_own_invites: false },
      advanced_config: { punishment_action: 'ban', timeout_duration_ms: 900000 },
    },
    ANTI_MASS_MENTION: {
      simple_config: { action: 'ban' },
      advanced_config: { timeout_duration_ms: 900000 },
    },
    ANTI_RAID: {
      simple_config: { action: 'ban', timeout_duration_ms: 900000, lockdown_on_raid: true },
      advanced_config: { join_threshold: 6, join_window_ms: 7000, account_age_min_days: 30, new_account_action: 'ban', new_account_timeout_duration_ms: 900000, raid_duration_ms: 600000 },
    },
    LOCKDOWN: {
      simple_config: { trigger_on_raid: true, trigger_on_nuke: true },
      advanced_config: { duration_ms: 600000 },
    },
    ANTI_NUKE: {
      simple_config: { action: 'ban' },
      advanced_config: { event_threshold: 2, window_ms: 10000, timeout_duration_ms: 900000, watch_ban_bursts: true, watch_kick_bursts: true },
    },
    ANTI_ALT_ACCOUNT: {
      simple_config: { action: 'ban', timeout_duration_ms: 900000 },
      advanced_config: { max_account_age_days: 30, require_custom_avatar: true, suspicious_name_patterns: true },
    },
    ANTI_BOT: {
      simple_config: { action: 'ban', check_pfp: true },
      advanced_config: { block_default_avatar: true, min_account_age_days: 30, block_pattern_usernames: true },
    },
    ANTI_TOKEN_SCAM: {
      simple_config: { action: 'blacklist', timeout_duration_ms: 1800000 },
      advanced_config: {},
    },
    AUTO_SLOWMODE: {
      simple_config: { slowmode_seconds: 30 },
      advanced_config: { trigger_messages: 5, window_ms: 7000, duration_ms: 300000 },
    },
    AUTO_MOD: {
      simple_config: { filter_profanity: true },
      advanced_config: { punishment_action: 'ban', timeout_duration_ms: 900000, dm_warning: false },
    },
    AUTO_QUARANTINE: {
      simple_config: {},
      advanced_config: { release_after_ms: 0, on_alt_account: true, on_token_scam: true },
    },
  },
};

const ULTIMATE_PROTECTION_MANAGED_TYPES = [
  'ANTI_SPAM',
  'ANTI_LINK',
  'ANTI_INVITE',
  'ANTI_MASS_MENTION',
  'ANTI_RAID',
  'LOCKDOWN',
  'ANTI_NUKE',
  'ANTI_ALT_ACCOUNT',
  'ANTI_BOT',
  'ANTI_TOKEN_SCAM',
  'AUTO_SLOWMODE',
  'AUTO_MOD',
  'AUTO_QUARANTINE',
];

function normalizeStringId(value) {
  const nextValue = typeof value === 'string' ? value.trim() : '';
  return nextValue || null;
}

function uniqueStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function getGuildModuleRowsMap(guildId) {
  return new Map(db.findMany('modules', { guild_id: guildId }).map((row) => [row.module_type, row]));
}

function getSanitizedModuleState(moduleType, row) {
  const definition = MODULE_DEFINITIONS[moduleType] || { simple_config: {}, advanced_config: {} };
  return sanitizeModuleConfigs(
    moduleType,
    { ...definition.simple_config, ...parseConfig(row?.simple_config) },
    { ...definition.advanced_config, ...parseConfig(row?.advanced_config) }
  );
}

function upsertModuleState(guildId, existingRows, moduleType, enabled, simpleConfig, advancedConfig, now) {
  const row = existingRows.get(moduleType) || null;
  const sanitized = sanitizeModuleConfigs(moduleType, simpleConfig, advancedConfig);

  if (row) {
    db.db.prepare(
      'UPDATE modules SET enabled = ?, simple_config = ?, advanced_config = ?, updated_at = ? WHERE id = ?'
    ).run(
      enabled ? 1 : 0,
      JSON.stringify(sanitized.simple_config),
      JSON.stringify(sanitized.advanced_config),
      now,
      row.id
    );
    return;
  }

  db.insert('modules', {
    id: uuidv4(),
    guild_id: guildId,
    module_type: moduleType,
    enabled: enabled ? 1 : 0,
    simple_config: JSON.stringify(sanitized.simple_config),
    advanced_config: JSON.stringify(sanitized.advanced_config),
    created_at: now,
    updated_at: now,
  });
}

function disableUltimateProtectionModules(guildId, now) {
  const existingRows = getGuildModuleRowsMap(guildId);

  for (const moduleType of ULTIMATE_PROTECTION_MANAGED_TYPES) {
    const row = existingRows.get(moduleType);
    if (!row) continue;

    db.db.prepare('UPDATE modules SET enabled = 0, updated_at = ? WHERE id = ?')
      .run(now, row.id);
  }
}

function buildUltimateProtectionPlan(existingRows, simpleConfig, advancedConfig) {
  const profile = String(simpleConfig?.profile || 'smart').toLowerCase();
  const preset = ULTIMATE_PROTECTION_PROFILES[profile] || ULTIMATE_PROTECTION_PROFILES.smart;
  const trustedRoles = uniqueStringList(advancedConfig?.trusted_roles);
  const alertChannelId = normalizeStringId(advancedConfig?.alert_channel_id);
  const quarantineRoleId = normalizeStringId(simpleConfig?.quarantine_role_id);
  const shieldChat = advancedConfig?.shield_chat !== false;
  const shieldRaid = advancedConfig?.shield_raid !== false;
  const shieldStaff = advancedConfig?.shield_staff !== false;
  const shieldQuarantine = advancedConfig?.shield_quarantine !== false;
  const stripStaffRoles = advancedConfig?.strip_staff_roles !== false;

  function buildState(moduleType, overrides = {}) {
    const current = getSanitizedModuleState(moduleType, existingRows.get(moduleType));
    return sanitizeModuleConfigs(
      moduleType,
      { ...current.simple_config, ...(preset[moduleType]?.simple_config || {}), ...(overrides.simple_config || {}) },
      { ...current.advanced_config, ...(preset[moduleType]?.advanced_config || {}), ...(overrides.advanced_config || {}) }
    );
  }

  const antiSpam = buildState('ANTI_SPAM');
  antiSpam.advanced_config.whitelist_roles = uniqueStringList([
    ...(antiSpam.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);

  const antiLink = buildState('ANTI_LINK');
  antiLink.advanced_config.whitelist_roles = uniqueStringList([
    ...(antiLink.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);

  const antiInvite = buildState('ANTI_INVITE');
  antiInvite.advanced_config.whitelist_roles = uniqueStringList([
    ...(antiInvite.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);

  const antiMention = buildState('ANTI_MASS_MENTION');
  antiMention.advanced_config.authorized_roles = uniqueStringList([
    ...(antiMention.advanced_config.authorized_roles || []),
    ...trustedRoles,
  ]);

  const antiRaid = buildState('ANTI_RAID');
  if (alertChannelId) antiRaid.advanced_config.alert_channel_id = alertChannelId;

  const lockdown = buildState('LOCKDOWN', {
    simple_config: {
      trigger_on_raid: shieldRaid,
      trigger_on_nuke: shieldStaff,
    },
  });
  if (alertChannelId) lockdown.advanced_config.alert_channel_id = alertChannelId;

  const antiNuke = buildState('ANTI_NUKE', {
    advanced_config: {
      watch_ban_bursts: shieldStaff,
      watch_kick_bursts: shieldStaff,
      strip_executor_roles: shieldStaff && stripStaffRoles,
    },
  });
  antiNuke.advanced_config.whitelist_roles = uniqueStringList([
    ...(antiNuke.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);
  if (alertChannelId) antiNuke.advanced_config.alert_channel_id = alertChannelId;

  const antiAlt = buildState('ANTI_ALT_ACCOUNT');
  if (alertChannelId) antiAlt.advanced_config.alert_channel_id = alertChannelId;

  const antiBot = buildState('ANTI_BOT');
  antiBot.advanced_config.whitelist_roles = uniqueStringList([
    ...(antiBot.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);

  const antiToken = buildState('ANTI_TOKEN_SCAM');
  antiToken.advanced_config.whitelist_roles = uniqueStringList([
    ...(antiToken.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);
  if (alertChannelId) antiToken.advanced_config.alert_channel_id = alertChannelId;

  const autoSlowmode = buildState('AUTO_SLOWMODE');
  const autoMod = buildState('AUTO_MOD');
  autoMod.advanced_config.whitelist_roles = uniqueStringList([
    ...(autoMod.advanced_config.whitelist_roles || []),
    ...trustedRoles,
  ]);

  const autoQuarantine = buildState('AUTO_QUARANTINE', {
    advanced_config: {
      on_alt_account: shieldRaid,
      on_token_scam: shieldChat,
    },
  });
  if (quarantineRoleId) {
    autoQuarantine.simple_config.role_id = quarantineRoleId;
  }

  return {
    ANTI_SPAM: { enabled: shieldChat, ...antiSpam },
    ANTI_LINK: { enabled: shieldChat, ...antiLink },
    ANTI_INVITE: { enabled: shieldChat, ...antiInvite },
    ANTI_MASS_MENTION: { enabled: shieldChat, ...antiMention },
    ANTI_RAID: { enabled: shieldRaid, ...antiRaid },
    LOCKDOWN: { enabled: shieldRaid || shieldStaff, ...lockdown },
    ANTI_NUKE: { enabled: shieldStaff, ...antiNuke },
    ANTI_ALT_ACCOUNT: { enabled: shieldRaid, ...antiAlt },
    ANTI_BOT: { enabled: shieldRaid, ...antiBot },
    ANTI_TOKEN_SCAM: { enabled: shieldChat, ...antiToken },
    AUTO_SLOWMODE: { enabled: shieldRaid, ...autoSlowmode },
    AUTO_MOD: { enabled: shieldChat, ...autoMod },
    AUTO_QUARANTINE: { enabled: shieldQuarantine, ...autoQuarantine },
  };
}

function applyUltimateProtection(guildId, simpleConfig, advancedConfig, now) {
  const existingRows = getGuildModuleRowsMap(guildId);
  const plan = buildUltimateProtectionPlan(existingRows, simpleConfig, advancedConfig);

  for (const [moduleType, state] of Object.entries(plan)) {
    upsertModuleState(
      guildId,
      existingRows,
      moduleType,
      state.enabled,
      state.simple_config,
      state.advanced_config,
      now
    );
  }
}

function sanitizeModuleConfigs(type, simpleConfig, advancedConfig) {
  const nextSimple = { ...simpleConfig };
  const nextAdvanced = { ...advancedConfig };
  nextSimple.action = normalizeLegacyAction(nextSimple.action);
  nextAdvanced.punishment_action = normalizeLegacyAction(nextAdvanced.punishment_action);
  nextAdvanced.new_account_action = normalizeLegacyAction(nextAdvanced.new_account_action);

  if (type === 'ANTI_SPAM') {
    for (const key of ANTI_SPAM_LEGACY_KEYS) {
      delete nextSimple[key];
      delete nextAdvanced[key];
    }
  }

  if (type === 'ANTI_MASS_MENTION') {
    if ((!Array.isArray(nextAdvanced.authorized_roles) || nextAdvanced.authorized_roles.length === 0) && Array.isArray(nextAdvanced.whitelist_roles)) {
      nextAdvanced.authorized_roles = [...nextAdvanced.whitelist_roles];
    }
    if ((!nextSimple.action || nextSimple.action === 'delete') && typeof nextAdvanced.punishment_action === 'string' && nextAdvanced.punishment_action.trim()) {
      nextSimple.action = nextAdvanced.punishment_action;
    }

    for (const key of ANTI_MENTION_LEGACY_SIMPLE_KEYS) {
      delete nextSimple[key];
    }
    for (const key of ANTI_MENTION_LEGACY_ADVANCED_KEYS) {
      delete nextAdvanced[key];
    }
  }

  return {
    simple_config: nextSimple,
    advanced_config: nextAdvanced,
  };
}

function applyProtectionPreset(guildId, profile, now) {
  const preset = PROTECTION_PRESET_PROFILES[profile] || PROTECTION_PRESET_PROFILES.balanced;
  const existingRows = db.findMany('modules', { guild_id: guildId });

  for (const [moduleType, overrides] of Object.entries(preset)) {
    const definition = MODULE_DEFINITIONS[moduleType];
    if (!definition) continue;

    const existing = existingRows.find((row) => row.module_type === moduleType) || null;
    const currentSimple = { ...definition.simple_config, ...parseConfig(existing?.simple_config) };
    const currentAdvanced = { ...definition.advanced_config, ...parseConfig(existing?.advanced_config) };
    const sanitized = sanitizeModuleConfigs(
      moduleType,
      { ...currentSimple, ...(overrides.simple_config || {}) },
      { ...currentAdvanced, ...(overrides.advanced_config || {}) }
    );

    if (existing) {
      db.db.prepare(
        'UPDATE modules SET enabled = 1, simple_config = ?, advanced_config = ?, updated_at = ? WHERE id = ?'
      ).run(
        JSON.stringify(sanitized.simple_config),
        JSON.stringify(sanitized.advanced_config),
        now,
        existing.id
      );
    } else {
      db.insert('modules', {
        id: uuidv4(),
        guild_id: guildId,
        module_type: moduleType,
        enabled: 1,
        simple_config: JSON.stringify(sanitized.simple_config),
        advanced_config: JSON.stringify(sanitized.advanced_config),
        created_at: now,
        updated_at: now,
      });
    }
  }
}

function buildModuleResponse(type, definition, dbModule) {
  const storedSimple = dbModule ? parseConfig(dbModule.simple_config) : {};
  const storedAdvanced = dbModule ? parseConfig(dbModule.advanced_config) : {};
  const sanitized = sanitizeModuleConfigs(
    type,
    { ...definition.simple_config, ...storedSimple },
    { ...definition.advanced_config, ...storedAdvanced }
  );

  if (dbModule) {
    const hasLegacyKeys = ANTI_SPAM_LEGACY_KEYS.some((key) => key in storedSimple || key in storedAdvanced);
    if (type === 'ANTI_SPAM' && hasLegacyKeys) {
      db.db.prepare(
        'UPDATE modules SET simple_config = ?, advanced_config = ?, updated_at = ? WHERE id = ?'
      ).run(
        JSON.stringify(sanitized.simple_config),
        JSON.stringify(sanitized.advanced_config),
        new Date().toISOString(),
        dbModule.id
      );
    }

    const hasMentionLegacyKeys = (
      type === 'ANTI_MASS_MENTION'
      && (
        ANTI_MENTION_LEGACY_SIMPLE_KEYS.some((key) => key in storedSimple)
        || ANTI_MENTION_LEGACY_ADVANCED_KEYS.some((key) => key in storedAdvanced)
      )
    );
    if (hasMentionLegacyKeys) {
      db.db.prepare(
        'UPDATE modules SET simple_config = ?, advanced_config = ?, updated_at = ? WHERE id = ?'
      ).run(
        JSON.stringify(sanitized.simple_config),
        JSON.stringify(sanitized.advanced_config),
        new Date().toISOString(),
        dbModule.id
      );
    }
  }

  return {
    type,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    enabled: dbModule ? !!dbModule.enabled : false,
    simple_config: sanitized.simple_config,
    advanced_config: sanitized.advanced_config,
    updated_at: dbModule?.updated_at ?? null,
  };
}

function buildModuleSnapshots(guildId, moduleTypes = MODULE_TYPES) {
  const rowsByType = new Map(
    db.findMany('modules', { guild_id: guildId }).map((row) => [row.module_type, row])
  );

  const uniqueTypes = [...new Set((Array.isArray(moduleTypes) ? moduleTypes : MODULE_TYPES)
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => MODULE_DEFINITIONS[value]))];

  return uniqueTypes.map((type) => buildModuleResponse(
    type,
    MODULE_DEFINITIONS[type],
    rowsByType.get(type) || null
  ));
}

function getSyncedModuleTypes(type, { presetProfile = null, includeUltimateManaged = false } = {}) {
  const types = new Set([type]);

  if (type === 'PROTECTION_PRESETS') {
    const preset = PROTECTION_PRESET_PROFILES[String(presetProfile || '').toLowerCase()] || PROTECTION_PRESET_PROFILES.balanced;
    Object.keys(preset).forEach((moduleType) => types.add(moduleType));
  }

  if (type === 'ULTIMATE_PROTECTION' && includeUltimateManaged) {
    ULTIMATE_PROTECTION_MANAGED_TYPES.forEach((moduleType) => types.add(moduleType));
  }

  return [...types];
}

async function syncGuildNativeRules(req) {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const guildModules = db.raw('SELECT * FROM modules WHERE guild_id = ?', [req.guild.id]);
    const configs = {};

    for (const moduleRow of guildModules) {
      const definition = MODULE_DEFINITIONS[moduleRow.module_type] || { simple_config: {}, advanced_config: {} };
      const sanitized = sanitizeModuleConfigs(
        moduleRow.module_type,
        { ...definition.simple_config, ...parseConfig(moduleRow.simple_config) },
        { ...definition.advanced_config, ...parseConfig(moduleRow.advanced_config) }
      );

      configs[moduleRow.module_type] = {
        enabled: !!moduleRow.enabled,
        simple_config: sanitized.simple_config,
        advanced_config: sanitized.advanced_config,
      };
    }

    await syncNativeAutoModRules(token, req.guild.guild_id, configs);
  } catch {
    // best effort only
  }
}

// All routes require authentication, a valid bot token, and guild ownership
router.use(requireAuth, requireBotToken, requireGuildOwner);

// ── GET / — list all modules for a guild ─────────────────────────────────────
router.get('/', (req, res) => {
  res.json({ modules: buildModuleSnapshots(req.guild.id) });
});

// ── GET /:moduleType — single module ─────────────────────────────────────────
router.get('/:moduleType', (req, res) => {
  const typeResult = moduleTypeSchema.safeParse(req.params.moduleType.toUpperCase());
  if (!typeResult.success) return res.status(400).json({ error: 'Unknown module type' });

  const type = typeResult.data;
  const def = MODULE_DEFINITIONS[type];
  const dbModule = db.raw(
    'SELECT * FROM modules WHERE guild_id = ? AND module_type = ?',
    [req.guild.id, type]
  )[0] ?? null;

  res.json(buildModuleResponse(type, def, dbModule));
});

// ── PATCH /:moduleType/toggle ─────────────────────────────────────────────────
router.patch('/:moduleType/toggle', validate(moduleToggleSchema), async (req, res) => {
  const typeResult = moduleTypeSchema.safeParse(req.params.moduleType.toUpperCase());
  if (!typeResult.success) return res.status(400).json({ error: 'Unknown module type' });

  const type = typeResult.data;
  const moduleName = MODULE_DEFINITIONS[type]?.name || type;
  const { enabled } = req.body;
  const now = new Date().toISOString();
  const syncTypes = getSyncedModuleTypes(type, {
    includeUltimateManaged: type === 'ULTIMATE_PROTECTION',
  });

  const existing = db.raw(
    'SELECT id FROM modules WHERE guild_id = ? AND module_type = ?',
    [req.guild.id, type]
  )[0];

  if (existing) {
    db.db.prepare('UPDATE modules SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now, existing.id);
  } else {
    const def = MODULE_DEFINITIONS[type];
    db.insert('modules', {
      id: uuidv4(),
      guild_id: req.guild.id,
      module_type: type,
      enabled: enabled ? 1 : 0,
      simple_config: JSON.stringify(def.simple_config),
      advanced_config: JSON.stringify(def.advanced_config),
      created_at: now,
      updated_at: now,
    });
  }

  if (type === 'ULTIMATE_PROTECTION') {
    const storedRow = db.raw(
      'SELECT * FROM modules WHERE guild_id = ? AND module_type = ?',
      [req.guild.id, type]
    )[0] || null;
    const storedSimple = { ...MODULE_DEFINITIONS[type].simple_config, ...parseConfig(storedRow?.simple_config) };
    const storedAdvanced = { ...MODULE_DEFINITIONS[type].advanced_config, ...parseConfig(storedRow?.advanced_config) };

    if (enabled) {
      applyUltimateProtection(req.guild.id, storedSimple, storedAdvanced, now);
    } else {
      disableUltimateProtectionModules(req.guild.id, now);
    }
  }

  // Invalidate bot's in-memory module cache
  botManager.invalidateModuleCache(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  await syncGuildNativeRules(req);
  const syncedModules = buildModuleSnapshots(req.guild.id, syncTypes);
  notifyGuildModuleSync(req, {
    action: 'toggle',
    moduleType: type,
    enabled: Boolean(enabled),
    modules: syncedModules,
    updatedAt: now,
  });
  logModuleSiteAction(req, enabled ? 'Module active' : 'Module desactive', type, moduleName, [
    `Module : ${moduleName}`,
    `Etat : ${enabled ? 'active' : 'desactive'}`,
    `Serveur : ${req.guild.name || req.guild.guild_id}`,
  ]);

  res.json({
    type,
    enabled,
    modules: syncedModules,
    message: `Module ${enabled ? 'enabled' : 'disabled'}`,
  });
});

// ── PATCH /:moduleType/config — update simple + advanced config ───────────────
router.patch('/:moduleType/config', validate(moduleConfigSchema), async (req, res) => {
  const typeResult = moduleTypeSchema.safeParse(req.params.moduleType.toUpperCase());
  if (!typeResult.success) return res.status(400).json({ error: 'Unknown module type' });

  const type = typeResult.data;
  const def = MODULE_DEFINITIONS[type];
  const moduleName = def?.name || type;
  const now = new Date().toISOString();

  const existing = db.raw(
    'SELECT * FROM modules WHERE guild_id = ? AND module_type = ?',
    [req.guild.id, type]
  )[0];

  const currentSimple = { ...def.simple_config, ...parseConfig(existing?.simple_config) };
  const currentAdvanced = { ...def.advanced_config, ...parseConfig(existing?.advanced_config) };

  const mergedSimple = req.body.simple_config ? { ...currentSimple, ...req.body.simple_config } : currentSimple;
  const mergedAdvanced = req.body.advanced_config ? { ...currentAdvanced, ...req.body.advanced_config } : currentAdvanced;
  const sanitized = sanitizeModuleConfigs(type, mergedSimple, mergedAdvanced);
  const newSimple = sanitized.simple_config;
  const newAdvanced = sanitized.advanced_config;

  if (existing) {
    db.db.prepare(
      'UPDATE modules SET simple_config = ?, advanced_config = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(newSimple), JSON.stringify(newAdvanced), now, existing.id);
  } else {
    db.insert('modules', {
      id: uuidv4(),
      guild_id: req.guild.id,
      module_type: type,
      enabled: 0,
      simple_config: JSON.stringify(newSimple),
      advanced_config: JSON.stringify(newAdvanced),
      created_at: now,
      updated_at: now,
    });
  }

  if (type === 'PROTECTION_PRESETS') {
    applyProtectionPreset(req.guild.id, newSimple.profile, now);
  }

  if (type === 'ULTIMATE_PROTECTION' && existing?.enabled) {
    applyUltimateProtection(req.guild.id, newSimple, newAdvanced, now);
  }

  const syncTypes = getSyncedModuleTypes(type, {
    presetProfile: type === 'PROTECTION_PRESETS' ? newSimple.profile : null,
    includeUltimateManaged: type === 'ULTIMATE_PROTECTION' && !!existing?.enabled,
  });

  botManager.invalidateModuleCache(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  await syncGuildNativeRules(req);
  const syncedModules = buildModuleSnapshots(req.guild.id, syncTypes);
  notifyGuildModuleSync(req, {
    action: 'config',
    moduleType: type,
    modules: syncedModules,
    updatedAt: now,
  });
  const changedSimpleKeys = Object.keys(req.body.simple_config || {});
  const changedAdvancedKeys = Object.keys(req.body.advanced_config || {});
  logModuleSiteAction(req, 'Configuration module mise a jour', type, moduleName, [
    `Module : ${moduleName}`,
    changedSimpleKeys.length ? `Champs simples : ${changedSimpleKeys.join(', ')}` : '',
    changedAdvancedKeys.length ? `Champs avances : ${changedAdvancedKeys.join(', ')}` : '',
    type === 'PROTECTION_PRESETS' && newSimple.profile ? `Preset applique : ${newSimple.profile}` : '',
  ].filter(Boolean));

  res.json({
    type,
    simple_config: newSimple,
    advanced_config: newAdvanced,
    modules: syncedModules,
    message: 'Configuration updated',
  });
});

// ── POST /:moduleType/reset — reset to defaults ───────────────────────────────
router.post('/:moduleType/reset', async (req, res) => {
  const typeResult = moduleTypeSchema.safeParse(req.params.moduleType.toUpperCase());
  if (!typeResult.success) return res.status(400).json({ error: 'Unknown module type' });

  const type = typeResult.data;
  const def = MODULE_DEFINITIONS[type];
  const moduleName = def?.name || type;
  const now = new Date().toISOString();
  const syncTypes = getSyncedModuleTypes(type, {
    includeUltimateManaged: type === 'ULTIMATE_PROTECTION',
  });

  const existing = db.raw(
    'SELECT id FROM modules WHERE guild_id = ? AND module_type = ?',
    [req.guild.id, type]
  )[0];

  if (existing) {
    db.db.prepare(
      'UPDATE modules SET simple_config = ?, advanced_config = ?, enabled = 0, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(def.simple_config), JSON.stringify(def.advanced_config), now, existing.id);
  } else {
    db.insert('modules', {
      id: uuidv4(),
      guild_id: req.guild.id,
      module_type: type,
      enabled: 0,
      simple_config: JSON.stringify(def.simple_config),
      advanced_config: JSON.stringify(def.advanced_config),
      created_at: now,
      updated_at: now,
    });
  }

  if (type === 'ULTIMATE_PROTECTION') {
    disableUltimateProtectionModules(req.guild.id, now);
  }

  botManager.invalidateModuleCache(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  await syncGuildNativeRules(req);
  const syncedModules = buildModuleSnapshots(req.guild.id, syncTypes);
  notifyGuildModuleSync(req, {
    action: 'reset',
    moduleType: type,
    enabled: false,
    modules: syncedModules,
    updatedAt: now,
  });
  logModuleSiteAction(req, 'Module reinitialise', type, moduleName, [
    `Module : ${moduleName}`,
    'Etat : desactive',
    'Configuration remise par defaut',
  ]);
  res.json({
    message: 'Module reset to defaults',
    type,
    modules: syncedModules,
  });
});

module.exports = router;
