'use strict';

const cron = require('node-cron');
const db = require('../database');
const botManager = require('../services/botManager');
const logger = require('../utils/logger').child('Jobs');

/**
 * Expire warnings whose expires_at has passed.
 * Runs every hour.
 */
const warningExpiryJob = cron.schedule('0 * * * *', () => {
  try {
    const result = db.db
      .prepare("UPDATE warnings SET active = 0 WHERE active = 1 AND expires_at IS NOT NULL AND expires_at < datetime('now')")
      .run();
    if (result.changes > 0) {
      logger.info(`Expired ${result.changes} warnings`);
    }
  } catch (err) {
    logger.error(`Warning expiry job failed: ${err.message}`);
  }
}, { scheduled: false });

/**
 * Sync guild member counts for all active guilds.
 * Runs every 30 minutes.
 */
const guildSyncJob = cron.schedule('*/30 * * * *', async () => {
  try {
    const statuses = botManager.getAllStatuses();
    for (const status of statuses) {
      if (status.status !== 'running') continue;
      const process = botManager.getProcess(status.userId);
      if (!process?.client) continue;

      // Update member counts from cache (no API call — Discord.js keeps them current)
      for (const [, guild] of process.client.guilds.cache) {
        db.db.prepare(
          'UPDATE guilds SET member_count = ?, last_synced_at = ? WHERE guild_id = ? AND user_id = ?'
        ).run(guild.memberCount ?? 0, new Date().toISOString(), guild.id, status.userId);
      }
    }
  } catch (err) {
    logger.error(`Guild sync job failed: ${err.message}`);
  }
}, { scheduled: false });

/**
 * Clean up old bot logs (keep last 7 days).
 * Runs daily at 02:00.
 */
const logCleanupJob = cron.schedule('0 2 * * *', () => {
  try {
    const botResult = db.db
      .prepare("DELETE FROM bot_logs WHERE created_at < datetime('now', '-7 days')")
      .run();
    const sysResult = db.db
      .prepare("DELETE FROM system_logs WHERE created_at < datetime('now', '-30 days')")
      .run();
    logger.info(`Log cleanup: deleted ${botResult.changes} bot logs, ${sysResult.changes} system logs`);
  } catch (err) {
    logger.error(`Log cleanup job failed: ${err.message}`);
  }
}, { scheduled: false });

/**
 * Watchdog: check for bots that should be running but aren't.
 * Runs every 5 minutes.
 */
const botWatchdogJob = cron.schedule('*/5 * * * *', async () => {
  try {
    // Find users whose bot_processes row says running but process doesn't exist in memory
    const runningRows = db.raw(
      "SELECT user_id FROM bot_processes WHERE status = 'running'"
    );

    for (const { user_id } of runningRows) {
      const process = botManager.getProcess(user_id);
      if (!process) {
        logger.warn(`Watchdog: bot for user ${user_id} is marked running but not in memory — restarting`);
        try {
          await botManager.startBot(user_id);
        } catch (err) {
          logger.error(`Watchdog restart failed for user ${user_id}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(`Bot watchdog job failed: ${err.message}`);
  }
}, { scheduled: false });

function startAll() {
  warningExpiryJob.start();
  guildSyncJob.start();
  logCleanupJob.start();
  botWatchdogJob.start();
  logger.info('All cron jobs started');
}

function stopAll() {
  warningExpiryJob.stop();
  guildSyncJob.stop();
  logCleanupJob.stop();
  botWatchdogJob.stop();
  logger.info('All cron jobs stopped');
}

module.exports = { startAll, stopAll };
