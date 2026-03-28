'use strict';

/**
 * Full database schema for Discord Bot Management SaaS.
 * Executed in order — each statement is idempotent (IF NOT EXISTS).
 */
const SCHEMA = [
  // ────────────────────────────────────────────────────────────────────────────
  // USERS
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    username        TEXT NOT NULL,
    password_hash   TEXT,                   -- null for OAuth-only accounts
    avatar_url      TEXT,
    role            TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin','founder','api_provider')),
    site_language   TEXT NOT NULL DEFAULT 'auto',
    ai_language     TEXT NOT NULL DEFAULT 'auto',
    analytics_layout TEXT,
    discord_id      TEXT UNIQUE,
    google_id       TEXT UNIQUE,
    discord_token   TEXT,                   -- encrypted OAuth access token
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_seen_ip_hash TEXT,
    last_seen_device_hash TEXT,
    last_seen_user_agent TEXT,
    last_seen_at    TEXT,
    last_login_at   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS access_blocks (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    block_type      TEXT NOT NULL CHECK(block_type IN ('ip','device')),
    value_hash      TEXT NOT NULL,
    user_agent      TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, block_type, value_hash)
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // BOT TOKENS (one active token per user)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bot_tokens (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    encrypted_token TEXT NOT NULL,          -- AES-256 encrypted Discord bot token
    token_hash      TEXT NOT NULL,          -- SHA-256 for duplicate detection
    bot_id          TEXT,                   -- Discord application/bot user ID
    bot_username    TEXT,
    bot_discriminator TEXT,
    bot_avatar      TEXT,
    is_valid        INTEGER NOT NULL DEFAULT 1,
    last_validated_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // GUILDS (Discord servers the bot is in)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS guilds (
    id              TEXT PRIMARY KEY,       -- internal UUID
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guild_id        TEXT NOT NULL,          -- Discord guild snowflake
    name            TEXT NOT NULL,
    icon            TEXT,                   -- icon hash
    member_count    INTEGER DEFAULT 0,
    owner_id        TEXT,                   -- Discord owner snowflake
    features        TEXT DEFAULT '[]',      -- JSON array of guild features
    is_active       INTEGER NOT NULL DEFAULT 1,
    discord_logs_cleared_before TEXT,
    bot_joined_at   TEXT,
    last_synced_at  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, guild_id)
  )`,

  `CREATE TABLE IF NOT EXISTS guild_access_members (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_role     TEXT NOT NULL DEFAULT 'admin' CHECK(access_role IN ('admin','moderator','viewer')),
    invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    is_suspended    INTEGER NOT NULL DEFAULT 0,
    expires_at      TEXT,
    accepted_at     TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS guild_access_codes (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    code            TEXT NOT NULL UNIQUE,
    access_role     TEXT NOT NULL DEFAULT 'admin' CHECK(access_role IN ('admin','moderator','viewer')),
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TEXT,
    used_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at         TEXT,
    revoked_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS collaboration_audit_log (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_username  TEXT,
    action_type     TEXT NOT NULL,
    target          TEXT,
    details         TEXT DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS guild_config_snapshots (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    label           TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // MODULES (per guild, per module type)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS modules (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    module_type     TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 0,
    simple_config   TEXT NOT NULL DEFAULT '{}',   -- JSON
    advanced_config TEXT NOT NULL DEFAULT '{}',   -- JSON
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id, module_type)
  )`,

  `CREATE TABLE IF NOT EXISTS bot_blacklist_entries (
    id              TEXT PRIMARY KEY,
    owner_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id  TEXT NOT NULL,
    target_username TEXT,
    reason          TEXT,
    source_module   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(owner_user_id, target_user_id)
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // WARNINGS
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS warnings (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    target_user_id  TEXT NOT NULL,          -- Discord user snowflake
    target_username TEXT,
    moderator_id    TEXT NOT NULL,          -- Discord user snowflake
    moderator_username TEXT,
    reason          TEXT NOT NULL,
    points          INTEGER NOT NULL DEFAULT 1,
    active          INTEGER NOT NULL DEFAULT 1,
    metadata        TEXT DEFAULT '{}',
    expires_at      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // MODERATION ACTIONS (audit trail)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mod_actions (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    action_type     TEXT NOT NULL CHECK(action_type IN ('delete','timeout','kick','ban','warn','unban','untimeout')),
    target_user_id  TEXT NOT NULL,
    target_username TEXT,
    moderator_id    TEXT NOT NULL,
    moderator_username TEXT,
    reason          TEXT,
    duration_ms     INTEGER,                -- for timeouts
    module_source   TEXT,                   -- which module triggered this (null = manual)
    metadata        TEXT DEFAULT '{}',      -- JSON extra data
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS guild_dm_settings (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    auto_dm_warn      INTEGER NOT NULL DEFAULT 1,
    auto_dm_timeout   INTEGER NOT NULL DEFAULT 1,
    auto_dm_kick      INTEGER NOT NULL DEFAULT 1,
    auto_dm_ban       INTEGER NOT NULL DEFAULT 1,
    auto_dm_blacklist INTEGER NOT NULL DEFAULT 1,
    appeal_server_name TEXT NOT NULL DEFAULT '',
    appeal_server_url TEXT NOT NULL DEFAULT '',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id)
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // CUSTOM COMMANDS
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS custom_commands (
      id              TEXT PRIMARY KEY,
      guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      trigger         TEXT NOT NULL,          -- e.g. "!hello"
      command_type    TEXT NOT NULL DEFAULT 'prefix',
      command_prefix  TEXT NOT NULL DEFAULT '',
      command_name    TEXT NOT NULL DEFAULT '',
      description     TEXT NOT NULL DEFAULT '',
      response        TEXT NOT NULL,
    reply_in_dm     INTEGER NOT NULL DEFAULT 0,
    response_mode   TEXT NOT NULL DEFAULT 'channel',
    delete_trigger  INTEGER NOT NULL DEFAULT 0,
    allowed_roles   TEXT DEFAULT '[]',      -- JSON array of role IDs
    allowed_channels TEXT DEFAULT '[]',     -- JSON array of channel IDs
    aliases         TEXT DEFAULT '[]',      -- JSON array of alternative triggers
    cooldown_ms     INTEGER DEFAULT 0,
    delete_response_after_ms INTEGER DEFAULT 0,
    embed_enabled   INTEGER NOT NULL DEFAULT 0,
    embed_title     TEXT NOT NULL DEFAULT '',
    embed_color     TEXT NOT NULL DEFAULT '#22d3ee',
    mention_user    INTEGER NOT NULL DEFAULT 0,
    require_args    INTEGER NOT NULL DEFAULT 0,
    usage_hint      TEXT NOT NULL DEFAULT '',
    use_count       INTEGER DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id, trigger)
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // BOT EVENT LOGS (per guild)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS bot_logs (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    level           TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('error','warn','info','debug')),
    category        TEXT NOT NULL,          -- e.g. 'antiSpam', 'botRuntime', 'module'
    message         TEXT NOT NULL,
    metadata        TEXT DEFAULT '{}',      -- JSON
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // SYSTEM LOGS (platform-level)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS system_logs (
    id              TEXT PRIMARY KEY,
    level           TEXT NOT NULL DEFAULT 'info',
    category        TEXT NOT NULL,
    message         TEXT NOT NULL,
    metadata        TEXT DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // GUILD LOG CHANNELS (where to send audit messages in Discord)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS guild_log_channels (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    channel_id      TEXT NOT NULL,          -- Discord channel snowflake
    log_events      TEXT NOT NULL DEFAULT '[]', -- JSON array of event names to log
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id)
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // AI CONFIGURATION (founder-managed)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_config (
    id              TEXT PRIMARY KEY DEFAULT 'singleton',
    provider        TEXT NOT NULL DEFAULT 'anthropic' CHECK(provider IN ('anthropic','openai','gemini','xai','groq','mistral','together','deepseek','openrouter','perplexity')),
    encrypted_api_key TEXT,
    active_provider_key_id TEXT,
    model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    max_tokens      INTEGER DEFAULT 1024,
    temperature     REAL DEFAULT 0.7,
    user_quota_tokens INTEGER DEFAULT 4000,
    site_quota_tokens INTEGER DEFAULT 20000,
    quota_window_hours INTEGER DEFAULT 5,
    auto_mode      INTEGER NOT NULL DEFAULT 1,
    enabled         INTEGER NOT NULL DEFAULT 1,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS ai_provider_keys (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          TEXT NOT NULL CHECK(provider IN ('anthropic','openai','gemini','xai','groq','mistral','together','deepseek','openrouter','perplexity')),
    encrypted_api_key TEXT NOT NULL,
    key_hash          TEXT NOT NULL,
    selected_model    TEXT,
    status            TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','valid','quota_exhausted','invalid')),
    status_reason     TEXT,
    is_enabled        INTEGER NOT NULL DEFAULT 1,
    checked_at        TEXT,
    last_used_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, provider)
  )`,

  `CREATE TABLE IF NOT EXISTS ai_user_quotas (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    window_started_at TEXT NOT NULL,
    window_ends_at    TEXT NOT NULL,
    used_input_tokens INTEGER NOT NULL DEFAULT 0,
    used_output_tokens INTEGER NOT NULL DEFAULT 0,
    used_total_tokens INTEGER NOT NULL DEFAULT 0,
    request_count     INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // SUPPORT TICKETS
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS support_tickets (
    id                TEXT PRIMARY KEY,
    ticket_number     INTEGER NOT NULL UNIQUE,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category          TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('bug','report','account','question','other')),
    title             TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','closed')),
    claimed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    claimed_at        TEXT,
    claimed_once_at   TEXT,
    closed_at         TEXT,
    closed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    message_count     INTEGER NOT NULL DEFAULT 0,
    last_message_preview TEXT NOT NULL DEFAULT '',
    last_message_at   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id                TEXT PRIMARY KEY,
    ticket_id         TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
    author_role       TEXT NOT NULL DEFAULT 'member',
    author_username   TEXT,
    author_avatar_url TEXT,
    kind              TEXT NOT NULL DEFAULT 'user' CHECK(kind IN ('user','staff','system')),
    body              TEXT NOT NULL,
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    deleted_at        TEXT,
    deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // SITE REVIEWS
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS site_reviews (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    rating_half       INTEGER NOT NULL CHECK(rating_half >= 1 AND rating_half <= 10),
    message           TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // BOT PROCESS STATUS (runtime state, not persisted across restarts)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS ai_global_quota (
    id                TEXT PRIMARY KEY DEFAULT 'site-global',
    window_started_at TEXT NOT NULL,
    window_ends_at    TEXT NOT NULL,
    used_input_tokens INTEGER NOT NULL DEFAULT 0,
    used_output_tokens INTEGER NOT NULL DEFAULT 0,
    used_total_tokens INTEGER NOT NULL DEFAULT 0,
    request_count     INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS bot_processes (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('starting','running','stopping','stopped','error','reconnecting')),
    started_at      TEXT,
    last_heartbeat  TEXT,
    restart_count   INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    ping_ms         INTEGER,
    guilds_count    INTEGER DEFAULT 0,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // SPAM TRACKING (in-memory mostly, but we persist daily stats)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS spam_stats (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,          -- Discord user snowflake
    action_type     TEXT NOT NULL,          -- 'spam','link','invite','mass_mention'
    count           INTEGER NOT NULL DEFAULT 1,
    window_start    TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // INDEXES
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_guilds_user_id ON guilds(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guilds_guild_id ON guilds(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_access_members_guild_id ON guild_access_members(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_access_members_user_id ON guild_access_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_config_snapshots_guild_id ON guild_config_snapshots(guild_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_collab_audit_guild_id ON collaboration_audit_log(guild_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_collab_audit_actor ON collaboration_audit_log(actor_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_modules_guild_id ON modules(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_blacklist_owner_target ON bot_blacklist_entries(owner_user_id, target_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_warnings_guild_id ON warnings(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_warnings_target ON warnings(target_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mod_actions_guild_id ON mod_actions(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_logs_guild_id ON bot_logs(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_commands_guild_id ON custom_commands(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, last_message_at)`,
  `CREATE INDEX IF NOT EXISTS idx_support_tickets_claimed_by ON support_tickets(claimed_by_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON support_ticket_messages(ticket_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_site_reviews_updated_at ON site_reviews(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_access_blocks_user_id ON access_blocks(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_blocks_lookup ON access_blocks(block_type, value_hash, is_active)`,
];

module.exports = SCHEMA;
