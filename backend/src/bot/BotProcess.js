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
  AttachmentBuilder,
  EmbedBuilder,
  ActivityType,
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
const {
  buildCaptchaCode,
  buildNumericCaptchaCode,
  getGuildCaptchaConfig,
  getGuildCaptchaConfigById,
  getSelectedCaptchaChallenge,
  saveGuildCaptchaConfig,
  recordPublishedCaptchaPanel,
  createCaptchaChallenge,
  getActiveCaptchaChallengeById,
  validateCaptchaChallenge,
} = require('../services/captchaGeneratorService');
const { buildCaptchaPngAttachment } = require('../services/captchaImageService');
const {
  getGuildVoiceGenerator,
  getGuildVoiceGeneratorById,
  getGuildVoiceGeneratorForDiscord,
  recordPublishedVoiceGenerator,
  getTempVoiceRoomById,
  getTempVoiceRoomByChannelId,
  getActiveTempVoiceRoomByOwner,
  createTempVoiceRoomEntry,
  updateTempVoiceRoom,
  closeTempVoiceRoom,
  buildVoiceRoomName,
  SUPPORTED_REGIONS,
} = require('../services/voiceGeneratorService');
const { getBotProfileSettings } = require('../services/botProfileService');
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
const LEGACY_TICKET_DUPLICATE_FOOTER = 'Une seule demande active par categorie si la protection anti-doublon est active.';
const LEGACY_TICKET_PANEL_DESCRIPTION = 'Choisis le bon motif dans le menu ci-dessous pour ouvrir un salon privé avec le staff adapté.';
const DEFAULT_TICKET_PANEL_DESCRIPTION = 'Crée ton ticket depuis le menu ci-dessous.';
const TICKET_DELETE_DELAY_MS = 2000;
const MAX_TICKET_TRANSCRIPT_BYTES = 7_500_000;
const MAX_TICKET_TRANSCRIPT_MESSAGES = 5000;
const CAPTCHA_GENERATOR_PREFIX = 'captcha';
const CAPTCHA_ANSWER_INPUT_ID = 'captcha_answer';
const VOICE_GENERATOR_PREFIX = 'voicegen';
const VOICE_MODAL_INPUT_ID = 'voice_value';
const CAPTCHA_EMOJI_CHOICES = Object.freeze([
  { value: 'shield', emoji: '🛡️', label: 'Bouclier' },
  { value: 'spark', emoji: '✨', label: 'Étincelle' },
  { value: 'rocket', emoji: '🚀', label: 'Fusée' },
  { value: 'gem', emoji: '💎', label: 'Gemme' },
  { value: 'lock', emoji: '🔒', label: 'Verrou' },
  { value: 'bolt', emoji: '⚡', label: 'Éclair' },
  { value: 'planet', emoji: '🪐', label: 'Planète' },
  { value: 'fire', emoji: '🔥', label: 'Flamme' },
]);
const CAPTCHA_WORD_CHOICES = Object.freeze([
  'AURORA',
  'NEXUS',
  'COMET',
  'VECTOR',
  'ORBIT',
  'PHOTON',
  'SHADOW',
  'CRYSTAL',
  'NOVA',
  'RIFT',
  'PULSE',
  'EMBER',
]);
const VOICE_REGION_LABELS = Object.freeze({
  auto: 'Auto',
  rotterdam: 'Europe',
  'us-east': 'US East',
  'us-west': 'US West',
  'us-central': 'US Central',
  'us-south': 'US South',
  singapore: 'Singapore',
  japan: 'Japan',
  hongkong: 'Hong Kong',
  india: 'India',
  sydney: 'Sydney',
  brazil: 'Brazil',
  southafrica: 'South Africa',
  russia: 'Russia',
});

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

function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:image\/([a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;

  const extension = String(match[1] || 'png').toLowerCase() === 'jpeg' ? 'jpg' : String(match[1] || 'png').toLowerCase();
  try {
    return {
      extension,
      buffer: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
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

function shuffleArray(items = []) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function sanitizeSlashCommandName(value) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 32);
  return cleaned;
}

function normalizeSlashDescription(value, fallback = 'Commande DiscordForger') {
  const cleaned = String(value || fallback || 'Commande DiscordForger').trim().replace(/\s+/g, ' ');
  return (cleaned || fallback).slice(0, 100);
}

function isValidSlashCommandPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const name = sanitizeSlashCommandName(payload.name);
  const description = normalizeSlashDescription(payload.description);
  return name.length >= 1 && description.length >= 1;
}

function buildInfoEmbed({ title, description, color = 0x22d3ee, thumbnail = null, image = null, fields = [], footer = null }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title);
  if (description) embed.setDescription(description);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (Array.isArray(fields) && fields.length > 0) {
    embed.addFields(
      fields
        .filter((field) => field && field.name && field.value)
        .map((field) => ({
          name: String(field.name).slice(0, 256),
          value: String(field.value).slice(0, 1024),
          inline: field.inline !== false,
        }))
    );
  }
  if (footer) {
    embed.setFooter({ text: String(footer).slice(0, 2048) });
  }
  return embed;
}

const DEFAULT_ACTION_CONFIG_BY_TYPE = new Map(
  DEFAULT_SYSTEM_COMMANDS.map((definition) => [definition.action_type, definition.action_config || {}])
);

