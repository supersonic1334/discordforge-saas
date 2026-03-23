'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');
const logger = require('../../utils/logger').child('ModHelpers');
const discordService = require('../../services/discordService');

/**
 * Record a moderation action to the audit log.
 */
async function recordModAction(guildId, actionType, targetUserId, targetUsername, moderatorId, moderatorUsername, reason, durationMs, moduleSource, metadata = {}) {
  try {
    // Find internal guild record
    const guild = db.raw('SELECT id FROM guilds WHERE guild_id = ?', [guildId])[0];
    if (!guild) return;

    db.insert('mod_actions', {
      id: uuidv4(),
      guild_id: guild.id,
      action_type: actionType,
      target_user_id: targetUserId,
      target_username: targetUsername ?? 'Unknown',
      moderator_id: moderatorId ?? 'system',
      moderator_username: moderatorUsername ?? 'System',
      reason: reason ?? '',
      duration_ms: durationMs ?? null,
      module_source: moduleSource ?? null,
      metadata: JSON.stringify(metadata),
    });
  } catch (err) {
    logger.error('Failed to record mod action', { error: err.message, guildId, actionType });
  }
}

/**
 * Add a warning to a user and return new warning count.
 */
async function addWarning(guildId, targetUserId, targetUsername, moderatorId, moderatorUsername, reason, points = 1, metadata = {}) {
  try {
    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ?', [guildId])[0];
    if (!guildRow) return 0;

    const warningModule = db.raw(
      'SELECT advanced_config FROM modules WHERE guild_id = ? AND module_type = ?',
      [guildRow.id, 'WARNING_SYSTEM']
    )[0];

    let expiresAt = null;
    if (warningModule) {
      const ac = JSON.parse(warningModule.advanced_config || '{}');
      if (ac.warning_expiry_days > 0) {
        expiresAt = new Date(Date.now() + ac.warning_expiry_days * 86400000).toISOString();
      }
    }

    db.insert('warnings', {
      id: uuidv4(),
      guild_id: guildRow.id,
      target_user_id: targetUserId,
      target_username: targetUsername ?? 'Unknown',
      moderator_id: moderatorId ?? 'system',
      moderator_username: moderatorUsername ?? 'System',
      reason,
      points,
      active: 1,
      metadata: JSON.stringify(metadata || {}),
      expires_at: expiresAt,
    });

    // Expire old warnings
    db.db.prepare(
      'UPDATE warnings SET active = 0 WHERE guild_id = ? AND expires_at IS NOT NULL AND expires_at < ?'
    ).run(guildRow.id, new Date().toISOString());

    return getWarningCount(guildId, targetUserId);
  } catch (err) {
    logger.error('Failed to add warning', { error: err.message, guildId, targetUserId });
    return 0;
  }
}

/**
 * Get active warning count for a user in a guild.
 */
function getWarningCount(guildId, userId) {
  try {
    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ?', [guildId])[0];
    if (!guildRow) return 0;
    const row = db.raw(
      'SELECT SUM(points) as total FROM warnings WHERE guild_id = ? AND target_user_id = ? AND active = 1',
      [guildRow.id, userId]
    )[0];
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Check if the warning system module should escalate and execute action.
 */
async function checkEscalation(guildId, targetUserId, targetUsername, botToken, guild) {
  try {
    const guildRow = db.raw('SELECT id FROM guilds WHERE guild_id = ?', [guildId])[0];
    if (!guildRow) return;

    const moduleRow = db.raw(
      'SELECT enabled, simple_config, advanced_config FROM modules WHERE guild_id = ? AND module_type = ?',
      [guildRow.id, 'WARNING_SYSTEM']
    )[0];

    if (!moduleRow || !moduleRow.enabled) return;

    const sc = JSON.parse(moduleRow.simple_config || '{}');
    const ac = JSON.parse(moduleRow.advanced_config || '{}');
    if (!sc.escalate_automatically || !ac.escalation_steps?.length) return;

    const warnCount = getWarningCount(guildId, targetUserId);
    const botId = guild.members.me?.id;
    const botTag = guild.members.me?.user?.tag ?? 'Bot';

    // Find highest matching escalation step
    const steps = [...ac.escalation_steps].sort((a, b) => b.warnings - a.warnings);
    const step = steps.find((s) => warnCount >= s.warnings);
    if (!step) return;

    logger.info(`Escalation triggered for ${targetUserId}: ${step.action} (${warnCount} warnings)`, { guildId });

    const reason = `Warning system escalation: ${warnCount} warnings`;
    switch (step.action) {
      case 'timeout':
        await discordService.timeoutMember(botToken, guildId, targetUserId, step.duration_ms || 600000, reason);
        await recordModAction(guildId, 'timeout', targetUserId, targetUsername, botId, botTag, reason, step.duration_ms || 600000, 'WARNING_SYSTEM');
        break;
      case 'kick':
        await discordService.kickMember(botToken, guildId, targetUserId, reason);
        await recordModAction(guildId, 'kick', targetUserId, targetUsername, botId, botTag, reason, null, 'WARNING_SYSTEM');
        break;
      case 'ban':
        await discordService.banMember(botToken, guildId, targetUserId, reason);
        await recordModAction(guildId, 'ban', targetUserId, targetUsername, botId, botTag, reason, null, 'WARNING_SYSTEM');
        break;
    }
  } catch (err) {
    logger.error('Escalation check failed', { error: err.message, guildId, targetUserId });
  }
}

/**
 * Log a bot event to the database.
 */
function logBotEvent(userId, guildId, level, category, message, metadata = {}) {
  try {
    db.insert('bot_logs', {
      id: uuidv4(),
      guild_id: guildId ?? null,
      user_id: userId ?? null,
      level,
      category,
      message,
      metadata: JSON.stringify(metadata),
    });
  } catch { /* swallow — logging should never crash the bot */ }
}

module.exports = {
  recordModAction,
  addWarning,
  getWarningCount,
  checkEscalation,
  logBotEvent,
};
