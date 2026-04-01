'use strict';

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionFlagsBits,
  ApplicationCommandOptionType,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const EventEmitter = require('events');

const logger = require('../utils/logger').child('BotProcess');
const db = require('../database');
const { decrypt } = require('../services/encryptionService');
const {
  banUserAcrossBotNetwork,
  enforceBlacklistOnJoin,
  getBlacklistEntry,
  removeBlacklistEntry,
} = require('../services/botBlacklistService');
const { safeSendModerationDm } = require('../services/moderationDmService');
const { MODULE_DEFINITIONS } = require('./modules/definitions');
const { handleAntiSpam } = require('./modules/antiSpam');
const { handleAntiLink, handleAntiInvite, handleAntiMassMention, handleAntiBotJoin, handleAntiRaid, punishSecurityAction } = require('./modules/securityModules');
const { activateLockdown, handleAntiAltAccount, handleAntiNukeEvent, handleAntiTokenScam, handleAutoSlowmode } = require('./modules/advancedProtection');
const { handleWelcomeMessage, handleAutoRole, handleLogging, handleCustomCommand } = require('./modules/utilityModules');
const { addWarning, checkEscalation, logBotEvent, recordModAction } = require('./utils/modHelpers');
const { syncNativeAutoModRules, getManagedRuleKey, RULE_KEYS } = require('../services/discordAutoModService');
const { COMMAND_ACTION_TYPES, DEFAULT_SYSTEM_COMMANDS } = require('../constants/systemCommands');
const {
  getGuildTicketGeneratorForDiscord,
  getGuildTicketGeneratorById,
  getTicketEntryById,
  getOpenTicketByChannelId,
  findDuplicateOpenTicket,
  createTicketEntry,
  claimTicketEntry,
  closeTicketEntry,
  recordPublishedPanel,
  getNextTicketNumber,
  replaceTicketTemplate,
  buildTicketChannelName,
} = require('../services/ticketGeneratorService');
const config = require('../config');

// ── Status enum ───────────────────────────────────────────────────────────────
const BotStatus = {
  STARTING:      'starting',
  RUNNING:       'running',
  STOPPING:      'stopping',
  STOPPED:       'stopped',
  ERROR:         'error',
  RECONNECTING:  'reconnecting',
};

const TICKET_GENERATOR_PREFIX = 'ticketgen';
const TICKET_REASON_INPUT_ID = 'reason';

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

function normalizeVisibility(value, fallbackValue = 'ephemeral') {
  return String(value || fallbackValue || '').trim().toLowerCase() === 'public'
    ? 'public'
    : 'ephemeral';
}

function normalizeBooleanFlag(value, fallbackValue = false) {
  return (value ?? fallbackValue) ? 1 : 0;
}

const DEFAULT_ACTION_CONFIG_BY_TYPE = new Map(
  DEFAULT_SYSTEM_COMMANDS.map((definition) => [definition.action_type, definition.action_config || {}])
);

function normalizeCommandActionConfig(actionType, rawValue = {}) {
  const source = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {};
  const fallback = DEFAULT_ACTION_CONFIG_BY_TYPE.get(actionType) || {};

  switch (actionType) {
    case COMMAND_ACTION_TYPES.CLEAR_MESSAGES: {
      const minAmount = clampNumber(source.min_amount ?? fallback.min_amount, 1, 100, 1);
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        min_amount: minAmount,
        max_amount: clampNumber(source.max_amount ?? fallback.max_amount, minAmount, 100, 100),
        success_message: String(source.success_message ?? fallback.success_message ?? '{count} messages supprimes dans {channel}.').trim().slice(0, 220),
        empty_message: String(source.empty_message ?? fallback.empty_message ?? 'Aucun message recent a supprimer ici.').trim().slice(0, 220),
        denied_message: String(source.denied_message ?? fallback.denied_message ?? 'Tu dois avoir la permission de gerer les messages pour utiliser cette commande.').trim().slice(0, 220),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };
    }

    case COMMAND_ACTION_TYPES.BAN_MEMBER:
    case COMMAND_ACTION_TYPES.BLACKLIST_MEMBER:
    case COMMAND_ACTION_TYPES.SOFTBAN_MEMBER:
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

    case COMMAND_ACTION_TYPES.KICK_MEMBER:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER:
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

    case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? false),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? false),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.WARN_MEMBER:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
        default_points: clampNumber(source.default_points ?? fallback.default_points, 1, 20, 1),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.UNBAN_MEMBER:
    case COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER:
    case COMMAND_ACTION_TYPES.ADD_ROLE:
    case COMMAND_ACTION_TYPES.REMOVE_ROLE:
    case COMMAND_ACTION_TYPES.SET_NICKNAME:
    case COMMAND_ACTION_TYPES.MOVE_MEMBER:
    case COMMAND_ACTION_TYPES.DISCONNECT_MEMBER:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? false),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.LOCK_CHANNEL:
    case COMMAND_ACTION_TYPES.UNLOCK_CHANNEL:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? false),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? false),
        default_seconds: parseFlexibleDurationSeconds(source.default_seconds ?? fallback.default_seconds, {
          fallback: Number(fallback.default_seconds || 30),
          minimum: 0,
          maximum: 21600000,
          defaultUnit: 's',
          allowZero: true,
        }),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.SAY_MESSAGE:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
        allow_mentions: normalizeBooleanFlag(source.allow_mentions, fallback.allow_mentions ?? false),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        default_channel_id: normalizeSnowflake(source.default_channel_id, fallback.default_channel_id),
        ping_everyone: normalizeBooleanFlag(source.ping_everyone, fallback.ping_everyone ?? false),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    default:
      return source;
  }
}

function getDefaultNativePermission(actionType) {
  switch (actionType) {
    case COMMAND_ACTION_TYPES.CLEAR_MESSAGES:
      return PermissionFlagsBits.ManageMessages;
    case COMMAND_ACTION_TYPES.TICKET_PANEL:
      return PermissionFlagsBits.ManageChannels;
    case COMMAND_ACTION_TYPES.BAN_MEMBER:
    case COMMAND_ACTION_TYPES.BLACKLIST_MEMBER:
    case COMMAND_ACTION_TYPES.SOFTBAN_MEMBER:
    case COMMAND_ACTION_TYPES.UNBAN_MEMBER:
    case COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER:
      return PermissionFlagsBits.BanMembers;
    case COMMAND_ACTION_TYPES.KICK_MEMBER:
      return PermissionFlagsBits.KickMembers;
    case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER:
    case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
    case COMMAND_ACTION_TYPES.WARN_MEMBER:
      return PermissionFlagsBits.ModerateMembers;
    case COMMAND_ACTION_TYPES.ADD_ROLE:
    case COMMAND_ACTION_TYPES.REMOVE_ROLE:
      return PermissionFlagsBits.ManageRoles;
    case COMMAND_ACTION_TYPES.SET_NICKNAME:
      return PermissionFlagsBits.ManageNicknames;
    case COMMAND_ACTION_TYPES.LOCK_CHANNEL:
    case COMMAND_ACTION_TYPES.UNLOCK_CHANNEL:
    case COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL:
      return PermissionFlagsBits.ManageChannels;
    case COMMAND_ACTION_TYPES.SAY_MESSAGE:
    case COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE:
      return PermissionFlagsBits.ManageMessages;
    case COMMAND_ACTION_TYPES.MOVE_MEMBER:
    case COMMAND_ACTION_TYPES.DISCONNECT_MEMBER:
      return PermissionFlagsBits.MoveMembers;
    default:
      return null;
  }
}

function buildSlashCommandPayload(command) {
  const actionType = String(command.action_type || '').trim();
  const payload = {
    name: command.command_name,
    description: String(command.description || `Commande ${command.command_name}`).slice(0, 100),
    dm_permission: false,
  };
  const permission = getDefaultNativePermission(actionType);
  if (permission) {
    payload.default_member_permissions = permission.toString();
  }

  switch (actionType) {
    case COMMAND_ACTION_TYPES.CLEAR_MESSAGES:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Integer,
          name: 'amount',
          description: 'Nombre de messages a supprimer',
          required: true,
          min_value: 1,
          max_value: 100,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.BAN_MEMBER:
    case COMMAND_ACTION_TYPES.BLACKLIST_MEMBER:
    case COMMAND_ACTION_TYPES.KICK_MEMBER:
    case COMMAND_ACTION_TYPES.SOFTBAN_MEMBER:
    case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
    case COMMAND_ACTION_TYPES.DISCONNECT_MEMBER:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de la sanction',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: 'minutes',
          description: 'Duree du timeout en minutes',
          required: false,
          min_value: 1,
          max_value: 40320,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de la sanction',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.WARN_MEMBER:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de l avertissement',
          required: false,
          max_length: 300,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: 'points',
          description: 'Points a ajouter',
          required: false,
          min_value: 1,
          max_value: 20,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.UNBAN_MEMBER:
    case COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER:
      payload.options = [
        {
          type: ApplicationCommandOptionType.String,
          name: 'user_id',
          description: 'Identifiant Discord de l utilisateur banni',
          required: true,
          min_length: 17,
          max_length: 20,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison du retrait de ban',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.ADD_ROLE:
    case COMMAND_ACTION_TYPES.REMOVE_ROLE:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.Role,
          name: 'role',
          description: 'Role a gerer',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de la modification',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.SET_NICKNAME:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'nickname',
          description: 'Nouveau pseudo',
          required: true,
          min_length: 1,
          max_length: 32,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de la modification',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.LOCK_CHANNEL:
    case COMMAND_ACTION_TYPES.UNLOCK_CHANNEL:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon texte cible',
          required: false,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de la modification',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon texte cible',
          required: false,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          ],
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: 'seconds',
          description: 'Slowmode en secondes',
          required: false,
          min_value: 0,
          max_value: 21600,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison de la modification',
          required: false,
          max_length: 300,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.SAY_MESSAGE:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon de destination',
          required: false,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'message',
          description: 'Message a envoyer',
          required: true,
          max_length: 2000,
        },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'allow_mentions',
          description: 'Autoriser les mentions',
          required: false,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon de destination',
          required: false,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'title',
          description: 'Titre de l annonce',
          required: false,
          max_length: 120,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'message',
          description: 'Contenu de l annonce',
          required: true,
          max_length: 2000,
        },
        {
          type: ApplicationCommandOptionType.Boolean,
          name: 'ping_everyone',
          description: 'Ajouter un @everyone',
          required: false,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.MOVE_MEMBER:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon vocal de destination',
          required: true,
          channel_types: [
            ChannelType.GuildVoice,
            ChannelType.GuildStageVoice,
          ],
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'reason',
          description: 'Raison du deplacement',
          required: false,
          max_length: 300,
        },
      ];
      break;

    default:
      break;
  }

  return payload;
}

function parseDurationToMs(value, fallbackMs = 600000) {
  if (value === null || value === undefined || value === '') return fallbackMs;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clampDurationMs(value * 60000, 60000, 2419200000, fallbackMs);
  }

  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/^(\d+)(s|m|h|d|j)?$/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2] || 'm';
  const multiplier = unit === 's'
    ? 1000
    : unit === 'h'
      ? 3600000
      : (unit === 'd' || unit === 'j')
        ? 86400000
        : 60000;
  return clampDurationMs(amount * multiplier, 60000, 2419200000, fallbackMs);
}