const ACTIVITY_TYPE_MAP = Object.freeze({
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  streaming: ActivityType.Streaming,
});

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

    case COMMAND_ACTION_TYPES.PING_INFO:
    case COMMAND_ACTION_TYPES.BOT_INFO:
    case COMMAND_ACTION_TYPES.SERVER_INFO:
    case COMMAND_ACTION_TYPES.MEMBERCOUNT_INFO:
    case COMMAND_ACTION_TYPES.USER_INFO:
    case COMMAND_ACTION_TYPES.AVATAR_INFO:
    case COMMAND_ACTION_TYPES.BANNER_INFO:
    case COMMAND_ACTION_TYPES.ROLE_INFO:
    case COMMAND_ACTION_TYPES.CHANNEL_INFO:
    case COMMAND_ACTION_TYPES.JOINED_AT_INFO:
    case COMMAND_ACTION_TYPES.SERVER_ICON_INFO:
    case COMMAND_ACTION_TYPES.BOOSTS_INFO:
    case COMMAND_ACTION_TYPES.PERMISSIONS_INFO:
    case COMMAND_ACTION_TYPES.ID_INFO:
    case COMMAND_ACTION_TYPES.EMOJI_INFO:
      return {
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
  const commandName = sanitizeSlashCommandName(command.command_name);
  const payload = {
    name: commandName,
    description: normalizeSlashDescription(command.description, `Commande ${commandName || 'discordforger'}`),
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

    case COMMAND_ACTION_TYPES.USER_INFO:
    case COMMAND_ACTION_TYPES.AVATAR_INFO:
    case COMMAND_ACTION_TYPES.BANNER_INFO:
    case COMMAND_ACTION_TYPES.JOINED_AT_INFO:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: false,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.ROLE_INFO:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Role,
          name: 'role',
          description: 'Role cible',
          required: true,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.CHANNEL_INFO:
      payload.options = [
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon cible',
          required: false,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.PERMISSIONS_INFO:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: false,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.ID_INFO:
      payload.options = [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Membre cible',
          required: false,
        },
        {
          type: ApplicationCommandOptionType.Role,
          name: 'role',
          description: 'Role cible',
          required: false,
        },
        {
          type: ApplicationCommandOptionType.Channel,
          name: 'channel',
          description: 'Salon cible',
          required: false,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.EMOJI_INFO:
      payload.options = [
        {
          type: ApplicationCommandOptionType.String,
          name: 'emoji',
          description: 'Emoji du serveur',
          required: true,
          max_length: 100,
        },
      ];
      break;

    default:
      payload.options = [];
      break;
  }

  return isValidSlashCommandPayload(payload) ? payload : null;
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
    this._voiceRoomControlSyncs = new Map();
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

  _buildPresencePayload(settings = {}) {
    const presenceStatus = String(settings.presence_status || 'online').trim().toLowerCase();
    const activityTypeKey = String(settings.activity_type || 'playing').trim().toLowerCase();
    const activityText = String(settings.activity_text || '').trim().slice(0, 128);
    const mappedType = ACTIVITY_TYPE_MAP[activityTypeKey] ?? ActivityType.Playing;

    return {
      status: ['online', 'idle', 'dnd', 'invisible'].includes(presenceStatus) ? presenceStatus : 'online',
      activities: activityText
        ? [{
            name: activityText,
            type: mappedType,
          }]
        : [],
    };
  }

  async applyStoredPresence() {
    if (!this.client?.user) return;
    const settings = getBotProfileSettings(this.userId);
    await this.client.user.setPresence(this._buildPresencePayload(settings));
  }

  // ── Client Setup ────────────────────────────────────────────────────────────

  _createClient() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
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

    c.once(Events.ClientReady, async (readyClient) => {
      this.restartCount = 0;
      this.startedAt = new Date().toISOString();
      this.lastError = null;
      this._setStatus(BotStatus.RUNNING);

      logger.info(`✅ Bot ready: ${readyClient.user.tag} | Guilds: ${readyClient.guilds.cache.size}`, { userId: this.userId });
      await this.applyStoredPresence().catch((error) => {
        logger.warn(`Presence restore failed: ${error.message}`, { userId: this.userId });
      });
      this._startHeartbeat();
      this._syncGuilds();
      this.emit('ready', readyClient.user);
    });

    c.on(Events.MessageCreate, (msg) => this._onMessage(msg));
    c.on(Events.InteractionCreate, (interaction) => this._onInteraction(interaction));
    c.on(Events.GuildMemberAdd, (member) => this._onMemberAdd(member));
    c.on(Events.GuildMemberRemove, (member) => this._onMemberRemove(member));
    c.on(Events.VoiceStateUpdate, (oldState, newState) => this._onVoiceStateUpdate(oldState, newState));
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
      try {
        const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guild.id, this.userId])[0];
        if (!guildRow) return { guildId: guild.id, synced: 0 };
        this._ensureSystemCommands(guildRow.id);

        const slashCommands = db.raw(
          `SELECT * FROM custom_commands
           WHERE guild_id = ? AND enabled = 1 AND command_type = 'slash'
           ORDER BY is_system DESC, updated_at DESC, created_at DESC`,
          [guildRow.id]
        ).map(normalizeCommandRow);

        const seenNames = new Set();
        const payloads = [];

        for (const command of slashCommands) {
          const sanitizedName = sanitizeSlashCommandName(command.command_name);
          if (!sanitizedName) {
            logger.warn(`Skipping invalid slash command without valid name`, {
              userId: this.userId,
              guildId: guild.id,
              commandId: command.id,
              rawName: command.command_name || null,
            });
            continue;
          }

          if (seenNames.has(sanitizedName)) {
            logger.warn(`Skipping duplicate slash command`, {
              userId: this.userId,
              guildId: guild.id,
              commandId: command.id,
              commandName: sanitizedName,
            });
            continue;
          }

          const payload = buildSlashCommandPayload({
            ...command,
            command_name: sanitizedName,
          });

          if (!payload) {
            logger.warn(`Skipping invalid slash payload`, {
              userId: this.userId,
              guildId: guild.id,
              commandId: command.id,
              commandName: sanitizedName,
            });
            continue;
          }

          seenNames.add(sanitizedName);
          payloads.push(payload);
        }

        try {
          await guild.commands.set(payloads);
          logger.info(`Slash commands synced for guild ${guild.id}`, {
            userId: this.userId,
            guildId: guild.id,
            count: payloads.length,
            mode: 'bulk',
          });
          return { guildId: guild.id, synced: payloads.length };
        } catch (bulkError) {
          logger.warn(`Bulk slash sync failed for guild ${guild.id}, fallback to individual sync: ${bulkError.message}`, {
            userId: this.userId,
            guildId: guild.id,
            count: payloads.length,
          });

          const existingCommands = await guild.commands.fetch().catch(() => null);
          const existingByName = new Map(
            [...(existingCommands?.values?.() || [])].map((entry) => [sanitizeSlashCommandName(entry.name), entry])
          );
          const syncedNames = new Set();
          let syncedCount = 0;

          for (const payload of payloads) {
            try {
              const existing = existingByName.get(payload.name) || null;
              if (existing) {
                await guild.commands.edit(existing.id, payload);
              } else {
                await guild.commands.create(payload);
              }
              syncedNames.add(payload.name);
              syncedCount += 1;
            } catch (singleError) {
              logger.error(`Slash command sync failed for ${payload.name} in guild ${guild.id}: ${singleError.message}`, {
                userId: this.userId,
                guildId: guild.id,
                commandName: payload.name,
              });
            }
          }

          for (const [name, existing] of existingByName.entries()) {
            if (!syncedNames.has(name)) {
              await guild.commands.delete(existing.id).catch(() => {});
            }
          }

          logger.info(`Slash commands synced for guild ${guild.id}`, {
            userId: this.userId,
            guildId: guild.id,
            count: syncedCount,
            expected: payloads.length,
            mode: 'fallback',
          });
          return { guildId: guild.id, synced: syncedCount };
        }
      } catch (error) {
        logger.error(`Slash command sync failed for guild ${guild.id}: ${error.message}`, {
          userId: this.userId,
          guildId: guild.id,
        });
        throw error;
      }
    });

    const results = await Promise.allSettled(syncJobs);
    const rejected = results.filter((entry) => entry.status === 'rejected');
    if (rejected.length > 0) {
      throw new Error(`Slash command sync failed for ${rejected.length} guild(s)`);
    }
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

  async _deferCommandInteraction(source, { ephemeral = true } = {}) {
    if (!(typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand())) return false;
    if (source.deferred || source.replied || typeof source.deferReply !== 'function') return false;
    await source.deferReply({ ephemeral }).catch(() => {});
    return true;
  }

  _buildDiscordAssetFile(assetValue, fileNamePrefix) {
    const raw = String(assetValue || '').trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) {
      return { url: raw, file: null };
    }

    const parsed = parseImageDataUrl(raw);
    if (!parsed?.buffer?.length) return null;

    const fileName = `${fileNamePrefix}.${parsed.extension || 'png'}`;
    return {
      url: `attachment://${fileName}`,
      file: new AttachmentBuilder(parsed.buffer, { name: fileName }),
    };
  }

  _buildTicketGeneratorAssets(generator, prefix = 'ticket-panel') {
    const thumbnail = this._buildDiscordAssetFile(generator?.panel_thumbnail_url, `${prefix}-thumbnail`);
    const image = this._buildDiscordAssetFile(generator?.panel_image_url, `${prefix}-image`);
    return {
      thumbnail,
      image,
      files: [thumbnail?.file, image?.file].filter(Boolean),
    };
  }

  async _replyToNativeSource(source, content, { ephemeral = true, preferReply = true } = {}) {
    const payload = { content: String(content || '').slice(0, 2000) || 'Commande exécutée.' };
    if (typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()) {
      if (source.deferred && !source.replied && typeof source.editReply === 'function') {
        return source.editReply(payload);
      }
      if (source.replied && typeof source.followUp === 'function') {
        return source.followUp({ ...payload, ephemeral });
      }
      return source.reply({ ...payload, ephemeral });
    }

    if (preferReply && typeof source?.reply === 'function') {
      return source.reply({ ...payload, allowedMentions: { repliedUser: false } });
    }
    if (source?.channel?.isTextBased?.()) {
      return source.channel.send(payload);
    }
    return null;
  }

  async _replyWithEmbedToNativeSource(source, embed, { ephemeral = true, preferReply = true } = {}) {
    const payload = { embeds: [embed] };
    if (typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()) {
      if (source.deferred && !source.replied && typeof source.editReply === 'function') {
        return source.editReply(payload);
      }
      if (source.replied && typeof source.followUp === 'function') {
        return source.followUp({ ...payload, ephemeral });
      }
      return source.reply({ ...payload, ephemeral });
    }

    if (preferReply && typeof source?.reply === 'function') {
      return source.reply(payload);
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

    const fields = [];
    const extras = [];
    for (const entry of Array.isArray(lines) ? lines : []) {
      const line = String(entry || '').trim();
      if (!line) continue;

      const separatorIndex = line.indexOf(':');
      if (separatorIndex > 0 && separatorIndex < 60) {
        const name = line.slice(0, separatorIndex).trim().slice(0, 256) || 'Info';
        const value = line.slice(separatorIndex + 1).trim().slice(0, 1024) || '-';
        fields.push({
          name,
          value,
          inline: value.length <= 90 && !/raison|contenu|message|historique|details/i.test(name),
        });
      } else {
        extras.push(line);
      }
    }

    const guildIconUrl = guild.iconURL?.({ size: 128 }) || null;
    const description = extras.length > 0
      ? extras.join('\n').slice(0, 4000)
      : 'Action native exécutée et synchronisée avec Discord.';

    await channel.send({
      embeds: [{
        author: {
          name: `Journal natif • ${guild.name}`,
          icon_url: guildIconUrl || undefined,
        },
        title: String(title || 'Journal de commande native').slice(0, 256),
        description,
        color,
        thumbnail: guildIconUrl ? { url: guildIconUrl } : undefined,
        fields: fields.slice(0, 10),
        footer: {
          text: 'Exécution Discord native',
        },
        timestamp: new Date().toISOString(),
      }],
    }).catch(() => {});
  }

  _hexColorToInt(value, fallback = 0x22d3ee) {
    const normalized = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(normalized) ? Number.parseInt(normalized, 16) : fallback;
  }

  _sanitizeTicketPanelFooter(value) {
    const normalized = String(value || '').trim();
    return normalized === LEGACY_TICKET_DUPLICATE_FOOTER ? '' : normalized;
  }

  _sanitizeTicketPanelDescription(value) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === LEGACY_TICKET_PANEL_DESCRIPTION) {
      return DEFAULT_TICKET_PANEL_DESCRIPTION;
    }
    return normalized;
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

  async _resolveGuildJoinUrl(guild) {
    if (!guild) return '';

    const directVanityCode = String(guild.vanityURLCode || '').trim();
    if (directVanityCode) {
      return `https://discord.gg/${directVanityCode}`;
    }

    if (typeof guild.fetchVanityData === 'function') {
      try {
        const vanity = await guild.fetchVanityData();
        if (vanity?.code) {
          return `https://discord.gg/${vanity.code}`;
        }
      } catch {}
    }

    const botMember = guild.members?.me || await guild.members.fetchMe().catch(() => null);
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (channel) => {
      if (!channel?.id || seen.has(channel.id)) return;
      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return;
      seen.add(channel.id);
      candidates.push(channel);
    };

    pushCandidate(guild.systemChannel || null);
    pushCandidate(guild.rulesChannel || null);
    pushCandidate(guild.publicUpdatesChannel || null);

    for (const channel of guild.channels.cache
      .filter((entry) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(entry?.type))
      .sort((left, right) => (left.rawPosition || 0) - (right.rawPosition || 0))
      .values()) {
      pushCandidate(channel);
    }

    for (const channel of candidates) {
      const permissions = channel.permissionsFor?.(botMember);
      if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.CreateInstantInvite)) {
        continue;
      }

      try {
        const invite = await channel.createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: false,
          reason: 'Lien de retour automatique apres softban',
        });
        if (invite?.url) return invite.url;
      } catch {}
    }

    return '';
  }

  async _sendSoftbanRejoinLink(targetUser, guild) {
    if (!targetUser?.send || !guild) return false;

    const joinUrl = await this._resolveGuildJoinUrl(guild);
    if (!joinUrl) return false;

    try {
      await targetUser.send({ content: joinUrl });
      return true;
    } catch {
      return false;
    }
  }

  async _deleteMessagesFlexible(channel, amount) {
    if (!channel?.messages?.fetch || !channel?.bulkDelete) return 0;

    const fetchLimit = Math.min(100, Math.max(Number(amount || 0), 1));
    const fetched = await channel.messages.fetch({ limit: fetchLimit }).catch(() => null);
    const candidates = fetched ? Array.from(fetched.values()).slice(0, fetchLimit) : [];
    if (!candidates.length) return 0;

    const recentThresholdMs = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const recentMessages = candidates.filter((message) => (now - Number(message.createdTimestamp || 0)) < recentThresholdMs);
    const oldMessages = candidates.filter((message) => (now - Number(message.createdTimestamp || 0)) >= recentThresholdMs);

    let deletedCount = 0;

    if (recentMessages.length) {
      const deleted = await channel.bulkDelete(recentMessages.map((message) => message.id), true).catch(() => null);
      deletedCount += deleted?.size || 0;
    }

    for (const message of oldMessages) {
      try {
        await message.delete();
        deletedCount += 1;
      } catch {}
    }

    return deletedCount;
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

  _sanitizeTranscriptFileToken(value, fallback = 'ticket') {
    const normalized = String(value || fallback)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

    return normalized || fallback;
  }

  _getTicketCloseContext(interaction, entryId, internalGuildId) {
    const entry = getTicketEntryById(internalGuildId, entryId);
    if (!entry) {
      return { error: 'Ticket introuvable.' };
    }
    if (entry.status === 'closed') {
      return { error: 'Ce ticket est déjà fermé.' };
    }

    const generator = getGuildTicketGeneratorById(entry.generator_id);
    if (!generator?.id) {
      return { error: 'Configuration ticket introuvable.' };
    }

    const option = (generator.options || []).find((item) => item.key === entry.option_key);
    const isSupport = this._hasTicketSupportAccess(interaction.member, option);
    const isCreator = String(entry.creator_discord_user_id) === String(interaction.user.id);
    if (!isSupport && !(generator.allow_user_close && isCreator)) {
      return { error: 'Tu ne peux pas fermer ce ticket.' };
    }

    return { entry, generator, option };
  }

  async _resolveTicketTextChannel(guild, channelId) {
    const normalizedChannelId = normalizeSnowflake(channelId);
    if (!guild || !normalizedChannelId) return null;

    const channel = guild.channels.cache.get(normalizedChannelId)
      || await guild.channels.fetch(normalizedChannelId).catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
  }

  async _resolveTicketTranscriptChannel(guild, generator, ticketChannelId) {
    const transcriptChannelId = normalizeSnowflake(generator?.transcript_channel_id);
    if (!transcriptChannelId) {
      throw new Error('Choisis un salon transcript avant de fermer avec transcript.');
    }
    if (transcriptChannelId === normalizeSnowflake(ticketChannelId)) {
      throw new Error('Le salon transcript doit être différent du salon ticket.');
    }

    const channel = await this._resolveTicketTextChannel(guild, transcriptChannelId);
    if (!channel) {
      throw new Error('Le salon transcript configuré est introuvable ou invalide.');
    }

    const permissions = channel.permissionsFor?.(guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error('Le bot ne peut pas voir le salon transcript.');
    }
    if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error('Le bot ne peut pas envoyer de transcript dans ce salon.');
    }
    if (!permissions?.has(PermissionFlagsBits.AttachFiles)) {
      throw new Error('Le bot doit pouvoir joindre des fichiers dans le salon transcript.');
    }

    return channel;
  }

  async _fetchTicketTranscriptMessages(channel) {
    const collected = [];
    let before = null;
    let truncated = false;

    while (true) {
      const batch = await channel.messages.fetch({
        limit: 100,
        ...(before ? { before } : {}),
      }).catch(() => null);

      if (!batch?.size) break;
      const items = [...batch.values()];
      collected.push(...items);
      if (collected.length >= MAX_TICKET_TRANSCRIPT_MESSAGES) {
        truncated = true;
        break;
      }

      before = items[items.length - 1]?.id;
      if (!before || batch.size < 100) break;
    }

    return {
      messages: collected.slice(0, MAX_TICKET_TRANSCRIPT_MESSAGES).reverse(),
      truncated,
    };
  }

  _buildTicketTranscriptAttachment({ guild, channel, entry, option, closer, messages, truncated }) {
    const headerLines = [
      `Transcript ticket #${entry.ticket_number}`,
      `Serveur: ${guild?.name || guild?.id || 'Serveur inconnu'}`,
      `Salon: #${channel?.name || entry.channel_id}`,
      `Categorie: ${String(option?.label || entry.option_key || 'Ticket')}`,
      `Createur: ${entry.creator_username || entry.creator_discord_user_id}`,
      `Ferme par: ${closer?.tag || closer?.username || closer?.id || entry.closed_by_username || entry.closed_by_discord_user_id || 'Inconnu'}`,
      `Raison: ${entry.reason || 'Aucune raison'}`,
      `Cree le: ${entry.created_at || new Date().toISOString()}`,
      `Ferme le: ${new Date().toISOString()}`,
      '',
      '----- Conversation -----',
      '',
    ];

    const lines = [...headerLines];
    let byteLength = Buffer.byteLength(lines.join('\n'), 'utf8');
    let includedMessages = 0;
    let transcriptTruncated = !!truncated;

    for (const message of messages) {
      const authorLabel = message.author?.tag
        || message.author?.username
        || message.member?.displayName
        || message.author?.id
        || 'Utilisateur inconnu';
      const blockLines = [
        `[${message.createdAt?.toISOString?.() || new Date().toISOString()}] ${authorLabel}`,
      ];

      const content = String(message.content || '').trim();
      if (content) {
        blockLines.push(content);
      }

      const attachmentUrls = [...(message.attachments?.values?.() || [])]
        .map((attachment) => attachment?.url)
        .filter(Boolean);
      if (attachmentUrls.length > 0) {
        blockLines.push(`Pieces jointes: ${attachmentUrls.join(', ')}`);
      }

      const embedSummaries = [...(message.embeds || [])]
        .map((embed) => [embed.title, embed.description].filter(Boolean).join(' - ').trim())
        .filter(Boolean);
      if (embedSummaries.length > 0) {
        blockLines.push(`Embeds: ${embedSummaries.join(' | ')}`);
      }

      if (blockLines.length === 1) {
        blockLines.push('[Message sans texte]');
      }

      blockLines.push('');
      const block = blockLines.join('\n');
      const nextBytes = Buffer.byteLength(block, 'utf8');
      if ((byteLength + nextBytes) > MAX_TICKET_TRANSCRIPT_BYTES) {
        transcriptTruncated = true;
        break;
      }

      lines.push(block);
      byteLength += nextBytes;
      includedMessages += 1;
    }

    if (transcriptTruncated) {
      lines.push('[Transcript tronqué pour rester dans la limite d envoi Discord.]');
    }

    const optionToken = this._sanitizeTranscriptFileToken(option?.label || option?.key || 'ticket');
    const fileName = `transcript-${optionToken}-${String(entry.ticket_number || '1').padStart(4, '0')}.txt`;
    const buffer = Buffer.from(lines.join('\n'), 'utf8');

    return {
      attachment: new AttachmentBuilder(buffer, { name: fileName }),
      messageCount: includedMessages,
      truncated: transcriptTruncated,
    };
  }

  async _sendTicketTranscript({ guild, generator, entry, option, channel, closer }) {
    const transcriptChannel = await this._resolveTicketTranscriptChannel(guild, generator, channel.id);
    const transcriptData = await this._fetchTicketTranscriptMessages(channel);
    const transcriptFile = this._buildTicketTranscriptAttachment({
      guild,
      channel,
      entry,
      option,
      closer,
      messages: transcriptData.messages,
      truncated: transcriptData.truncated,
    });

    const canEmbed = transcriptChannel.permissionsFor?.(guild.members.me)?.has(PermissionFlagsBits.EmbedLinks);
    const summaryEmbed = {
      author: {
        name: `${guild?.name || 'Serveur'} • Transcript ticket`,
        icon_url: guild?.iconURL?.({ size: 128 }) || undefined,
      },
      title: `Transcript • Ticket #${entry.ticket_number}`,
      description: `Le ticket **${String(option?.label || entry.option_key || 'Ticket')}** a ete ferme et exporte.`,
      color: this._hexColorToInt(generator?.panel_color, 0x7c3aed),
      fields: [
        {
          name: 'Salon ferme',
          value: `#${channel?.name || entry.channel_id}`,
          inline: true,
        },
        {
          name: 'Demandeur',
          value: entry.creator_discord_user_id ? `<@${entry.creator_discord_user_id}>` : (entry.creator_username || 'Inconnu'),
          inline: true,
        },
        {
          name: 'Ferme par',
          value: closer?.id ? `<@${closer.id}>` : (closer?.tag || closer?.username || closer?.id || 'Inconnu'),
          inline: true,
        },
        {
          name: 'Raison',
          value: String(entry.reason || 'Aucune raison').slice(0, 1024),
          inline: false,
        },
      ],
      footer: transcriptFile.truncated
        ? { text: 'Transcript tronqué pour respecter la limite de taille Discord.' }
        : undefined,
      timestamp: new Date().toISOString(),
    };

    await transcriptChannel.send({
      content: canEmbed ? undefined : `Transcript ticket #${entry.ticket_number} - ${String(option?.label || entry.option_key || 'Ticket')}`,
      embeds: canEmbed ? [summaryEmbed] : undefined,
      files: [transcriptFile.attachment],
    });

    return {
      channel: transcriptChannel,
      truncated: transcriptFile.truncated,
      messageCount: transcriptFile.messageCount,
    };
  }

  _buildTicketGeneratorComponents(generator) {
    const enabledOptions = (generator?.options || []).filter((option) => option.enabled).slice(0, 10);
    if (enabledOptions.length === 0) return [];

    const menu = new StringSelectMenuBuilder()
      .setCustomId(this._buildTicketGeneratorCustomId('open', generator.id))
      .setPlaceholder(String(generator.menu_placeholder || 'Choisis une catégorie de ticket').slice(0, 120))
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

  _buildTicketGeneratorPanelPayload(generator, guild = null) {
    const assets = this._buildTicketGeneratorAssets(generator, `ticket-panel-${generator?.id || 'default'}`);
    const footerText = this._sanitizeTicketPanelFooter(generator?.panel_footer);
    const guildIconUrl = guild?.iconURL?.({ size: 128 }) || null;
    const mainEmbed = {
      title: String(generator.panel_title || 'Support & tickets').slice(0, 256),
      description: this._sanitizeTicketPanelDescription(generator?.panel_description).slice(0, 4000),
      color: this._hexColorToInt(generator.panel_color, 0x7c3aed),
      footer: footerText
        ? { text: footerText.slice(0, 2048) }
        : undefined,
      timestamp: new Date().toISOString(),
    };

    if (assets.thumbnail?.url) {
      mainEmbed.thumbnail = { url: assets.thumbnail.url };
    } else if (guildIconUrl) {
      mainEmbed.thumbnail = { url: guildIconUrl };
    }

    if (assets.image?.url) {
      mainEmbed.image = { url: assets.image.url };
    }

    return {
      embeds: [mainEmbed],
      components: this._buildTicketGeneratorComponents(generator),
      files: assets.files,
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
      throw new Error('Le générateur de tickets est désactivé');
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
      throw new Error('Le salon de publication tickets doit être un salon texte');
    }

    const botPermissions = channel.permissionsFor?.(guild.members.me);
    if (!botPermissions?.has(PermissionFlagsBits.ViewChannel)) {
      throw new Error('Le bot ne peut pas voir le salon tickets choisi');
    }
    if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error('Le bot ne peut pas envoyer de messages dans le salon tickets choisi');
    }
    if (!botPermissions?.has(PermissionFlagsBits.EmbedLinks)) {
      throw new Error("Le bot doit avoir la permission d'intégrer des liens dans le salon tickets choisi");
    }

    const payload = this._buildTicketGeneratorPanelPayload(generator, guild);
    let message = null;

    if (generator.panel_message_id) {
      message = await channel.messages.fetch(generator.panel_message_id).catch(() => null);
      if (message?.editable) {
        message = await message.edit({
          ...payload,
          attachments: payload.files?.length ? [] : undefined,
        }).catch(() => null);
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
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    if (!generator?.enabled || !option?.enabled) {
      await interaction.editReply({ content: 'Ce type de ticket est indisponible pour le moment.' }).catch(() => {});
      return true;
    }

    const duplicate = generator.prevent_duplicates
      ? findDuplicateOpenTicket(internalGuildId, interaction.user.id, option.key)
      : null;
    if (duplicate) {
      const existingChannelLabel = duplicate.channel_id ? `<#${duplicate.channel_id}>` : `#${duplicate.ticket_number}`;
      await interaction.editReply({
        content: `Tu as déjà un ticket ouvert pour cette catégorie : ${existingChannelLabel}`,
      }).catch(() => {});
      return true;
    }

    const guild = interaction.guild;
    const botMember = guild.members.me;
    if (!botMember) {
      await interaction.editReply({ content: 'Le bot est indisponible pour créer ce ticket.' }).catch(() => {});
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
      .setLabel('Prendre en charge')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Success);
    const closeButton = new ButtonBuilder()
      .setCustomId(this._buildTicketGeneratorCustomId('close', entry.id))
      .setLabel('Fermer')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);

    const openingEmbed = {
      author: {
        name: `${option.emoji ? `${option.emoji} ` : ''}${String(option.label || 'Ticket').slice(0, 80)} • Ticket #${entry.ticket_number}`,
        icon_url: interaction.user?.displayAvatarURL?.({ size: 128 }) || undefined,
      },
      title: 'Nouvelle demande reçue',
      description: introMessage,
      color: this._hexColorToInt(generator.panel_color, 0x7c3aed),
      fields: [
        {
          name: 'Demandeur',
          value: interaction.user.id ? `<@${interaction.user.id}>` : (interaction.user.tag || interaction.user.username || interaction.user.id),
          inline: true,
        },
        {
          name: 'Catégorie',
          value: String(option.label || 'Ticket').slice(0, 1024),
          inline: true,
        },
        {
          name: 'Statut',
          value: 'Ouvert',
          inline: true,
        },
        {
          name: 'Salon',
          value: `<#${channel.id}>`,
          inline: true,
        },
        {
          name: 'Équipe notifiée',
          value: supportRoleIds.length > 0 ? supportRoleIds.map((roleId) => `<@&${roleId}>`).join(' ') : 'Aucun rôle staff configuré',
          inline: false,
        },
        {
          name: 'Raison',
          value: reason.slice(0, 1024) || 'Aucune raison',
        },
      ],
      footer: {
        text: `${String(generator.panel_title || 'Support & tickets').slice(0, 120)} • Ticket ${entry.ticket_number}`,
      },
      timestamp: new Date().toISOString(),
    };

    const assets = this._buildTicketGeneratorAssets(generator, `ticket-opening-${entry.id}`);
    if (assets.thumbnail?.url) openingEmbed.thumbnail = { url: assets.thumbnail.url };
    if (assets.image?.url) openingEmbed.image = { url: assets.image.url };

    await channel.send({
      content: shouldPingRoles ? supportRoleIds.map((roleId) => `<@&${roleId}>`).join(' ') : '',
      allowedMentions: {
        roles: shouldPingRoles ? supportRoleIds : [],
        users: interaction.user.id ? [interaction.user.id] : [],
      },
      embeds: [openingEmbed],
      components: [new ActionRowBuilder().addComponents(claimButton, closeButton)],
      files: assets.files,
    }).catch(() => {});

    await interaction.editReply({
      content: `Ticket créé : <#${channel.id}>`,
    }).catch(() => {});

    return true;
  }

  async _handleTicketGeneratorClaim(interaction, entryId, internalGuildId) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const entry = getTicketEntryById(internalGuildId, entryId);
    if (!entry) {
      await interaction.editReply({ content: 'Ticket introuvable.' }).catch(() => {});
      return true;
    }
    if (entry.status === 'closed') {
      await interaction.editReply({ content: 'Ce ticket est déjà fermé.' }).catch(() => {});
      return true;
    }

    const generator = getGuildTicketGeneratorById(entry.generator_id);
    const option = (generator?.options || []).find((item) => item.key === entry.option_key);
    if (!this._hasTicketSupportAccess(interaction.member, option)) {
      await interaction.editReply({ content: "Tu n'as pas accès à la prise en charge de ce ticket." }).catch(() => {});
      return true;
    }
    if (entry.claimed_by_discord_user_id && entry.claimed_by_discord_user_id !== interaction.user.id) {
      await interaction.editReply({
        content: `Ce ticket est déjà pris par ${entry.claimed_by_username || 'un autre membre du staff'}.`,
      }).catch(() => {});
      return true;
    }
    if (entry.claimed_by_discord_user_id === interaction.user.id) {
      await interaction.editReply({ content: 'Tu as déjà pris ce ticket.' }).catch(() => {});
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

    await interaction.editReply({ content: 'Ticket pris en charge.' }).catch(() => {});
    if (interaction.channel?.isTextBased?.()) {
      await interaction.channel.send({
        content: claimMessage,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => {});
    }

    return true;
  }

  async _handleTicketGeneratorClose(interaction, entryId, internalGuildId) {
    const context = this._getTicketCloseContext(interaction, entryId, internalGuildId);
    if (context.error) {
      await interaction.reply({ content: context.error, ephemeral: true }).catch(() => {});
      return true;
    }

    const transcriptConfigured = !!normalizeSnowflake(context.generator?.transcript_channel_id);
    const actions = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(this._buildTicketGeneratorCustomId('closeconfirm', context.entry.id, 'with'))
        .setLabel('Fermer + transcript')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!transcriptConfigured),
      new ButtonBuilder()
        .setCustomId(this._buildTicketGeneratorCustomId('closeconfirm', context.entry.id, 'without'))
        .setLabel('Fermer sans transcript')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(this._buildTicketGeneratorCustomId('closecancel', context.entry.id))
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: transcriptConfigured
        ? 'Veux-tu envoyer le transcript avant de supprimer ce ticket ?'
        : "Aucun salon transcript n'est configuré. Tu peux fermer directement ou annuler.",
      components: [actions],
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  async _handleTicketGeneratorCloseCancel(interaction) {
    await interaction.update({
      content: 'Fermeture du ticket annulée.',
      components: [],
    }).catch(() => {});
    return true;
  }

  async _handleTicketGeneratorCloseConfirm(interaction, entryId, mode, internalGuildId) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const context = this._getTicketCloseContext(interaction, entryId, internalGuildId);
    if (context.error) {
      await interaction.editReply({ content: context.error }).catch(() => {});
      return true;
    }

    const { entry, generator, option } = context;
    const guild = interaction.guild;
    const channel = await this._resolveTicketTextChannel(guild, entry.channel_id);
    if (!channel) {
      await interaction.editReply({ content: 'Le salon ticket est introuvable ou déjà supprimé.' }).catch(() => {});
      return true;
    }
    const channelPermissions = channel.permissionsFor?.(guild.members.me);
    if (!channelPermissions?.has(PermissionFlagsBits.ViewChannel) || !channelPermissions?.has(PermissionFlagsBits.ReadMessageHistory)) {
      await interaction.editReply({ content: 'Le bot ne peut pas relire ce ticket pour le fermer proprement.' }).catch(() => {});
      return true;
    }
    if (!channelPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.editReply({ content: 'Le bot doit avoir la permission de gérer ce salon pour supprimer le ticket.' }).catch(() => {});
      return true;
    }

    const wantsTranscript = String(mode || '').trim().toLowerCase() === 'with';
    let transcriptResult = null;
    if (wantsTranscript) {
      try {
        transcriptResult = await this._sendTicketTranscript({
          guild,
          generator,
          entry,
          option,
          channel,
          closer: interaction.user,
        });
      } catch (error) {
        await interaction.editReply({
          content: String(error?.message || 'Impossible de générer le transcript pour le moment.'),
        }).catch(() => {});
        return true;
      }
    }

    closeTicketEntry(
      internalGuildId,
      entry.id,
      interaction.user.id,
      interaction.user.tag || interaction.user.username || interaction.user.id
    );

    if (channel.permissionOverwrites?.edit && entry.creator_discord_user_id) {
      await channel.permissionOverwrites.edit(entry.creator_discord_user_id, {
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
    ).slice(0, 1700);

    await channel.send({
      content: [
        closeMessage,
        transcriptResult?.channel?.id ? `Transcript envoyé dans <#${transcriptResult.channel.id}>.` : '',
        `Suppression du salon dans ${Math.max(1, Math.round(TICKET_DELETE_DELAY_MS / 1000))} seconde(s).`,
      ].filter(Boolean).join('\n\n'),
      allowedMentions: { users: [interaction.user.id] },
    }).catch(() => {});

    await interaction.editReply({
      content: transcriptResult?.channel?.id
        ? `Ticket fermé. Transcript envoyé dans <#${transcriptResult.channel.id}>.`
        : 'Ticket fermé. Suppression du salon lancée.',
    }).catch(() => {});

    setTimeout(() => {
      channel.delete(`Ticket ferme par ${interaction.user.tag || interaction.user.username || interaction.user.id}`).catch(() => {});
    }, TICKET_DELETE_DELAY_MS);

    return true;
  }

  _buildVoiceGeneratorCustomId(type, ...args) {
    return [VOICE_GENERATOR_PREFIX, type, ...args.map((item) => String(item || '').trim())]
      .filter(Boolean)
      .join(':');
  }

  _parseVoiceGeneratorCustomId(customId) {
    const parts = String(customId || '').split(':').filter(Boolean);
    if (parts[0] !== VOICE_GENERATOR_PREFIX || parts.length < 2) return null;
    return {
      type: parts[1],
      args: parts.slice(2),
    };
  }

  _sanitizeVoiceChannelName(value, fallback = 'vocale-temporaire') {
    const normalized = String(value || fallback)
      .trim()
      .replace(/[^\p{L}\p{N}\- _]/gu, '')
      .replace(/\s+/g, ' ')
      .slice(0, 90);

    return normalized || fallback;
  }

  _buildVoiceGeneratorAssets(configRow, prefix = 'voice-panel') {
    const files = [];
    let thumbnailUrl = String(configRow?.panel_thumbnail_url || '').trim();
    let imageUrl = String(configRow?.panel_image_url || '').trim();

    const thumbnailAsset = parseImageDataUrl(thumbnailUrl);
    if (thumbnailAsset) {
      const fileName = `${prefix}-thumb.${thumbnailAsset.extension}`;
      files.push(new AttachmentBuilder(thumbnailAsset.buffer, { name: fileName }));
      thumbnailUrl = `attachment://${fileName}`;
    }

    const imageAsset = parseImageDataUrl(imageUrl);
    if (imageAsset) {
      const fileName = `${prefix}-banner.${imageAsset.extension}`;
      files.push(new AttachmentBuilder(imageAsset.buffer, { name: fileName }));
      imageUrl = `attachment://${fileName}`;
    }

    return {
      files,
      thumbnailUrl,
      imageUrl,
    };
  }

  _buildVoiceRegionOptions() {
    return Object.entries(VOICE_REGION_LABELS)
      .filter(([value]) => SUPPORTED_REGIONS.has(value))
      .slice(0, 10)
      .map(([value, label]) => new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(`region__${value}`)
        .setDescription(value === 'auto' ? 'Laisser Discord choisir automatiquement' : `Basculer la vocale sur ${label}`));
  }

  _getVoiceBrandAssetUrls(configRow) {
    const frontendBaseUrl = String(config.FRONTEND_URL || '').replace(/\/+$/, '');
    return {
      thumbnailUrl: String(configRow?.panel_thumbnail_url || '').trim() || `${frontendBaseUrl}/discordforger-icon.png`,
      imageUrl: String(configRow?.panel_image_url || '').trim() || `${frontendBaseUrl}/discordforger-logo-full.png`,
      siteUrl: frontendBaseUrl || null,
      siteButtonLabel: String(configRow?.site_button_label || 'Ouvrir DiscordForger').trim().slice(0, 80) || 'Ouvrir DiscordForger',
      showSiteLink: typeof configRow?.show_site_link === 'boolean' ? configRow.show_site_link : true,
    };
  }

  _buildVoiceControlComponents(room, configRow) {
    const settingsMenu = new StringSelectMenuBuilder()
      .setCustomId(this._buildVoiceGeneratorCustomId('settings', room.id))
      .setPlaceholder('Parametres de la vocale')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Renommer').setValue('rename').setDescription('Changer le nom de ta vocale'),
        new StringSelectMenuOptionBuilder().setLabel('Limite').setValue('limit').setDescription('Modifier la limite de membres'),
        new StringSelectMenuOptionBuilder().setLabel('Verrouiller').setValue('lock').setDescription('Bloquer l acces libre'),
        new StringSelectMenuOptionBuilder().setLabel('Deverrouiller').setValue('unlock').setDescription('Rouvrir l acces libre'),
        new StringSelectMenuOptionBuilder().setLabel('Ghost').setValue('ghost').setDescription('Masquer la vocale aux autres'),
        new StringSelectMenuOptionBuilder().setLabel('Unghost').setValue('unghost').setDescription('Rendre la vocale visible'),
        new StringSelectMenuOptionBuilder().setLabel('Supprimer').setValue('delete').setDescription('Supprimer la vocale maintenant'),
        ...(configRow?.allow_claim ? [new StringSelectMenuOptionBuilder().setLabel('Recuperer').setValue('claim').setDescription('Recuperer la vocale si le createur est parti')] : [])
      );

    const permissionsMenu = new StringSelectMenuBuilder()
      .setCustomId(this._buildVoiceGeneratorCustomId('permissions', room.id))
      .setPlaceholder("Gerer l'acces")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Inviter').setValue('invite').setDescription('Autoriser un membre dans la vocale'),
        new StringSelectMenuOptionBuilder().setLabel('Refuser').setValue('reject').setDescription('Bloquer ou expulser un membre'),
        new StringSelectMenuOptionBuilder().setLabel('Transferer').setValue('transfer').setDescription('Transmettre la propriete')
      );

    const regionMenu = new StringSelectMenuBuilder()
      .setCustomId(this._buildVoiceGeneratorCustomId('region', room.id))
      .setPlaceholder(`Region active : ${VOICE_REGION_LABELS[room?.rtc_region || 'auto'] || 'Auto'}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(this._buildVoiceRegionOptions());

    const rows = [
      new ActionRowBuilder().addComponents(settingsMenu),
      new ActionRowBuilder().addComponents(permissionsMenu),
      new ActionRowBuilder().addComponents(regionMenu),
    ];

    const assets = this._getVoiceBrandAssetUrls(configRow);
    if (assets.showSiteLink && assets.siteUrl) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(assets.siteButtonLabel)
            .setURL(assets.siteUrl)
        )
      );
    }

    return rows;
  }

  _buildVoiceRoomControlPayload(room, configRow, guild, channel) {
    const assets = this._buildVoiceGeneratorAssets(configRow, `voice-room-${room.id}`);
    const brandAssets = this._getVoiceBrandAssetUrls(configRow);
    const ownerMention = room.owner_discord_user_id ? `<@${room.owner_discord_user_id}>` : 'Inconnu';
    const memberCount = channel?.members?.size || 0;
    const embed = {
      author: {
        name: guild?.name ? `${guild.name} • Controle vocal` : 'Controle vocal',
        icon_url: guild?.iconURL?.({ size: 128 }) || undefined,
      },
      title: String(configRow?.control_title || 'Bienvenue dans ton salon vocal').slice(0, 256),
      description: `${String(configRow?.control_description || 'Utilise les menus ci-dessous pour personnaliser et gerer ta vocale.').slice(0, 3600)}\n\nUtilise les menus ci-dessous pour ajuster ta vocale rapidement.`,
      color: this._hexColorToInt(configRow?.panel_color, 0x22c55e),
      fields: [
        {
          name: 'Createur',
          value: ownerMention,
          inline: true,
        },
        {
          name: 'Membres',
          value: `${memberCount}/${room.user_limit || 'illimite'}`,
          inline: true,
        },
        {
          name: 'Statut',
          value: [
            room.is_locked ? 'Verrouille' : 'Ouvert',
            room.is_hidden ? 'Ghost' : 'Visible',
            VOICE_REGION_LABELS[room.rtc_region || 'auto'] || 'Auto',
          ].join(' • '),
          inline: true,
        },
        {
          name: 'Salon',
          value: channel?.id ? `<#${channel.id}>` : (room.name || 'Vocale temporaire'),
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    if (assets.thumbnailUrl || brandAssets.thumbnailUrl) embed.thumbnail = { url: assets.thumbnailUrl || brandAssets.thumbnailUrl };
    if (assets.imageUrl || brandAssets.imageUrl) embed.image = { url: assets.imageUrl || brandAssets.imageUrl };

    return {
      embeds: [embed],
      components: this._buildVoiceControlComponents(room, configRow),
      files: assets.files,
    };
  }

  async _resolveVoiceGeneratorPublishChannel(guild, configRow) {
    if (!guild) {
      throw new Error('Serveur vocal introuvable.');
    }

    const desiredParentId = normalizeSnowflake(configRow?.creator_category_id);
    const parent = desiredParentId
      ? (guild.channels.cache.get(desiredParentId) || await guild.channels.fetch(desiredParentId).catch(() => null))
      : null;

    if (configRow?.channel_mode === 'create') {
      const desiredName = this._sanitizeVoiceChannelName(configRow?.creator_channel_name, 'Creer ta voc');
      const existing = guild.channels.cache.find((channel) => (
        (channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice)
        && this._sanitizeVoiceChannelName(channel?.name) === desiredName
        && (!desiredParentId || channel?.parentId === desiredParentId)
      ));

      if (existing) return existing;

      if (!guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error('Le bot doit avoir la permission de gerer les salons pour creer le vocal createur.');
      }

      return guild.channels.create({
        name: desiredName,
        type: ChannelType.GuildVoice,
        parent: parent?.type === ChannelType.GuildCategory ? parent.id : undefined,
        userLimit: 0,
        reason: 'Creation du vocal createur',
      });
    }

    const existingId = normalizeSnowflake(configRow?.creator_channel_id);
    const channel = existingId
      ? (guild.channels.cache.get(existingId) || await guild.channels.fetch(existingId).catch(() => null))
      : null;

    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      throw new Error('Choisis un vocal createur valide.');
    }

    return channel;
  }

  async publishVoiceGeneratorPanel(discordGuildId) {
    const guild = this.client?.guilds?.cache?.get(discordGuildId)
      || await this.client?.guilds?.fetch?.(discordGuildId).catch(() => null);
    if (!guild) {
      throw new Error('Serveur Discord introuvable pour publier le createur vocal');
    }

    const internalGuildId = this._resolveInternalGuildId(discordGuildId);
    if (!internalGuildId) {
      throw new Error('Serveur interne introuvable pour ce systeme vocal');
    }

    const configRow = getGuildVoiceGeneratorForDiscord(this.userId, discordGuildId);
    if (!configRow?.id || !configRow.enabled) {
      throw new Error('Le systeme vocal est desactive.');
    }

    const creatorChannel = await this._resolveVoiceGeneratorPublishChannel(guild, configRow);
    if (!creatorChannel?.viewable) {
      throw new Error('Le bot ne peut pas voir le vocal createur.');
    }

    recordPublishedVoiceGenerator(internalGuildId, creatorChannel.id);

    return {
      channel_id: creatorChannel.id,
      channel_name: creatorChannel.name,
    };
  }

  async _resolveVoiceChannelById(guild, channelId) {
    const normalizedChannelId = normalizeSnowflake(channelId);
    if (!guild || !normalizedChannelId) return null;
    return guild.channels.cache.get(normalizedChannelId)
      || await guild.channels.fetch(normalizedChannelId).catch(() => null);
  }

  async _resolveVoicePromptMember(guild, rawInput) {
    const input = String(rawInput || '').trim();
    if (!guild || !input) return null;

    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    const directId = mentionMatch?.[1] || (normalizeSnowflake(input) || '');
    if (directId) {
      return guild.members.fetch(directId).catch(() => null);
    }

    const lowered = input.toLowerCase();
    const cached = guild.members.cache.find((member) => {
      const values = [
        member.user?.username,
        member.user?.globalName,
        member.displayName,
        member.user?.tag,
      ].filter(Boolean).map((value) => String(value).toLowerCase());
      return values.includes(lowered);
    });
    if (cached) return cached;

    return guild.members.fetch({ query: input.slice(0, 32), limit: 5 })
      .then((collection) => {
        const exact = collection.find((member) => {
          const values = [
            member.user?.username,
            member.user?.globalName,
            member.displayName,
            member.user?.tag,
          ].filter(Boolean).map((value) => String(value).toLowerCase());
          return values.includes(lowered);
        });
        return exact || collection.first() || null;
      })
      .catch(() => null);
  }

  async _syncVoiceRoomPermissions(guild, room, channel = null) {
    const resolvedChannel = channel || await this._resolveVoiceChannelById(guild, room?.channel_id);
    if (!resolvedChannel) return null;

    const ownerId = normalizeSnowflake(room?.owner_discord_user_id);
    const allowedIds = new Set([ownerId, ...(room?.allowed_user_ids || [])].filter(Boolean));
    if (room?.is_hidden) {
      for (const memberId of resolvedChannel.members?.keys?.() || []) {
        allowedIds.add(memberId);
      }
    }
    const blockedIds = new Set((room?.blocked_user_ids || []).filter(Boolean));
    blockedIds.delete(ownerId);
    const overwriteMap = new Map();

    const pushOverwrite = (id, allow = [], deny = []) => {
      if (!id) return;
      overwriteMap.set(id, {
        id,
        allow: [...new Set(allow.filter(Boolean))],
        deny: [...new Set(deny.filter(Boolean))],
      });
    };

    pushOverwrite(guild.roles.everyone.id, [], [
      ...(room?.is_hidden ? [PermissionFlagsBits.ViewChannel] : []),
      ...(room?.is_locked ? [PermissionFlagsBits.Connect] : []),
    ]);

    pushOverwrite(guild.members.me?.id, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
    ], []);

    pushOverwrite(ownerId, [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
    ], []);

    for (const userId of allowedIds) {
      if (userId === ownerId || blockedIds.has(userId)) continue;
      pushOverwrite(userId, [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ], []);
    }

    for (const userId of blockedIds) {
      pushOverwrite(userId, [], [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
      ]);
    }

    await resolvedChannel.permissionOverwrites.set([...overwriteMap.values()], 'Sync vocal temporaire').catch(() => {});

    await resolvedChannel.setUserLimit(Number(room?.user_limit || 0)).catch(() => {});
    await resolvedChannel.setRTCRegion(room?.rtc_region && room.rtc_region !== 'auto' ? room.rtc_region : null).catch(() => {});

    return resolvedChannel;
  }

  async _syncVoiceRoomControlMessage(guild, room, configRow) {
    return this._withVoiceRoomControlSync(room?.id, async () => {
      const channel = await this._syncVoiceRoomPermissions(guild, room);
      if (!channel || typeof channel.send !== 'function') {
        return room;
      }

      const payload = this._buildVoiceRoomControlPayload(room, configRow, guild, channel);
      const matchedMessages = await this._findVoiceRoomControlMessages(channel, room.id);
      let message = null;

      if (room.control_message_id && channel.messages?.fetch) {
        message = await channel.messages.fetch(room.control_message_id).catch(() => null);
      }

      if (!message) {
        message = matchedMessages[0] || null;
      }

      if (message?.author?.id === this.client?.user?.id) {
        message = await message.edit({
          content: null,
          ...payload,
          attachments: [],
        }).catch(() => null);
      }

      if (!message) {
        message = await channel.send({
          content: room.owner_discord_user_id ? `<@${room.owner_discord_user_id}> ton panneau vocal est pret juste ici.` : undefined,
          allowedMentions: room.owner_discord_user_id ? { users: [room.owner_discord_user_id] } : undefined,
          ...payload,
        }).catch(() => null);
      }

      if (!message?.id) return room;

      for (const duplicate of matchedMessages) {
        if (duplicate.id !== message.id && duplicate.deletable) {
          await duplicate.delete().catch(() => {});
        }
      }

      return updateTempVoiceRoom(room.guild_id, room.id, {
        control_message_id: message.id,
        channel_id: channel.id,
        name: channel.name,
        user_limit: channel.userLimit || room.user_limit,
      });
    });
  }

  _canManageVoiceRoom(member, room) {
    if (!member || !room) return false;
    return member.id === room.owner_discord_user_id;
  }

  async _findVoiceRoomControlMessages(channel, roomId) {
    if (!channel?.messages?.fetch || !roomId) return [];
    const recentMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    if (!recentMessages) return [];

    return [...recentMessages.values()]
      .filter((message) => (
        message?.author?.id === this.client?.user?.id
        && Array.isArray(message.components)
        && message.components.some((row) => row.components?.some((component) => {
          const customId = String(component?.customId || '');
          return customId.startsWith(`${VOICE_GENERATOR_PREFIX}:`) && customId.includes(`:${roomId}`);
        }))
      ))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
  }

  async _withVoiceRoomControlSync(roomId, executor) {
    const key = String(roomId || '');
    const previous = this._voiceRoomControlSyncs.get(key) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => executor());

    this._voiceRoomControlSyncs.set(key, next);

    try {
      return await next;
    } finally {
      if (this._voiceRoomControlSyncs.get(key) === next) {
        this._voiceRoomControlSyncs.delete(key);
      }
    }
  }

  async _createManagedVoiceRoom(member, internalGuildId, configRow, creatorChannel) {
    const guild = member.guild;
    const existing = getActiveTempVoiceRoomByOwner(internalGuildId, member.id);

    if (existing?.channel_id) {
      const existingChannel = await this._resolveVoiceChannelById(guild, existing.channel_id);
      if (existingChannel) {
        await member.voice.setChannel(existingChannel, 'Retour vers la vocale temporaire existante').catch(() => {});
        await this._syncVoiceRoomControlMessage(guild, existing, configRow);
        return existing;
      }
      closeTempVoiceRoom(internalGuildId, existing.id);
    }

    const baseName = buildVoiceRoomName(configRow.room_name_template, {
      username: member.displayName || member.user?.globalName || member.user?.username || member.id,
      display_name: member.displayName || member.user?.globalName || member.user?.username || member.id,
      user_tag: member.user?.tag || member.user?.username || member.id,
    });
    const existingNames = new Set(guild.channels.cache.map((channel) => String(channel?.name || '').toLowerCase()));
    let finalName = this._sanitizeVoiceChannelName(baseName, 'vocale-temporaire');
    let suffix = 1;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = this._sanitizeVoiceChannelName(`${baseName} ${suffix}`, 'vocale-temporaire');
      suffix += 1;
    }

    const targetParentId = normalizeSnowflake(configRow.creator_category_id || creatorChannel?.parentId);
    const parentChannel = targetParentId
      ? (guild.channels.cache.get(targetParentId) || await guild.channels.fetch(targetParentId).catch(() => null))
      : null;

    const createdChannel = await guild.channels.create({
      name: finalName,
      type: ChannelType.GuildVoice,
      parent: parentChannel?.type === ChannelType.GuildCategory ? parentChannel.id : undefined,
      userLimit: Number(configRow.default_user_limit || 0),
      rtcRegion: configRow.default_region && configRow.default_region !== 'auto' ? configRow.default_region : null,
      reason: `Creation vocale temporaire pour ${member.user?.tag || member.displayName || member.id}`,
    });

    let room = createTempVoiceRoomEntry({
      internalGuildId,
      generatorId: configRow.id,
      ownerDiscordUserId: member.id,
      ownerUsername: member.user?.tag || member.displayName || member.user?.username || member.id,
      sourceChannelId: creatorChannel?.id || '',
      channelId: createdChannel.id,
      name: createdChannel.name,
      userLimit: configRow.default_user_limit,
      rtcRegion: configRow.default_region,
    });

    await this._syncVoiceRoomPermissions(guild, room, createdChannel);
    await member.voice.setChannel(createdChannel, 'Creation vocale temporaire').catch(() => {});
    room = await this._syncVoiceRoomControlMessage(guild, room, configRow);
    return room;
  }

  async _deleteManagedVoiceRoom(guild, room, reason = 'Suppression vocale temporaire') {
    if (!room?.id) return;
    const channel = await this._resolveVoiceChannelById(guild, room.channel_id);
    closeTempVoiceRoom(room.guild_id, room.id);
    if (channel?.deletable) {
      await channel.delete(reason).catch(() => {});
    }
  }

  async _showVoiceRoomModal(interaction, roomId, action) {
    const modal = new ModalBuilder()
      .setCustomId(this._buildVoiceGeneratorCustomId('modal', action, roomId))
      .setTitle({
        rename: 'Renommer la vocale',
        limit: 'Changer la limite',
        invite: 'Inviter un membre',
        reject: 'Refuser un membre',
        transfer: 'Transferer la vocale',
      }[action] || 'Gestion vocale');

    const input = new TextInputBuilder()
      .setCustomId(VOICE_MODAL_INPUT_ID)
      .setStyle(action === 'rename' ? TextInputStyle.Short : TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(action === 'rename' ? 90 : 120)
      .setLabel({
        rename: 'Nouveau nom',
        limit: 'Limite (0-99)',
        invite: 'Mention, ID ou pseudo exact',
        reject: 'Mention, ID ou pseudo exact',
        transfer: 'Mention, ID ou pseudo exact',
      }[action] || 'Valeur')
      .setPlaceholder({
        rename: 'Vocal de Supersonic',
        limit: '0 pour illimite',
        invite: '@membre ou 123456789',
        reject: '@membre ou 123456789',
        transfer: '@membre ou 123456789',
      }[action] || '');

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }

  async _handleVoiceRoomAction(interaction, roomId, action, internalGuildId) {
    const room = getTempVoiceRoomById(internalGuildId, roomId);
    if (!room || room.status !== 'open') {
      await interaction.reply({ content: 'Cette vocale temporaire est introuvable.', ephemeral: true }).catch(() => {});
      return true;
    }

    const configRow = getGuildVoiceGeneratorById(room.generator_id);
    const channel = await this._resolveVoiceChannelById(interaction.guild, room.channel_id);
    if (!configRow?.id || !channel) {
      await interaction.reply({ content: 'Configuration vocale introuvable.', ephemeral: true }).catch(() => {});
      return true;
    }

    if (['rename', 'limit', 'invite', 'reject', 'transfer'].includes(action)) {
      if (!this._canManageVoiceRoom(interaction.member, room)) {
        await interaction.reply({ content: 'Tu ne peux pas gerer cette vocale.', ephemeral: true }).catch(() => {});
        return true;
      }
      await this._showVoiceRoomModal(interaction, room.id, action);
      return true;
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    if (!this._canManageVoiceRoom(interaction.member, room) && action !== 'claim') {
      await interaction.editReply({ content: 'Tu ne peux pas gerer cette vocale.' }).catch(() => {});
      return true;
    }

    let nextRoom = room;

    switch (action) {
      case 'lock':
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { is_locked: true });
        break;
      case 'unlock':
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { is_locked: false });
        break;
      case 'ghost':
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { is_hidden: true });
        break;
      case 'unghost':
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { is_hidden: false });
        break;
      case 'delete':
        await this._deleteManagedVoiceRoom(interaction.guild, room, `Vocale supprimee par ${interaction.user?.tag || interaction.user?.id}`);
        await interaction.editReply({ content: 'Vocale temporaire supprimee.' }).catch(() => {});
        return true;
      case 'claim': {
        if (!configRow.allow_claim) {
          await interaction.editReply({ content: 'Le claim est desactive sur le site.' }).catch(() => {});
          return true;
        }
        if (!channel.members.has(interaction.user.id)) {
          await interaction.editReply({ content: 'Tu dois etre connecte a cette vocale pour la claim.' }).catch(() => {});
          return true;
        }
        if (room.owner_discord_user_id === interaction.user.id) {
          await interaction.editReply({ content: 'Tu possedes deja cette vocale.' }).catch(() => {});
          return true;
        }
        if (room.owner_discord_user_id && channel.members.has(room.owner_discord_user_id)) {
          await interaction.editReply({ content: 'Le createur est encore present dans la vocale.' }).catch(() => {});
          return true;
        }
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, {
          owner_discord_user_id: interaction.user.id,
          owner_username: interaction.user?.tag || interaction.user?.username || interaction.user.id,
          blocked_user_ids: (room.blocked_user_ids || []).filter((userId) => userId !== interaction.user.id),
        });
        break;
      }
      default:
        await interaction.editReply({ content: 'Action vocale inconnue.' }).catch(() => {});
        return true;
    }

    const syncedRoom = await this._syncVoiceRoomControlMessage(interaction.guild, nextRoom, configRow);
    await interaction.editReply({ content: `Action appliquee: ${action}.` }).catch(() => {});
    return !!syncedRoom;
  }

  async _handleVoiceRoomRegion(interaction, roomId, regionValue, internalGuildId) {
    const room = getTempVoiceRoomById(internalGuildId, roomId);
    if (!room || room.status !== 'open') {
      await interaction.reply({ content: 'Cette vocale temporaire est introuvable.', ephemeral: true }).catch(() => {});
      return true;
    }
    if (!this._canManageVoiceRoom(interaction.member, room)) {
      await interaction.reply({ content: 'Tu ne peux pas gerer cette vocale.', ephemeral: true }).catch(() => {});
      return true;
    }

    const nextRegion = SUPPORTED_REGIONS.has(regionValue) ? regionValue : 'auto';
    const nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { rtc_region: nextRegion });
    const configRow = getGuildVoiceGeneratorById(room.generator_id);
    await this._syncVoiceRoomControlMessage(interaction.guild, nextRoom, configRow);
    await interaction.reply({
      content: `Region mise a jour: ${VOICE_REGION_LABELS[nextRegion] || 'Auto'}.`,
      ephemeral: true,
    }).catch(() => {});
    return true;
  }

  async _handleVoiceRoomModal(interaction, action, roomId, internalGuildId) {
    const room = getTempVoiceRoomById(internalGuildId, roomId);
    if (!room || room.status !== 'open') {
      await interaction.reply({ content: 'Cette vocale temporaire est introuvable.', ephemeral: true }).catch(() => {});
      return true;
    }

    const configRow = getGuildVoiceGeneratorById(room.generator_id);
    const channel = await this._resolveVoiceChannelById(interaction.guild, room.channel_id);
    if (!configRow?.id || !channel || !this._canManageVoiceRoom(interaction.member, room)) {
      await interaction.reply({ content: 'Tu ne peux pas gerer cette vocale.', ephemeral: true }).catch(() => {});
      return true;
    }

    const value = String(interaction.fields.getTextInputValue(VOICE_MODAL_INPUT_ID) || '').trim();
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    let nextRoom = room;

    if (action === 'rename') {
      const nextName = this._sanitizeVoiceChannelName(value, room.name || 'vocale-temporaire');
      await channel.setName(nextName, `Rename vocal temporaire par ${interaction.user?.tag || interaction.user?.id}`).catch(() => {});
      nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { name: nextName });
    } else if (action === 'limit') {
      const nextLimit = Math.max(0, Math.min(Number(value || 0), 99));
      nextRoom = updateTempVoiceRoom(internalGuildId, room.id, { user_limit: nextLimit });
    } else {
      const targetMember = await this._resolveVoicePromptMember(interaction.guild, value);
      if (!targetMember) {
        await interaction.editReply({ content: 'Membre introuvable.' }).catch(() => {});
        return true;
      }

      if (action === 'invite') {
        const allowed = new Set(nextRoom.allowed_user_ids || []);
        allowed.add(targetMember.id);
        const blocked = new Set(nextRoom.blocked_user_ids || []);
        blocked.delete(targetMember.id);
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, {
          allowed_user_ids: [...allowed],
          blocked_user_ids: [...blocked],
        });
      } else if (action === 'reject') {
        const blocked = new Set(nextRoom.blocked_user_ids || []);
        blocked.add(targetMember.id);
        const allowed = new Set(nextRoom.allowed_user_ids || []);
        allowed.delete(targetMember.id);
        if (targetMember.voice?.channelId === channel.id) {
          await targetMember.voice.setChannel(null, 'Refus de la vocale temporaire').catch(() => {});
        }
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, {
          blocked_user_ids: [...blocked],
          allowed_user_ids: [...allowed],
        });
      } else if (action === 'transfer') {
        if (targetMember.voice?.channelId !== channel.id) {
          await interaction.editReply({ content: 'Le membre doit etre connecte a la vocale pour recevoir le transfer.' }).catch(() => {});
          return true;
        }
        nextRoom = updateTempVoiceRoom(internalGuildId, room.id, {
          owner_discord_user_id: targetMember.id,
          owner_username: targetMember.user?.tag || targetMember.displayName || targetMember.id,
          blocked_user_ids: (room.blocked_user_ids || []).filter((userId) => userId !== targetMember.id),
        });
      }
    }

    const syncedRoom = await this._syncVoiceRoomControlMessage(interaction.guild, nextRoom, configRow);
    await interaction.editReply({ content: `Action appliquee: ${action}.` }).catch(() => {});
    return !!syncedRoom;
  }

  async _handleVoiceGeneratorInteraction(interaction) {
    const parsed = this._parseVoiceGeneratorCustomId(interaction?.customId);
    if (!parsed || !interaction?.guild) return false;

    const internalGuildId = this._resolveInternalGuildId(interaction.guild.id);
    if (!internalGuildId) {
      if (typeof interaction.reply === 'function') {
        await interaction.reply({ content: 'Serveur vocal introuvable.', ephemeral: true }).catch(() => {});
      }
      return true;
    }

    try {
      if (interaction.isStringSelectMenu() && parsed.type === 'settings') {
        return this._handleVoiceRoomAction(interaction, parsed.args[0], interaction.values?.[0], internalGuildId);
      }

      if (interaction.isStringSelectMenu() && parsed.type === 'permissions') {
        return this._handleVoiceRoomAction(interaction, parsed.args[0], interaction.values?.[0], internalGuildId);
      }

      if (interaction.isStringSelectMenu() && parsed.type === 'region') {
        const rawValue = String(interaction.values?.[0] || '');
        const regionValue = rawValue.replace(/^region__/, '');
        return this._handleVoiceRoomRegion(interaction, parsed.args[0], regionValue, internalGuildId);
      }

      if (interaction.isModalSubmit() && parsed.type === 'modal') {
        return this._handleVoiceRoomModal(interaction, parsed.args[0], parsed.args[1], internalGuildId);
      }
    } catch (error) {
      logger.error(`Voice interaction error: ${error.message}`);
      if (!interaction.replied && !interaction.deferred && typeof interaction.reply === 'function') {
        await interaction.reply({ content: 'Impossible de traiter cette vocale pour le moment.', ephemeral: true }).catch(() => {});
      } else if (typeof interaction.followUp === 'function') {
        await interaction.followUp({ content: 'Impossible de traiter cette vocale pour le moment.', ephemeral: true }).catch(() => {});
      }
      return true;
    }

    return false;
  }

  _buildCaptchaCustomId(type, ...args) {
    return [CAPTCHA_GENERATOR_PREFIX, type, ...args].filter(Boolean).join(':');
  }

  _parseCaptchaCustomId(customId) {
    const parts = String(customId || '').split(':').filter(Boolean);
    if (parts[0] !== CAPTCHA_GENERATOR_PREFIX || parts.length < 2) return null;
    return {
      type: parts[1],
      args: parts.slice(2),
    };
  }

  _sanitizeCaptchaChannelName(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);

    return normalized || 'verification';
  }

  _buildCaptchaPanelAssets(configRow) {
    const files = [];
    let thumbnailUrl = String(configRow?.panel_thumbnail_url || '').trim();
    let imageUrl = String(configRow?.panel_image_url || '').trim();

    const thumbnailAsset = parseImageDataUrl(thumbnailUrl);
    if (thumbnailAsset) {
      const fileName = `captcha-thumb-${configRow.id}.${thumbnailAsset.extension}`;
      files.push(new AttachmentBuilder(thumbnailAsset.buffer, { name: fileName }));
      thumbnailUrl = `attachment://${fileName}`;
    }

    const imageAsset = parseImageDataUrl(imageUrl);
    if (imageAsset) {
      const fileName = `captcha-banner-${configRow.id}.${imageAsset.extension}`;
      files.push(new AttachmentBuilder(imageAsset.buffer, { name: fileName }));
      imageUrl = `attachment://${fileName}`;
    }

    return {
      files,
      thumbnailUrl,
      imageUrl,
    };
  }

  _getCaptchaChallengeDefinition(configRow, challengeType = null) {
    const selected = challengeType
      ? (configRow?.challenge_types || []).find((item) => item?.key === challengeType)
      : getSelectedCaptchaChallenge(configRow);

    const key = selected?.key || challengeType || 'image_code';
    const fallbackByKey = {
      image_code: {
        key: 'image_code',
        label: 'Code image',
        description: 'Le membre recopie un code brouillé affiché dans une image.',
      },
      quick_math: {
        key: 'quick_math',
        label: 'Calcul express',
        description: 'Le membre résout une opération courte pour valider son accès.',
      },
      emoji_gate: {
        key: 'emoji_gate',
        label: 'Sélection visuelle',
        description: 'Le membre clique sur le bon pictogramme parmi plusieurs choix.',
      },
      word_gate: {
        key: 'word_gate',
        label: 'Mot cible',
        description: 'Le membre choisit le bon mot parmi plusieurs propositions.',
      },
    };

    const fallback = fallbackByKey[key] || fallbackByKey.image_code;
    return {
      key: fallback.key,
      label: String(selected?.label || fallback.label).trim(),
      description: String(selected?.description || fallback.description).trim(),
    };
  }

  _buildCaptchaPanelComponents(configRow) {
    const selectedType = this._getCaptchaChallengeDefinition(configRow);
    if (!selectedType?.key) return [];

    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(this._buildCaptchaCustomId('start', configRow.id))
          .setLabel('Vérifier l’accès')
          .setEmoji('🛡️')
          .setStyle(ButtonStyle.Primary)
      ),
    ];
  }

  _buildCaptchaPanelPayload(configRow) {
    const assets = this._buildCaptchaPanelAssets(configRow);
    const color = Number.parseInt(String(configRow.panel_color || '#06b6d4').replace('#', ''), 16);

    const embed = {
      color,
      title: String(configRow.panel_title || 'Vérification du serveur'),
      description: String(configRow.panel_description || '').trim() || 'Clique sur ce bouton ci-dessous pour vérifier ton accès au serveur.',
    };

    if (assets.thumbnailUrl) {
      embed.thumbnail = { url: assets.thumbnailUrl };
    }
    if (assets.imageUrl) {
      embed.image = { url: assets.imageUrl };
    }

    return {
      embeds: [embed],
      components: this._buildCaptchaPanelComponents(configRow),
      files: assets.files,
    };
  }

  _pickCaptchaChallengeType(configRow) {
    return this._getCaptchaChallengeDefinition(configRow)?.key || null;
  }

  _buildCaptchaChoiceComponents(challengeId, choices = []) {
    const safeChoices = Array.isArray(choices) ? choices.slice(0, 4) : [];
    if (!safeChoices.length) return [];

    return [
      new ActionRowBuilder().addComponents(
        ...safeChoices.map((choice) => {
          const button = new ButtonBuilder()
            .setCustomId(this._buildCaptchaCustomId('choice', challengeId, choice.value))
            .setLabel(String(choice.label || choice.value || 'Choix').slice(0, 80))
            .setStyle(ButtonStyle.Secondary);

          if (choice.emoji) {
            button.setEmoji(choice.emoji);
          }

          return button;
        })
      ),
    ];
  }

  _buildCaptchaRetryComponents(challenge) {
    if (!challenge) return [];

    if (['emoji_gate', 'word_gate'].includes(challenge.challenge_type)) {
      return this._buildCaptchaChoiceComponents(challenge.id, challenge.metadata?.choices || []);
    }

    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(this._buildCaptchaCustomId('answer', challenge.id))
          .setLabel(challenge.challenge_type === 'quick_math' ? 'Ouvrir le calcul' : 'Entrer le code')
          .setStyle(ButtonStyle.Primary)
      ),
    ];
  }

  async _replyCaptcha(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload);
    }
    return interaction.reply({
      ephemeral: true,
      ...payload,
    });
  }

  async _deferCaptcha(interaction) {
    if (interaction.deferred || interaction.replied || typeof interaction.deferReply !== 'function') {
      return;
    }
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }

  _buildCaptchaPromptPayload(configRow, challenge, prompt, {
    tone = 'info',
    title = '',
    intro = '',
    footer = '',
  } = {}) {
    const panelAssets = this._buildCaptchaPanelAssets(configRow);
    const files = [...panelAssets.files];
    let visualUrl = panelAssets.imageUrl || '';

    if (prompt.challengeType === 'image_code' && prompt.visualCode) {
      const codeAttachment = buildCaptchaPngAttachment(prompt.visualCode, challenge.id, configRow.panel_color);
      files.push(codeAttachment);
      visualUrl = `attachment://${codeAttachment.name}`;
    }

    const descriptionParts = [
      intro,
      String(prompt.description || '').trim(),
      String(prompt.promptText || '').trim(),
    ].filter(Boolean);

    const embed = this._buildCaptchaFeedbackEmbed(configRow, {
      title: title || prompt.title || 'Verification privee',
      description: descriptionParts.join('\n\n').slice(0, 4000),
      tone,
      imageUrl: visualUrl,
      footer: footer || 'Tes reponses restent visibles uniquement pour toi.',
    });

    if (panelAssets.thumbnailUrl) {
      embed.thumbnail = { url: panelAssets.thumbnailUrl };
    }

    return {
      embeds: [embed],
      components: prompt.responseMode === 'choices'
        ? this._buildCaptchaChoiceComponents(challenge.id, prompt.choices)
        : this._buildCaptchaRetryComponents(challenge),
      files,
    };
  }

  _createCaptchaChallengeInstance(configRow, {
    guildId,
    discordUserId,
    discordChannelId = '',
    challengeType = null,
    attemptCount = 0,
  } = {}) {
    const prompt = this._buildCaptchaChallengePrompt(
      challengeType || this._pickCaptchaChallengeType(configRow) || 'image_code'
    );

    const challenge = createCaptchaChallenge({
      guildId,
      configId: configRow.id,
      discordUserId,
      discordChannelId,
      challengeType: prompt.challengeType,
      promptText: prompt.promptText,
      expectedAnswer: prompt.expectedAnswer,
      metadata: {
        ...(prompt.visualCode ? { visualCode: prompt.visualCode } : {}),
        ...(prompt.choices ? { choices: prompt.choices } : {}),
      },
      attemptCount,
    });

    return {
      challenge,
      prompt,
    };
  }

  async _buildCaptchaRetryPayload(configRow, activeChallenge, interaction, failureReason) {
    const nextAttemptCount = Math.max(0, Number(activeChallenge?.attempt_count || 0));
    const regenerated = this._createCaptchaChallengeInstance(configRow, {
      guildId: activeChallenge.guild_id,
      discordUserId: interaction.user.id,
      discordChannelId: interaction.channelId || activeChallenge.discord_channel_id || '',
      challengeType: activeChallenge.challenge_type,
      attemptCount: nextAttemptCount,
    });

    const intro = failureReason === 'empty'
      ? 'Reponse vide. Un nouveau defis prive a ete prepare.'
      : 'Code invalide. Un nouveau defis prive a ete genere.';

    return this._buildCaptchaPromptPayload(configRow, regenerated.challenge, regenerated.prompt, {
      tone: 'warning',
      intro,
      footer: `${Math.max(0, 3 - nextAttemptCount)} essai(s) restant(s) avant expulsion automatique.`,
    });
  }

  _buildCaptchaChallengePrompt(challengeType) {
    if (challengeType === 'quick_math') {
      const left = 4 + Math.floor(Math.random() * 7);
      const right = 2 + Math.floor(Math.random() * 6);
      const useSubtraction = Math.random() > 0.45;
      const larger = Math.max(left, right);
      const smaller = Math.min(left, right);
      const promptText = useSubtraction
        ? `Combien font ${larger} - ${smaller} ?`
        : `Combien font ${left} + ${right} ?`;
      const expectedAnswer = String(useSubtraction ? (larger - smaller) : (left + right));
      return {
        challengeType,
        promptText,
        expectedAnswer,
        responseMode: 'modal',
        title: 'Calcul express',
        description: 'Résous ce calcul pour récupérer ton accès.',
      };
    }

    if (challengeType === 'emoji_gate') {
      const choices = shuffleArray(CAPTCHA_EMOJI_CHOICES).slice(0, 4);
      const correct = choices[Math.floor(Math.random() * choices.length)] || choices[0];
      return {
        challengeType,
        promptText: `Clique sur ${correct.label}.`,
        expectedAnswer: correct.value,
        responseMode: 'choices',
        title: 'Sélection visuelle',
        description: 'Choisis le bon pictogramme parmi les boutons ci-dessous.',
        choices,
      };
    }

    if (challengeType === 'word_gate') {
      const words = shuffleArray(CAPTCHA_WORD_CHOICES).slice(0, 4);
      const correct = words[Math.floor(Math.random() * words.length)] || words[0];
      const choices = shuffleArray(words.map((word) => ({
        value: word,
        label: word,
      })));
      return {
        challengeType,
        promptText: `Choisis le mot ${correct}.`,
        expectedAnswer: correct,
        responseMode: 'choices',
        title: 'Mot cible',
        description: 'Repère le bon mot et clique sur le bon bouton.',
        choices,
      };
    }

    const expectedAnswer = buildNumericCaptchaCode(6);
    return {
      challengeType: 'image_code',
      promptText: 'Recopie le code visible sur l image.',
      expectedAnswer,
      responseMode: 'image',
      title: 'Code image',
      description: 'Observe le code brouillé puis saisis-le exactement.',
      visualCode: expectedAnswer,
    };
  }

  _memberHasCaptchaAccess(member, configRow) {
    const grantedRoles = Array.isArray(configRow?.verified_role_ids) ? configRow.verified_role_ids : [];
    if (!member?.roles?.cache || !grantedRoles.length) return false;
    return grantedRoles.some((roleId) => member.roles.cache.has(roleId));
  }

  async _resolveCaptchaPublishChannel(guild, configRow) {
    if (!guild || !configRow) {
      throw new Error('Serveur CAPTCHA introuvable.');
    }

    if (configRow.channel_mode === 'create') {
      const desiredName = this._sanitizeCaptchaChannelName(configRow.panel_channel_name);
      const existing = guild.channels.cache.find((channel) => (
        [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type)
        && this._sanitizeCaptchaChannelName(channel?.name) === desiredName
      ));

      if (existing) return existing;

      if (!guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error('Le bot doit avoir la permission de gerer les salons pour creer le salon CAPTCHA.');
      }

      return guild.channels.create({
        name: desiredName,
        type: ChannelType.GuildText,
        reason: 'Creation du salon CAPTCHA',
      });
    }

    const channel = await this._resolveTicketTextChannel(guild, configRow.panel_channel_id);
    if (!channel) {
      throw new Error('Choisis un salon texte valide pour le panel CAPTCHA.');
    }
    return channel;
  }

  async _syncCaptchaVerifiedChannelVisibility(channel, guild, configRow) {
    if (!channel?.permissionOverwrites?.edit || !guild?.members?.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      return;
    }

    const roleIds = [...new Set((configRow?.verified_role_ids || []).map((roleId) => normalizeSnowflake(roleId)).filter(Boolean))];
    if (!roleIds.length) return;

    await Promise.all(roleIds.map((roleId) => (
      channel.permissionOverwrites.edit(roleId, {
        ViewChannel: false,
        SendMessages: false,
        AddReactions: false,
        ReadMessageHistory: false,
      }, {
        reason: 'Masquer le salon CAPTCHA aux membres verifies',
      }).catch(() => {})
    )));
  }

  async publishCaptchaPanel(discordGuildId) {
    const guild = this.client?.guilds?.cache?.get(discordGuildId) || await this.client?.guilds?.fetch(discordGuildId);
    if (!guild) {
      throw new Error('Serveur Discord introuvable.');
    }

    const internalGuildId = this._resolveInternalGuildId(discordGuildId);
    if (!internalGuildId) {
      throw new Error('Serveur interne introuvable.');
    }

    const configRow = getGuildCaptchaConfig(internalGuildId);
    const enabledTypes = (configRow?.challenge_types || []).filter((item) => item.enabled);
    if (!configRow?.enabled) {
      throw new Error('Le module CAPTCHA est desactive.');
    }
    if (!enabledTypes.length) {
      throw new Error('Active au moins une methode CAPTCHA.');
    }

    const validRoles = (configRow.verified_role_ids || [])
      .map((roleId) => guild.roles.cache.get(roleId))
      .filter((role) => role && role.editable);
    if (!validRoles.length) {
      throw new Error('Choisis au moins un role verifiable que le bot peut attribuer.');
    }

    const channel = await this._resolveCaptchaPublishChannel(guild, configRow);
    const permissions = channel.permissionsFor?.(guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions?.has(PermissionFlagsBits.SendMessages)) {
      throw new Error('Le bot ne peut pas envoyer le panel CAPTCHA dans ce salon.');
    }
    if (!permissions?.has(PermissionFlagsBits.EmbedLinks)) {
      throw new Error('Le bot doit pouvoir integrer des liens dans le salon CAPTCHA.');
    }
    if (!permissions?.has(PermissionFlagsBits.AttachFiles)) {
      throw new Error('Le bot doit pouvoir joindre des fichiers dans le salon CAPTCHA.');
    }

    const payload = this._buildCaptchaPanelPayload(configRow);
    let message = null;

    if (configRow.panel_message_id) {
      message = await channel.messages.fetch(configRow.panel_message_id).catch(() => null);
    }

    if (message) {
      await message.edit(payload);
    } else {
      message = await channel.send(payload);
    }

    await this._syncCaptchaVerifiedChannelVisibility(channel, guild, configRow);

    const saved = recordPublishedCaptchaPanel(internalGuildId, {
      panel_channel_id: channel.id,
      panel_message_id: message.id,
    });

    if (configRow.channel_mode === 'create' && saved.panel_channel_id !== channel.id) {
      saveGuildCaptchaConfig(internalGuildId, {
        panel_channel_id: channel.id,
      });
    }

    return {
      channelId: channel.id,
      channelName: channel.name,
      messageId: message.id,
    };
  }

  async _showCaptchaAnswerModal(interaction, challenge) {
    const modal = new ModalBuilder()
      .setCustomId(this._buildCaptchaCustomId('submit', challenge.id))
      .setTitle(challenge?.challenge_type === 'quick_math' ? 'Calcul express' : 'Code image');

    const input = new TextInputBuilder()
      .setCustomId(CAPTCHA_ANSWER_INPUT_ID)
      .setLabel(String(challenge?.prompt_text || 'Saisis la réponse').slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(24)
      .setPlaceholder(challenge?.challenge_type === 'quick_math' ? 'Entre le résultat' : 'Recopie le code exact');

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  }

  async _sendCaptchaLog({ guild, configRow, member, challengeType, grantedRoleIds = [] }) {
    if (!configRow?.log_channel_id) return;

    const channel = await this._resolveTicketTextChannel(guild, configRow.log_channel_id);
    if (!channel?.isTextBased?.()) return;

    await channel.send({
      embeds: [{
        color: Number.parseInt(String(configRow.panel_color || '#06b6d4').replace('#', ''), 16),
        title: 'Vérification CAPTCHA validée',
        description: `${member} a validé son accès au serveur.`,
        thumbnail: member?.user?.displayAvatarURL ? { url: member.user.displayAvatarURL({ size: 256 }) } : undefined,
        fields: [
          {
            name: 'Méthode',
            value: this._getCaptchaChallengeDefinition(configRow, challengeType).label,
            inline: true,
          },
          {
            name: 'Rôles ajoutés',
            value: grantedRoleIds.length ? grantedRoleIds.map((roleId) => `<@&${roleId}>`).join(', ') : 'Aucun rôle ajouté',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: guild?.name || 'CAPTCHA',
        },
      }],
    }).catch(() => {});
  }

  _buildCaptchaFeedbackEmbed(configRow, {
    title,
    description,
    tone = 'info',
    imageUrl = '',
    footer = '',
  } = {}) {
    const colorByTone = {
      success: 0x22c55e,
      error: 0xef4444,
      warning: 0xf59e0b,
      info: Number.parseInt(String(configRow?.panel_color || '#06b6d4').replace('#', ''), 16),
    };

    const embed = {
      color: colorByTone[tone] || colorByTone.info,
      title: String(title || 'CAPTCHA').slice(0, 256),
      description: String(description || '').trim().slice(0, 4000),
    };

    if (imageUrl) {
      embed.image = { url: imageUrl };
    }
    if (footer) {
      embed.footer = { text: String(footer).slice(0, 2048) };
    }
    return embed;
  }

  async _resolveCaptchaMember(interaction) {
    return interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  }

  async _handleCaptchaMaxAttempts(interaction, challenge) {
    await this._deferCaptcha(interaction);

    const member = await this._resolveCaptchaMember(interaction);
    let kicked = false;

    if (member?.kickable) {
      kicked = await member.kick('Échec CAPTCHA après 3 tentatives').then(() => true).catch(() => false);
    }

    await this._replyCaptcha(interaction, {
      embeds: [this._buildCaptchaFeedbackEmbed(null, {
        title: 'Verification refusee',
        description: kicked
          ? 'Trop de tentatives incorrectes. Tu as ete expulse du serveur pour proteger l acces.'
          : 'Trop de tentatives incorrectes. Le bot n a pas pu t expulser automatiquement, contacte un administrateur.',
        tone: 'error',
        footer: 'Nouvelle tentative bloquee apres trop d erreurs consecutives.',
      })],
      components: [],
    }).catch(() => {});

    return true;
  }

  async _handleCaptchaMaxAttemptsMessage(message) {
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    let kicked = false;

    if (member?.kickable) {
      kicked = await member.kick('Échec CAPTCHA après 3 tentatives').then(() => true).catch(() => false);
    }

    await message.channel.send({
      content: `<@${message.author.id}>`,
      embeds: [
        this._buildCaptchaFeedbackEmbed(null, {
          title: 'Vérification refusée',
          description: kicked
            ? 'Trop de codes incorrects. Tu as été expulsé du serveur.'
            : 'Trop de codes incorrects. Le bot n’a pas pu t’expulser automatiquement.',
          tone: 'error',
        }),
      ],
      allowedMentions: { users: [message.author.id] },
    }).catch(() => {});

    return true;
  }

  async _finalizeCaptchaChallenge(interaction, activeChallenge, internalGuildId, answer) {
    if (!activeChallenge || activeChallenge.guild_id !== internalGuildId) {
      await this._replyCaptcha(interaction, { content: 'Ce CAPTCHA a expiré. Relance une vérification.' }).catch(() => {});
      return true;
    }
    if (String(activeChallenge.discord_user_id) !== String(interaction.user.id)) {
      await this._replyCaptcha(interaction, { content: 'Cette vérification ne t’appartient pas.' }).catch(() => {});
      return true;
    }

    const configRow = getGuildCaptchaConfigById(activeChallenge.config_id);
    if (!configRow?.id || configRow.guild_id !== internalGuildId) {
      await this._replyCaptcha(interaction, { content: 'Configuration CAPTCHA introuvable.' }).catch(() => {});
      return true;
    }

    await this._deferCaptcha(interaction);

    const result = validateCaptchaChallenge(activeChallenge.id, answer);
    if (!result.ok) {
      if (result.reason === 'max_attempts') {
        return this._handleCaptchaMaxAttempts(interaction, result.challenge || activeChallenge);
      }

      const canRetry = ['invalid', 'empty'].includes(result.reason);
      if (result.reason === 'expired' || !canRetry) {
        await this._replyCaptcha(interaction, {
          embeds: [this._buildCaptchaFeedbackEmbed(configRow, {
            title: 'Verification expiree',
            description: 'Ce defis a expire. Clique de nouveau sur le bouton de verification.',
            tone: 'warning',
          })],
          components: [],
        }).catch(() => {});
        return true;
      }

      const retryPayload = await this._buildCaptchaRetryPayload(
        configRow,
        result.challenge || activeChallenge,
        interaction,
        result.reason
      );

      await this._replyCaptcha(interaction, retryPayload).catch(() => {});
      return true;
    }

    const member = await this._resolveCaptchaMember(interaction);
    if (!member) {
      await this._replyCaptcha(interaction, { content: 'Membre introuvable pour finaliser la vérification.' }).catch(() => {});
      return true;
    }

    const rolesToGrant = (configRow.verified_role_ids || [])
      .map((roleId) => interaction.guild.roles.cache.get(roleId))
      .filter((role) => role && role.editable)
      .map((role) => role.id);

    await this._replyCaptcha(interaction, {
      embeds: [this._buildCaptchaFeedbackEmbed(configRow, {
        title: 'Acces confirme',
        description: String(configRow.success_message || 'Verification reussie. Acces debloque.').trim(),
        tone: 'success',
        footer: 'Ouverture du serveur en cours...',
      })],
      components: [],
    }).catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 1800));

    try {
      if (rolesToGrant.length) {
        await member.roles.add(rolesToGrant, 'CAPTCHA reussi').catch((error) => {
          throw new Error(`Impossible d attribuer les roles CAPTCHA: ${error.message}`);
        });
      }

      await this._sendCaptchaLog({
        guild: interaction.guild,
        configRow,
        member,
        challengeType: activeChallenge.challenge_type,
        grantedRoleIds: rolesToGrant,
      });
    } catch (error) {
      await this._replyCaptcha(interaction, {
        embeds: [this._buildCaptchaFeedbackEmbed(configRow, {
          title: 'Validation interrompue',
          description: String(error?.message || 'Impossible de finaliser cette verification.'),
          tone: 'error',
        })],
        components: [],
      }).catch(() => {});
      return true;
    }

    await interaction.deleteReply().catch(() => {});

    return true;
  }

  async _handleCaptchaMessageAnswer(message, activeChallenge, internalGuildId) {
    if (!activeChallenge || activeChallenge.guild_id !== internalGuildId || activeChallenge.challenge_type !== 'image_code') {
      return false;
    }

    if (String(activeChallenge.discord_user_id) !== String(message.author.id)) {
      return false;
    }

    const configRow = getGuildCaptchaConfigById(activeChallenge.config_id);
    if (!configRow?.id || configRow.guild_id !== internalGuildId) {
      await message.channel.send({
        content: `<@${message.author.id}>`,
        embeds: [
          this._buildCaptchaFeedbackEmbed(null, {
            title: 'CAPTCHA indisponible',
            description: 'La configuration CAPTCHA est introuvable.',
            tone: 'error',
          }),
        ],
        allowedMentions: { users: [message.author.id] },
      }).catch(() => {});
      return true;
    }

    const result = validateCaptchaChallenge(activeChallenge.id, message.content);
    await message.delete().catch(() => {});

    if (!result.ok) {
      if (result.reason === 'max_attempts') {
        return this._handleCaptchaMaxAttemptsMessage(message);
      }

      const description = result.reason === 'expired'
        ? 'Le CAPTCHA a expiré. Clique de nouveau sur le bouton de vérification.'
        : result.reason === 'empty'
          ? 'Envoie uniquement le code affiché dans le salon.'
          : String(configRow.failure_message || 'Code invalide. Réessaie.');

      await message.channel.send({
        content: `<@${message.author.id}>`,
        embeds: [
          this._buildCaptchaFeedbackEmbed(configRow, {
            title: 'Code invalide',
            description,
            tone: 'warning',
          }),
        ],
        allowedMentions: { users: [message.author.id] },
      }).catch(() => {});
      return true;
    }

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) {
      await message.channel.send({
        content: `<@${message.author.id}>`,
        embeds: [
          this._buildCaptchaFeedbackEmbed(configRow, {
            title: 'Membre introuvable',
            description: 'Impossible de finaliser la vérification pour ce membre.',
            tone: 'error',
          }),
        ],
        allowedMentions: { users: [message.author.id] },
      }).catch(() => {});
      return true;
    }

    const rolesToGrant = (configRow.verified_role_ids || [])
      .map((roleId) => message.guild.roles.cache.get(roleId))
      .filter((role) => role && role.editable)
      .map((role) => role.id);

    if (rolesToGrant.length) {
      await member.roles.add(rolesToGrant, 'CAPTCHA reussi').catch((error) => {
        throw new Error(`Impossible d attribuer les roles CAPTCHA: ${error.message}`);
      });
    }

    await this._sendCaptchaLog({
      guild: message.guild,
      configRow,
      member,
      challengeType: activeChallenge.challenge_type,
      grantedRoleIds: rolesToGrant,
    });

    await message.channel.send({
      content: `<@${message.author.id}>`,
      embeds: [
        this._buildCaptchaFeedbackEmbed(configRow, {
          title: 'Vérification validée',
          description: String(configRow.success_message || 'Vérification réussie. Accès débloqué.'),
          tone: 'success',
        }),
      ],
      allowedMentions: { users: [message.author.id] },
    }).catch(() => {});

    return true;
  }

  async _handleCaptchaStart(interaction, configId, internalGuildId) {
    const configRow = getGuildCaptchaConfigById(configId);
    if (!configRow?.id || configRow.guild_id !== internalGuildId || !configRow.enabled) {
      await interaction.reply({ content: 'Ce CAPTCHA est indisponible.', ephemeral: true }).catch(() => {});
      return true;
    }

    const member = await this._resolveCaptchaMember(interaction);
    if (!member) {
      await interaction.reply({ content: 'Membre introuvable pour cette vérification.', ephemeral: true }).catch(() => {});
      return true;
    }

    if (this._memberHasCaptchaAccess(member, configRow)) {
      await interaction.reply({ content: 'Tu as déjà validé ton accès.', ephemeral: true }).catch(() => {});
      return true;
    }

    const selectedType = this._pickCaptchaChallengeType(configRow);
    if (!selectedType) {
      await interaction.reply({ content: 'Choisis un mode CAPTCHA sur le site avant de publier.', ephemeral: true }).catch(() => {});
      return true;
    }

    const { prompt, challenge } = this._createCaptchaChallengeInstance(configRow, {
      guildId: internalGuildId,
      discordUserId: interaction.user.id,
      discordChannelId: interaction.channelId || '',
      challengeType: selectedType,
    });

    if (prompt.responseMode === 'modal') {
      await this._showCaptchaAnswerModal(interaction, challenge);
      return true;
    }

    await interaction.reply({
      ephemeral: true,
      ...this._buildCaptchaPromptPayload(configRow, challenge, prompt, {
        title: prompt.responseMode === 'choices' ? 'Verification visuelle' : prompt.title,
        intro: prompt.responseMode === 'image'
          ? 'Le code ci-dessous est genere uniquement pour toi.'
          : 'Ce defis est prive et visible uniquement par toi.',
        footer: '3 erreurs consecutives = expulsion automatique du serveur.',
      }),
    }).catch(() => {});
    return true;
  }

  async _handleCaptchaAnswerButton(interaction, challengeId, internalGuildId) {
    const challenge = getActiveCaptchaChallengeById(challengeId);
    if (!challenge || challenge.guild_id !== internalGuildId) {
      await interaction.reply({ content: 'Ce CAPTCHA a expiré. Relance une vérification.', ephemeral: true }).catch(() => {});
      return true;
    }
    if (String(challenge.discord_user_id) !== String(interaction.user.id)) {
      await interaction.reply({ content: 'Cette vérification ne t’appartient pas.', ephemeral: true }).catch(() => {});
      return true;
    }

    await this._showCaptchaAnswerModal(interaction, challenge);
    return true;
  }

  async _handleCaptchaChoice(interaction, challengeId, selectedValue, internalGuildId) {
    const activeChallenge = getActiveCaptchaChallengeById(challengeId);
    return this._finalizeCaptchaChallenge(interaction, activeChallenge, internalGuildId, selectedValue);
  }

  async _handleCaptchaSubmit(interaction, challengeId, internalGuildId) {
    const activeChallenge = getActiveCaptchaChallengeById(challengeId);
    const answer = interaction.fields.getTextInputValue(CAPTCHA_ANSWER_INPUT_ID);
    return this._finalizeCaptchaChallenge(interaction, activeChallenge, internalGuildId, answer);
  }

  async _handleCaptchaInteraction(interaction) {
    const parsed = this._parseCaptchaCustomId(interaction?.customId);
    if (!parsed || !interaction?.guild) return false;

    const internalGuildId = this._resolveInternalGuildId(interaction.guild.id);
    if (!internalGuildId) {
      if (typeof interaction.reply === 'function') {
        await interaction.reply({ content: 'Serveur CAPTCHA introuvable.', ephemeral: true }).catch(() => {});
      }
      return true;
    }

    try {
      if (interaction.isButton() && parsed.type === 'start') {
        return this._handleCaptchaStart(interaction, parsed.args[0], internalGuildId);
      }

      if (interaction.isButton() && parsed.type === 'answer') {
        return this._handleCaptchaAnswerButton(interaction, parsed.args[0], internalGuildId);
      }

      if (interaction.isButton() && parsed.type === 'choice') {
        return this._handleCaptchaChoice(interaction, parsed.args[0], parsed.args[1], internalGuildId);
      }

      if (interaction.isModalSubmit() && parsed.type === 'submit') {
        return this._handleCaptchaSubmit(interaction, parsed.args[0], internalGuildId);
      }
    } catch (error) {
      logger.error(`Captcha interaction error: ${error.message}`);
      if (!interaction.replied && !interaction.deferred && typeof interaction.reply === 'function') {
        await interaction.reply({ content: 'Impossible de traiter ce CAPTCHA pour le moment.', ephemeral: true }).catch(() => {});
      } else if (typeof interaction.followUp === 'function') {
        await interaction.followUp({ content: 'Impossible de traiter ce CAPTCHA pour le moment.', ephemeral: true }).catch(() => {});
      }
      return true;
    }

    return false;
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

      if (interaction.isButton() && parsed.type === 'closeconfirm') {
        return this._handleTicketGeneratorCloseConfirm(interaction, parsed.args[0], parsed.args[1], internalGuildId);
      }

      if (interaction.isButton() && parsed.type === 'closecancel') {
        return this._handleTicketGeneratorCloseCancel(interaction);
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
    if (isSlash) {
      await this._deferCommandInteraction(source, {
        ephemeral: actionConfig.success_visibility !== 'public',
      });
    }
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

    const deletedCount = await this._deleteMessagesFlexible(channel, amount);

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
    await this._deferCommandInteraction(source, { ephemeral: true });

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
    await this._deferCommandInteraction(source, {
      ephemeral: actionConfig.success_visibility !== 'public',
    });
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

    const effectiveReason = reason || 'Aucune raison précisée.';
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Ban exécuté', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Blacklist exécutée', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Kick exécuté', [
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
        await this._sendSoftbanRejoinLink(targetUser, guild).catch(() => false);
        await recordModAction(guild.id, 'ban', targetUser.id, targetUser.globalName || targetUser.username, source.user.id, moderatorName, effectiveReason, null, 'SYSTEM_COMMAND', {
          command_id: command.id,
          system_key: command.system_key,
          variant: 'softban',
        });
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Softban exécuté', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Timeout appliqué', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Timeout retiré', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Avertissement envoyé', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Déban effectué', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Blacklist retirée', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Rôle ajouté', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Rôle retiré', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Pseudo modifié', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, shouldLock ? 'Salon verrouillé' : 'Salon déverrouillé', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Slowmode modifié', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Annonce publiée', [
          `Commande: ${command.display_trigger}`,
          `Salon: <#${channel.id}>`,
          `Moderateur: <@${source.user.id}>`,
          `Titre: ${title}`,
          `Ping everyone: ${pingEveryone ? 'oui' : 'non'}`,
        ], 0x8b5cf6);
        await this._replyToNativeSource(source, `Annonce publiée dans <#${channel.id}>.`, replyOptions);
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Membre déplacé', [
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
        await this._logNativeCommandToChannel(guild, actionConfig.log_channel_id, 'Membre déconnecté', [
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

  async _executeNativeInfoCommand(source, command) {
    if (!(typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand())) {
      await this._replyToNativeSource(source, 'Cette commande est disponible en slash uniquement.', { preferReply: true });
      return true;
    }

    const guild = source.guild;
    const actionConfig = normalizeCommandActionConfig(command.action_type, command.action_config);
    const replyOptions = { ephemeral: actionConfig.success_visibility !== 'public' };
    await this._deferCommandInteraction(source, replyOptions);

    const resolveTargetUser = async () => {
      const user = source.options.getUser('user') || source.user;
      const member = await guild.members.fetch(user.id).catch(() => null);
      return { user, member };
    };

    const embedColor = this._hexColorToInt(command.embed_color, 0x22d3ee);

    switch (command.action_type) {
      case COMMAND_ACTION_TYPES.PING_INFO: {
        const embed = buildInfoEmbed({
          title: 'Ping du bot',
          color: embedColor,
          description: 'Latences actuelles du bot sur Discord.',
          fields: [
            { name: 'WebSocket', value: `${Math.max(0, Math.round(this.client?.ws?.ping || 0))} ms` },
            { name: 'Serveur', value: `${Date.now() - source.createdTimestamp} ms` },
          ],
          footer: `Commande ${command.display_trigger}`,
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.BOT_INFO: {
        const me = guild.members.me;
        const embed = buildInfoEmbed({
          title: `${this.client.user?.username || 'Bot'} • Infos`,
          color: embedColor,
          description: 'Résumé rapide du bot sur ce serveur.',
          thumbnail: this.client.user?.displayAvatarURL?.({ size: 256 }) || null,
          fields: [
            { name: 'Serveur', value: guild.name },
            { name: 'Ping', value: `${Math.max(0, Math.round(this.client?.ws?.ping || 0))} ms` },
            { name: 'Salons visibles', value: `${guild.channels.cache.size}` },
            { name: 'Membres visibles', value: `${guild.members.cache.size}` },
            { name: 'Rôle le plus haut', value: me?.roles?.highest ? `<@&${me.roles.highest.id}>` : 'Aucun' },
            { name: 'ID bot', value: this.client.user?.id || '-' },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.SERVER_INFO: {
        const owner = await guild.fetchOwner().catch(() => null);
        const embed = buildInfoEmbed({
          title: `${guild.name} • Infos serveur`,
          color: embedColor,
          thumbnail: guild.iconURL?.({ size: 256 }) || null,
          description: guild.description || 'Aucune description publique.',
          fields: [
            { name: 'ID', value: guild.id },
            { name: 'Propriétaire', value: owner ? `<@${owner.id}>` : 'Inconnu' },
            { name: 'Membres', value: `${guild.memberCount || guild.members.cache.size}` },
            { name: 'Salons', value: `${guild.channels.cache.size}` },
            { name: 'Rôles', value: `${guild.roles.cache.size}` },
            { name: 'Créé le', value: guild.createdAt ? guild.createdAt.toLocaleString('fr-FR') : '-' },
          ],
          image: guild.bannerURL?.({ size: 1024 }) || null,
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.MEMBERCOUNT_INFO: {
        const humans = guild.members.cache.filter((member) => !member.user?.bot).size;
        const bots = guild.members.cache.filter((member) => member.user?.bot).size;
        const embed = buildInfoEmbed({
          title: `${guild.name} • Membres`,
          color: embedColor,
          fields: [
            { name: 'Total', value: `${guild.memberCount || guild.members.cache.size}` },
            { name: 'Humains visibles', value: `${humans}` },
            { name: 'Bots visibles', value: `${bots}` },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.USER_INFO: {
        const { user, member } = await resolveTargetUser();
        const liveUser = await this.client.users.fetch(user.id, { force: true }).catch(() => user);
        const roleList = member?.roles?.cache
          ? member.roles.cache.filter((role) => role.id !== guild.id).map((role) => `<@&${role.id}>`).slice(0, 8)
          : [];
        const embed = buildInfoEmbed({
          title: `${liveUser.displayName || liveUser.username} • Profil`,
          color: embedColor,
          thumbnail: liveUser.displayAvatarURL?.({ size: 256 }) || null,
          fields: [
            { name: 'ID', value: liveUser.id },
            { name: 'Pseudo', value: liveUser.username || '-' },
            { name: 'Nom affiché', value: liveUser.globalName || liveUser.displayName || '-' },
            { name: 'Compte créé le', value: liveUser.createdAt ? liveUser.createdAt.toLocaleString('fr-FR') : '-' },
            { name: 'Rejoint le serveur', value: member?.joinedAt ? member.joinedAt.toLocaleString('fr-FR') : 'Non visible' },
            { name: 'Rôles', value: roleList.length > 0 ? roleList.join(', ') : 'Aucun rôle visible', inline: false },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.AVATAR_INFO: {
        const { user } = await resolveTargetUser();
        const liveUser = await this.client.users.fetch(user.id, { force: true }).catch(() => user);
        const avatarUrl = liveUser.displayAvatarURL?.({ size: 1024 }) || null;
        const embed = buildInfoEmbed({
          title: `Avatar • ${liveUser.displayName || liveUser.username}`,
          color: embedColor,
          image: avatarUrl,
          fields: avatarUrl ? [{ name: 'Lien', value: avatarUrl, inline: false }] : [],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.BANNER_INFO: {
        const { user } = await resolveTargetUser();
        const liveUser = await this.client.users.fetch(user.id, { force: true }).catch(() => user);
        const bannerUrl = liveUser.bannerURL?.({ size: 1024 }) || null;
        if (!bannerUrl) {
          await this._replyToNativeSource(source, 'Aucune banniere publique trouvee pour ce membre.', replyOptions);
          return true;
        }
        const embed = buildInfoEmbed({
          title: `Banniere • ${liveUser.displayName || liveUser.username}`,
          color: embedColor,
          image: bannerUrl,
          fields: [{ name: 'Lien', value: bannerUrl, inline: false }],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.ROLE_INFO: {
        const role = source.options.getRole('role', true);
        const embed = buildInfoEmbed({
          title: `${role.name} • Role`,
          color: role.color || embedColor,
          fields: [
            { name: 'ID', value: role.id },
            { name: 'Couleur', value: role.hexColor || '#' + (role.color || embedColor).toString(16).padStart(6, '0') },
            { name: 'Position', value: `${role.position}` },
            { name: 'Membres visibles', value: `${role.members?.size || 0}` },
            { name: 'Mentionnable', value: role.mentionable ? 'Oui' : 'Non' },
            { name: 'Affiché séparément', value: role.hoist ? 'Oui' : 'Non' },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.CHANNEL_INFO: {
        const channel = source.options.getChannel('channel') || source.channel;
        const parentName = channel?.parent?.name || 'Aucune catégorie';
        const embed = buildInfoEmbed({
          title: `${channel?.name || 'Salon'} • Infos`,
          color: embedColor,
          fields: [
            { name: 'ID', value: channel?.id || '-' },
            { name: 'Type', value: String(channel?.type ?? 'inconnu') },
            { name: 'Catégorie', value: parentName },
            { name: 'NSFW', value: channel?.nsfw ? 'Oui' : 'Non' },
            { name: 'Créé le', value: channel?.createdAt ? channel.createdAt.toLocaleString('fr-FR') : '-' },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.JOINED_AT_INFO: {
        const { user, member } = await resolveTargetUser();
        const embed = buildInfoEmbed({
          title: `${user.displayName || user.username} • Arrivée`,
          color: embedColor,
          thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
          fields: [
            { name: 'Compte créé le', value: user.createdAt ? user.createdAt.toLocaleString('fr-FR') : '-' },
            { name: 'Rejoint le serveur', value: member?.joinedAt ? member.joinedAt.toLocaleString('fr-FR') : 'Non visible' },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.SERVER_ICON_INFO: {
        const iconUrl = guild.iconURL?.({ size: 1024 }) || null;
        if (!iconUrl) {
          await this._replyToNativeSource(source, 'Aucune icone publique trouvee pour ce serveur.', replyOptions);
          return true;
        }
        const embed = buildInfoEmbed({
          title: `${guild.name} • Icône`,
          color: embedColor,
          image: iconUrl,
          fields: [{ name: 'Lien', value: iconUrl, inline: false }],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.BOOSTS_INFO: {
        const embed = buildInfoEmbed({
          title: `${guild.name} • Boosts`,
          color: embedColor,
          thumbnail: guild.iconURL?.({ size: 256 }) || null,
          fields: [
            { name: 'Niveau', value: String(guild.premiumTier || 0) },
            { name: 'Boosts actifs', value: `${guild.premiumSubscriptionCount || 0}` },
            { name: 'Limite audio', value: guild.maximumBitrate ? `${Math.round(guild.maximumBitrate / 1000)} kbps` : '-' },
          ],
          image: guild.bannerURL?.({ size: 1024 }) || null,
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.PERMISSIONS_INFO: {
        const { user, member } = await resolveTargetUser();
        const permissions = member?.permissions?.toArray?.() || [];
        const visiblePermissions = permissions.length > 0 ? permissions.slice(0, 15).map((entry) => `\`${entry}\``) : ['Aucune permission visible'];
        const embed = buildInfoEmbed({
          title: `${user.displayName || user.username} • Permissions`,
          color: embedColor,
          thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
          fields: [
            { name: 'ID', value: user.id },
            { name: 'Administrateur', value: member?.permissions?.has?.(PermissionFlagsBits.Administrator) ? 'Oui' : 'Non' },
            { name: 'Type', value: member ? 'Membre du serveur' : 'Utilisateur non visible' },
            { name: 'Permissions visibles', value: visiblePermissions.join(', '), inline: false },
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.ID_INFO: {
        const user = source.options.getUser('user');
        const role = source.options.getRole('role');
        const channel = source.options.getChannel('channel');
        const fields = [];

        if (user) {
          fields.push({ name: 'Utilisateur', value: `${user.displayName || user.username}\n\`${user.id}\``, inline: false });
        }
        if (role) {
          fields.push({ name: 'Rôle', value: `${role.name}\n\`${role.id}\``, inline: false });
        }
        if (channel) {
          fields.push({ name: 'Salon', value: `${channel.name || 'Salon'}\n\`${channel.id}\``, inline: false });
        }
        if (fields.length === 0) {
          fields.push({ name: 'Ton compte', value: `${source.user.displayName || source.user.username}\n\`${source.user.id}\``, inline: false });
          if (source.channel?.id) {
            fields.push({ name: 'Salon actuel', value: `${source.channel.name || 'Salon'}\n\`${source.channel.id}\``, inline: false });
          }
        }

        const embed = buildInfoEmbed({
          title: 'Identifiants Discord',
          color: embedColor,
          fields,
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
        return true;
      }

      case COMMAND_ACTION_TYPES.EMOJI_INFO: {
        const rawEmoji = String(source.options.getString('emoji', true) || '').trim();
        const customMatch = rawEmoji.match(/^<a?:[\w~]+:(\d+)>$/);
        const emojiId = customMatch?.[1] || (/^\d+$/.test(rawEmoji) ? rawEmoji : null);
        const emoji = emojiId
          ? guild.emojis.cache.get(emojiId)
          : guild.emojis.cache.find((entry) => entry.name?.toLowerCase() === rawEmoji.replace(/:/g, '').toLowerCase());

        if (!emoji) {
          await this._replyToNativeSource(source, 'Emoji introuvable sur ce serveur.', replyOptions);
          return true;
        }

        const imageUrl = emoji.imageURL?.({ size: 512 }) || null;
        const embed = buildInfoEmbed({
          title: `${emoji.name} • Emoji`,
          color: embedColor,
          thumbnail: imageUrl,
          fields: [
            { name: 'ID', value: emoji.id },
            { name: 'Animé', value: emoji.animated ? 'Oui' : 'Non' },
            { name: 'Créé le', value: emoji.createdAt ? emoji.createdAt.toLocaleString('fr-FR') : '-' },
            ...(imageUrl ? [{ name: 'Lien', value: imageUrl, inline: false }] : []),
          ],
        });
        await this._replyWithEmbedToNativeSource(source, embed, replyOptions);
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
      case COMMAND_ACTION_TYPES.PING_INFO:
      case COMMAND_ACTION_TYPES.BOT_INFO:
      case COMMAND_ACTION_TYPES.SERVER_INFO:
      case COMMAND_ACTION_TYPES.MEMBERCOUNT_INFO:
      case COMMAND_ACTION_TYPES.USER_INFO:
      case COMMAND_ACTION_TYPES.AVATAR_INFO:
      case COMMAND_ACTION_TYPES.BANNER_INFO:
      case COMMAND_ACTION_TYPES.ROLE_INFO:
      case COMMAND_ACTION_TYPES.CHANNEL_INFO:
      case COMMAND_ACTION_TYPES.JOINED_AT_INFO:
      case COMMAND_ACTION_TYPES.SERVER_ICON_INFO:
      case COMMAND_ACTION_TYPES.BOOSTS_INFO:
      case COMMAND_ACTION_TYPES.PERMISSIONS_INFO:
      case COMMAND_ACTION_TYPES.ID_INFO:
      case COMMAND_ACTION_TYPES.EMOJI_INFO:
        return this._executeNativeInfoCommand(source, command);
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

    if (await this._handleVoiceGeneratorInteraction(interaction)) {
      return;
    }

    if (await this._handleCaptchaInteraction(interaction)) {
      return;
    }

    if (await this._handleTicketGeneratorInteraction(interaction)) {
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guildId, this.userId])[0];
    if (!guildRow) return;
    this._ensureSystemCommands(guildRow.id);

    const command = db.raw(
      `SELECT * FROM custom_commands
       WHERE guild_id = ? AND enabled = 1 AND command_type = 'slash' AND command_name = ?
       LIMIT 1`,
      [guildRow.id, interaction.commandName]
    )[0];

    if (!command) {
      await interaction.reply({
        content: 'Cette commande est en cours de synchronisation. Reessaie dans quelques secondes.',
        ephemeral: true,
      }).catch(() => {});
      await this._syncSlashCommands(guildId).catch(() => {});
      return;
    }

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

  async _onVoiceStateUpdate(oldState, newState) {
    const guild = newState?.guild || oldState?.guild;
    const member = newState?.member || oldState?.member;
    if (!guild || !member || member.user?.bot) return;

    const internalGuildId = this._resolveInternalGuildId(guild.id);
    if (!internalGuildId) return;

    const configRow = getGuildVoiceGenerator(internalGuildId);
    const creatorChannelId = normalizeSnowflake(configRow?.creator_channel_id);
    const touchedChannelIds = new Set([oldState?.channelId, newState?.channelId].filter(Boolean));

    if (
      configRow?.enabled
      && creatorChannelId
      && newState?.channelId === creatorChannelId
      && oldState?.channelId !== creatorChannelId
    ) {
      const creatorChannel = guild.channels.cache.get(creatorChannelId)
        || await guild.channels.fetch(creatorChannelId).catch(() => null);
      if (creatorChannel) {
        const createdRoom = await this._createManagedVoiceRoom(member, internalGuildId, configRow, creatorChannel).catch((error) => {
          logger.error(`Voice create error: ${error.message}`);
          return null;
        });
        if (createdRoom?.channel_id) {
          touchedChannelIds.add(createdRoom.channel_id);
        }
      }
    }

    for (const channelId of touchedChannelIds) {
      const room = getTempVoiceRoomByChannelId(internalGuildId, channelId);
      if (!room || room.status !== 'open') continue;

      const channel = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);

      if (!channel) {
        closeTempVoiceRoom(internalGuildId, room.id);
        continue;
      }

      if (configRow.delete_when_empty && (channel.members?.size || 0) === 0) {
        await this._deleteManagedVoiceRoom(guild, room, 'Vocale temporaire vide').catch(() => {});
        continue;
      }

      const refreshed = updateTempVoiceRoom(internalGuildId, room.id, {
        name: channel.name,
        user_limit: channel.userLimit || room.user_limit,
      });
      await this._syncVoiceRoomControlMessage(guild, refreshed, configRow).catch(() => {});
    }
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

