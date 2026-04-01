'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { v4: uuidv4 } = require('uuid');

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { customCommandSchema, commandAssistantSchema, commandToggleSchema } = require('../validators/schemas');
const db = require('../database');
const botManager = require('../services/botManager');
const aiService = require('../services/aiService');
const guildAccessService = require('../services/guildAccessService');
const logger = require('../utils/logger').child('CommandsRoutes');
const { logBotEvent } = require('../bot/utils/modHelpers');
const { COMMAND_ACTION_TYPES, SUPPORTED_NATIVE_ACTIONS, DEFAULT_SYSTEM_COMMANDS } = require('../constants/systemCommands');
const wsServer = require('../websocket');

router.use(requireAuth, requireBotToken, requireGuildOwner);

const scheduledCommandSyncs = new Map();

function listMappedCommandsForGuild(guildId) {
  ensureDefaultCommandsForGuild(guildId);
  const commands = db.raw(
    `SELECT * FROM custom_commands
     WHERE guild_id = ?
     ORDER BY is_system DESC, command_type ASC, trigger ASC`,
    [guildId]
  );
  return commands.map(mapCommandRow);
}

function notifyGuildCommandSync(req, payload = {}) {
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
    commands: listMappedCommandsForGuild(req.guild.id),
    ...payload,
  };

  for (const userId of userIds) {
    wsServer.broadcastToUser(userId, {
      event: 'commands:updated',
      data: eventPayload,
    });
  }
}

function parseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeResponseMode(value, replyInDm) {
  if (value === 'reply' || value === 'dm' || value === 'channel') return value;
  return replyInDm ? 'dm' : 'channel';
}

function normalizeColor(value = '#22d3ee') {
  const raw = String(value || '').trim();
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '#22d3ee';
}

function normalizeTrigger(value) {
  return String(value || '').trim();
}

function normalizeCommandType(value) {
  return value === 'slash' ? 'slash' : 'prefix';
}

function normalizeCommandPrefix(value) {
  return String(value || '!').trim().slice(0, 5) || '!';
}

function normalizeExecutionMode(value, actionType = '') {
  if (value === 'native' || SUPPORTED_NATIVE_ACTIONS.has(actionType)) return 'native';
  return 'response';
}

function normalizeActionType(value) {
  const actionType = String(value || '').trim();
  return SUPPORTED_NATIVE_ACTIONS.has(actionType) ? actionType : '';
}

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function clampDurationMs(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function parseFlexibleDurationMs(value, {
  fallback,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
  defaultUnit = 'm',
  allowZero = false,
} = {}) {
  if (value === null || value === undefined || value === '') return fallback;

  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (allowZero && (raw === '0' || raw === '0s' || raw === '0m' || raw === '0h' || raw === '0d' || raw === '0j')) {
    return 0;
  }

  const match = raw.match(/^(\d+)\s*([smhdj]?)$/);
  if (!match) return fallback;

  const amount = Number(match[1]);
  const unit = match[2] || defaultUnit;
  const multiplier = unit === 's'
    ? 1000
    : unit === 'h'
      ? 3600000
      : (unit === 'd' || unit === 'j')
        ? 86400000
        : 60000;

  const computed = Math.round(amount * multiplier);
  if (allowZero && computed === 0) return 0;
  return clampDurationMs(computed, minimum, maximum, fallback);
}

function parseFlexibleDurationSeconds(value, options = {}) {
  const fallbackMs = Math.max(0, Math.round(Number(options.fallback || 0) * 1000));
  const next = parseFlexibleDurationMs(value, {
    ...options,
    fallback: fallbackMs,
  });
  return Math.max(0, Math.round(Number(next || 0) / 1000));
}

function normalizeSnowflake(value, fallbackValue = '') {
  const raw = String(value ?? fallbackValue ?? '').trim();
  return /^\d+$/.test(raw) ? raw : '';
}

function normalizeBooleanFlag(value, fallbackValue = false) {
  return (value ?? fallbackValue) ? 1 : 0;
}

function normalizeVisibility(value, fallbackValue = 'ephemeral') {
  return String(value || fallbackValue || '').trim().toLowerCase() === 'public'
    ? 'public'
    : 'ephemeral';
}

function normalizeClearActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};
  const minAmount = clampNumber(source.min_amount ?? fallback.min_amount, 1, 100, 1);
  const maxAmount = clampNumber(source.max_amount ?? fallback.max_amount, minAmount, 100, 100);

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    min_amount: minAmount,
    max_amount: maxAmount,
    success_message: String(source.success_message ?? fallback.success_message ?? '{count} messages supprimes dans {channel}.').trim().slice(0, 220),
    empty_message: String(source.empty_message ?? fallback.empty_message ?? 'Aucun message recent a supprimer ici.').trim().slice(0, 220),
    denied_message: String(source.denied_message ?? fallback.denied_message ?? 'Tu dois avoir la permission de gerer les messages pour utiliser cette commande.').trim().slice(0, 220),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeTicketPanelActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};
  const supportRoleIds = normalizeIdArray(source.support_role_ids ?? fallback.support_role_ids ?? []);

  return {
    button_label: String(source.button_label ?? fallback.button_label ?? 'Ouvrir un ticket').trim().slice(0, 80) || 'Ouvrir un ticket',
    button_emoji: String(source.button_emoji ?? fallback.button_emoji ?? '🎫').trim().slice(0, 10) || '🎫',
    category_id: normalizeSnowflake(source.category_id, fallback.category_id),
    support_role_ids: supportRoleIds,
    ticket_name_template: String(source.ticket_name_template ?? fallback.ticket_name_template ?? 'ticket-{username}').trim().slice(0, 80) || 'ticket-{username}',
    welcome_message: String(source.welcome_message ?? fallback.welcome_message ?? 'Bonjour {mention}, decris ici ta demande et un membre du staff te repondra.').trim().slice(0, 1000),
    close_message: String(source.close_message ?? fallback.close_message ?? 'Ticket ferme par {closer}.').trim().slice(0, 240),
    prevent_duplicates: (source.prevent_duplicates ?? fallback.prevent_duplicates ?? true) ? 1 : 0,
  };
}

function normalizeBanActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
    require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
    delete_message_seconds: parseFlexibleDurationSeconds(source.delete_message_seconds ?? fallback.delete_message_seconds, {
      fallback: Number(fallback.delete_message_seconds || 0),
      minimum: 0,
      maximum: 604800000,
      defaultUnit: 's',
      allowZero: true,
    }),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeKickActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
    require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeTimeoutActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
    require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
    default_duration_ms: parseFlexibleDurationMs(source.default_duration_ms ?? fallback.default_duration_ms, {
      fallback: Number(fallback.default_duration_ms || 600000),
      minimum: 60000,
      maximum: 2419200000,
      defaultUnit: 'm',
    }),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeUntimeoutActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? false),
    require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? false),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeWarnActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
    require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
    default_points: clampNumber(source.default_points ?? fallback.default_points, 1, 20, 1),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeReasonActionConfig(value = {}, fallbackValue = {}, defaultRequireReason = false) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? defaultRequireReason),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeChannelActionConfig(value = {}, fallbackValue = {}, defaultRequireReason = false) {
  const base = normalizeReasonActionConfig(value, fallbackValue, defaultRequireReason);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    ...base,
    default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
  };
}

function normalizeSlowmodeActionConfig(value = {}, fallbackValue = {}) {
  const base = normalizeChannelActionConfig(value, fallbackValue, false);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    ...base,
    default_seconds: parseFlexibleDurationSeconds(source.default_seconds ?? fallback.default_seconds, {
      fallback: Number(fallback.default_seconds || 30),
      minimum: 0,
      maximum: 21600000,
      defaultUnit: 's',
      allowZero: true,
    }),
  };
}

function normalizeSayActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
    allow_mentions: normalizeBooleanFlag(source.allow_mentions, fallback.allow_mentions ?? false),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeAnnounceActionConfig(value = {}, fallbackValue = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue) ? fallbackValue : {};

  return {
    log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
    default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
    ping_everyone: normalizeBooleanFlag(source.ping_everyone, fallback.ping_everyone ?? false),
    success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
  };
}

function normalizeActionConfig(actionType, value = {}, fallbackValue = {}) {
  if (actionType === COMMAND_ACTION_TYPES.CLEAR_MESSAGES) {
    return normalizeClearActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.TICKET_PANEL) {
    return normalizeTicketPanelActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.BAN_MEMBER) {
    return normalizeBanActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.BLACKLIST_MEMBER) {
    return normalizeBanActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.KICK_MEMBER) {
    return normalizeKickActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.SOFTBAN_MEMBER) {
    return normalizeBanActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.TIMEOUT_MEMBER) {
    return normalizeTimeoutActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER) {
    return normalizeUntimeoutActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.WARN_MEMBER) {
    return normalizeWarnActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.UNBAN_MEMBER) {
    return normalizeReasonActionConfig(value, fallbackValue, false);
  }
  if (actionType === COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER) {
    return normalizeReasonActionConfig(value, fallbackValue, false);
  }
  if (
    actionType === COMMAND_ACTION_TYPES.ADD_ROLE
    || actionType === COMMAND_ACTION_TYPES.REMOVE_ROLE
    || actionType === COMMAND_ACTION_TYPES.SET_NICKNAME
    || actionType === COMMAND_ACTION_TYPES.MOVE_MEMBER
    || actionType === COMMAND_ACTION_TYPES.DISCONNECT_MEMBER
  ) {
    return normalizeReasonActionConfig(value, fallbackValue, false);
  }
  if (actionType === COMMAND_ACTION_TYPES.LOCK_CHANNEL || actionType === COMMAND_ACTION_TYPES.UNLOCK_CHANNEL) {
    return normalizeChannelActionConfig(value, fallbackValue, false);
  }
  if (actionType === COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL) {
    return normalizeSlowmodeActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.SAY_MESSAGE) {
    return normalizeSayActionConfig(value, fallbackValue);
  }
  if (actionType === COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE) {
    return normalizeAnnounceActionConfig(value, fallbackValue);
  }
  return {};
}

