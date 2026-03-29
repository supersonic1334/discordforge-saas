'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { moduleToggleSchema, moduleConfigSchema, moduleTypeSchema } = require('../validators/schemas');
const { MODULE_DEFINITIONS, MODULE_TYPES } = require('../bot/modules/definitions');
const botManager = require('../services/botManager');
const { syncNativeAutoModRules } = require('../services/discordAutoModService');
const { decrypt } = require('../services/encryptionService');
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
  const modules = db.findMany('modules', { guild_id: req.guild.id });

  // Merge with definitions (ensures missing modules are shown with defaults)
  const result = MODULE_TYPES.map((type) => {
    const def = MODULE_DEFINITIONS[type];
    const dbModule = modules.find((m) => m.module_type === type);
    return buildModuleResponse(type, def, dbModule);
  });

  res.json({ modules: result });
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

  // Invalidate bot's in-memory module cache
  botManager.invalidateModuleCache(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  await syncGuildNativeRules(req);
  logModuleSiteAction(req, enabled ? 'Module active' : 'Module desactive', type, moduleName, [
    `Module : ${moduleName}`,
    `Etat : ${enabled ? 'active' : 'desactive'}`,
    `Serveur : ${req.guild.name || req.guild.guild_id}`,
  ]);

  res.json({ type, enabled, message: `Module ${enabled ? 'enabled' : 'disabled'}` });
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

  botManager.invalidateModuleCache(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  await syncGuildNativeRules(req);
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

  botManager.invalidateModuleCache(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  await syncGuildNativeRules(req);
  logModuleSiteAction(req, 'Module reinitialise', type, moduleName, [
    `Module : ${moduleName}`,
    'Etat : desactive',
    'Configuration remise par defaut',
  ]);
  res.json({ message: 'Module reset to defaults', type });
});

module.exports = router;
