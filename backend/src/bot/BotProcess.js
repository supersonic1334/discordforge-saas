'use strict';

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const EventEmitter = require('events');

const logger = require('../utils/logger').child('BotProcess');
const db = require('../database');
const { decrypt } = require('../services/encryptionService');
const { enforceBlacklistOnJoin } = require('../services/botBlacklistService');
const { safeSendModerationDm } = require('../services/moderationDmService');
const { MODULE_DEFINITIONS } = require('./modules/definitions');
const { handleAntiSpam } = require('./modules/antiSpam');
const { handleAntiLink, handleAntiInvite, handleAntiMassMention, handleAntiBotJoin, handleAntiRaid, punishSecurityAction } = require('./modules/securityModules');
const { handleWelcomeMessage, handleAutoRole, handleLogging, handleCustomCommand } = require('./modules/utilityModules');
const { addWarning, checkEscalation, logBotEvent } = require('./utils/modHelpers');
const { syncNativeAutoModRules, getManagedRuleKey, RULE_KEYS } = require('../services/discordAutoModService');
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

  return {
    ...row,
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
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

  async _syncSlashCommands(discordGuildId = null) {
    if (!this.client?.guilds?.cache?.size) return;

    const guilds = discordGuildId
      ? [this.client.guilds.cache.get(discordGuildId)].filter(Boolean)
      : [...this.client.guilds.cache.values()];

    const syncJobs = guilds.map(async (guild) => {
      const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ? AND user_id = ?', [guild.id, this.userId])[0];
      if (!guildRow) return;

      const slashCommands = db.raw(
        `SELECT * FROM custom_commands
         WHERE guild_id = ? AND enabled = 1 AND command_type = 'slash'
         ORDER BY created_at ASC`,
        [guildRow.id]
      ).map(normalizeCommandRow);

      const payloads = slashCommands
        .filter((command) => command.command_name)
        .map((command) => ({
          name: command.command_name,
          description: (command.description || `Commande ${command.command_name}`).slice(0, 100),
        }));

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

  // ── Event Handlers ──────────────────────────────────────────────────────────

  async _onMessage(message) {
    if (!message.guild) return; // Ignore DMs at guild module level
    if (message.author?.bot && message.author.id !== this.client.user.id) {
      // Still process for logging
    }

    const guildId = message.guild.id;
    const configs = await this._getEnabledModules(guildId);

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
              handleCustomCommand(message, match.command, match.matchedTrigger)
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
      const executed = await handleCustomCommand(interaction, normalizedCommand, `/${interaction.commandName}`);
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

    if (configs.ANTI_RAID?.enabled) {
      promises.push(handleAntiRaid(member, configs.ANTI_RAID, this.token, this.userId).catch((e) => logger.error(`AntiRaid error: ${e.message}`)));
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
  }

  async _onMemberRemove(member) {
    const guildId = member.guild.id;
    const configs = await this._getEnabledModules(guildId);
    if (configs.LOGGING?.enabled) {
      await handleLogging('member_leave', { user: member.user }, configs.LOGGING, this.token).catch(() => {});
    }
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
  }

  async _onBanAdd(ban) {
    const configs = await this._getEnabledModules(ban.guild.id);
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