function buildNativeActionDefaults(actionType, mode, currentCommand = null) {
  if (actionType === COMMAND_ACTION_TYPES.CLEAR_MESSAGES) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Supprime rapidement un lot de messages',
      response: currentCommand?.response || 'Supprime un nombre precis de messages dans le salon courant.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#22d3ee',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/clear amount:20' : `${currentCommand?.display_trigger || '!clear'} 20`,
      require_args: mode !== 'slash',
      delete_trigger: mode !== 'slash',
      cooldown_ms: Number(currentCommand?.cooldown_ms || 3000),
      action_config: normalizeClearActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.TICKET_PANEL) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Publie un panel de tickets interactif',
      response: currentCommand?.response || 'Appuie sur le bouton ci-dessous pour ouvrir un ticket prive avec le staff.',
      response_mode: 'channel',
      embed_enabled: true,
      embed_title: currentCommand?.embed_title || 'Support & tickets',
      embed_color: currentCommand?.embed_color || '#7c3aed',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/tickets' : (currentCommand?.display_trigger || '!tickets'),
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeTicketPanelActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.BAN_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Bannit un membre avec une raison',
      response: currentCommand?.response || 'Bannit un membre et journalise la sanction.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#ef4444',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/ban user:@membre reason:"..."' : `${currentCommand?.display_trigger || '!ban'} @membre raison`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 2500),
      action_config: normalizeBanActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.BLACKLIST_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Blacklist un membre sur tout le reseau',
      response: currentCommand?.response || 'Bannit le membre ici et l ajoute a la blacklist reseau du bot.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#dc2626',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/blacklist user:@membre reason:"..."' : `${currentCommand?.display_trigger || '!blacklist'} @membre raison`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 3000),
      action_config: normalizeBanActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.KICK_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Expulse un membre avec une raison',
      response: currentCommand?.response || 'Expulse un membre et journalise la sanction.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#f97316',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/kick user:@membre reason:"..."' : `${currentCommand?.display_trigger || '!kick'} @membre raison`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 2500),
      action_config: normalizeKickActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.SOFTBAN_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Ban puis deban un membre pour nettoyer',
      response: currentCommand?.response || 'Bannit puis debannit un membre pour nettoyer ses messages recents.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#fb7185',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/softban user:@membre reason:"..."' : `${currentCommand?.display_trigger || '!softban'} @membre raison`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 3000),
      action_config: normalizeBanActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.TIMEOUT_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Met un membre en timeout temporaire',
      response: currentCommand?.response || 'Applique un timeout avec duree et raison.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#f59e0b',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/tempmute user:@membre minutes:10 reason:"..."' : `${currentCommand?.display_trigger || '!tempmute'} @membre 10m raison`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 2500),
      action_config: normalizeTimeoutActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Retire le timeout d un membre',
      response: currentCommand?.response || 'Retire le timeout d un membre et journalise l action.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#22c55e',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/unmute user:@membre reason:"..."' : `${currentCommand?.display_trigger || '!unmute'} @membre`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeUntimeoutActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.WARN_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Ajoute un avertissement a un membre',
      response: currentCommand?.response || 'Ajoute un avertissement avec raison et journalisation.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#eab308',
      mention_user: false,
      usage_hint: mode === 'slash' ? '/warn user:@membre reason:"..." points:1' : `${currentCommand?.display_trigger || '!warn'} @membre raison`,
      require_args: mode !== 'slash',
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeWarnActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.UNBAN_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Retire le ban d un utilisateur',
      response: currentCommand?.response || 'Retire un bannissement avec raison optionnelle.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#22c55e',
      mention_user: false,
      usage_hint: '/unban user_id:123456789012345678 reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Retire un utilisateur de la blacklist reseau',
      response: currentCommand?.response || 'Retire un utilisateur de la blacklist reseau du bot.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#10b981',
      mention_user: false,
      usage_hint: '/unblacklist user_id:123456789012345678 reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.ADD_ROLE) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Ajoute un role a un membre',
      response: currentCommand?.response || 'Ajoute un role au membre cible.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#60a5fa',
      mention_user: false,
      usage_hint: '/addrole user:@membre role:@role reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.REMOVE_ROLE) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Retire un role a un membre',
      response: currentCommand?.response || 'Retire un role du membre cible.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#38bdf8',
      mention_user: false,
      usage_hint: '/removerole user:@membre role:@role reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.SET_NICKNAME) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Change le pseudo d un membre',
      response: currentCommand?.response || 'Met a jour le pseudo du membre cible.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#a78bfa',
      mention_user: false,
      usage_hint: '/nick user:@membre nickname:"Nouveau pseudo" reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.LOCK_CHANNEL) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Verrouille un salon texte',
      response: currentCommand?.response || 'Bloque l envoi de messages dans le salon choisi.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#f97316',
      mention_user: false,
      usage_hint: '/lock channel:#general reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeChannelActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.UNLOCK_CHANNEL) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Deverrouille un salon texte',
      response: currentCommand?.response || 'Retablit l envoi de messages dans le salon choisi.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#22c55e',
      mention_user: false,
      usage_hint: '/unlock channel:#general reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeChannelActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Regle le mode lent d un salon',
      response: currentCommand?.response || 'Ajuste le slowmode du salon cible.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#f59e0b',
      mention_user: false,
      usage_hint: '/slowmode channel:#general seconds:30 reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeSlowmodeActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.SAY_MESSAGE) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Fait parler le bot dans un salon',
      response: currentCommand?.response || 'Publie un message brut dans le salon choisi.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#06b6d4',
      mention_user: false,
      usage_hint: '/say channel:#annonces message:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1200),
      action_config: normalizeSayActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Publie une annonce en embed',
      response: currentCommand?.response || 'Publie une annonce mise en forme dans le salon choisi.',
      response_mode: 'reply',
      embed_enabled: true,
      embed_title: currentCommand?.embed_title || 'Annonce',
      embed_color: currentCommand?.embed_color || '#8b5cf6',
      mention_user: false,
      usage_hint: '/announce channel:#annonces title:"Annonce" message:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1200),
      action_config: normalizeAnnounceActionConfig({}, currentConfig),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.MOVE_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Deplace un membre vers un vocal',
      response: currentCommand?.response || 'Deplace un membre connecte vers un autre salon vocal.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#14b8a6',
      mention_user: false,
      usage_hint: '/move user:@membre channel:Vocal reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  if (actionType === COMMAND_ACTION_TYPES.DISCONNECT_MEMBER) {
    const currentConfig = currentCommand?.action_type === actionType ? currentCommand.action_config : {};
    return {
      execution_mode: 'native',
      action_type: actionType,
      description: currentCommand?.description || 'Deconnecte un membre de son vocal',
      response: currentCommand?.response || 'Deconnecte un membre de son salon vocal avec journalisation.',
      response_mode: 'reply',
      embed_enabled: false,
      embed_title: '',
      embed_color: currentCommand?.embed_color || '#0ea5e9',
      mention_user: false,
      usage_hint: '/disconnect user:@membre reason:"..."',
      require_args: false,
      delete_trigger: false,
      cooldown_ms: Number(currentCommand?.cooldown_ms || 1500),
      action_config: normalizeReasonActionConfig({}, currentConfig, false),
    };
  }

  return null;
}

function extractLargestJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  const fencedMatches = [
    source.match(/```command\s*([\s\S]*?)```/i),
    source.match(/```json\s*([\s\S]*?)```/i),
  ];

  for (const match of fencedMatches) {
    if (!match) continue;
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // keep scanning
    }
  }

  let depth = 0;
  let start = -1;
  let best = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start !== -1) {
        const candidate = source.slice(start, index + 1);
        if (!best || candidate.length > best.length) best = candidate;
        start = -1;
      }
    }
  }

  if (!best) return null;

  try {
    return JSON.parse(best);
  } catch {
    return null;
  }
}

function isFullPrefixCommandInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.includes(' ')) return true;
  if (/^[^a-z0-9\s/]+$/i.test(raw)) return false;
  if (/^[^a-z0-9\s/].+/i.test(raw)) return raw.length > 1;
  return false;
}

function shouldUseSpaceAfterPrefix(prefix) {
  return /^[a-z0-9]+$/i.test(String(prefix || '').trim());
}

function sanitizeCommandName(value, commandType = 'prefix') {
  const raw = String(value || '').trim().replace(/\s+/g, '-');
  if (!raw) return '';

  if (commandType === 'slash') {
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 32);
    return cleaned || 'commande';
  }

  return raw
    .replace(/[^\w-]/g, '')
    .slice(0, 32);
}

function buildCommandTrigger(commandType, commandPrefix, commandName) {
  if (!commandName) {
    return commandType === 'slash' ? '/' : commandPrefix;
  }
  if (commandType === 'slash') {
    return `/${commandName}`;
  }

  return shouldUseSpaceAfterPrefix(commandPrefix)
    ? `${commandPrefix} ${commandName}`
    : `${commandPrefix}${commandName}`;
}

