'use strict';

const { Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');
const EventEmitter = require('events');

const logger = require('../utils/logger').child('BotProcess');
const db = require('../database');
const { decrypt } = require('../services/encryptionService');
const { enforceBlacklistOnJoin } = require('../services/botBlacklistService');
const { safeSendModerationDm } = require('../services/moderationDmService');
const { MODULE_DEFINITIONS } = require('./modules/definitions');
const { handleAntiSpam } = require('./modules/antiSpam');
const { handleAntiLink, handleAntiInvite, handleAntiMassMention, handleAntiBotJoin, handleAntiRaid, punishSecurityAction } = require('./modules/securityModules');
const { activateLockdown, handleAntiAltAccount, handleAntiNukeEvent, handleAntiTokenScam, handleAutoSlowmode } = require('./modules/advancedProtection');
const { handleWelcomeMessage, handleAutoRole, handleLogging, handleCustomCommand } = require('./modules/utilityModules');
const { addWarning, checkEscalation, logBotEvent, recordModAction } = require('./utils/modHelpers');
const { syncNativeAutoModRules, getManagedRuleKey, RULE_KEYS } = require('../services/discordAutoModService');
const { COMMAND_ACTION_TYPES, DEFAULT_SYSTEM_COMMANDS } = require('../constants/systemCommands');
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
    case COMMAND_ACTION_TYPES.CLEAR_MESSAGES:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        min_amount: clampNumber(source.min_amount ?? fallback.min_amount, 1, 100, 1),
        max_amount: clampNumber(source.max_amount ?? fallback.max_amount, 1, 100, 100),
        default_amount: clampNumber(source.default_amount ?? fallback.default_amount, 1, 100, 20),
        success_message: String(source.success_message ?? fallback.success_message ?? '{count} messages supprimes dans {channel}.').trim().slice(0, 220),
        empty_message: String(source.empty_message ?? fallback.empty_message ?? 'Aucun message recent a supprimer ici.').trim().slice(0, 220),
        denied_message: String(source.denied_message ?? fallback.denied_message ?? 'Tu dois avoir la permission de gerer les messages pour utiliser cette commande.').trim().slice(0, 220),
        success_visibility: normalizeVisibility(source.success_visibility, fallback.success_visibility),
      };

    case COMMAND_ACTION_TYPES.BAN_MEMBER:
      return {
        log_channel_id: normalizeSnowflake(source.log_channel_id, fallback.log_channel_id),
        dm_user: normalizeBooleanFlag(source.dm_user, fallback.dm_user ?? true),
        require_reason: normalizeBooleanFlag(source.require_reason, fallback.require_reason ?? true),
        delete_message_seconds: clampNumber(source.delete_message_seconds ?? fallback.delete_message_seconds, 0, 604800, 0),
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
        default_duration_ms: clampDurationMs(source.default_duration_ms ?? fallback.default_duration_ms, 60000, 2419200000, 600000),
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

    default:
      return source;
  }
}

function getDefaultNativePermission(actionType) {
  switch (actionType) {
    case COMMAND_ACTION_TYPES.CLEAR_MESSAGES:
      return PermissionFlagsBits.ManageMessages;
    case COMMAND_ACTION_TYPES.BAN_MEMBER:
      return PermissionFlagsBits.BanMembers;
    case COMMAND_ACTION_TYPES.KICK_MEMBER:
      return PermissionFlagsBits.KickMembers;
    case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER:
    case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
    case COMMAND_ACTION_TYPES.WARN_MEMBER:
      return PermissionFlagsBits.ModerateMembers;
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
          required: false,
          min_value: 1,
          max_value: 100,
        },
      ];
      break;

    case COMMAND_ACTION_TYPES.BAN_MEMBER:
    case COMMAND_ACTION_TYPES.KICK_MEMBER:
    case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
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
  const match = raw.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2] || 'm';
  const multiplier = unit === 's'
    ? 1000
    : unit === 'h'
      ? 3600000
      : unit === 'd'
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

  async _executeNativeClear(source, command, matchedTrigger = null) {
    const channel = source.channel;
    const guild = source.guild;
    if (!guild || !channel?.bulkDelete) return false;

    const actionConfig = normalizeCommandActionConfig(COMMAND_ACTION_TYPES.CLEAR_MESSAGES, command.action_config);
    const amount = typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand()
      ? clampNumber(source.options.getInteger('amount') ?? actionConfig.default_amount, actionConfig.min_amount, actionConfig.max_amount, actionConfig.default_amount)
      : clampNumber(this._extractNativeArgs(source, matchedTrigger)[0] ?? actionConfig.default_amount, actionConfig.min_amount, actionConfig.max_amount, actionConfig.default_amount);

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

  async _executeNativeModeration(source, command) {
    if (!(typeof source?.isChatInputCommand === 'function' && source.isChatInputCommand())) {
      await this._replyToNativeSource(source, 'Cette commande native est disponible en slash uniquement.', { preferReply: true });
      return true;
    }

    const guild = source.guild;
    const targetUser = source.options.getUser('user', true);
    const targetMember = source.options.getMember('user')
      || await guild.members.fetch(targetUser.id).catch(() => null);
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

    switch (command.action_type) {
      case COMMAND_ACTION_TYPES.BAN_MEMBER: {
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
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete banni.`, { ephemeral: !visibilityIsPublic });
        return true;
      }

      case COMMAND_ACTION_TYPES.KICK_MEMBER: {
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
        await this._replyToNativeSource(source, `<@${targetUser.id}> a ete expulse.`, { ephemeral: !visibilityIsPublic });
        return true;
      }

      case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER: {
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
        await this._replyToNativeSource(source, `<@${targetUser.id}> est en timeout pour ${Math.max(1, Math.round(durationMs / 60000))} minute(s).`, { ephemeral: !visibilityIsPublic });
        return true;
      }

      case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER: {
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
        await this._replyToNativeSource(source, `Le timeout de <@${targetUser.id}> a ete retire.`, { ephemeral: !visibilityIsPublic });
        return true;
      }

      case COMMAND_ACTION_TYPES.WARN_MEMBER: {
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
        await this._replyToNativeSource(source, `<@${targetUser.id}> a recu ${points} point(s) d avertissement.`, { ephemeral: !visibilityIsPublic });
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
      case COMMAND_ACTION_TYPES.BAN_MEMBER:
      case COMMAND_ACTION_TYPES.KICK_MEMBER:
      case COMMAND_ACTION_TYPES.TIMEOUT_MEMBER:
      case COMMAND_ACTION_TYPES.UNTIMEOUT_MEMBER:
      case COMMAND_ACTION_TYPES.WARN_MEMBER:
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
    if (!interaction.isChatInputCommand() || !interaction.guild) return;

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
