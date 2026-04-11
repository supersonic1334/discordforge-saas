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
    role            TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin','founder','api_provider','osint')),
    email_verified  INTEGER NOT NULL DEFAULT 0,
    email_verified_at TEXT,
    site_language   TEXT NOT NULL DEFAULT 'auto',
    ai_language     TEXT NOT NULL DEFAULT 'auto',
    analytics_layout TEXT,
    discord_id      TEXT UNIQUE,
    discord_username TEXT,
    discord_global_name TEXT,
    discord_avatar_hash TEXT,
    discord_avatar_url TEXT,
    discord_banner_hash TEXT,
    discord_banner_url TEXT,
    discord_banner_color TEXT,
    discord_avatar_animated INTEGER NOT NULL DEFAULT 0,
    discord_banner_animated INTEGER NOT NULL DEFAULT 0,
    discord_profile_synced_at TEXT,
    google_id       TEXT UNIQUE,
    discord_token   TEXT,                   -- encrypted OAuth access token
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_seen_ip_hash TEXT,
    last_seen_device_hash TEXT,
    last_seen_client_signature_hash TEXT,
    last_seen_user_agent TEXT,
    last_seen_at    TEXT,
    last_login_at   TEXT,
    email_fast_vault TEXT,
    email_fast_vault_updated_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS access_blocks (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    block_type      TEXT NOT NULL CHECK(block_type IN ('ip','device','client_signature')),
    value_hash      TEXT NOT NULL,
    user_agent      TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, block_type, value_hash)
  )`,

  `CREATE TABLE IF NOT EXISTS auth_email_challenges (
    id                TEXT PRIMARY KEY,
    user_id           TEXT REFERENCES users(id) ON DELETE CASCADE,
    email             TEXT NOT NULL,
    challenge_type    TEXT NOT NULL CHECK(challenge_type IN ('register_verify','login_approve')),
    token_hash        TEXT NOT NULL UNIQUE,
    device_hash       TEXT,
    client_signature_hash TEXT,
    ip_hash           TEXT,
    ip_address        TEXT,
    location_label    TEXT,
    user_agent        TEXT,
    metadata          TEXT NOT NULL DEFAULT '{}',
    expires_at        TEXT NOT NULL,
    consumed_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS auth_trusted_devices (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_hash       TEXT,
    client_signature_hash TEXT,
    user_agent        TEXT,
    label             TEXT NOT NULL DEFAULT '',
    last_ip_hash      TEXT,
    last_seen_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS user_security_access_log (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address        TEXT,
    ip_hash           TEXT,
    city              TEXT NOT NULL DEFAULT '',
    region            TEXT NOT NULL DEFAULT '',
    country           TEXT NOT NULL DEFAULT '',
    location_label    TEXT NOT NULL DEFAULT '',
    network_provider  TEXT NOT NULL DEFAULT '',
    network_domain    TEXT NOT NULL DEFAULT '',
    network_type      TEXT NOT NULL DEFAULT '',
    browser_name      TEXT NOT NULL DEFAULT '',
    os_name           TEXT NOT NULL DEFAULT '',
    device_type       TEXT NOT NULL DEFAULT '',
    device_model      TEXT NOT NULL DEFAULT '',
    is_proxy          INTEGER NOT NULL DEFAULT 0,
    is_vpn            INTEGER NOT NULL DEFAULT 0,
    is_tor            INTEGER NOT NULL DEFAULT 0,
    is_datacenter     INTEGER NOT NULL DEFAULT 0,
    user_agent        TEXT,
    device_hash       TEXT,
    client_signature_hash TEXT,
    first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
    seen_count        INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_user_security_access_log_user_last_seen
    ON user_security_access_log(user_id, last_seen_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_user_security_access_log_user_ip
    ON user_security_access_log(user_id, ip_hash)`,

  `CREATE TABLE IF NOT EXISTS user_precise_locations (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    consent_status      TEXT NOT NULL DEFAULT 'unknown',
    permission_state    TEXT NOT NULL DEFAULT '',
    latitude            REAL,
    longitude           REAL,
    accuracy_m          REAL,
    altitude_m          REAL,
    altitude_accuracy_m REAL,
    heading_deg         REAL,
    speed_mps           REAL,
    timezone            TEXT NOT NULL DEFAULT '',
    reverse_label       TEXT NOT NULL DEFAULT '',
    reverse_display_name TEXT NOT NULL DEFAULT '',
    last_error          TEXT NOT NULL DEFAULT '',
    captured_at         TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS register_captcha_guards (
    id                TEXT PRIMARY KEY,
    fingerprint_key   TEXT NOT NULL UNIQUE,
    ip_hash           TEXT,
    device_hash       TEXT,
    client_signature_hash TEXT,
    failure_count     INTEGER NOT NULL DEFAULT 0,
    lock_level        INTEGER NOT NULL DEFAULT 0,
    locked_until      TEXT,
    permanently_locked INTEGER NOT NULL DEFAULT 0,
    last_failure_at   TEXT,
    last_success_at   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_register_captcha_guards_ip_hash
    ON register_captcha_guards(ip_hash)`,

  `CREATE INDEX IF NOT EXISTS idx_register_captcha_guards_device_hash
    ON register_captcha_guards(device_hash)`,

  `CREATE INDEX IF NOT EXISTS idx_register_captcha_guards_client_signature_hash
    ON register_captcha_guards(client_signature_hash)`,

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
    suspended_until TEXT,
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

  `CREATE TABLE IF NOT EXISTS guild_join_requests (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    code_id           TEXT REFERENCES guild_access_codes(id) ON DELETE SET NULL,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    inviter_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    access_role       TEXT NOT NULL DEFAULT 'admin' CHECK(access_role IN ('admin','moderator','viewer')),
    code_masked       TEXT NOT NULL DEFAULT '',
    request_status    TEXT NOT NULL DEFAULT 'pending' CHECK(request_status IN ('pending','approved','rejected')),
    decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    decided_at        TEXT,
    requested_at      TEXT NOT NULL DEFAULT (datetime('now')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(code_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_guild_join_requests_guild_status
    ON guild_join_requests(guild_id, request_status, requested_at DESC)`,

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
    brand_name        TEXT NOT NULL DEFAULT '',
    brand_icon_url    TEXT NOT NULL DEFAULT '',
    brand_logo_url    TEXT NOT NULL DEFAULT '',
    brand_site_url    TEXT NOT NULL DEFAULT '',
    site_button_label TEXT NOT NULL DEFAULT '',
    show_site_link    INTEGER NOT NULL DEFAULT 1,
    show_brand_logo   INTEGER NOT NULL DEFAULT 1,
    footer_text       TEXT NOT NULL DEFAULT '',
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
      is_system       INTEGER NOT NULL DEFAULT 0,
      system_key      TEXT NOT NULL DEFAULT '',
      execution_mode  TEXT NOT NULL DEFAULT 'response',
      action_type     TEXT NOT NULL DEFAULT '',
      action_config   TEXT NOT NULL DEFAULT '{}',
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

  `CREATE TABLE IF NOT EXISTS guild_ticket_generators (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    enabled           INTEGER NOT NULL DEFAULT 1,
    panel_channel_id  TEXT NOT NULL DEFAULT '',
    panel_message_id  TEXT NOT NULL DEFAULT '',
    transcript_channel_id TEXT NOT NULL DEFAULT '',
    panel_title       TEXT NOT NULL DEFAULT 'Support & tickets',
    panel_description TEXT NOT NULL DEFAULT '',
    panel_footer      TEXT NOT NULL DEFAULT '',
    menu_placeholder  TEXT NOT NULL DEFAULT 'Choisis une categorie',
    panel_color       TEXT NOT NULL DEFAULT '#7c3aed',
    panel_thumbnail_url TEXT NOT NULL DEFAULT '',
    panel_image_url   TEXT NOT NULL DEFAULT '',
    default_category_id TEXT NOT NULL DEFAULT '',
    ticket_name_template TEXT NOT NULL DEFAULT 'ticket-{number}',
    ticket_topic_template TEXT NOT NULL DEFAULT 'Ticket #{number} • {label}',
    intro_message     TEXT NOT NULL DEFAULT '',
    claim_message     TEXT NOT NULL DEFAULT 'Ticket pris en charge par {claimer}.',
    close_message     TEXT NOT NULL DEFAULT 'Ticket ferme par {closer}.',
    auto_ping_support INTEGER NOT NULL DEFAULT 1,
    allow_user_close  INTEGER NOT NULL DEFAULT 1,
    prevent_duplicates INTEGER NOT NULL DEFAULT 1,
    options_json      TEXT NOT NULL DEFAULT '[]',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id)
  )`,

  `CREATE TABLE IF NOT EXISTS guild_ticket_entries (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    generator_id      TEXT NOT NULL REFERENCES guild_ticket_generators(id) ON DELETE CASCADE,
    option_key        TEXT NOT NULL,
    ticket_number     INTEGER NOT NULL,
    channel_id        TEXT NOT NULL,
    creator_discord_user_id TEXT NOT NULL,
    creator_username  TEXT NOT NULL DEFAULT '',
    claimed_by_discord_user_id TEXT,
    claimed_by_username TEXT,
    closed_by_discord_user_id TEXT,
    closed_by_username TEXT,
    reason            TEXT NOT NULL DEFAULT '',
    subject           TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','closed')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    claimed_at        TEXT,
    closed_at         TEXT,
    UNIQUE(channel_id),
    UNIQUE(guild_id, ticket_number)
  )`,

  `CREATE TABLE IF NOT EXISTS guild_captcha_configs (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    enabled           INTEGER NOT NULL DEFAULT 1,
    channel_mode      TEXT NOT NULL DEFAULT 'existing' CHECK(channel_mode IN ('existing','create')),
    panel_channel_id  TEXT NOT NULL DEFAULT '',
    panel_channel_name TEXT NOT NULL DEFAULT 'verification',
    panel_message_id  TEXT NOT NULL DEFAULT '',
    panel_title       TEXT NOT NULL DEFAULT 'Verification CAPTCHA',
    panel_description TEXT NOT NULL DEFAULT '',
    panel_color       TEXT NOT NULL DEFAULT '#06b6d4',
    panel_thumbnail_url TEXT NOT NULL DEFAULT '',
    panel_image_url   TEXT NOT NULL DEFAULT '',
    verified_role_ids TEXT NOT NULL DEFAULT '[]',
    log_channel_id    TEXT NOT NULL DEFAULT '',
    success_message   TEXT NOT NULL DEFAULT 'Verification reussie. Acces debloque.',
    failure_message   TEXT NOT NULL DEFAULT 'Code invalide. Reessaie avec une nouvelle verification.',
    challenge_types_json TEXT NOT NULL DEFAULT '[]',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id)
  )`,

  `CREATE TABLE IF NOT EXISTS guild_captcha_challenges (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    config_id         TEXT NOT NULL REFERENCES guild_captcha_configs(id) ON DELETE CASCADE,
    discord_user_id   TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL DEFAULT '',
    challenge_type    TEXT NOT NULL,
    prompt_text       TEXT NOT NULL DEFAULT '',
    expected_answer_hash TEXT NOT NULL,
    attempt_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json     TEXT NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','expired')),
    expires_at        TEXT NOT NULL,
    consumed_at       TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS guild_voice_generators (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    enabled           INTEGER NOT NULL DEFAULT 1,
    channel_mode      TEXT NOT NULL DEFAULT 'create' CHECK(channel_mode IN ('existing','create')),
    creator_channel_id TEXT NOT NULL DEFAULT '',
    creator_channel_name TEXT NOT NULL DEFAULT 'Creer ta voc',
    creator_category_id TEXT NOT NULL DEFAULT '',
    control_title     TEXT NOT NULL DEFAULT 'Ta vocale temporaire',
    control_description TEXT NOT NULL DEFAULT '',
      panel_color       TEXT NOT NULL DEFAULT '#22c55e',
      panel_thumbnail_url TEXT NOT NULL DEFAULT '',
      panel_image_url   TEXT NOT NULL DEFAULT '',
      site_button_label TEXT NOT NULL DEFAULT 'Ouvrir DiscordForger',
      show_site_link    INTEGER NOT NULL DEFAULT 1,
      room_name_template TEXT NOT NULL DEFAULT 'Vocal de {username}',
    default_user_limit INTEGER NOT NULL DEFAULT 0,
    default_region    TEXT NOT NULL DEFAULT 'auto',
    delete_when_empty INTEGER NOT NULL DEFAULT 1,
    allow_claim       INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id)
  )`,

  `CREATE TABLE IF NOT EXISTS guild_temp_voice_rooms (
    id                TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    generator_id      TEXT NOT NULL REFERENCES guild_voice_generators(id) ON DELETE CASCADE,
    owner_discord_user_id TEXT NOT NULL,
    owner_username    TEXT NOT NULL DEFAULT '',
    source_channel_id TEXT NOT NULL DEFAULT '',
    channel_id        TEXT NOT NULL,
    control_message_id TEXT NOT NULL DEFAULT '',
    name              TEXT NOT NULL DEFAULT '',
    user_limit        INTEGER NOT NULL DEFAULT 0,
    rtc_region        TEXT NOT NULL DEFAULT 'auto',
    is_locked         INTEGER NOT NULL DEFAULT 0,
    is_hidden         INTEGER NOT NULL DEFAULT 0,
    allowed_user_ids  TEXT NOT NULL DEFAULT '[]',
    blocked_user_ids  TEXT NOT NULL DEFAULT '[]',
    status            TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at         TEXT,
    UNIQUE(channel_id)
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

  `CREATE TABLE IF NOT EXISTS bot_profile_settings (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    presence_status TEXT NOT NULL DEFAULT 'online' CHECK(presence_status IN ('online','idle','dnd','invisible')),
    activity_type   TEXT NOT NULL DEFAULT 'playing' CHECK(activity_type IN ('playing','listening','watching','competing','streaming')),
    activity_text   TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ────────────────────────────────────────────────────────────────────────────
  // PLAYBOOKS (automated moderation workflows)
  // ────────────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS playbooks (
    id              TEXT PRIMARY KEY,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    conditions      TEXT NOT NULL DEFAULT '[]',    -- JSON array of conditions
    actions         TEXT NOT NULL DEFAULT '[]',    -- JSON array of actions
    cooldown_ms     INTEGER NOT NULL DEFAULT 60000,
    trigger_count   INTEGER NOT NULL DEFAULT 0,
    last_triggered_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(guild_id, name)
  )`,

  `CREATE TABLE IF NOT EXISTS playbook_logs (
    id              TEXT PRIMARY KEY,
    playbook_id     TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
    guild_id        TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    target_user_id  TEXT NOT NULL,
    target_username TEXT,
    triggered_by    TEXT NOT NULL,           -- which condition triggered it
    actions_taken   TEXT NOT NULL DEFAULT '[]',
    success         INTEGER NOT NULL DEFAULT 1,
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
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
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_commands_system_key ON custom_commands(guild_id, system_key) WHERE system_key != ''`,
  `CREATE INDEX IF NOT EXISTS idx_bot_logs_guild_id ON bot_logs(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_commands_guild_id ON custom_commands(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, last_message_at)`,
  `CREATE INDEX IF NOT EXISTS idx_support_tickets_claimed_by ON support_tickets(claimed_by_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id ON support_ticket_messages(ticket_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_ticket_generators_guild_id ON guild_ticket_generators(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_ticket_entries_guild_status ON guild_ticket_entries(guild_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_ticket_entries_creator ON guild_ticket_entries(guild_id, creator_discord_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_captcha_configs_guild_id ON guild_captcha_configs(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_captcha_challenges_lookup ON guild_captcha_challenges(guild_id, discord_user_id, status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_captcha_challenges_config ON guild_captcha_challenges(config_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_voice_generators_guild_id ON guild_voice_generators(guild_id)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_temp_voice_rooms_lookup ON guild_temp_voice_rooms(guild_id, channel_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_temp_voice_rooms_owner ON guild_temp_voice_rooms(guild_id, owner_discord_user_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_site_reviews_updated_at ON site_reviews(updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_access_blocks_user_id ON access_blocks(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_blocks_lookup ON access_blocks(block_type, value_hash, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_user_type ON auth_email_challenges(user_id, challenge_type, consumed_at, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_email ON auth_email_challenges(email, challenge_type, consumed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_trusted_devices_user_id ON auth_trusted_devices(user_id, updated_at DESC)`,
];

module.exports = SCHEMA;