const nativeExecutionCooldowns = new Map();

function shouldSkipNativeExecution(key) {
  const now = Date.now();
  const lastSeen = nativeExecutionCooldowns.get(key) ?? 0;
  nativeExecutionCooldowns.set(key, now);
  return now - lastSeen < 4000;
}

function shouldUseSpaceAfterPrefix(prefix) {
  return /^[a-z0-9]+$/i.test(String(prefix || '').trim());
}

function buildDisplayTrigger(commandType, commandPrefix, commandName, fallbackTrigger) {
  if (commandType === 'slash') return `/${commandName}`;
  if (!commandName) return String(fallbackTrigger || '').trim();
  return shouldUseSpaceAfterPrefix(commandPrefix)
    ? `${commandPrefix} ${commandName}`
    : `${commandPrefix}${commandName}`;
}

function normalizeCommandRow(row) {
  const commandType = row.command_type === 'slash' ? 'slash' : 'prefix';
  const commandPrefix = commandType === 'slash' ? '/' : String(row.command_prefix || '').trim();
  const commandName = String(row.command_name || '').trim();
  const actionType = String(row.action_type || '').trim();

  return {
    ...row,
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    is_system: !!row.is_system,
    system_key: String(row.system_key || '').trim(),
    execution_mode: String(row.execution_mode || '').trim() === 'native' ? 'native' : 'response',
    action_type: actionType,
    action_config: normalizeCommandActionConfig(actionType, parseJsonObject(row.action_config)),
    aliases: parseJsonArray(row.aliases),
    allowed_roles: parseJsonArray(row.allowed_roles),
    allowed_channels: parseJsonArray(row.allowed_channels),
    display_trigger: buildDisplayTrigger(commandType, commandPrefix, commandName, row.trigger),
  };
}

function resolveCommandMatch(messageContent, command, caseSensitive) {
  const content = String(messageContent || '').trim();
  const preparedContent = caseSensitive ? content : content.toLowerCase();
  const candidates = new Set();

  if (command.display_trigger) candidates.add(command.display_trigger);
  if (command.trigger) candidates.add(command.trigger);
  for (const alias of command.aliases || []) {
    candidates.add(alias);
  }

  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const normalized = caseSensitive ? raw : raw.toLowerCase();
    if (preparedContent === normalized) return raw;
    if (preparedContent.startsWith(`${normalized} `)) return raw;
  }

  return null;
}

/**
 * BotProcess wraps a Discord.js client for one user's bot token.
 * Emits: 'statusChange', 'ready', 'error', 'guildUpdate'
 */