function resolveRequestedCommandMeta({ mode, prefix, trigger, command_name }) {
  const commandType = normalizeCommandType(mode);

  if (commandType === 'slash') {
    const requestedName = sanitizeCommandName(command_name || trigger || '', 'slash');
    return {
      command_type: 'slash',
      command_prefix: '/',
      command_name: requestedName,
      trigger: requestedName ? `/${requestedName}` : '',
    };
  }

  const normalizedPrefix = normalizeCommandPrefix(prefix || '!');
  const requestedTrigger = String(trigger || '').trim();
  if (requestedTrigger) {
    const derived = deriveCommandMeta(requestedTrigger);
    return {
      command_type: 'prefix',
      command_prefix: normalizeCommandPrefix(derived.command_prefix || normalizedPrefix),
      command_name: sanitizeCommandName(derived.command_name || '', 'prefix'),
      trigger: derived.trigger || buildCommandTrigger('prefix', normalizeCommandPrefix(derived.command_prefix || normalizedPrefix), sanitizeCommandName(derived.command_name || '', 'prefix')),
    };
  }

  const requestedName = sanitizeCommandName(command_name || '', 'prefix');
  if (requestedName) {
    return {
      command_type: 'prefix',
      command_prefix: normalizedPrefix,
      command_name: requestedName,
      trigger: buildCommandTrigger('prefix', normalizedPrefix, requestedName),
    };
  }

  return {
    command_type: 'prefix',
    command_prefix: normalizedPrefix,
    command_name: '',
    trigger: '',
  };
}

function deriveCommandMeta(trigger) {
  const raw = normalizeTrigger(trigger);
  if (!raw) {
    return {
      command_type: 'prefix',
      command_prefix: '!',
      command_name: '',
      trigger: '',
    };
  }

  if (raw.startsWith('/')) {
    const commandName = sanitizeCommandName(raw.slice(1), 'slash');
    return {
      command_type: 'slash',
      command_prefix: '/',
      command_name: commandName,
      trigger: commandName ? `/${commandName}` : '/',
    };
  }

  if (raw.includes(' ')) {
    const [prefix, ...rest] = raw.split(/\s+/);
    const commandPrefix = normalizeCommandPrefix(prefix);
    const commandName = sanitizeCommandName(rest.join('-'), 'prefix');
    return {
      command_type: 'prefix',
      command_prefix: commandPrefix,
      command_name: commandName,
      trigger: buildCommandTrigger('prefix', commandPrefix, commandName),
    };
  }

  if (/^[^a-z0-9\s/]+$/i.test(raw)) {
    const commandPrefix = normalizeCommandPrefix(raw);
    return {
      command_type: 'prefix',
      command_prefix: commandPrefix,
      command_name: '',
      trigger: commandPrefix,
    };
  }

  const symbolicTrigger = raw.match(/^([^a-z0-9\s/]+)(.+)$/i);
  if (symbolicTrigger) {
    const commandPrefix = normalizeCommandPrefix(symbolicTrigger[1]);
    const commandName = sanitizeCommandName(symbolicTrigger[2], 'prefix');
    return {
      command_type: 'prefix',
      command_prefix: commandPrefix,
      command_name: commandName,
      trigger: buildCommandTrigger('prefix', commandPrefix, commandName),
    };
  }

  const commandName = sanitizeCommandName(raw, 'prefix');
  return {
    command_type: 'prefix',
    command_prefix: '!',
    command_name: commandName,
    trigger: buildCommandTrigger('prefix', '!', commandName),
  };
}

function resolveBooleanFlag(nextValue, currentValue = false) {
  return (nextValue ?? currentValue ?? false) ? 1 : 0;
}

