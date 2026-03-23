'use strict';

const logger = require('../utils/logger').child('DiscordAutoModService');
const discordService = require('./discordService');

const RULE_KEYS = {
  ANTI_INVITE: 'ANTI_INVITE',
  ANTI_MASS_MENTION: 'ANTI_MASS_MENTION',
  AUTO_MOD_PRESET: 'AUTO_MOD_PRESET',
  AUTO_MOD_CUSTOM: 'AUTO_MOD_CUSTOM',
};

const RULE_NAMES = {
  [RULE_KEYS.ANTI_INVITE]: 'DiscordForge • Anti-invitation',
  [RULE_KEYS.ANTI_MASS_MENTION]: 'DiscordForge • Anti-mention',
  [RULE_KEYS.AUTO_MOD_PRESET]: 'DiscordForge • AutoMod standard',
  [RULE_KEYS.AUTO_MOD_CUSTOM]: 'DiscordForge • AutoMod personnalise',
};

const AUTO_MOD_PREFIX = 'DiscordForge • ';
const TRIGGER_TYPES = {
  KEYWORD: 1,
  KEYWORD_PRESET: 4,
  MENTION_SPAM: 5,
};
const ACTION_TYPES = {
  BLOCK_MESSAGE: 1,
  TIMEOUT: 3,
};

function toIdList(list, maxLength) {
  return Array.isArray(list) ? list.filter(Boolean).slice(0, maxLength) : [];
}

function toTimeoutSeconds(durationMs, fallbackSeconds = 300) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value <= 0) return fallbackSeconds;
  return Math.max(60, Math.min(2_419_200, Math.round(value / 1000)));
}

function normalizeStringList(list, maxLength = 100) {
  return Array.isArray(list)
    ? [...new Set(list.map((entry) => String(entry || '').trim()).filter(Boolean))].slice(0, maxLength)
    : [];
}

function buildActions(action, durationMs) {
  const actions = [{ type: ACTION_TYPES.BLOCK_MESSAGE }];
  if (action === 'timeout') {
    actions.push({
      type: ACTION_TYPES.TIMEOUT,
      metadata: { duration_seconds: toTimeoutSeconds(durationMs) },
    });
  }
  return actions;
}

function canUseNativeInviteRule(config) {
  const simple = config?.simple_config || {};
  const advanced = config?.advanced_config || {};
  return !simple.allow_own_invites && !(advanced.whitelist_servers || []).length;
}

function buildInviteRule(config) {
  if (!canUseNativeInviteRule(config)) return null;

  const advanced = config?.advanced_config || {};
  const action = advanced.punishment_action || 'delete';

  return {
    name: RULE_NAMES[RULE_KEYS.ANTI_INVITE],
    event_type: 1,
    trigger_type: TRIGGER_TYPES.KEYWORD,
    trigger_metadata: {
      regex_patterns: [
        '(?i)(?:https?:\\/\\/)?(?:www\\.)?(?:discord(?:app)?\\.com\\/invite|discord\\.gg|discord\\.me|discord\\.io|discord\\.li)\\/[A-Za-z0-9-]+',
      ],
    },
    actions: buildActions(action, advanced.timeout_duration_ms),
    enabled: true,
    exempt_roles: toIdList(advanced.whitelist_roles, 20),
    exempt_channels: toIdList(advanced.whitelist_channels, 50),
  };
}

function buildMentionRule(config) {
  const simple = config?.simple_config || {};
  const advanced = config?.advanced_config || {};

  return {
    name: RULE_NAMES[RULE_KEYS.ANTI_MASS_MENTION],
    event_type: 1,
    trigger_type: TRIGGER_TYPES.MENTION_SPAM,
    trigger_metadata: {
      mention_total_limit: 1,
      mention_raid_protection_enabled: true,
    },
    actions: buildActions(simple.action || 'delete', advanced.timeout_duration_ms),
    enabled: true,
    exempt_roles: toIdList(advanced.authorized_roles, 20),
    exempt_channels: toIdList(advanced.whitelist_channels, 50),
  };
}

function buildAutoModPresetRule(config) {
  const simple = config?.simple_config || {};
  const advanced = config?.advanced_config || {};
  const action = advanced.punishment_action || simple.action || 'delete';

  if (!simple.filter_profanity) return null;

  return {
    name: RULE_NAMES[RULE_KEYS.AUTO_MOD_PRESET],
    event_type: 1,
    trigger_type: TRIGGER_TYPES.KEYWORD_PRESET,
    trigger_metadata: {
      presets: [1, 3],
    },
    actions: buildActions(action, advanced.timeout_duration_ms),
    enabled: true,
    exempt_roles: toIdList(advanced.whitelist_roles, 20),
    exempt_channels: toIdList(advanced.whitelist_channels, 50),
  };
}

