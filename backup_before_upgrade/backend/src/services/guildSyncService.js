'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const discordService = require('./discordService');
const { MODULE_DEFINITIONS, MODULE_TYPES } = require('../bot/modules/definitions');
const logger = require('../utils/logger').child('GuildSync');

/**
 * Sync all guilds from a live Discord.js Client to the database.
 * Creates missing guild rows and initializes default modules.
 */
async function syncGuildsForUser(userId, client, token) {
  const guilds = [...client.guilds.cache.values()];
  logger.info(`Syncing ${guilds.length} guilds for user ${userId}`);

  // Fetch full guild data (with member counts) for each guild
  const syncResults = await Promise.allSettled(
    guilds.map(async (partialGuild) => {
      try {
        const fullGuild = await discordService.getGuild(token, partialGuild.id);
        return upsertGuild(userId, fullGuild);
      } catch (err) {
        logger.warn(`Failed to fetch full guild ${partialGuild.id}: ${err.message}`);
        // Fall back to partial data from cache
        return upsertGuild(userId, {
          id: partialGuild.id,
          name: partialGuild.name,
          icon: partialGuild.icon,
          approximate_member_count: partialGuild.memberCount,
          owner_id: partialGuild.ownerId,
          features: partialGuild.features ?? [],
        });
      }
    })
  );

  const failed = syncResults.filter((r) => r.status === 'rejected').length;
  if (failed) logger.warn(`${failed} guilds failed to sync for user ${userId}`);

  // Mark guilds no longer in the bot's list as inactive
  const activeGuildIds = guilds.map((g) => g.id);
  if (activeGuildIds.length) {
    const placeholders = activeGuildIds.map(() => '?').join(',');
    db.db.prepare(
      `UPDATE guilds SET is_active = 0, updated_at = ? WHERE user_id = ? AND guild_id NOT IN (${placeholders})`
    ).run(new Date().toISOString(), userId, ...activeGuildIds);
  } else {
    db.db.prepare('UPDATE guilds SET is_active = 0 WHERE user_id = ?').run(userId);
  }

  return syncResults;
}

/**
 * Upsert a single guild and initialize its default modules.
 */
function upsertGuild(userId, guildData) {
  const existing = db.raw('SELECT id FROM guilds WHERE user_id = ? AND guild_id = ?', [userId, guildData.id])[0];

  const now = new Date().toISOString();
  let internalId;

  if (existing) {
    internalId = existing.id;
    db.db.prepare(
      `UPDATE guilds SET name = ?, icon = ?, member_count = ?, owner_id = ?, features = ?, is_active = 1, last_synced_at = ?, updated_at = ? WHERE id = ?`
    ).run(
      guildData.name,
      guildData.icon ?? null,
      guildData.approximate_member_count ?? guildData.member_count ?? 0,
      guildData.owner_id ?? null,
      JSON.stringify(guildData.features ?? []),
      now,
      now,
      internalId
    );
  } else {
    internalId = uuidv4();
    db.db.prepare(
      `INSERT INTO guilds (id, user_id, guild_id, name, icon, member_count, owner_id, features, is_active, bot_joined_at, last_synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(
      internalId,
      userId,
      guildData.id,
      guildData.name,
      guildData.icon ?? null,
      guildData.approximate_member_count ?? 0,
      guildData.owner_id ?? null,
      JSON.stringify(guildData.features ?? []),
      now,
      now,
      now,
      now
    );

    // Initialize default modules for new guild
    initializeDefaultModules(internalId);
  }

  return internalId;
}

/**
 * Create all module rows with default configs for a newly-joined guild.
 */
function initializeDefaultModules(internalGuildId) {
  const now = new Date().toISOString();
  const stmt = db.db.prepare(
    `INSERT OR IGNORE INTO modules (id, guild_id, module_type, enabled, simple_config, advanced_config, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`
  );

  const insertAll = () => db.transaction(() => {
    for (const [type, def] of Object.entries(MODULE_DEFINITIONS)) {
      stmt.run(
        uuidv4(),
        internalGuildId,
        type,
        JSON.stringify(def.simple_config),
        JSON.stringify(def.advanced_config),
        now,
        now
      );
    }
  });

  insertAll();
  logger.debug(`Initialized ${MODULE_TYPES.length} modules for guild ${internalGuildId}`);
}

/**
 * Remove all data for a guild (bot left or was removed).
 */
async function removeGuildForUser(userId, discordGuildId, token) {
  const guild = db.raw('SELECT id FROM guilds WHERE user_id = ? AND guild_id = ?', [userId, discordGuildId])[0];
  if (!guild) return false;

  try {
    await discordService.leaveGuild(token, discordGuildId);
  } catch (err) {
    logger.error(`Failed to leave guild ${discordGuildId}: ${err.message}`);
    throw err;
  }

  db.db.prepare('UPDATE guilds SET is_active = 0, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), guild.id);

  return true;
}

module.exports = { syncGuildsForUser, upsertGuild, initializeDefaultModules, removeGuildForUser };