class BotProcess extends EventEmitter {
  constructor(userId, encryptedToken) {
    super();
    this.userId        = userId;
    this.encryptedToken = encryptedToken;
    this.token         = null;         // decrypted (only in memory, never stored)
    this.client        = null;
    this.status        = BotStatus.STOPPED;
    this.restartCount  = 0;
    this.lastError     = null;
    this.startedAt     = null;
    this._stopping     = false;
    this._restartTimer = null;
    this._heartbeatInterval = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  async start() {
    if (this._stopping) return;
    this._setStatus(BotStatus.STARTING);

    try {
      this.token = decrypt(this.encryptedToken);
      if (!this.token) throw new Error('Failed to decrypt bot token');

      this._createClient();
      this._registerEvents();
      await this.client.login(this.token);
    } catch (err) {
      this.lastError = err.message;
      logger.error(`Bot start failed for user ${this.userId}: ${err.message}`);
      this._setStatus(BotStatus.ERROR);
      this._scheduleRestart();
    }
  }

  async stop() {
    this._stopping = true;
    clearTimeout(this._restartTimer);
    clearInterval(this._heartbeatInterval);
    this._setStatus(BotStatus.STOPPING);

    if (this.client) {
      try { this.client.destroy(); } catch { /* ignore */ }
      this.client = null;
    }

    this._setStatus(BotStatus.STOPPED);
    this._stopping = false;
    logger.info(`Bot stopped for user ${this.userId}`);
  }

  async restart() {
    await this.stop();
    this._stopping = false;
    this.restartCount = 0;
    await this.start();
  }

  // ── Client Setup ────────────────────────────────────────────────────────────

  _createClient() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
      ],
      rest: {
        retries: 3,
        timeout: 15000,
      },
    });
  }

  _registerEvents() {
    const c = this.client;

    c.once(Events.ClientReady, (readyClient) => {
      this.restartCount = 0;
      this.startedAt = new Date().toISOString();
      this.lastError = null;
      this._setStatus(BotStatus.RUNNING);

      logger.info(`✅ Bot ready: ${readyClient.user.tag} | Guilds: ${readyClient.guilds.cache.size}`, { userId: this.userId });
      this._startHeartbeat();
      this._syncGuilds();
      this.emit('ready', readyClient.user);
    });

    c.on(Events.MessageCreate, (msg) => this._onMessage(msg));
    c.on(Events.InteractionCreate, (interaction) => this._onInteraction(interaction));
    c.on(Events.GuildMemberAdd, (member) => this._onMemberAdd(member));
    c.on(Events.GuildMemberRemove, (member) => this._onMemberRemove(member));
    c.on(Events.MessageDelete, (msg) => this._onMessageDelete(msg));
    c.on(Events.MessageBulkDelete, (messages) => this._onMessageBulkDelete(messages));
    c.on(Events.MessageUpdate, (oldMsg, newMsg) => this._onMessageUpdate(oldMsg, newMsg));
    c.on(Events.GuildBanAdd, (ban) => this._onBanAdd(ban));
    c.on(Events.GuildMemberUpdate, (oldMember, newMember) => this._onMemberUpdate(oldMember, newMember));
    c.on(Events.AutoModerationActionExecution, (execution) => this._onAutoModerationActionExecution(execution));
    c.on(Events.ChannelCreate, (channel) => this._onGuildStructureEvent('channel_create', channel));
    c.on(Events.ChannelDelete, (channel) => this._onGuildStructureEvent('channel_delete', channel));
    c.on(Events.GuildRoleCreate, (role) => this._onGuildStructureEvent('role_create', role));
    c.on(Events.GuildRoleDelete, (role) => this._onGuildStructureEvent('role_delete', role));

    c.on(Events.ShardDisconnect, (event, shardId) => {
      logger.warn(`Bot disconnected (shard ${shardId}, code ${event.code})`, { userId: this.userId });
      this._setStatus(BotStatus.RECONNECTING);
    });

    c.on(Events.ShardReconnecting, () => {
      this._setStatus(BotStatus.RECONNECTING);
    });

    c.on(Events.ShardResume, () => {
      this._setStatus(BotStatus.RUNNING);
    });

    c.on(Events.Error, (err) => {
      this.lastError = err.message;
      logger.error(`Client error for user ${this.userId}: ${err.message}`);
      this._setStatus(BotStatus.ERROR);
      this._scheduleRestart();
    });

    c.on(Events.Warn, (warn) => {
      logger.warn(`Discord.js warning: ${warn}`, { userId: this.userId });
    });
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────

  _startHeartbeat() {
    clearInterval(this._heartbeatInterval);
    this._heartbeatInterval = setInterval(() => {
      const ping = this.client?.ws?.ping ?? -1;
      db.db.prepare(
        'UPDATE bot_processes SET last_heartbeat = ?, ping_ms = ?, guilds_count = ?, updated_at = ? WHERE user_id = ?'
      ).run(new Date().toISOString(), ping, this.client?.guilds?.cache?.size ?? 0, new Date().toISOString(), this.userId);
    }, 15_000);
  }

  // ── Guild Sync ──────────────────────────────────────────────────────────────

  async _syncGuilds() {
    if (!this.client?.guilds?.cache) return;
    const { syncGuildsForUser } = require('../services/guildSyncService');
    try {
      await syncGuildsForUser(this.userId, this.client, this.token);
      this.emit('guildUpdate');
      await this._syncNativeProtectionRules();
      await this._syncSlashCommands();
    } catch (err) {
      logger.error(`Guild sync failed: ${err.message}`, { userId: this.userId });
    }
  }

  async _syncNativeProtectionRules() {
    if (!this.client?.guilds?.cache?.size) return;

    const syncJobs = [...this.client.guilds.cache.values()].map(async (guild) => {
      try {
        const configs = await this._getEnabledModules(guild.id);
        await syncNativeAutoModRules(this.token, guild.id, configs);
      } catch (error) {
        logger.warn(`Native protection sync failed for guild ${guild.id}: ${error.message}`, { userId: this.userId });
      }
    });

    await Promise.allSettled(syncJobs);
  }

  _ensureSystemCommands(guildRowId) {
    if (!guildRowId) return;

    const now = new Date().toISOString();
    const existingRows = db.raw(
      'SELECT * FROM custom_commands WHERE guild_id = ? AND is_system = 1',
      [guildRowId]
    );
    const existingByKey = new Map(
      existingRows.map((row) => [String(row.system_key || '').trim(), row])
    );

    for (const definition of DEFAULT_SYSTEM_COMMANDS) {
      const trigger = `/${definition.command_name}`;
      const existing = existingByKey.get(definition.system_key) || null;
      const normalizedActionConfig = normalizeCommandActionConfig(
        definition.action_type,
        existing ? parseJsonObject(existing.action_config) : definition.action_config
      );

      if (existing) {
        db.db.prepare(`
          UPDATE custom_commands
          SET trigger = ?,
              command_type = ?,
              command_prefix = ?,
              command_name = ?,
              is_system = 1,
              system_key = ?,
              execution_mode = 'native',
              action_type = ?,
              action_config = ?,
              description = ?,
              response = ?,
              response_mode = ?,
              embed_enabled = ?,
              embed_title = ?,
              embed_color = ?,
              mention_user = ?,
              require_args = ?,
              delete_trigger = ?,
              cooldown_ms = ?,
              usage_hint = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          trigger,
          definition.command_type,
          definition.command_prefix,
          definition.command_name,
          definition.system_key,
          definition.action_type,
          JSON.stringify(normalizedActionConfig),
          definition.description,
          definition.response,
          definition.response_mode,
          definition.embed_enabled ? 1 : 0,
          definition.embed_title,
          definition.embed_color,
          definition.mention_user ? 1 : 0,
          definition.require_args ? 1 : 0,
          definition.delete_trigger ? 1 : 0,
          definition.cooldown_ms,
          definition.usage_hint,
          now,
          existing.id
        );
        continue;
      }

      db.insert('custom_commands', {
        guild_id: guildRowId,
        trigger,
        command_type: definition.command_type,
        command_prefix: definition.command_prefix,
        command_name: definition.command_name,
        is_system: 1,
        system_key: definition.system_key,
        enabled: definition.enabled ? 1 : 0,
        execution_mode: 'native',
        action_type: definition.action_type,
        action_config: JSON.stringify(normalizedActionConfig),
        description: definition.description,
        response: definition.response,
        response_mode: definition.response_mode,
        reply_in_dm: 0,
        delete_trigger: definition.delete_trigger ? 1 : 0,
        allowed_roles: '[]',
        allowed_channels: '[]',
        aliases: '[]',
        cooldown_ms: definition.cooldown_ms,
        delete_response_after_ms: 0,
        embed_enabled: definition.embed_enabled ? 1 : 0,
        embed_title: definition.embed_title,
        embed_color: definition.embed_color,
        mention_user: definition.mention_user ? 1 : 0,
        require_args: definition.require_args ? 1 : 0,
        usage_hint: definition.usage_hint,
        created_at: now,
        updated_at: now,
      });
    }
  }

  async _syncSlashCommands(discordGuildId = null) {
    if (!this.client?.guilds?.cache?.size) return;

    const guilds = discordGuildId
      ? [this.client.guilds.cache.get(discordGuildId)].filter(Boolean)
      : [...this.client.guilds.cache.values()];

    const syncJobs = guilds.map(async (guild) => {
      const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guild.id, this.userId])[0];
      if (!guildRow) return;
      this._ensureSystemCommands(guildRow.id);

      const slashCommands = db.raw(
        `SELECT * FROM custom_commands
         WHERE guild_id = ? AND enabled = 1 AND command_type = 'slash'
         ORDER BY created_at ASC`,
        [guildRow.id]
      ).map(normalizeCommandRow);

      const payloads = slashCommands
        .filter((command) => command.command_name)
        .map((command) => buildSlashCommandPayload(command));

      await guild.commands.set(payloads);
    });

    await Promise.allSettled(syncJobs);
  }

  _resolveInternalGuildId(discordGuildId) {
    return db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [discordGuildId, this.userId])[0]?.id || null;
  }

  _storeDiscordRuntimeLog(discordGuildId, message, metadata = {}, level = 'info') {
    const internalGuildId = this._resolveInternalGuildId(discordGuildId);
    if (!internalGuildId) return;

    logBotEvent(this.userId, internalGuildId, level, 'discord_event', message, metadata);
  }

  _notifyScanUpdate(discordGuildId, payload = {}) {
    if (!discordGuildId) return;
    this.emit('scanUpdate', {
      userId: this.userId,
      guildId: String(discordGuildId),
      ...payload,
      at: new Date().toISOString(),
    });
  }

  _extractNativeArgs(source, matchedTrigger = null) {
    if (typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()) {
      return [];
    }

    const content = String(source?.content || '').trim();
    const prefix = String(matchedTrigger || '').trim();
    const argsText = prefix && content.startsWith(prefix)
      ? content.slice(prefix.length).trim()
      : content;

    return argsText ? argsText.split(/\s+/).filter(Boolean) : [];
  }

  async _replyToNativeSource(source, content, { ephemeral = true, preferReply = true } = {}) {
    const payload = { content: String(content || '').slice(0, 2000) || 'Commande executee.' };
    if (typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()) {
      const response = { ...payload, ephemeral };
      if (source.deferred || source.replied) return source.followUp(response);
      return source.reply(response);
    }

    if (preferReply && typeof source?.reply === 'function') {
      return source.reply({ ...payload, allowedMentions: { repliedUser: false } });
    }
    if (source?.channel?.isTextBased?.()) {
      return source.channel.send(payload);
    }
    return null;
  }

  async _logNativeCommandToChannel(guild, channelId, title, lines = [], color = 0x22d3ee) {
    const targetChannelId = normalizeSnowflake(channelId);
    if (!guild || !targetChannelId) return;

    const channel = guild.channels.cache.get(targetChannelId)
      || await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    await channel.send({
      embeds: [{
        title: String(title || 'Journal de commande native').slice(0, 256),
        description: lines.filter(Boolean).join('\n').slice(0, 4000),
        color,
      timestamp: new Date().toISOString(),
      }],
    }).catch(() => {});
  }

  _hexColorToInt(value, fallback = 0x22d3ee) {
    const normalized = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(normalized) ? Number.parseInt(normalized, 16) : fallback;
  }

  async _resolveTextChannel(source, actionConfig = {}, optionName = 'channel') {
    const guild = source?.guild;
    if (!guild) return null;

    const fromOption = typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()
      ? source.options.getChannel(optionName)
      : null;
    if (fromOption?.isTextBased?.()) return fromOption;

    const defaultChannelId = normalizeSnowflake(actionConfig.default_channel_id);
    if (defaultChannelId) {
      const defaultChannel = guild.channels.cache.get(defaultChannelId)
        || await guild.channels.fetch(defaultChannelId).catch(() => null);
      if (defaultChannel?.isTextBased?.()) return defaultChannel;
    }

    return source?.channel?.isTextBased?.() ? source.channel : null;
  }

  async _resolveVoiceChannel(source, optionName = 'channel') {
    const guild = source?.guild;
    if (!guild || !(typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand())) return null;

    const channel = source.options.getChannel(optionName);
    if (!channel) return null;
    return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice
      ? channel
      : null;
  }

  _buildTicketGeneratorCustomId(type, ...parts) {
    return [TICKET_GENERATOR_PREFIX, type, ...parts.map((part) => String(part || '').trim())]
      .filter(Boolean)
      .join(':')
      .slice(0, 100);
  }

  _parseTicketGeneratorCustomId(customId) {
    const parts = String(customId || '').split(':');
    if (parts[0] !== TICKET_GENERATOR_PREFIX || parts.length < 3) return null;
    return {
      type: parts[1],
      args: parts.slice(2),
    };
  }

  _getTicketTemplateValues({ user, option, ticketNumber, reason = '', channelId = '', claimer = '', closer = '' }) {
    const username = String(user?.username || user?.globalName || user?.id || 'user')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'user';
    const userTag = String(user?.tag || user?.username || user?.globalName || user?.id || 'Utilisateur').trim();

    return {
      number: String(ticketNumber || ''),
      label: String(option?.label || ''),
      option_key: String(option?.key || ''),
      mention: user?.id ? `<@${user.id}>` : '',
      user_id: String(user?.id || ''),
      user_tag: userTag,
      username,
      reason: String(reason || '').trim(),
      channel: channelId ? `<#${channelId}>` : '',
      claimer: String(claimer || ''),
      closer: String(closer || ''),
    };
  }

  _buildTicketGeneratorComponents(generator) {
    const enabledOptions = (generator?.options || []).filter((option) => option.enabled).slice(0, 10);
    if (enabledOptions.length === 0) return [];

    const menu = new StringSelectMenuBuilder()
      .setCustomId(this._buildTicketGeneratorCustomId('open', generator.id))
      .setPlaceholder(String(generator.menu_placeholder || 'Choisis une categorie de ticket').slice(0, 120))
      .setMinValues(1)
      .setMaxValues(1);

    for (const option of enabledOptions) {
      const item = new StringSelectMenuOptionBuilder()
        .setLabel(String(option.label || 'Ticket').slice(0, 100))
        .setValue(option.key)
        .setDescription(String(option.description || 'Ouvrir ce ticket').slice(0, 100));

      if (option.emoji) {
        try {
          item.setEmoji(option.emoji);
        } catch {
          // Ignore invalid emoji configuration.
        }
      }

      menu.addOptions(item);
    }

    return [new ActionRowBuilder().addComponents(menu)];
  }

  _buildTicketGeneratorPanelPayload(generator) {
    const embed = {
      title: String(generator.panel_title || 'Ticket Generator').slice(0, 256),
      description: String(generator.panel_description || 'Choisis une categorie de ticket puis remplis le formulaire.').slice(0, 4000),
      color: this._hexColorToInt(generator.panel_color, 0x7c3aed),
      footer: generator.panel_footer
        ? { text: String(generator.panel_footer).slice(0, 2048) }
        : undefined,
      timestamp: new Date().toISOString(),
    };

    if (generator.panel_thumbnail_url) {
      embed.thumbnail = { url: String(generator.panel_thumbnail_url) };
    }

    if (generator.panel_image_url) {
      embed.image = { url: String(generator.panel_image_url) };
    }

    return {
      embeds: [embed],
      components: this._buildTicketGeneratorComponents(generator),
    };
  }

  async publishTicketGeneratorPanel(discordGuildId) {
    const guild = this.client?.guilds?.cache?.get(discordGuildId)
      || await this.client?.guilds?.fetch?.(discordGuildId).catch(() => null);
    if (!guild) {
      throw new Error('Serveur Discord introuvable pour publier le panel tickets');
    }

    const internalGuildId = this._resolveInternalGuildId(discordGuildId);
    if (!internalGuildId) {
      throw new Error('Serveur interne introuvable pour ce generateur de tickets');
    }

    const generator = getGuildTicketGeneratorForDiscord(this.userId, discordGuildId);
    if (!generator?.id || !generator.enabled) {
      throw new Error('Le generateur de tickets est desactive');
    }

    const enabledOptions = (generator.options || []).filter((option) => option.enabled);
    if (enabledOptions.length === 0) {
      throw new Error('Ajoute au moins un type de ticket actif avant la publication');
    }

    const targetChannelId = normalizeSnowflake(generator.panel_channel_id);
    if (!targetChannelId) {
      throw new Error('Choisis un salon de publication pour le panel tickets');
    }

    const channel = guild.channels.cache.get(targetChannelId)
      || await guild.channels.fetch(targetChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      throw new Error('Le salon de publication tickets doit etre un salon texte');
    }

    const botPermissions = channel.permissionsFor?.(guild.members.me);
    if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error('Le bot ne peut pas envoyer de messages dans le salon tickets choisi');
    }

    const payload = this._buildTicketGeneratorPanelPayload(generator);
    let message = null;

    if (generator.panel_message_id) {
      message = await channel.messages.fetch(generator.panel_message_id).catch(() => null);
      if (message?.editable) {
        message = await message.edit(payload).catch(() => null);
      }
    }

    if (!message) {
      message = await channel.send(payload);
    }

    recordPublishedPanel(internalGuildId, channel.id, message.id);

    return {
      channel_id: channel.id,
      message_id: message.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    };
  }

  _hasTicketSupportAccess(member, option) {
    if (!member) return false;
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
    const memberRoleIds = new Set(Array.from(member.roles?.cache?.keys?.() || []));
    return (option?.role_ids || []).some((roleId) => memberRoleIds.has(roleId));
  }

  async _showTicketGeneratorModal(interaction, generator, option) {
    const modal = new ModalBuilder()
      .setCustomId(this._buildTicketGeneratorCustomId('submit', generator.id, option.key))
      .setTitle(String(option.modal_title || option.label || 'Nouveau ticket').slice(0, 45));

    const input = new TextInputBuilder()
      .setCustomId(TICKET_REASON_INPUT_ID)
      .setLabel(String(option.question_label || 'Pourquoi veux-tu ouvrir ce ticket ?').slice(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(String(option.question_placeholder || 'Explique ta demande...').slice(0, 100))
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }

  async _handleTicketGeneratorSubmit(interaction, generator, option, internalGuildId) {
    if (!generator?.enabled || !option?.enabled) {
      await interaction.reply({ content: 'Ce type de ticket est indisponible pour le moment.', ephemeral: true }).catch(() => {});
      return true;
    }

    const duplicate = generator.prevent_duplicates
      ? findDuplicateOpenTicket(internalGuildId, interaction.user.id, option.key)
      : null;
    if (duplicate) {
      const existingChannelLabel = duplicate.channel_id ? `<#${duplicate.channel_id}>` : `#${duplicate.ticket_number}`;
      await interaction.reply({
        content: `Tu as deja un ticket ouvert pour cette categorie: ${existingChannelLabel}`,
        ephemeral: true,
      }).catch(() => {});
      return true;
    }

    const guild = interaction.guild;
    const botMember = guild.members.me;
    if (!botMember) {
      await interaction.reply({ content: 'Le bot est indisponible pour creer ce ticket.', ephemeral: true }).catch(() => {});
      return true;
    }

    const reason = String(interaction.fields.getTextInputValue(TICKET_REASON_INPUT_ID) || '').trim();
    const ticketNumber = getNextTicketNumber(internalGuildId);
    const ticketValues = this._getTicketTemplateValues({
      user: interaction.user,
      option,
      ticketNumber,
      reason,
    });
    const topicBase = replaceTicketTemplate(option.ticket_topic_template || generator.ticket_topic_template, ticketValues).trim();
    const topic = [topicBase, reason].filter(Boolean).join(' | ').slice(0, 1024);

    const desiredName = buildTicketChannelName(option.ticket_name_template || generator.ticket_name_template, ticketValues);
    const existingNames = new Set(guild.channels.cache.map((channel) => String(channel?.name || '').toLowerCase()));
    let finalName = desiredName;
    let suffix = 1;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = `${desiredName}-${suffix}`.slice(0, 90);
      suffix += 1;
    }

    const parentId = normalizeSnowflake(option.category_id || generator.default_category_id);
    const parentChannel = parentId
      ? (guild.channels.cache.get(parentId) || await guild.channels.fetch(parentId).catch(() => null))
      : null;
    const supportRoleIds = (option.role_ids || []).filter((roleId) => guild.roles.cache.has(roleId));

    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      ...supportRoleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      })),
    ];

    const channel = await guild.channels.create({
      name: finalName,
      type: ChannelType.GuildText,
      topic,
      parent: parentChannel?.type === ChannelType.GuildCategory ? parentChannel.id : undefined,
      permissionOverwrites,
      reason: `Ticket ${option.label} ouvert par ${interaction.user.tag || interaction.user.username || interaction.user.id}`,
    });

    const entry = createTicketEntry({
      internalGuildId,
      generatorId: generator.id,
      optionKey: option.key,
      ticketNumber,
      channelId: channel.id,
      creatorDiscordUserId: interaction.user.id,
      creatorUsername: interaction.user.tag || interaction.user.username || interaction.user.id,
      reason,
      subject: `${option.label}: ${reason}`.slice(0, 240),
    });

    const fullValues = this._getTicketTemplateValues({
      user: interaction.user,
      option,
      ticketNumber: entry.ticket_number,
      reason,
      channelId: channel.id,
    });
    const introMessage = replaceTicketTemplate(
      option.intro_message || generator.intro_message || 'Bonjour {mention}, ton ticket est ouvert.',
      fullValues
    ).slice(0, 1800);
    const shouldPingRoles = !!generator.auto_ping_support && !!option.ping_roles && supportRoleIds.length > 0;
    const claimButton = new ButtonBuilder()
      .setCustomId(this._buildTicketGeneratorCustomId('claim', entry.id))
      .setLabel('Claim')
      .setStyle(ButtonStyle.Primary);
    const closeButton = new ButtonBuilder()
      .setCustomId(this._buildTicketGeneratorCustomId('close', entry.id))
      .setLabel('Fermer')
      .setStyle(ButtonStyle.Danger);

    const openingEmbed = {
      title: `${String(option.label || 'Ticket').slice(0, 80)} | #${entry.ticket_number}`,
      description: introMessage,
      color: this._hexColorToInt(generator.panel_color, 0x7c3aed),
      fields: [
        {
          name: 'Auteur',
          value: interaction.user.id ? `<@${interaction.user.id}>` : (interaction.user.tag || interaction.user.username || interaction.user.id),
          inline: true,
        },
        {
          name: 'Categorie',
          value: String(option.label || 'Ticket').slice(0, 1024),
          inline: true,
        },
        {
          name: 'Raison',
          value: reason.slice(0, 1024) || 'Aucune raison',
        },
      ],
      footer: {
        text: `Ticket ${entry.ticket_number}`,
      },
      timestamp: new Date().toISOString(),
    };

    if (generator.panel_thumbnail_url) {
      openingEmbed.thumbnail = { url: String(generator.panel_thumbnail_url) };
    }

    if (generator.panel_image_url) {
      openingEmbed.image = { url: String(generator.panel_image_url) };
    }

    await channel.send({
      content: shouldPingRoles ? supportRoleIds.map((roleId) => `<@&${roleId}>`).join(' ') : '',
      allowedMentions: {
        roles: shouldPingRoles ? supportRoleIds : [],
        users: interaction.user.id ? [interaction.user.id] : [],
      },
      embeds: [openingEmbed],
      components: [new ActionRowBuilder().addComponents(claimButton, closeButton)],
    }).catch(() => {});

    await interaction.reply({
      content: `Ticket cree: <#${channel.id}>`,
      ephemeral: true,
    }).catch(() => {});

    return true;
  }

  async _handleTicketGeneratorClaim(interaction, entryId, internalGuildId) {
    const entry = getTicketEntryById(internalGuildId, entryId);
    if (!entry) {
      await interaction.reply({ content: 'Ticket introuvable.', ephemeral: true }).catch(() => {});
      return true;
    }
    if (entry.status === 'closed') {
      await interaction.reply({ content: 'Ce ticket est deja ferme.', ephemeral: true }).catch(() => {});
      return true;
    }

    const generator = getGuildTicketGeneratorById(entry.generator_id);
    const option = (generator?.options || []).find((item) => item.key === entry.option_key);
    if (!this._hasTicketSupportAccess(interaction.member, option)) {
      await interaction.reply({ content: 'Tu n as pas acces a la prise en charge de ce ticket.', ephemeral: true }).catch(() => {});
      return true;
    }
    if (entry.claimed_by_discord_user_id && entry.claimed_by_discord_user_id !== interaction.user.id) {
      await interaction.reply({
        content: `Ce ticket est deja pris par ${entry.claimed_by_username || 'un autre membre du staff'}.`,
        ephemeral: true,
      }).catch(() => {});
      return true;
    }
    if (entry.claimed_by_discord_user_id === interaction.user.id) {
      await interaction.reply({ content: 'Tu as deja pris ce ticket.', ephemeral: true }).catch(() => {});
      return true;
    }

    claimTicketEntry(
      internalGuildId,
      entry.id,
      interaction.user.id,
      interaction.user.tag || interaction.user.username || interaction.user.id
    );

    const values = this._getTicketTemplateValues({
      user: interaction.user,
      option,
      ticketNumber: entry.ticket_number,
      reason: entry.reason,
      channelId: entry.channel_id,
      claimer: `<@${interaction.user.id}>`,
    });
    const claimMessage = replaceTicketTemplate(
      generator?.claim_message || 'Ticket pris en charge par {claimer}.',
      values
    ).slice(0, 2000);

    await interaction.reply({ content: 'Ticket pris en charge.', ephemeral: true }).catch(() => {});
    if (interaction.channel?.isTextBased?.()) {
      await interaction.channel.send({
        content: claimMessage,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => {});
    }

    return true;
  }

  async _handleTicketGeneratorClose(interaction, entryId, internalGuildId) {
    const entry = getTicketEntryById(internalGuildId, entryId);
    if (!entry) {
      await interaction.reply({ content: 'Ticket introuvable.', ephemeral: true }).catch(() => {});
      return true;
    }
    if (entry.status === 'closed') {
      await interaction.reply({ content: 'Ce ticket est deja ferme.', ephemeral: true }).catch(() => {});
      return true;
    }

    const generator = getGuildTicketGeneratorById(entry.generator_id);
    const option = (generator?.options || []).find((item) => item.key === entry.option_key);
    const isSupport = this._hasTicketSupportAccess(interaction.member, option);
    const isCreator = String(entry.creator_discord_user_id) === String(interaction.user.id);
    if (!isSupport && !(generator?.allow_user_close && isCreator)) {
      await interaction.reply({ content: 'Tu ne peux pas fermer ce ticket.', ephemeral: true }).catch(() => {});
      return true;
    }

    closeTicketEntry(
      internalGuildId,
      entry.id,
      interaction.user.id,
      interaction.user.tag || interaction.user.username || interaction.user.id
    );

    if (interaction.channel?.permissionOverwrites?.edit && entry.creator_discord_user_id) {
      await interaction.channel.permissionOverwrites.edit(entry.creator_discord_user_id, {
        SendMessages: false,
        AddReactions: false,
        AttachFiles: false,
      }, {
        reason: `Ticket ferme par ${interaction.user.tag || interaction.user.username || interaction.user.id}`,
      }).catch(() => {});
    }

    const values = this._getTicketTemplateValues({
      user: interaction.user,
      option,
      ticketNumber: entry.ticket_number,
      reason: entry.reason,
      channelId: entry.channel_id,
      closer: `<@${interaction.user.id}>`,
    });
    const closeMessage = replaceTicketTemplate(
      generator?.close_message || 'Ticket ferme par {closer}.',
      values
    ).slice(0, 2000);

    await interaction.reply({ content: 'Ticket ferme.', ephemeral: true }).catch(() => {});
    if (interaction.channel?.isTextBased?.()) {
      await interaction.channel.send({
        content: closeMessage,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => {});
    }

    return true;
  }

  async _handleTicketGeneratorInteraction(interaction) {
    const parsed = this._parseTicketGeneratorCustomId(interaction?.customId);
    if (!parsed || !interaction?.guild) return false;

    const internalGuildId = this._resolveInternalGuildId(interaction.guild.id);
    if (!internalGuildId) {
      if (typeof interaction.reply === 'function') {
        await interaction.reply({ content: 'Serveur tickets introuvable.', ephemeral: true }).catch(() => {});
      }
      return true;
    }

    try {
      if (interaction.isStringSelectMenu() && parsed.type === 'open') {
        const generator = getGuildTicketGeneratorById(parsed.args[0]);
        const option = (generator?.options || []).find((item) => item.key === interaction.values?.[0] && item.enabled);
        if (!generator?.id || generator.guild_id !== internalGuildId || !option) {
          await interaction.reply({ content: 'Ce ticket est indisponible.', ephemeral: true }).catch(() => {});
          return true;
        }
        await this._showTicketGeneratorModal(interaction, generator, option);
        return true;
      }

      if (interaction.isModalSubmit() && parsed.type === 'submit') {
        const generator = getGuildTicketGeneratorById(parsed.args[0]);
        const option = (generator?.options || []).find((item) => item.key === parsed.args[1] && item.enabled);
        if (!generator?.id || generator.guild_id !== internalGuildId || !option) {
          await interaction.reply({ content: 'Ce ticket est indisponible.', ephemeral: true }).catch(() => {});
          return true;
        }
        return this._handleTicketGeneratorSubmit(interaction, generator, option, internalGuildId);
      }

      if (interaction.isButton() && parsed.type === 'claim') {
        return this._handleTicketGeneratorClaim(interaction, parsed.args[0], internalGuildId);
      }

      if (interaction.isButton() && parsed.type === 'close') {
        return this._handleTicketGeneratorClose(interaction, parsed.args[0], internalGuildId);
      }
    } catch (error) {
      logger.error(`Ticket interaction error: ${error.message}`);
      if (!interaction.replied && !interaction.deferred && typeof interaction.reply === 'function') {
        await interaction.reply({ content: 'Impossible de traiter ce ticket pour le moment.', ephemeral: true }).catch(() => {});
      } else if (typeof interaction.followUp === 'function') {
        await interaction.followUp({ content: 'Impossible de traiter ce ticket pour le moment.', ephemeral: true }).catch(() => {});
      }
      return true;
    }

    return false;
  }

  async _executeNativeClear(source, command, matchedTrigger = null) {
    const channel = source.channel;
    const guild = source.guild;
    if (!guild || !channel?.bulkDelete) return false;

    const actionConfig = normalizeCommandActionConfig(COMMAND_ACTION_TYPES.CLEAR_MESSAGES, command.action_config);
    const isSlash = typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand();
    const rawAmount = isSlash
      ? source.options.getInteger('amount')
      : this._extractNativeArgs(source, matchedTrigger)[0];

    if (!isSlash && (rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === '')) {
      const usageMessage = command.usage_hint
        ? `Indique une quantite. Exemple: ${command.usage_hint}`
        : 'Indique le nombre de messages a supprimer.';
      await this._replyToNativeSource(source, usageMessage, { ephemeral: true });
      return true;
    }

    const amount = clampNumber(rawAmount, actionConfig.min_amount, actionConfig.max_amount, actionConfig.min_amount);

    const memberPermissions = typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()
      ? source.memberPermissions
      : source.member?.permissions;
    const botPermissions = channel.permissionsFor?.(guild.members.me);

    if (!memberPermissions?.has(PermissionFlagsBits.ManageMessages) || !botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      await this._replyToNativeSource(source, actionConfig.denied_message, { ephemeral: true });
      return true;
    }

    const deleted = await channel.bulkDelete(amount, true).catch(() => null);
    const deletedCount = deleted?.size || 0;

    if (deletedCount <= 0) {
      await this._replyToNativeSource(source, actionConfig.empty_message, { ephemeral: true });
      return true;
    }

    const successMessage = String(actionConfig.success_message || '{count} messages supprimes dans {channel}.')
      .replace(/\{count\}/g, String(deletedCount))
      .replace(/\{channel\}/g, `#${channel.name || 'salon'}`);

    await this._replyToNativeSource(source, successMessage, {
      ephemeral: actionConfig.success_visibility !== 'public',
      preferReply: false,
    });

    await this._logNativeCommandToChannel(
      guild,
      actionConfig.log_channel_id,
      'Clear execute',
      [
        `Commande: ${command.display_trigger}`,
        `Salon: <#${channel.id}>`,
        `Auteur: <@${source.user?.id || source.author?.id}>`,
        `Messages supprimes: ${deletedCount}`,
      ],
      0x22d3ee
    );

    return true;
  }

  async _executeNativeTicketPanel(source) {
    const guild = source?.guild;
    if (!guild) return false;

    const memberPermissions = typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()
      ? source.memberPermissions
      : source.member?.permissions;
    const botPermissions = guild.members.me?.permissions;

    if (!memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await this._replyToNativeSource(source, 'Tu dois avoir la permission de gerer les salons pour publier le panel tickets.', { ephemeral: true });
      return true;
    }
    if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await this._replyToNativeSource(source, 'Le bot doit avoir la permission de gerer les salons pour publier le panel tickets.', { ephemeral: true });
      return true;
    }

    const panel = await this.publishTicketGeneratorPanel(guild.id);
    await this._replyToNativeSource(source, `Panel tickets publie dans <#${panel.channel_id}>.`, {
      ephemeral: true,
      preferReply: false,
    });
    return true;
  }

  async _executeNativeModeration(source, command) {
    if (!(typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand())) {
      await this._replyToNativeSource(source, 'Cette commande native est disponible en slash uniquement.', { preferReply: true });
      return true;
    }

    const guild = source.guild;
    const moderatorName = source.user?.tag || source.user?.username || 'Moderateur';
    const permission = getDefaultNativePermission(command.action_type);
    const actionConfig = normalizeCommandActionConfig(command.action_type, command.action_config);
    const reason = String(source.options.getString('reason') || '').trim();
    const requireReason = !!actionConfig.require_reason;
    const botMember = guild.members.me;

    if (permission && !source.memberPermissions?.has(permission)) {
      await this._replyToNativeSource(source, 'Tu n as pas la permission pour executer cette commande.', { ephemeral: true });
      return true;
    }
    if (permission && !botMember?.permissions?.has(permission)) {
      await this._replyToNativeSource(source, 'Le bot n a pas la permission requise pour executer cette commande.', { ephemeral: true });
      return true;
    }
    if (requireReason && !reason) {
      await this._replyToNativeSource(source, 'Une raison est obligatoire pour cette commande.', { ephemeral: true });
      return true;
    }

    const effectiveReason = reason || 'Aucune raison precisee.';
    const visibilityIsPublic = actionConfig.success_visibility === 'public';
    const replyOptions = { ephemeral: !visibilityIsPublic };
    const resolveTargetMember = async () => {
      const user = source.options.getUser('user', true);
      const member = source.options.getMember('user')
        || await guild.members.fetch(user.id).catch(() => null);
      return { user, member };
    };

    switch (command.action_type) {
      case COMMAND_ACTION_TYPES.BAN_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (targetMember && !targetMember.bannable) {
          await this._replyToNativeSource(source, 'Je ne peux pas bannir ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'ban',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            moderatorName,
          }).catch(() => {});
        }
        await guild.members.ban(targetUser, {
          reason: effectiveReason,
          deleteMessageSeconds: clampNumber(actionConfig.delete_message_seconds, 0, 604800, 0),
        });
        await recordModAction(guild.id, 'ban', targetUser.id, targetUser.globalName || targetUser.username, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Ban execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0xef4444);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete banni.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.BLACKLIST_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (targetMember && !targetMember.bannable) {
          await this._replyToNativeSource(source, 'Je ne peux pas blacklist ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'blacklist',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            moderatorName,
          }).catch(() => {});
        }
        await banUserAcrossBotNetwork(
          this.userId,
          targetUser.id,
          targetUser.globalName || targetUser.username || targetUser.id,
          this.token,
          effectiveReason,
          'SYSTEM_COMMAND',
          clampNumber(actionConfig.delete_message_seconds, 0, 604800, 0)
        );
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Blacklist executee', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0xdc2626);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete ajoute a la blacklist reseau.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.KICK_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.kickable) {
          await this._replyToNativeSource(source, 'Je ne peux pas expulser ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'kick',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            moderatorName,
          }).catch(() => {});
        }
        await targetMember.kick(effectiveReason);
        await recordModAction(guild.id, 'kick', targetUser.id, targetUser.globalName || targetUser.username, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Kick execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0xf97316);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete expulse.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.SOFTBAN_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (targetMember && !targetMember.bannable) {
          await this._replyToNativeSource(source, 'Je ne peux pas softban ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'ban',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            moderatorName,
          }).catch(() => {});
        }
        await guild.members.ban(targetUser, {
          reason: effectiveReason,
          deleteMessageSeconds: clampNumber(actionConfig.delete_message_seconds, 0, 604800, 0),
        });
        try {
          await guild.members.unban(targetUser.id, `Softban release: ${effectiveReason}`);
        } catch (error) {
          logger.warn(`Softban rollback failed for ${targetUser.id}: ${error.message}`);
          await this._replyToNativeSource(source, `Le membre <@${targetUser.id}> a ete banni, mais le deban automatique a echoue.`, { ephemeral: true });
          return true;
        }
        await recordModAction(guild.id, 'ban', targetUser.id, targetUser.globalName || targetUser.username, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
          variant: 'softban',
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Softban execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Historique supprime: ${clampNumber(actionConfig.delete_message_seconds, 0, 604800, 0)} seconde(s)`,
          `Raison: ${effectiveReason}`,
        ], 0xfb7185);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete softban puis debanni.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.moderatable) {
          await this._replyToNativeSource(source, 'Je ne peux pas mettre ce membre en timeout avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        const requestedMinutes = source.options.getInteger('minutes');
        const durationMs = requestedMinutes !== null
          ? parseDurationToMs(requestedMinutes, Number(actionConfig.default_duration_ms || 600000))
          : clampDurationMs(actionConfig.default_duration_ms, 60000, 2419200000, 600000);
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'timeout',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            durationMs,
            moderatorName,
          }).catch(() => {});
        }
        await targetMember.timeout(durationMs, effectiveReason);
        await recordModAction(guild.id, 'timeout', targetUser.id, targetUser.globalName || targetUser.username, source.user.id, moderatorName, effectiveReason, durationMs, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Timeout execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Duree: ${Math.max(1, Math.round(durationMs / 60000))} minute(s)`,
          `Raison: ${effectiveReason}`,
        ], 0xf59e0b);
        await this._replyToNativeSource(source, `<@${targetUser.id}> est en timeout pour ${Math.max(1, Math.round(durationMs / 60000))} minute(s).`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.moderatable) {
          await this._replyToNativeSource(source, 'Je ne peux pas retirer le timeout de ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        await targetMember.timeout(null, effectiveReason);
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'untimeout',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            moderatorName,
          }).catch(() => {});
        }
        await recordModAction(guild.id, 'untimeout', targetUser.id, targetUser.globalName || targetUser.username, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Untimeout execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x22c55e);
        await this._replyToNativeSource(source, `Le timeout de <@${targetUser.id}> a ete retire.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.WARN_MEMBER: {
        const { user: targetUser } = await resolveTargetMember();
        const points = clampNumber(source.options.getInteger('points') ?? actionConfig.default_points, 1, 20, 1);
        const targetName = targetUser.globalName || targetUser.username || targetUser.id;
        await addWarning(guild.id, targetUser.id, targetName, source.user.id, moderatorName, effectiveReason, points, {
          command_id: command.id,
          system_key: command.system_key,
          moderator_discord_id: source.user.id,
        });
        await recordModAction(guild.id, 'warn', targetUser.id, targetName, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
          points,
        });
        if (actionConfig.dm_user) {
          await safeSendModerationDm({
            botToken: this.token,
            guildId: guild.id,
            guild,
            actionType: 'warn',
            targetUserId: targetUser.id,
            reason: effectiveReason,
            points,
            moderatorName,
          }).catch(() => {});
        }
        await checkEscalation(guild.id, targetUser.id, targetName, this.token, guild).catch(() => {});
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Warn execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Points: ${points}`,
          `Raison: ${effectiveReason}`,
        ], 0xeab308);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a recu ${points} point(s) d avertissement.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.UNBAN_MEMBER: {
        const targetUserId = normalizeSnowflake(source.options.getString('user_id', true));
        if (!targetUserId) {
          await this._replyToNativeSource(source, 'L identifiant Discord fourni est invalide.', { ephemeral: true });
          return true;
        }
        const banEntry = await guild.bans.fetch(targetUserId).catch(() => null);
        if (!banEntry?.user) {
          await this._replyToNativeSource(source, 'Aucun ban actif trouve pour cet utilisateur.', { ephemeral: true });
          return true;
        }
        await guild.members.unban(targetUserId, effectiveReason);
        await recordModAction(guild.id, 'unban', targetUserId, banEntry.user.globalName || banEntry.user.username || targetUserId, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Unban execute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUserId}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x22c55e);
        await this._replyToNativeSource(source, `<@${targetUserId}> a ete debanni.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER: {
        const targetUserId = normalizeSnowflake(source.options.getString('user_id', true));
        if (!targetUserId) {
          await this._replyToNativeSource(source, 'L identifiant Discord fourni est invalide.', { ephemeral: true });
          return true;
        }
        const currentEntry = getBlacklistEntry(this.userId, targetUserId);
        if (!currentEntry) {
          await this._replyToNativeSource(source, 'Aucune entree de blacklist reseau trouvee pour cet utilisateur.', { ephemeral: true });
          return true;
        }
        const removed = removeBlacklistEntry(this.userId, targetUserId);
        if (!removed) {
          await this._replyToNativeSource(source, 'Impossible de retirer cette entree de blacklist pour le moment.', { ephemeral: true });
          return true;
        }
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Blacklist retiree', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUserId}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x10b981);
        await this._replyToNativeSource(source, `<@${targetUserId}> a ete retire de la blacklist reseau.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.ADD_ROLE: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        const role = source.options.getRole('role', true);
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.manageable || !role?.editable) {
          await this._replyToNativeSource(source, 'Je ne peux pas gerer ce role ou ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        if (targetMember.roles.cache.has(role.id)) {
          await this._replyToNativeSource(source, 'Ce membre possede deja ce role.', { ephemeral: true });
          return true;
        }
        await targetMember.roles.add(role, effectiveReason);
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Role ajoute', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Role: <@&${role.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x60a5fa);
        await this._replyToNativeSource(source, `<@&${role.id}> a ete ajoute a <@${targetUser.id}>.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.REMOVE_ROLE: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        const role = source.options.getRole('role', true);
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.manageable || !role?.editable) {
          await this._replyToNativeSource(source, 'Je ne peux pas gerer ce role ou ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        if (!targetMember.roles.cache.has(role.id)) {
          await this._replyToNativeSource(source, 'Ce membre ne possede pas ce role.', { ephemeral: true });
          return true;
        }
        await targetMember.roles.remove(role, effectiveReason);
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Role retire', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Role: <@&${role.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x38bdf8);
        await this._replyToNativeSource(source, `<@&${role.id}> a ete retire a <@${targetUser.id}>.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.SET_NICKNAME: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        const nickname = String(source.options.getString('nickname', true) || '').trim();
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.manageable) {
          await this._replyToNativeSource(source, 'Je ne peux pas modifier le pseudo de ce membre avec la hierarchie actuelle.', { ephemeral: true });
          return true;
        }
        await targetMember.setNickname(nickname, effectiveReason);
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Pseudo modifie', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Nouveau pseudo: ${nickname}`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0xa78bfa);
        await this._replyToNativeSource(source, `Le pseudo de <@${targetUser.id}> est maintenant "${nickname}".`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.LOCK_CHANNEL:
      case COMMAND_ACTION_TYPES.UNLOCK_CHANNEL: {
        const channel = await this._resolveTextChannel(source, actionConfig);
        if (!channel || channel.isThread?.() || !channel.permissionOverwrites?.edit) {
          await this._replyToNativeSource(source, 'Choisis un salon texte standard pour cette commande.', { ephemeral: true });
          return true;
        }
        const channelBotPermissions = channel.permissionsFor(botMember);
        if (!channelBotPermissions?.has(PermissionFlagsBits.ManageChannels)) {
          await this._replyToNativeSource(source, 'Le bot n a pas la permission de gerer ce salon.', { ephemeral: true });
          return true;
        }
        const shouldLock = command.action_type === COMMAND_ACTION_TYPES.LOCK_CHANNEL;
        await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
          SendMessages: shouldLock ? false : null,
          AddReactions: shouldLock ? false : null,
        }, { reason: effectiveReason });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, shouldLock ? 'Salon verrouille' : 'Salon deverrouille', [
          `Commande: ${command.display_trigger}`,
          `Salon: <#${channel.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], shouldLock ? 0xf97316 : 0x22c55e);
        await this._replyToNativeSource(source, `Le salon <#${channel.id}> est maintenant ${shouldLock ? 'verrouille' : 'deverrouille'}.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL: {
        const channel = await this._resolveTextChannel(source, actionConfig);
        if (!channel || typeof channel.setRateLimitPerUser !== 'function') {
          await this._replyToNativeSource(source, 'Ce salon ne prend pas en charge le slowmode.', { ephemeral: true });
          return true;
        }
        const channelBotPermissions = channel.permissionsFor(botMember);
        if (!channelBotPermissions?.has(PermissionFlagsBits.ManageChannels)) {
          await this._replyToNativeSource(source, 'Le bot n a pas la permission de gerer ce salon.', { ephemeral: true });
          return true;
        }
        const seconds = clampNumber(source.options.getInteger('seconds') ?? actionConfig.default_seconds, 0, 21600, 30);
        await channel.setRateLimitPerUser(seconds, effectiveReason);
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Slowmode modifie', [
          `Commande: ${command.display_trigger}`,
          `Salon: <#${channel.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Slowmode: ${seconds} seconde(s)`,
          `Raison: ${effectiveReason}`,
        ], 0xf59e0b);
        await this._replyToNativeSource(source, seconds > 0 ? `Le slowmode de <#${channel.id}> est regle a ${seconds} seconde(s).` : `Le slowmode de <#${channel.id}> est desactive.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.SAY_MESSAGE: {
        const channel = await this._resolveTextChannel(source, actionConfig);
        const message = String(source.options.getString('message', true) || '').trim();
        if (!channel?.isTextBased?.()) {
          await this._replyToNativeSource(source, 'Aucun salon texte valide n a ete trouve pour publier ce message.', { ephemeral: true });
          return true;
        }
        const channelBotPermissions = channel.permissionsFor?.(botMember);
        if (!channelBotPermissions?.has(PermissionFlagsBits.SendMessages)) {
          await this._replyToNativeSource(source, 'Le bot ne peut pas envoyer de message dans ce salon.', { ephemeral: true });
          return true;
        }
        const allowMentionsOption = source.options.getBoolean('allow_mentions');
        const allowMentions = allowMentionsOption === null ? !!actionConfig.allow_mentions : !!allowMentionsOption;
        await channel.send({
          content: message,
          allowedMentions: allowMentions ? undefined : { parse: [] },
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Message envoye', [
          `Commande: ${command.display_trigger}`,
          `Salon: <#${channel.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Contenu: ${message.slice(0, 240)}`,
        ], 0x06b6d4);
        await this._replyToNativeSource(source, `Message envoye dans <#${channel.id}>.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE: {
        const channel = await this._resolveTextChannel(source, actionConfig);
        const message = String(source.options.getString('message', true) || '').trim();
        const title = String(source.options.getString('title') || command.embed_title || 'Annonce').trim().slice(0, 120) || 'Annonce';
        const pingEveryoneOption = source.options.getBoolean('ping_everyone');
        const pingEveryone = pingEveryoneOption === null ? !!actionConfig.ping_everyone : !!pingEveryoneOption;
        if (!channel?.isTextBased?.()) {
          await this._replyToNativeSource(source, 'Aucun salon texte valide n a ete trouve pour publier cette annonce.', { ephemeral: true });
          return true;
        }
        const channelBotPermissions = channel.permissionsFor?.(botMember);
        if (!channelBotPermissions?.has(PermissionFlagsBits.SendMessages)) {
          await this._replyToNativeSource(source, 'Le bot ne peut pas publier dans ce salon.', { ephemeral: true });
          return true;
        }
        if (pingEveryone) {
          if (!source.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) || !channelBotPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
            await this._replyToNativeSource(source, 'Le @everyone demande la permission de mention globale pour toi et pour le bot.', { ephemeral: true });
            return true;
          }
        }
        await channel.send({
          content: pingEveryone ? '@everyone' : undefined,
          embeds: [{
            title,
            description: message,
            color: this._hexColorToInt(command.embed_color, 0x8b5cf6),
            timestamp: new Date().toISOString(),
          }],
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Annonce publiee', [
          `Commande: ${command.display_trigger}`,
          `Salon: <#${channel.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Titre: ${title}`,
          `Ping everyone: ${pingEveryone ? 'oui' : 'non'}`,
        ], 0x8b5cf6);
        await this._replyToNativeSource(source, `Annonce publiee dans <#${channel.id}>.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.MOVE_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        const destinationChannel = await this._resolveVoiceChannel(source);
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!destinationChannel) {
          await this._replyToNativeSource(source, 'Choisis un salon vocal valide pour cette commande.', { ephemeral: true });
          return true;
        }
        if (!targetMember.voice?.channelId) {
          await this._replyToNativeSource(source, 'Ce membre n est connecte a aucun salon vocal.', { ephemeral: true });
          return true;
        }
        const destinationPermissions = destinationChannel.permissionsFor(botMember);
        if (!destinationPermissions?.has(PermissionFlagsBits.Connect)) {
          await this._replyToNativeSource(source, 'Le bot ne peut pas rejoindre le salon vocal de destination.', { ephemeral: true });
          return true;
        }
        await targetMember.voice.setChannel(destinationChannel, effectiveReason);
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Membre deplace', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Destination: <#${destinationChannel.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x14b8a6);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete deplace vers <#${destinationChannel.id}>.`, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.DISCONNECT_MEMBER: {
        const { user: targetUser, member: targetMember } = await resolveTargetMember();
        if (!targetMember) {
          await this._replyToNativeSource(source, 'Le membre est introuvable sur ce serveur.', { ephemeral: true });
          return true;
        }
        if (!targetMember.voice?.channelId) {
          await this._replyToNativeSource(source, 'Ce membre n est connecte a aucun salon vocal.', { ephemeral: true });
          return true;
        }
        await targetMember.voice.setChannel(null, effectiveReason);
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Membre deconnecte', [
          `Commande: ${command.display_trigger}`,
          `Cible: <@${targetUser.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Raison: ${effectiveReason}`,
        ], 0x0ea5e9);
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete deconnecte de son salon vocal.`, replyOptions);
        return true;
      }

      default:
        return false;
    }
  }

  async _executeNativeCommand(source, command, matchedTrigger = null) {
    switch (command.action_type) {
      case COMMAND_ACTION_TYPES.CLEAR_MESSAGES:
        return this._executeNativeClear(source, command, matchedTrigger);
      case COMMAND_ACTION_TYPES.TICKET_PANEL:
        return this._executeNativeTicketPanel(source, command, matchedTrigger);
      case COMMAND_ACTION_TYPES.BAN_MEMBER:
      case COMMAND_ACTION_TYPES.BLACKLIST_MEMBER:
      case COMMAND_ACTION_TYPES.KICK_MEMBER:
      case COMMAND_ACTION_TYPES.SOFTBAN_MEMBER:
      case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER:
      case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
      case COMMAND_ACTION_TYPES.WARN_MEMBER:
      case COMMAND_ACTION_TYPES.UNBAN_MEMBER:
      case COMMAND_ACTION_TYPES.UNBLACKLIST_MEMBER:
      case COMMAND_ACTION_TYPES.ADD_ROLE:
      case COMMAND_ACTION_TYPES.REMOVE_ROLE:
      case COMMAND_ACTION_TYPES.SET_NICKNAME:
      case COMMAND_ACTION_TYPES.LOCK_CHANNEL:
      case COMMAND_ACTION_TYPES.UNLOCK_CHANNEL:
      case COMMAND_ACTION_TYPES.SLOWMODE_CHANNEL:
      case COMMAND_ACTION_TYPES.SAY_MESSAGE:
      case COMMAND_ACTION_TYPES.ANNOUNCE_MESSAGE:
      case COMMAND_ACTION_TYPES.MOVE_MEMBER:
      case COMMAND_ACTION_TYPES.DISCONNECT_MEMBER:
        return this._executeNativeModeration(source, command);
      default:
        return handleCustomCommand(source, command, matchedTrigger);
    }
  }

  // ── Event Handlers ──────────────────────────────────────────────────────────

  async _onMessage(message) {
    if (!message.guild) return; // Ignore DMs at guild module level
    if (message.author?.bot && message.author.id !== this.client.user.id) {
      // Still process for logging
    }

    const guildId = message.guild.id;
    const configs = await this._getEnabledModules(guildId);
    const internalGuildId = this._resolveInternalGuildId(guildId);

    // Security modules — process message content
    const promises = [];

    if (configs.ANTI_SPAM?.enabled) {
      promises.push(handleAntiSpam(message, configs.ANTI_SPAM, this.token, this.userId).catch((e) => logger.error(`AntiSpam error: ${e.message}`)));
    }
    if (configs.ANTI_LINK?.enabled) {
      promises.push(handleAntiLink(message, configs.ANTI_LINK, this.token, this.userId).catch((e) => logger.error(`AntiLink error: ${e.message}`)));
    }
    if (configs.ANTI_INVITE?.enabled) {
      promises.push(handleAntiInvite(message, configs.ANTI_INVITE, this.token, this.userId).catch((e) => logger.error(`AntiInvite error: ${e.message}`)));
    }
    if (configs.ANTI_MASS_MENTION?.enabled) {
      promises.push(handleAntiMassMention(message, configs.ANTI_MASS_MENTION, this.token, this.userId).catch((e) => logger.error(`AntiMassMention error: ${e.message}`)));
    }
    if (configs.ANTI_TOKEN_SCAM?.enabled) {
      promises.push(handleAntiTokenScam(message, configs.ANTI_TOKEN_SCAM, this.token, this.userId, internalGuildId, configs).catch((e) => logger.error(`AntiTokenScam error: ${e.message}`)));
    }
    if (configs.AUTO_SLOWMODE?.enabled) {
      promises.push(handleAutoSlowmode(message, configs.AUTO_SLOWMODE, this.token, this.userId, internalGuildId).catch((e) => logger.error(`AutoSlowmode error: ${e.message}`)));
    }

    // Custom commands
    if (configs.CUSTOM_COMMANDS?.enabled) {
      const caseSensitive = !!configs.CUSTOM_COMMANDS.advanced_config?.case_sensitive;
      if (!message.author.bot) {
        const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guildId, this.userId])[0];
        if (guildRow) {
          const commands = db.raw(
            `SELECT * FROM custom_commands
             WHERE guild_id = ? AND enabled = 1 AND command_type != 'slash'
             ORDER BY created_at ASC`,
            [guildRow.id]
          ).map(normalizeCommandRow);

          const match = commands
            .map((command) => ({ command, matchedTrigger: resolveCommandMatch(message.content, command, caseSensitive) }))
            .find((entry) => !!entry.matchedTrigger);

          if (match?.command) {
            promises.push(
              this._executeNativeCommand(message, match.command, match.matchedTrigger)
                .then((executed) => {
                  if (executed) {
                    db.db.prepare('UPDATE custom_commands SET use_count = use_count + 1, updated_at = ? WHERE id = ?')
                      .run(new Date().toISOString(), match.command.id);
                  }
                })
                .catch((e) => logger.error(`CustomCmd error: ${e.message}`))
            );
          }
        }
      }
    }

    await Promise.allSettled(promises);

    // Logging module — message delete will be handled separately via MessageDelete event
  }

  async _onInteraction(interaction) {
    if (!interaction.guild) return;

    if (await this._handleTicketGeneratorInteraction(interaction)) {
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const configs = await this._getEnabledModules(guildId);
    if (!configs.CUSTOM_COMMANDS?.enabled) return;

    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guildId, this.userId])[0];
    if (!guildRow) return;

    const command = db.raw(
      `SELECT * FROM custom_commands
       WHERE guild_id = ? AND enabled = 1 AND command_type = 'slash' AND command_name = ?
       LIMIT 1`,
      [guildRow.id, interaction.commandName]
    )[0];

    if (!command) return;

    const normalizedCommand = normalizeCommandRow(command);

    try {
      const executed = await this._executeNativeCommand(interaction, normalizedCommand, `/${interaction.commandName}`);
      if (executed) {
        db.db.prepare('UPDATE custom_commands SET use_count = use_count + 1, updated_at = ? WHERE id = ?')
          .run(new Date().toISOString(), normalizedCommand.id);
      }
    } catch (error) {
      logger.error(`SlashCmd error: ${error.message}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Commande indisponible pour le moment.', ephemeral: true }).catch(() => {});
      }
    }
  }

  async _onMemberAdd(member) {
    const blockedByBlacklist = await enforceBlacklistOnJoin(this.userId, member, this.token)
      .catch((e) => {
        logger.error(`Bot blacklist error: ${e.message}`);
        return false;
      });
    if (blockedByBlacklist) return;

    const guildId = member.guild.id;
    const configs = await this._getEnabledModules(guildId);
    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guildId, this.userId])[0];
    const internalId = guildRow?.id;

    const promises = [];
    let raidResult = { raidTriggered: false, suspiciousNewAccount: false };

    if (configs.ANTI_RAID?.enabled) {
      raidResult = await handleAntiRaid(member, configs.ANTI_RAID, this.token, this.userId).catch((e) => {
        logger.error(`AntiRaid error: ${e.message}`);
        return { raidTriggered: false, suspiciousNewAccount: false };
      });
    }
    if (configs.ANTI_ALT_ACCOUNT?.enabled && !raidResult?.raidTriggered && !raidResult?.suspiciousNewAccount) {
      promises.push(handleAntiAltAccount(member, configs.ANTI_ALT_ACCOUNT, this.token, this.userId, internalId, configs).catch((e) => logger.error(`AntiAlt error: ${e.message}`)));
    }
    if (configs.ANTI_BOT?.enabled) {
      promises.push(handleAntiBotJoin(member, configs.ANTI_BOT, this.token, this.userId).catch((e) => logger.error(`AntiBot error: ${e.message}`)));
    }
    if (configs.WELCOME_MESSAGE?.enabled) {
      promises.push(handleWelcomeMessage(member, configs.WELCOME_MESSAGE, this.token, internalId, this.userId).catch((e) => logger.error(`Welcome error: ${e.message}`)));
    }
    if (configs.AUTO_ROLE?.enabled) {
      promises.push(handleAutoRole(member, configs.AUTO_ROLE, this.token, internalId, this.userId).catch((e) => logger.error(`AutoRole error: ${e.message}`)));
    }
    if (configs.LOGGING?.enabled) {
      promises.push(handleLogging('member_join', { user: member.user }, configs.LOGGING, this.token).catch(() => {}));
    }

    await Promise.allSettled(promises);
    if (configs.LOCKDOWN?.enabled && configs.LOCKDOWN.simple_config?.trigger_on_raid && raidResult?.raidTriggered) {
      await activateLockdown({
        guild: member.guild,
        configs,
        botToken: this.token,
        ownerUserId: this.userId,
        internalGuildId: internalId,
        source: 'anti_raid',
        reason: 'Lockdown automatique apres detection anti-raid',
      }).catch((e) => logger.error(`Lockdown error: ${e.message}`));
    }
    this._notifyScanUpdate(member.guild.id, {
      memberId: member.user?.id || null,
      reason: 'member_join',
    });
  }

  async _onMemberRemove(member) {
    const guildId = member.guild.id;
    const configs = await this._getEnabledModules(guildId);

    if (configs.ANTI_NUKE?.enabled && configs.ANTI_NUKE.advanced_config?.watch_kick_bursts) {
      const internalGuildId = this._resolveInternalGuildId(guildId);
      await handleAntiNukeEvent({
        guild: member.guild,
        kind: 'member_kick',
        auditActionType: 20,
        targetId: member.user?.id || null,
        targetLabel: member.user?.globalName || member.user?.tag || member.user?.username || member.user?.id || 'Membre',
      }, configs.ANTI_NUKE, this.token, this.userId, internalGuildId, configs).catch((error) => {
        logger.error(`AntiNuke kick error: ${error.message}`);
      });
    }

    if (configs.LOGGING?.enabled) {
      await handleLogging('member_leave', { user: member.user }, configs.LOGGING, this.token).catch(() => {});
    }
    this._notifyScanUpdate(guildId, {
      memberId: member.user?.id || null,
      reason: 'member_leave',
    });
  }

  async _onMessageDelete(message) {
    if (!message.guild) return;
    const configs = await this._getEnabledModules(message.guild.id);
    this._storeDiscordRuntimeLog(message.guild.id, 'Contenu supprime', {
      event_type: 'message_delete_content',
      action_label: 'Contenu supprime',
      target_id: message.author?.id || null,
      target_label: message.author?.globalName || message.author?.tag || message.author?.username || message.author?.id || 'Utilisateur inconnu',
      target_avatar_url: message.author?.displayAvatarURL?.({ size: 128 }) || null,
      channel_id: message.channel?.id || null,
      channel_name: message.channel?.name || null,
      content: String(message.content || '').slice(0, 1600),
      attachments: [...(message.attachments?.values?.() || [])].slice(0, 5).map((attachment) => ({
        id: attachment.id,
        name: attachment.name || 'fichier',
        content_type: attachment.contentType || null,
        url: attachment.url || null,
      })),
    });
    if (configs.LOGGING?.enabled) {
      await handleLogging('message_delete', {
        author: message.author,
        channel: message.channel,
        content: message.content,
      }, configs.LOGGING, this.token).catch(() => {});
    }
    this._notifyScanUpdate(message.guild.id, {
      memberId: message.author?.id || null,
      reason: 'message_delete',
    });
  }

  async _onMessageBulkDelete(messages) {
    const list = [...(messages?.values?.() || [])];
    const first = list[0];
    if (!first?.guild) return;

    const groupedAuthors = new Map();
    const groupedContents = new Map();

    for (const message of list) {
      const authorId = message.author?.id || 'unknown';
      const authorLabel = message.author?.globalName || message.author?.tag || message.author?.username || authorId;
      const currentAuthor = groupedAuthors.get(authorId) || {
        id: message.author?.id || null,
        label: authorLabel,
        count: 0,
      };
      currentAuthor.count += 1;
      groupedAuthors.set(authorId, currentAuthor);

      const rawContent = String(message.content || '').trim();
      if (!rawContent) continue;
      const currentContent = groupedContents.get(rawContent) || { content: rawContent, count: 0 };
      currentContent.count += 1;
      groupedContents.set(rawContent, currentContent);
    }

    this._storeDiscordRuntimeLog(first.guild.id, 'Suppression multiple detectee', {
      event_type: 'message_bulk_delete_content',
      action_label: 'Suppression multiple detectee',
      target_count: list.length,
      channel_id: first.channel?.id || null,
      channel_name: first.channel?.name || null,
      authors: [...groupedAuthors.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      contents: [...groupedContents.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    });
    this._notifyScanUpdate(first.guild.id, {
      reason: 'message_bulk_delete',
    });
  }

  async _onMessageUpdate(oldMsg, newMsg) {
    if (!newMsg.guild) return;
    if (oldMsg.content === newMsg.content) return;
    const configs = await this._getEnabledModules(newMsg.guild.id);
    if (configs.LOGGING?.enabled) {
      await handleLogging('message_edit', {
        author: newMsg.author,
        channel: newMsg.channel,
        oldContent: oldMsg.content,
        newContent: newMsg.content,
      }, configs.LOGGING, this.token).catch(() => {});
    }
    this._notifyScanUpdate(newMsg.guild.id, {
      memberId: newMsg.author?.id || null,
      reason: 'message_edit',
    });
  }

  async _onBanAdd(ban) {
    const configs = await this._getEnabledModules(ban.guild.id);

    if (configs.ANTI_NUKE?.enabled && configs.ANTI_NUKE.advanced_config?.watch_ban_bursts) {
      const internalGuildId = this._resolveInternalGuildId(ban.guild.id);
      await handleAntiNukeEvent({
        guild: ban.guild,
        kind: 'ban_add',
        auditActionType: 22,
        targetId: ban.user?.id || null,
        targetLabel: ban.user?.globalName || ban.user?.tag || ban.user?.username || ban.user?.id || 'Utilisateur',
      }, configs.ANTI_NUKE, this.token, this.userId, internalGuildId, configs).catch((error) => {
        logger.error(`AntiNuke ban error: ${error.message}`);
      });
    }

    if (configs.LOGGING?.enabled) {
      await handleLogging('ban', { user: ban.user, reason: ban.reason }, configs.LOGGING, this.token).catch(() => {});
    }
  }

  async _onMemberUpdate(oldMember, newMember) {
    if (!newMember.guild) return;
    const configs = await this._getEnabledModules(newMember.guild.id);
    if (!configs.LOGGING?.enabled) return;

    // Nickname change
    if (oldMember.nickname !== newMember.nickname) {
      await handleLogging('nickname_change', {
        member: newMember,
        oldNick: oldMember.nickname,
        newNick: newMember.nickname,
      }, configs.LOGGING, this.token).catch(() => {});
    }

    // Role update
    const oldRoles = [...oldMember.roles.cache.keys()];
    const newRoles = [...newMember.roles.cache.keys()];
    const added = newRoles.filter((r) => !oldRoles.includes(r)).map((r) => `<@&${r}>`);
    const removed = oldRoles.filter((r) => !newRoles.includes(r)).map((r) => `<@&${r}>`);
    if (added.length || removed.length) {
      await handleLogging('role_update', { member: newMember, added, removed }, configs.LOGGING, this.token).catch(() => {});
    }
    this._notifyScanUpdate(newMember.guild.id, {
      memberId: newMember.user?.id || null,
      reason: 'member_update',
    });
  }

  async _onAutoModerationActionExecution(execution) {
    const ruleName = execution.autoModerationRule?.name || '';
    const ruleKey = getManagedRuleKey(ruleName);
    if (!ruleKey) return;

    const executionKey = [
      ruleKey,
      execution.guild?.id,
      execution.userId,
      execution.messageId || '',
      execution.matchedContent || execution.content || '',
    ].join(':');
    if (shouldSkipNativeExecution(executionKey)) return;

    const guild = execution.guild;
    if (!guild) return;

    const configs = await this._getEnabledModules(guild.id);
    const member = execution.member || await guild.members.fetch(execution.userId).catch(() => null);
    const target = member || execution.user || { id: execution.userId, tag: execution.userId };

    try {
      switch (ruleKey) {
        case RULE_KEYS.ANTI_INVITE: {
          const moduleConfig = configs.ANTI_INVITE;
          const action = moduleConfig?.advanced_config?.punishment_action || 'delete';
          if (action === 'kick' || action === 'ban' || action === 'blacklist') {
            await punishSecurityAction(action, guild, target, this.token, 'Anti-Invite: blocked before posting', moduleConfig?.advanced_config?.timeout_duration_ms, 'ANTI_INVITE', this.userId);
          }
          break;
        }

        case RULE_KEYS.ANTI_MASS_MENTION: {
          const moduleConfig = configs.ANTI_MASS_MENTION;
          const action = moduleConfig?.simple_config?.action || 'delete';
          if (action === 'kick' || action === 'ban' || action === 'blacklist') {
            await punishSecurityAction(action, guild, target, this.token, 'Anti-Mention: blocked before posting', moduleConfig?.advanced_config?.timeout_duration_ms, 'ANTI_MASS_MENTION', this.userId);
          }
          break;
        }

        case RULE_KEYS.AUTO_MOD_PRESET:
        case RULE_KEYS.AUTO_MOD_CUSTOM: {
          const moduleConfig = configs.AUTO_MOD;
          const action = moduleConfig?.advanced_config?.punishment_action || moduleConfig?.simple_config?.action || 'delete';

          if (action === 'warn') {
            const username = target.tag || target.username || execution.userId;
            await addWarning(guild.id, execution.userId, username, guild.members.me?.id, guild.members.me?.user?.tag ?? 'Bot', 'AutoMod: contenu bloque', 1);
            await safeSendModerationDm({
              botToken: this.token,
              guildId: guild.id,
              guild,
              actionType: 'warn',
              targetUserId: execution.userId,
              reason: 'AutoMod: contenu bloque',
              points: 1,
              moderatorName: guild.members.me?.user?.tag ?? 'Bot',
            });
            await checkEscalation(guild.id, execution.userId, username, this.token, guild);
            break;
          }

          if (action === 'kick' || action === 'ban' || action === 'blacklist') {
            await punishSecurityAction(action, guild, target, this.token, 'AutoMod: contenu bloque', moduleConfig?.advanced_config?.timeout_duration_ms, 'AUTO_MOD', this.userId);
          }
          break;
        }

        default:
          break;
      }
    } catch (error) {
      logger.warn(`Native AutoMod execution failed for ${ruleName}: ${error.message}`, { userId: this.userId, guildId: guild.id });
    }
  }

  async _onGuildStructureEvent(kind, entity) {
    const guild = entity?.guild;
    if (!guild) return;

    const configs = await this._getEnabledModules(guild.id);
    if (!configs.ANTI_NUKE?.enabled) return;

    const auditActionType = (
      kind === 'channel_create' ? 10
        : kind === 'channel_delete' ? 12
          : kind === 'role_create' ? 30
            : kind === 'role_delete' ? 32
              : null
    );
    if (!auditActionType) return;

    const internalGuildId = this._resolveInternalGuildId(guild.id);

    await handleAntiNukeEvent({
      guild,
      kind,
      auditActionType,
      targetId: entity?.id || null,
      targetLabel: entity?.name || entity?.id || kind,
    }, configs.ANTI_NUKE, this.token, this.userId, internalGuildId, configs).catch((error) => {
      logger.error(`AntiNuke event error: ${error.message}`);
    });

    this._notifyScanUpdate(guild.id, {
      reason: 'anti_nuke_event',
    });
  }

  // ── Module Config Cache ─────────────────────────────────────────────────────

  // Cache module configs for 10 seconds to avoid DB thrashing
  _moduleCache = new Map(); // guildId -> { configs, expiresAt }

  async _getEnabledModules(discordGuildId) {
    const cached = this._moduleCache.get(discordGuildId);
    if (cached && cached.expiresAt > Date.now()) return cached.configs;

    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [discordGuildId, this.userId])[0];
    if (!guildRow) return {};

    const modules = db.raw('SELECT * FROM modules WHERE guild_id = ?', [guildRow.id]);
    const configs = {};
    for (const mod of modules) {
      const defaults = MODULE_DEFINITIONS[mod.module_type] || { simple_config: {}, advanced_config: {} };
      configs[mod.module_type] = {
        enabled: !!mod.enabled,
        simple_config: { ...defaults.simple_config, ...JSON.parse(mod.simple_config || '{}') },
        advanced_config: { ...defaults.advanced_config, ...JSON.parse(mod.advanced_config || '{}') },
      };
    }

    this._moduleCache.set(discordGuildId, { configs, expiresAt: Date.now() + 10_000 });
    return configs;
  }

  /** Invalidate module cache for a guild (called when configs change). */
  invalidateModuleCache(discordGuildId) {
    this._moduleCache.delete(discordGuildId);
    if (discordGuildId === undefined) this._moduleCache.clear();
  }

  async syncCommandDefinitions(discordGuildId) {
    await this._syncSlashCommands(discordGuildId);
  }

  // ── Status Management ───────────────────────────────────────────────────────

  _setStatus(status) {
    this.status = status;
    db.db.prepare(
      `INSERT OR REPLACE INTO bot_processes (user_id, status, started_at, restart_count, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(this.userId, status, this.startedAt, this.restartCount, this.lastError, new Date().toISOString());
    this.emit('statusChange', { status, userId: this.userId });
  }

  _scheduleRestart() {
    if (this._stopping) return;
    const maxAttempts = config.BOT_MAX_RESTART_ATTEMPTS;
    if (this.restartCount >= maxAttempts) {
      logger.error(`Bot for user ${this.userId} exceeded max restart attempts (${maxAttempts}). Giving up.`);
      this._setStatus(BotStatus.ERROR);
      return;
    }

    this.restartCount++;
    const delay = config.BOT_RESTART_DELAY_MS * Math.pow(config.BOT_RESTART_BACKOFF_MULTIPLIER, this.restartCount - 1);
    logger.info(`Scheduling bot restart for user ${this.userId} in ${delay}ms (attempt ${this.restartCount}/${maxAttempts})`);

    this._restartTimer = setTimeout(async () => {
      if (!this._stopping) {
        if (this.client) {
          try { this.client.destroy(); } catch { /* ignore */ }
          this.client = null;
        }
        await this.start();
      }
    }, delay);
  }

  // ── Public Accessors ────────────────────────────────────────────────────────

  getStatus() {
    return {
      userId: this.userId,
      status: this.status,
      startedAt: this.startedAt,
      restartCount: this.restartCount,
      lastError: this.lastError,
      ping: this.client?.ws?.ping ?? -1,
      guildCount: this.client?.guilds?.cache?.size ?? 0,
      botTag: this.client?.user?.tag ?? null,
    };
  }
}

module.exports = { BotProcess, BotStatus };