function normalizeAliases(aliases = [], trigger = '', currentTrigger = '') {
  const forbidden = new Set([normalizeTrigger(trigger).toLowerCase(), normalizeTrigger(currentTrigger).toLowerCase()].filter(Boolean));
  const seen = new Set();
  const normalized = [];

  for (const alias of aliases) {
    const next = normalizeTrigger(alias);
    const key = next.toLowerCase();
    if (!next || forbidden.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function normalizeIdArray(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d+$/.test(value) && !seen.has(value) && seen.add(value));
}

function normalizeSystemKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function getSystemCommandDefinition(systemKey = '') {
  return DEFAULT_SYSTEM_COMMANDS.find((entry) => entry.system_key === normalizeSystemKey(systemKey)) || null;
}

function mapCommandRow(row) {
  const responseMode = normalizeResponseMode(row.response_mode, !!row.reply_in_dm);
  const derived = deriveCommandMeta(row.trigger);
  const commandType = normalizeCommandType(row.command_type || derived.command_type);
  const commandPrefix = commandType === 'slash'
    ? '/'
    : normalizeCommandPrefix(row.command_prefix || derived.command_prefix || '!');
  const commandName = sanitizeCommandName(row.command_name || derived.command_name || '', commandType);
  const actionType = normalizeActionType(row.action_type);
  const executionMode = normalizeExecutionMode(row.execution_mode, actionType);
  const actionConfig = normalizeActionConfig(actionType, parseJsonObject(row.action_config));
  const systemKey = normalizeSystemKey(row.system_key);
  const systemDefinition = getSystemCommandDefinition(systemKey);

  return {
    ...row,
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    is_system: !!row.is_system,
    system_key: systemKey,
    system_category: systemDefinition?.category || '',
    execution_mode: executionMode,
    action_type: executionMode === 'native' ? actionType : '',
    action_config: executionMode === 'native' ? actionConfig : {},
    display_trigger: buildCommandTrigger(commandType, commandPrefix, commandName),
    description: row.description || '',
    aliases: parseJsonArray(row.aliases),
    allowed_roles: parseJsonArray(row.allowed_roles),
    allowed_channels: parseJsonArray(row.allowed_channels),
    response_mode: responseMode,
    reply_in_dm: responseMode === 'dm',
    delete_trigger: !!row.delete_trigger,
    cooldown_ms: Number(row.cooldown_ms || 0),
    delete_response_after_ms: Number(row.delete_response_after_ms || 0),
    embed_enabled: !!row.embed_enabled,
    embed_title: row.embed_title || '',
    embed_color: normalizeColor(row.embed_color),
    mention_user: !!row.mention_user,
    require_args: !!row.require_args,
    usage_hint: row.usage_hint || '',
    enabled: !!row.enabled,
    use_count: Number(row.use_count || 0),
  };
}

function normalizePayload(body, currentCommand = null) {
  const derived = deriveCommandMeta(body.trigger ?? currentCommand?.trigger ?? '');
  const commandType = normalizeCommandType(body.command_type ?? currentCommand?.command_type ?? derived.command_type);
  const commandPrefix = commandType === 'slash'
    ? '/'
    : normalizeCommandPrefix(body.command_prefix ?? currentCommand?.command_prefix ?? derived.command_prefix ?? '!');
  const commandName = sanitizeCommandName(
    body.command_name ?? currentCommand?.command_name ?? derived.command_name,
    commandType
  );
  const trigger = normalizeTrigger(body.trigger ?? buildCommandTrigger(commandType, commandPrefix, commandName));
  const requestedActionType = normalizeActionType(body.action_type ?? currentCommand?.action_type ?? '');
  const executionMode = normalizeExecutionMode(body.execution_mode ?? currentCommand?.execution_mode, requestedActionType);
  const actionType = executionMode === 'native' ? requestedActionType : '';
  const currentActionConfig = currentCommand?.action_type === actionType ? currentCommand?.action_config : {};
  const actionDefaults = executionMode === 'native'
    ? buildNativeActionDefaults(actionType, commandType, currentCommand)
    : null;
  const responseMode = normalizeResponseMode(
    body.response_mode ?? currentCommand?.response_mode ?? actionDefaults?.response_mode,
    body.reply_in_dm ?? currentCommand?.reply_in_dm
  );
  const actionConfig = executionMode === 'native'
    ? normalizeActionConfig(actionType, body.action_config ?? currentActionConfig, actionDefaults?.action_config ?? currentActionConfig)
    : {};
  const isSystem = body.is_system ?? currentCommand?.is_system ?? false;
  const systemKey = isSystem ? normalizeSystemKey(body.system_key ?? currentCommand?.system_key ?? '') : '';

  return {
    trigger: trigger || buildCommandTrigger(commandType, commandPrefix, commandName),
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    is_system: !!isSystem,
    system_key: systemKey,
    execution_mode: executionMode,
    action_type: actionType,
    action_config: actionConfig,
    enabled: typeof body.enabled === 'boolean'
      ? body.enabled
      : !!(currentCommand?.enabled ?? true),
    description: String(body.description ?? currentCommand?.description ?? actionDefaults?.description ?? '').trim(),
    aliases: normalizeAliases(body.aliases ?? currentCommand?.aliases ?? [], trigger, currentCommand?.trigger),
    response: String(body.response ?? currentCommand?.response ?? actionDefaults?.response ?? '').trim(),
    response_mode: responseMode,
    reply_in_dm: responseMode === 'dm' ? 1 : 0,
    delete_trigger: resolveBooleanFlag(body.delete_trigger, currentCommand?.delete_trigger ?? actionDefaults?.delete_trigger),
    allowed_roles: normalizeIdArray(body.allowed_roles ?? currentCommand?.allowed_roles ?? []),
    allowed_channels: normalizeIdArray(body.allowed_channels ?? currentCommand?.allowed_channels ?? []),
    cooldown_ms: Number(body.cooldown_ms ?? currentCommand?.cooldown_ms ?? actionDefaults?.cooldown_ms ?? 0),
    delete_response_after_ms: Number(body.delete_response_after_ms ?? currentCommand?.delete_response_after_ms ?? 0),
    embed_enabled: resolveBooleanFlag(body.embed_enabled, currentCommand?.embed_enabled ?? actionDefaults?.embed_enabled),
    embed_title: String(body.embed_title ?? currentCommand?.embed_title ?? actionDefaults?.embed_title ?? '').trim(),
    embed_color: normalizeColor(body.embed_color ?? currentCommand?.embed_color ?? actionDefaults?.embed_color ?? '#22d3ee'),
    mention_user: resolveBooleanFlag(body.mention_user, currentCommand?.mention_user ?? actionDefaults?.mention_user),
    require_args: resolveBooleanFlag(body.require_args, currentCommand?.require_args ?? actionDefaults?.require_args),
    usage_hint: String(body.usage_hint ?? currentCommand?.usage_hint ?? actionDefaults?.usage_hint ?? '').trim(),
  };
}

function normalizeSystemUpdatePayload(body, currentCommand) {
  return normalizePayload({
    ...body,
    trigger: currentCommand.trigger,
    command_type: currentCommand.command_type,
    command_prefix: currentCommand.command_prefix,
    command_name: currentCommand.command_name,
    is_system: true,
    system_key: currentCommand.system_key,
    execution_mode: 'native',
    action_type: currentCommand.action_type,
    aliases: currentCommand.aliases,
    allowed_roles: currentCommand.allowed_roles,
    allowed_channels: currentCommand.allowed_channels,
    delete_trigger: false,
  }, currentCommand);
}

function ensureDefaultCommandsForGuild(guildId) {
  const existingRows = db.raw(
    'SELECT * FROM custom_commands WHERE guild_id = ? AND is_system = 1',
    [guildId]
  );
  const existingByKey = new Map(
    existingRows.map((row) => [normalizeSystemKey(row.system_key), mapCommandRow(row)])
  );

  for (const definition of DEFAULT_SYSTEM_COMMANDS) {
    const current = existingByKey.get(definition.system_key) || null;
    const payload = normalizePayload({
      trigger: buildCommandTrigger(definition.command_type, definition.command_prefix, definition.command_name),
      command_type: definition.command_type,
      command_prefix: definition.command_prefix,
      command_name: definition.command_name,
      is_system: true,
      system_key: definition.system_key,
      execution_mode: 'native',
      action_type: definition.action_type,
      action_config: current?.action_config || definition.action_config,
      enabled: current ? current.enabled : !!definition.enabled,
      description: definition.description,
      response: definition.response,
      response_mode: definition.response_mode,
      embed_enabled: definition.embed_enabled,
      embed_title: definition.embed_title,
      embed_color: definition.embed_color,
      mention_user: definition.mention_user,
      require_args: definition.require_args,
      delete_trigger: definition.delete_trigger,
      cooldown_ms: definition.cooldown_ms,
      usage_hint: definition.usage_hint,
    }, current);

    saveCommand(guildId, payload, current?.id || null);
  }
}

function findCommandCollision(guildId, trigger, aliases, ignoreId = null) {
  const taken = new Map();
  const commands = db.raw('SELECT id, trigger, aliases FROM custom_commands WHERE guild_id = ?', [guildId]);

  for (const row of commands) {
    if (ignoreId && row.id === ignoreId) continue;
    const keys = [row.trigger, ...parseJsonArray(row.aliases)];
    for (const key of keys) {
      const normalized = normalizeTrigger(key).toLowerCase();
      if (normalized) taken.set(normalized, row.id);
    }
  }

  for (const key of [trigger, ...aliases]) {
    const normalized = normalizeTrigger(key).toLowerCase();
    if (normalized && taken.has(normalized)) return key;
  }

  return null;
}

function enableCommandsModule(internalGuildId) {
  db.db.prepare(
    `UPDATE modules
     SET enabled = 1, updated_at = ?
     WHERE guild_id = ? AND module_type = 'CUSTOM_COMMANDS'`
  ).run(new Date().toISOString(), internalGuildId);
}

async function syncCommandState(userId, discordGuildId) {
  botManager.invalidateModuleCache(userId, discordGuildId);
  await botManager.syncCommandDefinitions(userId, discordGuildId);
}

function scheduleCommandSync(userId, discordGuildId) {
  const key = `${userId}:${discordGuildId}`;
  const existing = scheduledCommandSyncs.get(key) || {
    timer: null,
    running: false,
    queued: false,
  };

  if (existing.running) {
    existing.queued = true;
    scheduledCommandSyncs.set(key, existing);
    return;
  }

  if (existing.timer) {
    clearTimeout(existing.timer);
  }

  existing.timer = setTimeout(async () => {
    const state = scheduledCommandSyncs.get(key) || existing;
    state.timer = null;
    if (state.running) {
      state.queued = true;
      scheduledCommandSyncs.set(key, state);
      return;
    }

    state.running = true;
    scheduledCommandSyncs.set(key, state);

    try {
      await syncCommandState(userId, discordGuildId);
    } catch (error) {
      logger.warn('Command sync failed after update', {
        userId,
        discordGuildId,
        error: error?.message || 'Unknown error',
      });
    } finally {
      const latest = scheduledCommandSyncs.get(key) || state;
      latest.running = false;

      if (latest.queued) {
        latest.queued = false;
        scheduledCommandSyncs.set(key, latest);
        scheduleCommandSync(userId, discordGuildId);
      } else if (!latest.timer) {
        scheduledCommandSyncs.delete(key);
      } else {
        scheduledCommandSyncs.set(key, latest);
      }
    }
  }, 350);

  scheduledCommandSyncs.set(key, existing);
}

function logCommandSiteAction(req, actionLabel, command, details = []) {
  const label = command?.display_trigger || command?.trigger || command?.command_name || 'Commande';
  logBotEvent(req.user.id, req.guild.id, 'info', 'site_action', `${req.user.username} - ${actionLabel} - ${label}`, {
    action: actionLabel,
    action_label: actionLabel,
    actor_name: req.user.username,
    actor_user_id: req.user.id,
    target_label: label,
    command_id: command?.id || null,
    command_trigger: command?.display_trigger || command?.trigger || null,
    command_type: command?.command_type || null,
    details,
  });
}

function extractCommandDraft(text) {
  const parsed = extractLargestJsonObject(text);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function generateRandomSeed() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let seed = '';
  for (let i = 0; i < 10; i++) seed += chars[Math.floor(Math.random() * chars.length)];
  return `${seed}-${Date.now().toString(36)}`;
}

function extractUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s<>"']+/gi);
  return [...new Set((matches || []).map((entry) => entry.trim()).filter(Boolean))];
}

function textContainsAny(text, keywords = []) {
  const source = String(text || '').toLowerCase();
  return keywords.some((keyword) => source.includes(String(keyword || '').toLowerCase()));
}

function promptRequestsMediaShare(value) {
  return textContainsAny(value, [
    'image',
    'photo',
    'gif',
    'illustration',
    'logo',
    'banner',
    'avatar',
    'thumbnail',
    'poster',
    'wallpaper',
    'meme',
    'affiche cette image',
    'afficher cette image',
    'envoie cette image',
    'envoyer cette image',
    'poste cette image',
    'montrer cette image',
    'send this image',
    'show this image',
    'post this image',
    'display this image',
    'manda esta imagen',
    'muestra esta imagen',
    'envia esta imagen',
  ]);
}

function promptRequestsOnlyMedia(value) {
  return textContainsAny(value, [
    'envoie cette image',
    'envoyer cette image',
    'affiche cette image',
    'afficher cette image',
    'poste cette image',
    'send this image',
    'show this image',
    'display this image',
    'manda esta imagen',
    'muestra esta imagen',
    'envia esta imagen',
    'uniquement le lien',
    'juste le lien',
    'only the link',
    'solo el enlace',
  ]);
}

function responseContainsAnyUrl(response, urls) {
  const text = String(response || '');
  return urls.some((url) => text.includes(url));
}

function enforceDraftIntent(draft, userPrompt) {
  if (!draft || typeof draft !== 'object') return draft;

  const nextDraft = { ...draft };
  const urls = extractUrls(userPrompt);

  if (urls.length && promptRequestsMediaShare(userPrompt) && !responseContainsAnyUrl(nextDraft.response, urls)) {
    const primaryUrl = urls[0];
    const mustSendOnlyMedia = promptRequestsOnlyMedia(userPrompt);
    const currentResponse = String(nextDraft.response || '').trim();

    nextDraft.response = mustSendOnlyMedia
      ? primaryUrl
      : (currentResponse ? `${currentResponse}\n${primaryUrl}` : primaryUrl);

    if (!String(nextDraft.description || '').trim()) {
      nextDraft.description = 'Envoie le media demande';
    }

    if (mustSendOnlyMedia) {
      nextDraft.embed_enabled = false;
      nextDraft.embed_title = '';
    }
  }

  return nextDraft;
}

function detectPromptLocale(text = '', fallback = 'fr') {
  const value = String(text || '').toLowerCase();
  if (/[¿¡]|\b(comando|mensajes|ticket|abre|panel)\b/.test(value)) return 'es';
  if (/\b(command|messages|ticket|open|panel|please|create)\b/.test(value)) return 'en';
  return fallback;
}

function buildNativeAssistantReply(actionType, locale = 'fr', updated = false) {
  const key = detectPromptLocale(locale, locale);
  const copy = {
    fr: {
      clear_messages: updated
        ? 'Commande native de suppression renforcee et prete a executer.'
        : 'Commande native de suppression prete avec une vraie execution Discord.',
      ticket_panel: updated
        ? 'Panel de tickets natif mis a jour et pret a publier.'
        : 'Panel de tickets natif prepare avec ouverture de tickets prives.',
    },
    en: {
      clear_messages: updated
        ? 'Native clear command upgraded and ready to run.'
        : 'Native clear command prepared with real Discord execution.',
      ticket_panel: updated
        ? 'Native ticket panel updated and ready to publish.'
        : 'Native ticket panel prepared with private ticket opening.',
    },
    es: {
      clear_messages: updated
        ? 'Comando nativo de limpieza mejorado y listo para ejecutar.'
        : 'Comando nativo de limpieza preparado con ejecucion real en Discord.',
      ticket_panel: updated
        ? 'Panel nativo de tickets actualizado y listo para publicar.'
        : 'Panel nativo de tickets preparado con apertura privada.',
    },
  };

  return copy[key]?.[actionType] || copy.fr[actionType] || 'Commande native preparee.';
}

function matchesIntentPattern(text = '', pattern) {
  return pattern.test(String(text || '').toLowerCase());
}

function promptMatchesClearIntent(text = '') {
  return textContainsAny(text, [
    'clear',
    'purge',
    'vider le salon',
    'vider le chat',
    'supprime les messages',
    'supprimer des messages',
    'efface les messages',
    'bulk delete',
    'clean messages',
    'delete messages',
    'borrar mensajes',
    'limpiar mensajes',
    'purga',
  ]);
}

function promptMatchesTicketIntent(text = '') {
  return textContainsAny(text, [
    'ticket',
    'tickets',
    'panel ticket',
    'panel de ticket',
    'panel de tickets',
    'ticket panel',
    'support panel',
    'helpdesk',
    'ouvrir un ticket',
    'open a ticket',
    'crear ticket',
    'panel soporte',
  ]);
}

function promptMatchesUnbanIntent(text = '') {
  return matchesIntentPattern(text, /\b(unban|deban)\b|retir(?:e|er)\s+un\s+ban|lever\s+un\s+ban/);
}

function promptMatchesBanIntent(text = '') {
  return matchesIntentPattern(text, /(^|\s)ban(\s|$)|banni(?:r|t)|bannissement/);
}

function promptMatchesBlacklistIntent(text = '') {
  return matchesIntentPattern(text, /\bblacklist\b|blacklist(?:er)?|liste\s+noire|ban\s+reseau|network\s+blacklist/);
}

function promptMatchesKickIntent(text = '') {
  return matchesIntentPattern(text, /\bkick\b|expuls(?:e|er|ion)/);
}

function promptMatchesSoftbanIntent(text = '') {
  return matchesIntentPattern(text, /\bsoftban\b|ban\s+puis\s+deban|temp\s*ban\s+cleanup/);
}

function promptMatchesTimeoutIntent(text = '') {
  return matchesIntentPattern(text, /\btimeout\b|\btempmute\b|mute\s+temporaire|mettre.*timeout/);
}

function promptMatchesUntimeoutIntent(text = '') {
  return matchesIntentPattern(text, /\bunmute\b|retir(?:e|er).*timeout|lever.*mute|untimeout/);
}

function promptMatchesWarnIntent(text = '') {
  return matchesIntentPattern(text, /\bwarn\b|avertissement|warning/);
}

function promptMatchesUnblacklistIntent(text = '') {
  return matchesIntentPattern(text, /\bunblacklist\b|retir(?:e|er).*blacklist|sortir.*liste\s+noire|remove.*blacklist/);
}

function promptMatchesAddRoleIntent(text = '') {
  return matchesIntentPattern(text, /\baddrole\b|ajout(?:e|er).*\brole\b|donn(?:e|er).*\brole\b|assign.*role/);
}

function promptMatchesRemoveRoleIntent(text = '') {
  return matchesIntentPattern(text, /\bremoverole\b|retir(?:e|er).*\brole\b|enleve.*\brole\b|remove.*role/);
}

function promptMatchesNicknameIntent(text = '') {
  return matchesIntentPattern(text, /\bnick\b|nickname|changer.*pseudo|change.*nickname/);
}

function promptMatchesLockIntent(text = '') {
  return matchesIntentPattern(text, /\block\b|verrouill(?:e|er).*\bsalon\b|fermer.*\bsalon\b|close.*channel/);
}

function promptMatchesUnlockIntent(text = '') {
  return matchesIntentPattern(text, /\bunlock\b|deverrouill(?:e|er).*\bsalon\b|ouvrir.*\bsalon\b|open.*channel/);
}

function promptMatchesSlowmodeIntent(text = '') {
  return matchesIntentPattern(text, /\bslowmode\b|mode\s+lent|ralentir.*\bsalon\b/);
}

function promptMatchesSayIntent(text = '') {
  return matchesIntentPattern(text, /\bsay\b|fait\s+parler\s+le\s+bot|envoy(?:e|er)\s+un\s+message\s+via\s+le\s+bot|make\s+the\s+bot\s+say/);
}

function promptMatchesAnnounceIntent(text = '') {
  return matchesIntentPattern(text, /\bannounce\b|annonce|broadcast/);
}

function promptMatchesMoveIntent(text = '') {
  return matchesIntentPattern(text, /\bmove\b|deplac(?:e|er).*\bmembre\b|move.*voice|deplac(?:e|er).*\bvocal\b/);
}

function promptMatchesDisconnectIntent(text = '') {
  return matchesIntentPattern(text, /\bdisconnect\b|deconnect(?:e|er).*\bvocal\b|kick.*voice|deco.*membre/);
}

function extractPromptInteger(text = '', minimum = 1, maximum = 100) {
  const matches = String(text || '').match(/\b\d{1,4}\b/g) || [];
  const values = matches
    .map((entry) => Number(entry))
    .filter((value) => Number.isFinite(value) && value >= minimum && value <= maximum);

  return values.length ? values[0] : null;
}

function buildNativeDraftFromIntent(actionType, { prompt, mode, requestedCommandName, currentCommand }) {
  const defaults = buildNativeActionDefaults(actionType, mode, currentCommand);
  if (!defaults) return null;
  const slashOnlyActionTypes = new Set([
    COMMAND_ACTION_TYPES.BAN_MEMBER,
    COMMAND_ACTION_TYPES.BLACKLIST_MEMBER,
    COMMAND_ACTION_TYPES.KICK_MEMBER,
    COMMAND_ACTION_TYPES.SOFTBAN_MEMBER,
    COMMAND_ACTION_TYPES.TIMEOUT_MEMBER,
    COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER,
    COMMAND_ACTION_TYPES.WARN_MEMBER,
    COMMAND_ACTION_TYPES.UNBAN_MEMBER,
    COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER,
    COMMAND_ACTION_TYPES.ADD_ROLE,
    COMMAND_ACTION_TYPES.REMOVE_ROLE,
    COMMAND_ACTION_TYPES.SET_NICKNAME,
    COMMAND_ACTION_TYPES.LOCK_CHANNEL,
    COMMAND_ACTION_TYPES.UNLOCK_CHANNEL,
    COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL,
    COMMAND_ACTION_TYPES.SAY_MESSAGE,
    COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE,
    COMMAND_ACTION_TYPES.MOVE_MEMBER,
    COMMAND_ACTION_TYPES.DISCONNECT_MEMBER,
  ]);
  if (mode !== 'slash' && slashOnlyActionTypes.has(actionType)) return null;

  const commandNameFallbackMap = {
    [COMMAND_ACTION_TYPES.CLEAR_MESSAGES]: 'clear',
    [COMMAND_ACTION_TYPES.TICKET_PANEL]: 'tickets',
    [COMMAND_ACTION_TYPES.BAN_MEMBER]: 'ban',
    [COMMAND_ACTION_TYPES.BLACKLIST_MEMBER]: 'blacklist',
    [COMMAND_ACTION_TYPES.KICK_MEMBER]: 'kick',
    [COMMAND_ACTION_TYPES.SOFTBAN_MEMBER]: 'softban',
    [COMMAND_ACTION_TYPES.TIMEOUT_MEMBER]: 'tempmute',
    [COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER]: 'unmute',
    [COMMAND_ACTION_TYPES.WARN_MEMBER]: 'warn',
    [COMMAND_ACTION_TYPES.UNBAN_MEMBER]: 'unban',
    [COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER]: 'unblacklist',
    [COMMAND_ACTION_TYPES.ADD_ROLE]: 'addrole',
    [COMMAND_ACTION_TYPES.REMOVE_ROLE]: 'removerole',
    [COMMAND_ACTION_TYPES.SET_NICKNAME]: 'nick',
    [COMMAND_ACTION_TYPES.LOCK_CHANNEL]: 'lock',
    [COMMAND_ACTION_TYPES.UNLOCK_CHANNEL]: 'unlock',
    [COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL]: 'slowmode',
    [COMMAND_ACTION_TYPES.SAY_MESSAGE]: 'say',
    [COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE]: 'announce',
    [COMMAND_ACTION_TYPES.MOVE_MEMBER]: 'move',
    [COMMAND_ACTION_TYPES.DISCONNECT_MEMBER]: 'disconnect',
  };
  const commandNameFallback = commandNameFallbackMap[actionType] || 'commande';
  const requestedName = sanitizeCommandName(requestedCommandName || currentCommand?.command_name || commandNameFallback, mode);

  return {
    ...defaults,
    command_name: requestedName || commandNameFallback,
  };
}

function inferNativeActionDraft({ prompt, mode, requestedCommandName, currentCommand }) {
  if (currentCommand?.execution_mode === 'native' && currentCommand?.action_type) {
    return buildNativeDraftFromIntent(currentCommand.action_type, {
      prompt,
      mode,
      requestedCommandName,
      currentCommand,
    });
  }

  const intentMatchers = [
    [COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER, promptMatchesUnblacklistIntent],
    [COMMAND_ACTION_TYPES.UNBAN_MEMBER, promptMatchesUnbanIntent],
    [COMMAND_ACTION_TYPES.BLACKLIST_MEMBER, promptMatchesBlacklistIntent],
    [COMMAND_ACTION_TYPES.BAN_MEMBER, promptMatchesBanIntent],
    [COMMAND_ACTION_TYPES.KICK_MEMBER, promptMatchesKickIntent],
    [COMMAND_ACTION_TYPES.SOFTBAN_MEMBER, promptMatchesSoftbanIntent],
    [COMMAND_ACTION_TYPES.TIMEOUT_MEMBER, promptMatchesTimeoutIntent],
    [COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER, promptMatchesUntimeoutIntent],
    [COMMAND_ACTION_TYPES.WARN_MEMBER, promptMatchesWarnIntent],
    [COMMAND_ACTION_TYPES.ADD_ROLE, promptMatchesAddRoleIntent],
    [COMMAND_ACTION_TYPES.REMOVE_ROLE, promptMatchesRemoveRoleIntent],
    [COMMAND_ACTION_TYPES.SET_NICKNAME, promptMatchesNicknameIntent],
    [COMMAND_ACTION_TYPES.LOCK_CHANNEL, promptMatchesLockIntent],
    [COMMAND_ACTION_TYPES.UNLOCK_CHANNEL, promptMatchesUnlockIntent],
    [COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL, promptMatchesSlowmodeIntent],
    [COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE, promptMatchesAnnounceIntent],
    [COMMAND_ACTION_TYPES.SAY_MESSAGE, promptMatchesSayIntent],
    [COMMAND_ACTION_TYPES.MOVE_MEMBER, promptMatchesMoveIntent],
    [COMMAND_ACTION_TYPES.DISCONNECT_MEMBER, promptMatchesDisconnectIntent],
    [COMMAND_ACTION_TYPES.CLEAR_MESSAGES, promptMatchesClearIntent],
    [COMMAND_ACTION_TYPES.TICKET_PANEL, promptMatchesTicketIntent],
  ];

  for (const [actionType, matcher] of intentMatchers) {
    if (!matcher(prompt)) continue;
    const draft = buildNativeDraftFromIntent(actionType, {
      prompt,
      mode,
      requestedCommandName,
      currentCommand,
    });
    if (draft) return draft;
  }

  return null;
}

function mergeDraftWithIntent(aiDraft, inferredDraft, userPrompt) {
  if (!inferredDraft) {
    return enforceDraftIntent(aiDraft, userPrompt);
  }

  const next = {
    ...inferredDraft,
    action_config: { ...(inferredDraft.action_config || {}) },
  };

  if (!aiDraft || typeof aiDraft !== 'object') {
    return next;
  }

  const safeDraft = enforceDraftIntent(aiDraft, userPrompt) || {};

  if (safeDraft.command_name) next.command_name = safeDraft.command_name;
  if (safeDraft.description) next.description = String(safeDraft.description).trim().slice(0, 100);
  if (safeDraft.response) next.response = String(safeDraft.response).trim().slice(0, 2000);
  if (['channel', 'reply', 'dm'].includes(safeDraft.response_mode)) next.response_mode = safeDraft.response_mode;
  if (typeof safeDraft.embed_enabled === 'boolean') next.embed_enabled = safeDraft.embed_enabled;
  if (safeDraft.embed_title !== undefined) next.embed_title = String(safeDraft.embed_title || '').trim().slice(0, 256);
  if (safeDraft.embed_color) next.embed_color = normalizeColor(safeDraft.embed_color);
  if (safeDraft.mention_user !== undefined) next.mention_user = !!safeDraft.mention_user;
  if (safeDraft.usage_hint !== undefined) next.usage_hint = String(safeDraft.usage_hint || '').trim().slice(0, 200);
  if (safeDraft.require_args !== undefined) next.require_args = !!safeDraft.require_args;
  if (safeDraft.delete_trigger !== undefined) next.delete_trigger = !!safeDraft.delete_trigger;
  if (safeDraft.cooldown_ms !== undefined) next.cooldown_ms = Number(safeDraft.cooldown_ms || 0);
  if (safeDraft.action_config && typeof safeDraft.action_config === 'object' && !Array.isArray(safeDraft.action_config)) {
    next.action_config = normalizeActionConfig(next.action_type, safeDraft.action_config, next.action_config);
  }

  next.execution_mode = 'native';
  next.action_type = inferredDraft.action_type;
  return next;
}

const VARIETY_OPENERS = [
  'Start with an emoji and a creative one-liner.',
  'Begin with a punchy metaphor or analogy.',
  'Open with a surprising fun fact related to the command.',
  'Start with a direct, confident statement.',
  'Begin with a question that you immediately answer.',
  'Open with a brief compliment about the user\'s idea.',
  'Start with a short analogy from gaming or pop culture.',
  'Begin by noting something clever about the command concept.',
];

function buildAssistantSystemPrompt({ guildName, mode, prefix, requestedTrigger, requestedCommandName, existingCommand }) {
  const existingBlock = existingCommand
    ? `
COMMANDE EXISTANTE A MODIFIER:
- Declencheur: ${existingCommand.display_trigger}
- Description: ${existingCommand.description || '(aucune)'}
- Execution: ${existingCommand.execution_mode || 'response'}
- Action native: ${existingCommand.action_type || 'aucune'}
- Reponse actuelle: ${existingCommand.response}
- Mode: ${existingCommand.response_mode}
- Embed: ${existingCommand.embed_enabled ? 'oui' : 'non'}`
    : '';
  const requestedBlock = mode === 'slash'
    ? (requestedCommandName ? `\nCommande slash demandee: /${requestedCommandName}` : '')
    : (requestedTrigger
      ? `\nDeclencheur texte demande: ${requestedTrigger}`
      : (prefix ? `\nPrefixe demande: ${prefix}` : ''));

  const randomSeed = generateRandomSeed();
  const creativityIndex = Math.floor(Math.random() * 100);

  return `Tu es DiscordForger Command Builder, expert en creation de commandes Discord reelles.
Tu construis des commandes fonctionnelles immediatement, sans hors-contexte.

CONTEXTE:
- Serveur: ${guildName}
- Mode: ${mode}
${mode === 'slash' ? '- Type: Commande slash Discord (/)' : `- Prefixe: ${prefix || '!'}`}
${requestedBlock}
${existingBlock}

SEED: ${randomSeed}
CREATIVITE: ${creativityIndex}

CAPACITES DU SYSTEME:
- Mode "response": commande classique qui envoie une reponse texte ou embed
- Mode "native": commande executee reellement par le bot
- Action native clear_messages: supprime vraiment des messages, slash avec option amount, prefixe avec nombre en argument
- Action native ticket_panel: publie vraiment un panel avec bouton et ouvre un salon ticket prive
- Action native ban_member: bannit vraiment un membre avec raison
- Action native kick_member: expulse vraiment un membre avec raison
- Action native timeout_member: applique vraiment un timeout
- Action native untimeout_member: retire vraiment un timeout
- Action native warn_member: ajoute vraiment un avertissement
- Action native unban_member: retire vraiment un ban via user_id
- Action native add_role / remove_role: gere vraiment les roles d un membre
- Action native set_nickname: change vraiment le pseudo d un membre
- Action native lock_channel / unlock_channel: verrouille ou deverrouille vraiment un salon texte
- Action native slowmode_channel: regle vraiment le slowmode d un salon
- Action native say_message: fait vraiment parler le bot dans un salon
- Action native announce_message: publie vraiment une annonce en embed
- Action native move_member: deplace vraiment un membre vers un vocal
- Contenu variable avec [[random: option1 || option2 || option3]]
- Contenu combo avec [[combo: intro1 || intro2 :: corps1 || corps2 :: fin1 || fin2]]
- Placeholders: {mention} {username} {server} {channel} {memberCount} {args} {arg1} {arg2}

CHAMPS JSON AUTORISES UNIQUEMENT:
- command_name (string, obligatoire)
- description (string, max 100 chars)
- execution_mode ("response" | "native")
- action_type ("" | "clear_messages" | "ticket_panel" | "ban_member" | "blacklist_member" | "kick_member" | "softban_member" | "timeout_member" | "untimeout_member" | "warn_member" | "unban_member" | "unblacklist_member" | "add_role" | "remove_role" | "set_nickname" | "lock_channel" | "unlock_channel" | "slowmode_channel" | "say_message" | "announce_message" | "move_member" | "disconnect_member")
- action_config (object)
- response (string, max 2000 chars, obligatoire)
- response_mode ("channel" | "reply" | "dm")
- embed_enabled (boolean)
- embed_title (string)
- embed_color (hex string comme "#22d3ee")
- mention_user (boolean)
- usage_hint (string)
- require_args (boolean)
- delete_trigger (boolean)
- cooldown_ms (number)

REGLES CRITIQUES:

1. **PRECISION ABSOLUE**: Fais EXACTEMENT ce que l'utilisateur demande. Pas d'interpretation creative si la demande est claire.

2. **SI L'UTILISATEUR DONNE UNE URL/IMAGE/LIEN**: Tu DOIS l'inclure tel quel dans la reponse. Ne remplace JAMAIS un lien par du texte creatif.

3. **SI L'UTILISATEUR DEMANDE "envoie cette image [URL]"**: La reponse doit etre uniquement l'URL, pas un texte autour.

4. **COMMANDE SLASH**: command_name doit etre en minuscules, sans espaces, sans accents, compatible Discord (a-z, 0-9, -, _).

5. **COMMANDE PREFIXE**: Respecte le prefixe demande (!, ?, $, etc.).

6. **MODIFICATION**: Si tu modifies une commande existante, applique UNIQUEMENT le changement demande. Ne reinvente pas toute la commande.

7. **FORMAT DE SORTIE**: 
   - D'abord une courte explication (1-2 phrases max)
   - Puis exactement UN bloc \`\`\`command avec du JSON valide
   - Rien apres le bloc command

8. **PAS DE CODE**: Jamais de JavaScript, Discord.js, webhooks ou code brut. Tu renvoies seulement une spec JSON.

9. **CONTENU VARIABLE**: Pour blagues/citations/faits, utilise [[random: ...]] avec au moins 8-10 options VRAIMENT differentes.

10. **UTILISE LE NATIF QUAND C'EST SUPPORTE**:
   - clear / purge / suppression de messages => execution_mode = "native", action_type = "clear_messages"
   - ticket / panel ticket / support => execution_mode = "native", action_type = "ticket_panel"
   - ban / blacklist / kick / softban / tempmute / unmute / warn / unban / unblacklist => utilise les actions natives de moderation
   - addrole / removerole / nick / lock / unlock / slowmode / say / announce / move / disconnect => utilise les actions natives correspondantes
   - NE REPONDS PAS "je ne peux pas" pour ces cas, ils sont supportes.

11. **LANGUE**: Reponds dans la langue de l'utilisateur.

12. **TRIGGER DEMANDE**: Si un nom de commande ou trigger est explicitement demande, utilise-le EXACTEMENT.

EXEMPLES DE REPONSES CORRECTES:

Demande: "cree une commande bonjour qui dit bonjour"
Reponse:
Commande bonjour creee !
\`\`\`command
{"command_name":"bonjour","description":"Salue l'utilisateur","response":"Bonjour {mention} !","response_mode":"reply","embed_enabled":false}
\`\`\`

Demande: "envoie cette image https://exemple.com/image.png"
Reponse:
Commande prete pour envoyer l'image.
\`\`\`command
{"command_name":"image","description":"Envoie l'image","response":"https://exemple.com/image.png","response_mode":"channel","embed_enabled":false}
\`\`\`

Demande: "commande blague qui raconte une blague"
Reponse:
Commande blague avec variations !
\`\`\`command
{"command_name":"blague","description":"Raconte une blague aleatoire","response":"[[random: Pourquoi les plongeurs plongent en arriere ? Parce que sinon ils tomberaient dans le bateau ! || Qu'est-ce qu'un crocodile qui surveille ? Un croco-vigile ! || Comment appelle-t-on un chat tombe dans un pot de peinture ? Un chat-peint ! || ...]]","response_mode":"reply","embed_enabled":false}
\`\`\`

Demande: "cree un slash clear qui supprime des messages"
Reponse:
Commande slash native prete.
\`\`\`command
{"command_name":"clear","execution_mode":"native","action_type":"clear_messages","action_config":{"min_amount":1,"max_amount":100},"description":"Supprime un lot de messages","response":"Supprime un nombre precis de messages dans le salon courant.","response_mode":"reply","embed_enabled":false,"usage_hint":"/clear amount:20","require_args":false,"delete_trigger":false,"cooldown_ms":3000}
\`\`\`

Demande: "fais un panel de tickets"
Reponse:
Panel tickets natif pret.
\`\`\`command
{"command_name":"tickets","execution_mode":"native","action_type":"ticket_panel","action_config":{"button_label":"Ouvrir un ticket","button_emoji":"🎫","ticket_name_template":"ticket-{username}","welcome_message":"Bonjour {mention}, decris ici ta demande et un membre du staff te repondra.","close_message":"Ticket ferme par {closer}.","support_role_ids":[],"category_id":"","prevent_duplicates":true},"description":"Publie un panel de tickets interactif","response":"Appuie sur le bouton ci-dessous pour ouvrir un ticket prive avec le staff.","response_mode":"channel","embed_enabled":true,"embed_title":"Support & tickets","embed_color":"#7c3aed","usage_hint":"/tickets","require_args":false,"delete_trigger":false,"cooldown_ms":1500}
\`\`\``;
}

function normalizeAssistantDraft(draft, mode, prefix, currentCommand = null, requested = {}) {
  const commandType = normalizeCommandType(mode);
  const requestedMeta = resolveRequestedCommandMeta({
    mode,
    prefix,
    trigger: requested.trigger,
    command_name: requested.command_name,
  });
  const commandPrefix = commandType === 'slash'
    ? '/'
    : (requestedMeta.command_prefix || normalizeCommandPrefix(prefix || currentCommand?.command_prefix || '!'));
  const commandName = requestedMeta.command_name || sanitizeCommandName(
    draft?.command_name || currentCommand?.command_name || 'commande',
    commandType
  );
  const trigger = requestedMeta.trigger || buildCommandTrigger(commandType, commandPrefix, commandName);
  const actionType = normalizeActionType(draft?.action_type ?? currentCommand?.action_type ?? '');
  const executionMode = normalizeExecutionMode(draft?.execution_mode ?? currentCommand?.execution_mode, actionType);
  const nativeDefaults = executionMode === 'native'
    ? buildNativeActionDefaults(actionType, commandType, currentCommand)
    : null;

  return normalizePayload({
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    trigger,
    execution_mode: executionMode,
    action_type: actionType,
    action_config: draft?.action_config ?? currentCommand?.action_config ?? nativeDefaults?.action_config ?? {},
    description: String(draft?.description ?? '').trim().slice(0, 100) || String(currentCommand?.description || nativeDefaults?.description || '').trim().slice(0, 100),
    response: String(draft?.response ?? '').trim().slice(0, 2000) || String(currentCommand?.response || nativeDefaults?.response || '').trim().slice(0, 2000),
    response_mode: ['channel', 'reply', 'dm'].includes(draft?.response_mode) ? draft.response_mode : (currentCommand?.response_mode || nativeDefaults?.response_mode || 'reply'),
    embed_enabled: typeof draft?.embed_enabled === 'boolean' ? draft.embed_enabled : (currentCommand?.embed_enabled ?? nativeDefaults?.embed_enabled ?? false),
    embed_title: String(draft?.embed_title ?? currentCommand?.embed_title ?? nativeDefaults?.embed_title ?? '').trim().slice(0, 256),
    embed_color: normalizeColor(draft?.embed_color ?? currentCommand?.embed_color ?? nativeDefaults?.embed_color ?? '#22d3ee'),
    mention_user: draft?.mention_user ?? currentCommand?.mention_user ?? nativeDefaults?.mention_user ?? false,
    delete_trigger: draft?.delete_trigger ?? currentCommand?.delete_trigger ?? nativeDefaults?.delete_trigger ?? false,
    allowed_roles: [],
    allowed_channels: [],
    aliases: [],
    cooldown_ms: Number(draft?.cooldown_ms ?? currentCommand?.cooldown_ms ?? nativeDefaults?.cooldown_ms ?? 0),
    delete_response_after_ms: 0,
    require_args: draft?.require_args ?? currentCommand?.require_args ?? nativeDefaults?.require_args ?? false,
    usage_hint: String(draft?.usage_hint ?? currentCommand?.usage_hint ?? nativeDefaults?.usage_hint ?? '').trim().slice(0, 200),
  }, currentCommand);
}

function saveCommand(guildId, payload, currentId = null) {
  const now = new Date().toISOString();

  if (currentId) {
    const updates = {
      trigger: payload.trigger,
      command_type: payload.command_type,
      command_prefix: payload.command_prefix,
      command_name: payload.command_name,
      is_system: payload.is_system ? 1 : 0,
      system_key: payload.system_key || '',
      enabled: payload.enabled ? 1 : 0,
      execution_mode: payload.execution_mode,
      action_type: payload.action_type,
      action_config: JSON.stringify(payload.action_config || {}),
      description: payload.description,
      response: payload.response,
      reply_in_dm: payload.reply_in_dm,
      response_mode: payload.response_mode,
      delete_trigger: payload.delete_trigger,
      allowed_roles: JSON.stringify(payload.allowed_roles),
      allowed_channels: JSON.stringify(payload.allowed_channels),
      aliases: JSON.stringify(payload.aliases),
      cooldown_ms: payload.cooldown_ms,
      delete_response_after_ms: payload.delete_response_after_ms,
      embed_enabled: payload.embed_enabled,
      embed_title: payload.embed_title,
      embed_color: payload.embed_color,
      mention_user: payload.mention_user,
      require_args: payload.require_args,
      usage_hint: payload.usage_hint,
      updated_at: now,
    };

    const keys = Object.keys(updates);
    db.db.prepare(
      `UPDATE custom_commands SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`
    ).run(...Object.values(updates), currentId);

    return currentId;
  }

  const id = uuidv4();
  db.insert('custom_commands', {
    id,
    guild_id: guildId,
    trigger: payload.trigger,
    command_type: payload.command_type,
    command_prefix: payload.command_prefix,
    command_name: payload.command_name,
    is_system: payload.is_system ? 1 : 0,
    system_key: payload.system_key || '',
    enabled: payload.enabled ? 1 : 0,
    execution_mode: payload.execution_mode,
    action_type: payload.action_type,
    action_config: JSON.stringify(payload.action_config || {}),
    description: payload.description,
    response: payload.response,
    reply_in_dm: payload.reply_in_dm,
    response_mode: payload.response_mode,
    delete_trigger: payload.delete_trigger,
    allowed_roles: JSON.stringify(payload.allowed_roles),
    allowed_channels: JSON.stringify(payload.allowed_channels),
    aliases: JSON.stringify(payload.aliases),
    cooldown_ms: payload.cooldown_ms,
    delete_response_after_ms: payload.delete_response_after_ms,
    embed_enabled: payload.embed_enabled,
    embed_title: payload.embed_title,
    embed_color: payload.embed_color,
    mention_user: payload.mention_user,
    require_args: payload.require_args,
    usage_hint: payload.usage_hint,
    created_at: now,
    updated_at: now,
  });

  return id;
}

router.get('/', (req, res) => {
  ensureDefaultCommandsForGuild(req.guild.id);
  scheduleCommandSync(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  const commands = db.raw(
    `SELECT * FROM custom_commands
     WHERE guild_id = ?
     ORDER BY is_system DESC, command_type ASC, trigger ASC`,
    [req.guild.id]
  );

  res.json({ commands: commands.map(mapCommandRow) });
});

router.post('/assistant', validate(commandAssistantSchema), async (req, res, next) => {
  try {
    ensureDefaultCommandsForGuild(req.guild.id);
    const currentRow = req.body.command_id
      ? db.raw('SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?', [req.body.command_id, req.guild.id])[0]
      : null;
    const currentCommand = currentRow ? mapCommandRow(currentRow) : null;
    if (currentCommand?.is_system) {
      return res.status(400).json({ error: 'Les commandes par defaut se configurent directement et ne passent pas par l assistant.' });
    }
    const mode = normalizeCommandType(req.body.mode);
    const requestedMeta = resolveRequestedCommandMeta({
      mode,
      prefix: req.body.prefix || currentCommand?.command_prefix || '!',
      trigger: req.body.trigger,
      command_name: req.body.command_name,
    });
    const prefix = mode === 'slash' ? '/' : (requestedMeta.command_prefix || normalizeCommandPrefix(req.body.prefix || currentCommand?.command_prefix || '!'));
    const systemPrompt = buildAssistantSystemPrompt({
      guildName: req.guild.name,
      mode,
      prefix,
      requestedTrigger: mode === 'prefix' ? requestedMeta.trigger : '',
      requestedCommandName: mode === 'slash' ? requestedMeta.command_name : '',
      existingCommand: currentCommand,
    });

    // Inject variety seed into user prompt to prevent duplicate AI outputs
    const varietySuffix = `\n[variety-seed: ${generateRandomSeed()}]`;
    const messages = [
      ...req.body.conversation_history.slice(-8),
      { role: 'user', content: req.body.prompt + varietySuffix },
    ];
    const completion = await aiService.completeConversation(req.user.id, { systemPrompt, messages });
    const inferredDraft = inferNativeActionDraft({
      prompt: req.body.prompt,
      mode,
      requestedCommandName: mode === 'slash' ? requestedMeta.command_name : '',
      currentCommand,
    });
    const draft = mergeDraftWithIntent(extractCommandDraft(completion.text), inferredDraft, req.body.prompt);

    if (!draft) {
      return res.status(502).json({ error: 'Assistant command draft invalid' });
    }

    const payload = normalizeAssistantDraft(draft, mode, prefix, currentCommand, {
      trigger: req.body.trigger,
      command_name: req.body.command_name,
    });
    const collision = findCommandCollision(req.guild.id, payload.trigger, payload.aliases, currentCommand?.id);
    if (collision) {
      return res.status(409).json({ error: `Le declencheur "${collision}" existe deja` });
    }

    enableCommandsModule(req.guild.id);
    const savedId = saveCommand(req.guild.id, payload, currentCommand?.id || null);
    const saved = db.raw('SELECT * FROM custom_commands WHERE id = ?', [savedId])[0];
    scheduleCommandSync(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
    const mappedSaved = mapCommandRow(saved);
    notifyGuildCommandSync(req);
    logCommandSiteAction(req, currentCommand ? 'Commande modifiee par IA' : 'Commande creee par IA', mappedSaved, [
      `Declencheur : ${mappedSaved.display_trigger}`,
      `Mode : ${mappedSaved.command_type}`,
      currentCommand ? 'Type : edition' : 'Type : creation',
    ]);

    res.json({
      assistant_message: inferredDraft
        ? buildNativeAssistantReply(inferredDraft.action_type, req.body.prompt, !!currentCommand)
        : String(completion.text || '').replace(/```command[\s\S]*?```/gi, '').replace(/\[variety-seed:[^\]]*\]/g, '').trim(),
      command: mappedSaved,
      quota: completion.quota,
      usage: completion.usage,
      updated: !!currentCommand,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(customCommandSchema), async (req, res) => {
  ensureDefaultCommandsForGuild(req.guild.id);
  const payload = normalizePayload(req.body);
  const collision = findCommandCollision(req.guild.id, payload.trigger, payload.aliases);

  if (collision) {
    return res.status(409).json({ error: `Le declencheur ou alias "${collision}" existe deja` });
  }

  enableCommandsModule(req.guild.id);
  const id = saveCommand(req.guild.id, payload);
  const created = db.raw('SELECT * FROM custom_commands WHERE id = ?', [id])[0];
  scheduleCommandSync(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  const mappedCreated = mapCommandRow(created);
  notifyGuildCommandSync(req);
  logCommandSiteAction(req, 'Commande creee', mappedCreated, [
    `Declencheur : ${mappedCreated.display_trigger}`,
    `Mode : ${mappedCreated.command_type}`,
    mappedCreated.description ? `Description : ${mappedCreated.description}` : '',
  ].filter(Boolean));

  res.status(201).json({ message: 'Command created', command: mappedCreated });
});

router.patch('/:id', validate(customCommandSchema.partial()), async (req, res) => {
  ensureDefaultCommandsForGuild(req.guild.id);
  const row = db.raw(
    'SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];

  if (!row) return res.status(404).json({ error: 'Command not found' });

  const current = mapCommandRow(row);
  const payload = current.is_system
    ? normalizeSystemUpdatePayload(req.body, current)
    : normalizePayload(req.body, current);
  const collision = findCommandCollision(req.guild.id, payload.trigger, payload.aliases, row.id);

  if (collision) {
    return res.status(409).json({ error: `Le declencheur ou alias "${collision}" existe deja` });
  }

  saveCommand(req.guild.id, payload, row.id);
  const updated = db.raw('SELECT * FROM custom_commands WHERE id = ?', [row.id])[0];
  scheduleCommandSync(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  const mappedUpdated = mapCommandRow(updated);
  notifyGuildCommandSync(req);
  logCommandSiteAction(req, 'Commande modifiee', mappedUpdated, [
    `Declencheur : ${mappedUpdated.display_trigger}`,
    `Mode : ${mappedUpdated.command_type}`,
    mappedUpdated.description ? `Description : ${mappedUpdated.description}` : '',
  ].filter(Boolean));

  res.json({ message: 'Command updated', command: mappedUpdated });
});

router.delete('/:id', async (req, res) => {
  ensureDefaultCommandsForGuild(req.guild.id);
  const existing = db.raw(
    'SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];
  if (existing && Number(existing.is_system || 0) === 1) {
    return res.status(403).json({ error: 'Les commandes par defaut ne peuvent pas etre supprimees.' });
  }
  const deleted = db.db.prepare(
    'DELETE FROM custom_commands WHERE id = ? AND guild_id = ?'
  ).run(req.params.id, req.guild.id).changes;

  if (!deleted) return res.status(404).json({ error: 'Command not found' });

  scheduleCommandSync(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  notifyGuildCommandSync(req);
  if (existing) {
    const mappedExisting = mapCommandRow(existing);
    logCommandSiteAction(req, 'Commande supprimee', mappedExisting, [
      `Declencheur : ${mappedExisting.display_trigger}`,
      `Mode : ${mappedExisting.command_type}`,
    ]);
  }
  res.json({ message: 'Command deleted' });
});

router.patch('/:id/toggle', validate(commandToggleSchema), async (req, res) => {
  ensureDefaultCommandsForGuild(req.guild.id);
  const cmd = db.raw(
    'SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];

  if (!cmd) return res.status(404).json({ error: 'Command not found' });

  const requestedEnabled = typeof req.body.enabled === 'boolean'
    ? req.body.enabled
    : !cmd.enabled;
  const newState = requestedEnabled ? 1 : 0;

  if (newState) {
    enableCommandsModule(req.guild.id);
  }

  db.db.prepare('UPDATE custom_commands SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(newState, new Date().toISOString(), cmd.id);

  scheduleCommandSync(req.guildOwnerUserId || req.user.id, req.guild.guild_id);
  const updated = db.raw('SELECT * FROM custom_commands WHERE id = ?', [cmd.id])[0];
  const mappedToggle = mapCommandRow(updated);
  notifyGuildCommandSync(req);
  logCommandSiteAction(req, newState ? 'Commande activee' : 'Commande desactivee', mappedToggle, [
    `Declencheur : ${mappedToggle.display_trigger}`,
    `Mode : ${mappedToggle.command_type}`,
    `Etat : ${newState ? 'activee' : 'desactivee'}`,
  ]);
  res.json({ enabled: !!newState, command: mappedToggle });
});

module.exports = router;
