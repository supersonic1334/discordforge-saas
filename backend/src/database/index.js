'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const logger = require('../utils/logger').child('Database');
const SCHEMA = require('./schema');
const { getDefaultModel } = require('../config/aiCatalog');

// ── Ensure data directory exists ──────────────────────────────────────────────
const backendRoot = path.resolve(__dirname, '..', '..');
const dbPath = path.isAbsolute(config.DATABASE_PATH)
  ? config.DATABASE_PATH
  : path.resolve(backendRoot, config.DATABASE_PATH);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

if (config.isProd && !config.hasPersistentStorage) {
  logger.warn(`Production database is using non-persistent storage: ${dbPath}`);
}

// ── Open connection ───────────────────────────────────────────────────────────
const db = new DatabaseSync(dbPath);

// Performance pragmas
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA cache_size = -64000');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA temp_store = MEMORY');

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function ensureColumn(table, column, definition) {
  if (columnExists(table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function usersTableSupportsExtendedRoles() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  const sql = String(row?.sql || '');
  return sql.includes("'admin'") && sql.includes("'api_provider'");
}

function accessBlocksSupportClientSignature() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'access_blocks'").get();
  return String(row?.sql || '').includes("'client_signature'");
}

function ensureUsersRoleConstraint() {
  if (usersTableSupportsExtendedRoles()) return;

  logger.info('Migrating users table to support extended roles...');
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    transaction(() => {
      db.exec('DROP TABLE IF EXISTS users__next');
      db.exec(`
      CREATE TABLE users__next (
          id                TEXT PRIMARY KEY,
          email             TEXT UNIQUE NOT NULL,
          username          TEXT NOT NULL,
          password_hash     TEXT,
          avatar_url        TEXT,
          role              TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin','founder','api_provider')),
          site_language     TEXT NOT NULL DEFAULT 'auto',
          ai_language       TEXT NOT NULL DEFAULT 'auto',
          analytics_layout  TEXT,
          discord_id        TEXT UNIQUE,
          discord_username  TEXT,
          discord_global_name TEXT,
          discord_avatar_url TEXT,
          google_id         TEXT UNIQUE,
          discord_token     TEXT,
          is_active         INTEGER NOT NULL DEFAULT 1,
          last_seen_ip_hash TEXT,
          last_seen_device_hash TEXT,
          last_seen_user_agent TEXT,
          last_seen_at      TEXT,
          last_login_at     TEXT,
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      db.exec(`
        INSERT INTO users__next (
          id, email, username, password_hash, avatar_url, role,
          site_language, ai_language, analytics_layout, discord_id, discord_username, discord_global_name, discord_avatar_url, google_id, discord_token,
          is_active, last_seen_ip_hash, last_seen_device_hash, last_seen_user_agent,
          last_seen_at, last_login_at, created_at, updated_at
        )
        SELECT
          id,
          email,
          username,
          password_hash,
          avatar_url,
          CASE
            WHEN role = 'founder' THEN 'founder'
            WHEN role = 'admin' THEN 'admin'
            WHEN role = 'api_provider' THEN 'api_provider'
            ELSE 'member'
          END,
          COALESCE(site_language, 'auto'),
          COALESCE(ai_language, 'auto'),
          analytics_layout,
          discord_id,
          NULL,
          NULL,
          NULL,
          google_id,
          discord_token,
          COALESCE(is_active, 1),
          last_seen_ip_hash,
          last_seen_device_hash,
          last_seen_user_agent,
          last_seen_at,
          last_login_at,
          created_at,
          updated_at
        FROM users
      `);

      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users__next RENAME TO users');
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function ensureAccessBlockTypes() {
  if (accessBlocksSupportClientSignature()) return;

  logger.info('Migrating access_blocks table to support stronger client signatures...');
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    transaction(() => {
      db.exec('DROP TABLE IF EXISTS access_blocks__next');
      db.exec(`
        CREATE TABLE access_blocks__next (
          id              TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          block_type      TEXT NOT NULL CHECK(block_type IN ('ip','device','client_signature')),
          value_hash      TEXT NOT NULL,
          user_agent      TEXT,
          is_active       INTEGER NOT NULL DEFAULT 1,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, block_type, value_hash)
        )
      `);

      db.exec(`
        INSERT INTO access_blocks__next (
          id, user_id, block_type, value_hash, user_agent, is_active, created_at, updated_at
        )
        SELECT
          id,
          user_id,
          CASE
            WHEN block_type IN ('ip','device','client_signature') THEN block_type
            ELSE 'device'
          END,
          value_hash,
          user_agent,
          COALESCE(is_active, 1),
          created_at,
          updated_at
        FROM access_blocks
      `);

      db.exec('DROP TABLE access_blocks');
      db.exec('ALTER TABLE access_blocks__next RENAME TO access_blocks');
      db.exec('CREATE INDEX IF NOT EXISTS idx_access_blocks_user_id ON access_blocks(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_access_blocks_lookup ON access_blocks(block_type, value_hash, is_active)');
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

function aiConfigSupportsExtendedProviders() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_config'").get();
  return String(row?.sql || '').includes("'openrouter'");
}

function ensureAIConfigProviderConstraint() {
  if (aiConfigSupportsExtendedProviders()) return;

  logger.info('Migrating ai_config table to support more AI providers...');
  const hasUserQuotaTokens = columnExists('ai_config', 'user_quota_tokens');
  const hasSiteQuotaTokens = columnExists('ai_config', 'site_quota_tokens');
  const hasQuotaWindowHours = columnExists('ai_config', 'quota_window_hours');

  transaction(() => {
    db.exec('DROP TABLE IF EXISTS ai_config__next');
    db.exec(`
      CREATE TABLE ai_config__next (
        id                TEXT PRIMARY KEY DEFAULT 'singleton',
        provider          TEXT NOT NULL DEFAULT 'anthropic' CHECK(provider IN ('anthropic','openai','gemini','xai','groq','mistral','together','deepseek','openrouter','perplexity')),
        encrypted_api_key TEXT,
        active_provider_key_id TEXT,
        model             TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
        max_tokens        INTEGER DEFAULT 1024,
        temperature       REAL DEFAULT 0.7,
        user_quota_tokens INTEGER DEFAULT 4000,
        site_quota_tokens INTEGER DEFAULT 20000,
        quota_window_hours INTEGER DEFAULT 5,
        auto_mode         INTEGER NOT NULL DEFAULT 1,
        enabled           INTEGER NOT NULL DEFAULT 1,
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      INSERT INTO ai_config__next (
        id,
        provider,
        encrypted_api_key,
        active_provider_key_id,
        model,
        max_tokens,
        temperature,
        user_quota_tokens,
        site_quota_tokens,
        quota_window_hours,
        auto_mode,
        enabled,
        updated_at
      )
      SELECT
        id,
        CASE
          WHEN provider IN ('anthropic','openai','gemini','xai','groq','mistral','together','deepseek','openrouter','perplexity') THEN provider
          ELSE 'anthropic'
        END,
        encrypted_api_key,
        NULL,
        model,
        max_tokens,
        temperature,
        ${hasUserQuotaTokens ? 'CASE WHEN COALESCE(user_quota_tokens, 0) > 6000 THEN CAST(ROUND(user_quota_tokens / 5.0) AS INTEGER) ELSE COALESCE(user_quota_tokens, 4000) END' : '4000'},
        ${hasSiteQuotaTokens ? 'COALESCE(site_quota_tokens, user_quota_tokens, 20000)' : (hasUserQuotaTokens ? 'COALESCE(user_quota_tokens, 20000)' : '20000')},
        ${hasQuotaWindowHours ? 'COALESCE(quota_window_hours, 5)' : '5'},
        1,
        enabled,
        updated_at
      FROM ai_config
    `);

    db.exec('DROP TABLE ai_config');
    db.exec('ALTER TABLE ai_config__next RENAME TO ai_config');
  });
}

// ── Migration ─────────────────────────────────────────────────────────────────
function runMigrations() {
  logger.info('Running database migrations...');
  for (const stmt of SCHEMA) {
    try {
      db.exec(stmt);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        logger.error('Migration failed: ' + err.message);
        throw err;
      }
    }
  }
  ensureColumn('users', 'site_language', "TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn('users', 'ai_language', "TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn('users', 'analytics_layout', 'TEXT');
  ensureColumn('users', 'last_seen_ip_hash', 'TEXT');
  ensureColumn('users', 'last_seen_device_hash', 'TEXT');
  ensureColumn('users', 'last_seen_client_signature_hash', 'TEXT');
  ensureColumn('users', 'last_seen_user_agent', 'TEXT');
  ensureColumn('users', 'discord_username', 'TEXT');
  ensureColumn('users', 'discord_global_name', 'TEXT');
  ensureColumn('users', 'discord_avatar_url', 'TEXT');
  ensureColumn('guild_access_members', 'suspended_until', 'TEXT');
  ensureColumn('users', 'last_seen_at', 'TEXT');
  ensureColumn('users', 'email_fast_vault', 'TEXT');
  ensureColumn('users', 'email_fast_vault_updated_at', 'TEXT');
  ensureColumn('guilds', 'discord_logs_cleared_before', 'TEXT');
  ensureColumn('support_tickets', 'claimed_once_at', 'TEXT');
  ensureColumn('guild_dm_settings', 'brand_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_dm_settings', 'brand_icon_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_dm_settings', 'brand_logo_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_dm_settings', 'brand_site_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_dm_settings', 'site_button_label', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_dm_settings', 'show_site_link', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('guild_dm_settings', 'show_brand_logo', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('guild_dm_settings', 'footer_text', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_ticket_generators', 'panel_thumbnail_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_ticket_generators', 'panel_image_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('guild_ticket_generators', 'transcript_channel_id', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    UPDATE support_tickets
    SET claimed_once_at = claimed_at
    WHERE claimed_once_at IS NULL
      AND claimed_at IS NOT NULL
  `);
  ensureColumn('warnings', 'metadata', "TEXT DEFAULT '{}'");
  ensureUsersRoleConstraint();
  ensureAccessBlockTypes();
  ensureAIConfigProviderConstraint();
  ensureColumn('ai_config', 'user_quota_tokens', 'INTEGER DEFAULT 4000');
  ensureColumn('ai_config', 'site_quota_tokens', 'INTEGER DEFAULT 20000');
  ensureColumn('ai_config', 'quota_window_hours', 'INTEGER DEFAULT 5');
  ensureColumn('ai_config', 'auto_mode', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('ai_config', 'active_provider_key_id', 'TEXT');
  ensureColumn('ai_provider_keys', 'selected_model', 'TEXT');
  db.exec(`
    UPDATE ai_config
    SET site_quota_tokens = user_quota_tokens
    WHERE site_quota_tokens = 20000
      AND user_quota_tokens IS NOT NULL
      AND user_quota_tokens != 20000
  `);
  db.exec(`
    UPDATE ai_config
    SET site_quota_tokens = COALESCE(site_quota_tokens, user_quota_tokens, 20000)
    WHERE site_quota_tokens IS NULL OR site_quota_tokens <= 0
  `);
  db.exec(`
    UPDATE ai_config
    SET user_quota_tokens = CASE
      WHEN user_quota_tokens IS NULL OR user_quota_tokens <= 0 THEN 4000
      WHEN auto_mode = 0 AND user_quota_tokens = site_quota_tokens AND user_quota_tokens > 6000 THEN CAST(ROUND(user_quota_tokens / 5.0) AS INTEGER)
      ELSE user_quota_tokens
    END
  `);
  ensureColumn('custom_commands', 'description', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('custom_commands', 'command_type', "TEXT NOT NULL DEFAULT 'prefix'");
  ensureColumn('custom_commands', 'command_prefix', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('custom_commands', 'command_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('custom_commands', 'is_system', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('custom_commands', 'system_key', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('custom_commands', 'execution_mode', "TEXT NOT NULL DEFAULT 'response'");
  ensureColumn('custom_commands', 'action_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('custom_commands', 'action_config', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('custom_commands', 'response_mode', "TEXT NOT NULL DEFAULT 'channel'");
  ensureColumn('custom_commands', 'allowed_channels', "TEXT DEFAULT '[]'");
  ensureColumn('custom_commands', 'aliases', "TEXT DEFAULT '[]'");
  ensureColumn('custom_commands', 'delete_response_after_ms', 'INTEGER DEFAULT 0');
  ensureColumn('custom_commands', 'embed_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('custom_commands', 'embed_title', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('custom_commands', 'embed_color', "TEXT NOT NULL DEFAULT '#22d3ee'");
  ensureColumn('custom_commands', 'mention_user', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('custom_commands', 'require_args', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('custom_commands', 'usage_hint', "TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE custom_commands SET execution_mode = 'native' WHERE trim(COALESCE(action_type, '')) != ''");
  db.exec("UPDATE custom_commands SET execution_mode = 'response' WHERE execution_mode NOT IN ('response','native') OR execution_mode IS NULL");
  db.exec("UPDATE custom_commands SET action_type = '' WHERE action_type NOT IN ('','clear_messages','ticket_panel','ban_member','blacklist_member','kick_member','softban_member','timeout_member','untimeout_member','warn_member','unban_member','unblacklist_member','add_role','remove_role','set_nickname','lock_channel','unlock_channel','slowmode_channel','say_message','announce_message','move_member','disconnect_member') OR action_type IS NULL");
  db.exec("UPDATE custom_commands SET action_config = '{}' WHERE action_config IS NULL OR trim(action_config) = ''");
  db.exec("UPDATE custom_commands SET is_system = 0 WHERE is_system IS NULL");
  db.exec("UPDATE custom_commands SET system_key = '' WHERE system_key IS NULL");
  db.exec("UPDATE custom_commands SET response_mode = 'dm' WHERE reply_in_dm = 1 AND (response_mode IS NULL OR response_mode = '' OR response_mode = 'channel')");
  db.exec("UPDATE custom_commands SET response_mode = 'channel' WHERE response_mode NOT IN ('channel','reply','dm')");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_commands_system_key ON custom_commands(guild_id, system_key) WHERE system_key != ''");
  db.exec(`
    UPDATE custom_commands
    SET
      command_type = CASE
        WHEN lower(trim(trigger)) LIKE '/%' THEN 'slash'
        ELSE 'prefix'
      END,
      command_prefix = CASE
        WHEN lower(trim(trigger)) LIKE '/%' THEN '/'
        WHEN instr(trim(trigger), ' ') > 0 THEN substr(trim(trigger), 1, instr(trim(trigger), ' ') - 1)
        WHEN length(trim(trigger)) > 1 THEN substr(trim(trigger), 1, 1)
        ELSE '!'
      END,
      command_name = CASE
        WHEN lower(trim(trigger)) LIKE '/%' THEN substr(trim(trigger), 2)
        WHEN instr(trim(trigger), ' ') > 0 THEN substr(trim(trigger), instr(trim(trigger), ' ') + 1)
        WHEN length(trim(trigger)) > 1 THEN substr(trim(trigger), 2)
        ELSE trim(trigger)
      END
    WHERE trim(command_name) = ''
  `);

  const providerKeysWithoutModel = db.prepare('SELECT id, provider FROM ai_provider_keys WHERE selected_model IS NULL OR trim(selected_model) = \'\'').all();
  if (providerKeysWithoutModel.length > 0) {
    const stmt = db.prepare('UPDATE ai_provider_keys SET selected_model = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const row of providerKeysWithoutModel) {
      stmt.run(getDefaultModel(row.provider), now, row.id);
    }
  }

  logger.info('Migrations complete.');
}

// ── Transaction helper ────────────────────────────────────────────────────────
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

// ── Generic helpers ───────────────────────────────────────────────────────────
function findOne(table, where) {
  const keys = Object.keys(where);
  if (!keys.length) throw new Error('findOne: where must not be empty');
  const sql = 'SELECT * FROM ' + table + ' WHERE ' + keys.map((k) => k + ' = ?').join(' AND ') + ' LIMIT 1';
  return db.prepare(sql).get(...Object.values(where)) ?? null;
}

function findMany(table, where, opts) {
  where = where || {};
  opts  = opts  || {};
  const { orderBy = 'created_at DESC', limit, offset } = opts;
  const keys = Object.keys(where);
  let sql = 'SELECT * FROM ' + table;
  if (keys.length) sql += ' WHERE ' + keys.map((k) => k + ' = ?').join(' AND ');
  if (orderBy) sql += ' ORDER BY ' + orderBy;
  if (limit)   sql += ' LIMIT '  + Number(limit);
  if (offset)  sql += ' OFFSET ' + Number(offset);
  return db.prepare(sql).all(...Object.values(where));
}

function insert(table, data) {
  if (!data.id) data = Object.assign({ id: uuidv4() }, data);
  const keys = Object.keys(data);
  const sql = 'INSERT INTO ' + table + ' (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')';
  db.prepare(sql).run(...Object.values(data));
  return data;
}

function update(table, data, where) {
  data = Object.assign({}, data, { updated_at: new Date().toISOString() });
  const setKeys   = Object.keys(data);
  const whereKeys = Object.keys(where);
  const sql = 'UPDATE ' + table +
    ' SET '   + setKeys.map((k)   => k + ' = ?').join(', ') +
    ' WHERE ' + whereKeys.map((k) => k + ' = ?').join(' AND ');
  const result = db.prepare(sql).run(...Object.values(data), ...Object.values(where));
  return result.changes;
}

function upsert(table, data) {
  if (!data.id) data = Object.assign({ id: uuidv4() }, data);
  const keys = Object.keys(data);
  const sql = 'INSERT OR REPLACE INTO ' + table + ' (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')';
  db.prepare(sql).run(...Object.values(data));
  return data;
}

function remove(table, where) {
  const keys = Object.keys(where);
  const sql = 'DELETE FROM ' + table + ' WHERE ' + keys.map((k) => k + ' = ?').join(' AND ');
  return db.prepare(sql).run(...Object.values(where)).changes;
}

function raw(sql, params) {
  return db.prepare(sql).all(...(params || []));
}

function exec(sql) {
  return db.exec(sql);
}

module.exports = { db, runMigrations, transaction, findOne, findMany, insert, update, upsert, remove, raw, exec };