function buildAutoModCustomRule(config) {
  const simple = config?.simple_config || {};
  const advanced = config?.advanced_config || {};
  const action = advanced.punishment_action || simple.action || 'delete';
  const bannedWords = normalizeStringList(advanced.banned_words, 100);

  if (!bannedWords.length) return null;

  return {
    name: RULE_NAMES[RULE_KEYS.AUTO_MOD_CUSTOM],
    event_type: 1,
    trigger_type: TRIGGER_TYPES.KEYWORD,
    trigger_metadata: advanced.use_regex
      ? { regex_patterns: bannedWords.slice(0, 10) }
      : { keyword_filter: bannedWords },
    actions: buildActions(action, advanced.timeout_duration_ms),
    enabled: true,
    exempt_roles: toIdList(advanced.whitelist_roles, 20),
    exempt_channels: toIdList(advanced.whitelist_channels, 50),
  };
}

function buildDesiredRules(configs) {
  return [
    {
      key: RULE_KEYS.ANTI_INVITE,
      enabled: !!configs.ANTI_INVITE?.enabled,
      payload: buildInviteRule(configs.ANTI_INVITE),
    },
    {
      key: RULE_KEYS.ANTI_MASS_MENTION,
      enabled: !!configs.ANTI_MASS_MENTION?.enabled,
      payload: buildMentionRule(configs.ANTI_MASS_MENTION),
    },
    {
      key: RULE_KEYS.AUTO_MOD_PRESET,
      enabled: !!configs.AUTO_MOD?.enabled,
      payload: buildAutoModPresetRule(configs.AUTO_MOD),
    },
    {
      key: RULE_KEYS.AUTO_MOD_CUSTOM,
      enabled: !!configs.AUTO_MOD?.enabled,
      payload: buildAutoModCustomRule(configs.AUTO_MOD),
    },
  ];
}

function getManagedRuleKey(ruleName) {
  return Object.entries(RULE_NAMES).find(([, value]) => value === ruleName)?.[0] || null;
}

async function syncNativeAutoModRules(token, discordGuildId, configs) {
  if (!token || !discordGuildId) return;

  let rules;
  try {
    rules = await discordService.listAutoModerationRules(token, discordGuildId);
  } catch (error) {
    logger.warn(`AutoMod list failed for guild ${discordGuildId}: ${error.message}`);
    return;
  }

  const existingManaged = new Map(
    (rules || [])
      .filter((rule) => String(rule?.name || '').startsWith(AUTO_MOD_PREFIX))
      .map((rule) => [rule.name, rule])
  );

  const desiredRules = buildDesiredRules(configs);
  const desiredNames = new Set();

  for (const descriptor of desiredRules) {
    const ruleName = RULE_NAMES[descriptor.key];
    desiredNames.add(ruleName);
    const existingRule = existingManaged.get(ruleName);

    if (!descriptor.enabled || !descriptor.payload) {
      if (existingRule) {
        try {
          await discordService.deleteAutoModerationRule(token, discordGuildId, existingRule.id, `DiscordForge sync ${ruleName}`);
        } catch (error) {
          logger.warn(`AutoMod delete failed for ${ruleName} on guild ${discordGuildId}: ${error.message}`);
        }
      }
      continue;
    }

    try {
      if (existingRule) {
        await discordService.modifyAutoModerationRule(token, discordGuildId, existingRule.id, descriptor.payload, `DiscordForge sync ${ruleName}`);
      } else {
        await discordService.createAutoModerationRule(token, discordGuildId, descriptor.payload, `DiscordForge sync ${ruleName}`);
      }
    } catch (error) {
      logger.warn(`AutoMod upsert failed for ${ruleName} on guild ${discordGuildId}: ${error.message}`);
    }
  }

  for (const rule of existingManaged.values()) {
    if (desiredNames.has(rule.name)) continue;
    try {
      await discordService.deleteAutoModerationRule(token, discordGuildId, rule.id, `DiscordForge cleanup ${rule.name}`);
    } catch (error) {
      logger.warn(`AutoMod cleanup failed for ${rule.name} on guild ${discordGuildId}: ${error.message}`);
    }
  }
}

module.exports = {
  RULE_KEYS,
  RULE_NAMES,
  getManagedRuleKey,
  syncNativeAutoModRules,
  canUseNativeInviteRule,
};
