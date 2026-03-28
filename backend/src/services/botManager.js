'use strict';

const { BotProcess, BotStatus } = require('../bot/BotProcess');
const db = require('../database');
const { decrypt } = require('./encryptionService');
const logger = require('../utils/logger').child('BotManager');
const { validateToken } = require('./discordService');

/**
 * BotManager is a singleton that manages all running BotProcess instances.
 * One BotProcess per user (per bot token).
 */
class BotManager {
  constructor() {
    this._processes = new Map(); // userId -> BotProcess
    this._wsServer = null;       // set after WebSocket server init
  }

  // ── WebSocket integration ─────────────────────────────────────────────────

  setWebSocketServer(wss) {
    this._wsServer = wss;
  }

  _broadcast(userId, event, data) {
    if (!this._wsServer) return;
    this._wsServer.broadcastToUser(userId, { event, data });
  }

  // ── Start a bot ───────────────────────────────────────────────────────────

  async startBot(userId) {
    if (this._processes.has(userId)) {
      const existing = this._processes.get(userId);
      if ([BotStatus.RUNNING, BotStatus.STARTING, BotStatus.RECONNECTING].includes(existing.status)) {
        logger.warn(`Bot for user ${userId} is already running (status: ${existing.status})`);
        return existing.getStatus();
      }
      // It's in ERROR or STOPPED — restart it
      await existing.stop();
      this._processes.delete(userId);
    }

    // Load token from DB
    const tokenRow = db.findOne('bot_tokens', { user_id: userId });
    if (!tokenRow) throw new Error('No bot token found for this user');
    if (!tokenRow.is_valid) throw new Error('Bot token is marked invalid');

    const process = new BotProcess(userId, tokenRow.encrypted_token);

    // Wire up events
    process.on('statusChange', ({ status }) => {
      this._broadcast(userId, 'bot:statusChange', process.getStatus());
      logger.info(`Bot status for user ${userId}: ${status}`);
    });

    process.on('ready', (botUser) => {
      this._broadcast(userId, 'bot:ready', { botTag: botUser.tag, guildCount: process.client?.guilds?.cache?.size ?? 0 });
    });

    process.on('guildUpdate', () => {
      this._broadcast(userId, 'bot:guildUpdate', { userId });
    });

    process.on('scanUpdate', (payload) => {
      this._broadcast(userId, 'scan:updated', payload);
    });

    this._processes.set(userId, process);

    // Start (async — doesn't block)
    process.start().catch((err) => {
      logger.error(`Unexpected error starting bot for user ${userId}: ${err.message}`);
    });

    return process.getStatus();
  }

  // ── Stop a bot ────────────────────────────────────────────────────────────

  async stopBot(userId) {
    const process = this._processes.get(userId);
    if (!process) return null;

    await process.stop();
    this._processes.delete(userId);
    this._broadcast(userId, 'bot:statusChange', {
      userId,
      status: BotStatus.STOPPED,
      startedAt: null,
      restartCount: 0,
      lastError: null,
      ping: -1,
      guildCount: 0,
      botTag: null,
    });

    return { status: BotStatus.STOPPED };
  }

  // ── Restart a bot ─────────────────────────────────────────────────────────

  async restartBot(userId) {
    await this.stopBot(userId);
    return this.startBot(userId);
  }

  // ── Update token and restart ──────────────────────────────────────────────

  async updateTokenAndRestart(userId, encryptedToken) {
    // Stop existing process
    await this.stopBot(userId);

    // Clear old guild data
    db.db.prepare('UPDATE guilds SET is_active = 0 WHERE user_id = ?').run(userId);

    // Validate new token
    const token = decrypt(encryptedToken);
    const botInfo = await validateToken(token);

    // Update token record
    db.db.prepare(
      'UPDATE bot_tokens SET encrypted_token = ?, bot_id = ?, bot_username = ?, is_valid = 1, last_validated_at = ?, updated_at = ? WHERE user_id = ?'
    ).run(encryptedToken, botInfo.id, botInfo.username, new Date().toISOString(), new Date().toISOString(), userId);

    // Start fresh
    return this.startBot(userId);
  }

  // ── Status queries ────────────────────────────────────────────────────────

  getBotStatus(userId) {
    const process = this._processes.get(userId);
    if (!process) {
      const dbRow = db.findOne('bot_processes', { user_id: userId });
      return dbRow ?? { userId, status: BotStatus.STOPPED };
    }
    return process.getStatus();
  }

  getAllStatuses() {
    const statuses = [];
    for (const [userId, process] of this._processes.entries()) {
      statuses.push(process.getStatus());
    }
    return statuses;
  }

  isRunning(userId) {
    const p = this._processes.get(userId);
    return p?.status === BotStatus.RUNNING;
  }

  getProcess(userId) {
    return this._processes.get(userId) ?? null;
  }

  // ── Invalidate module cache (called after config changes) ─────────────────

  invalidateModuleCache(userId, discordGuildId) {
    const process = this._processes.get(userId);
    if (process) process.invalidateModuleCache(discordGuildId);
  }

  async syncCommandDefinitions(userId, discordGuildId) {
    const process = this._processes.get(userId);
    if (!process) return;
    await process.syncCommandDefinitions(discordGuildId);
  }

  // ── Boot all bots that were running before restart ─────────────────────────

  async bootPersistedBots() {
    logger.info('Booting bots from persisted state…');
    const runningBots = db.raw(
      "SELECT user_id FROM bot_processes WHERE status IN ('running','starting','reconnecting')"
    );

    let booted = 0;
    for (const { user_id } of runningBots) {
      try {
        await this.startBot(user_id);
        booted++;
      } catch (err) {
        logger.error(`Failed to boot persisted bot for user ${user_id}: ${err.message}`);
      }
    }

    logger.info(`Booted ${booted}/${runningBots.length} persisted bots`);
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  async shutdownAll() {
    logger.info(`Shutting down ${this._processes.size} bot processes…`);
    await Promise.allSettled(
      [...this._processes.keys()].map((userId) => this.stopBot(userId))
    );
    logger.info('All bots stopped.');
  }
}

// Export singleton
module.exports = new BotManager();
