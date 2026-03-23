'use strict';

/**
 * Canonical list of all module types with their default configurations.
 * simple_config  = basic fields shown to all users
 * advanced_config = power-user settings
 */
const MODULE_DEFINITIONS = {
  // ── Security Modules ────────────────────────────────────────────────────────

  ANTI_SPAM: {
    name: 'Anti-Spam',
    description: 'Detect and punish members sending messages too quickly.',
    category: 'security',
    simple_config: {
      action: 'timeout',          // delete | timeout | kick | ban | blacklist
      timeout_duration_ms: 300000, // 5 min
    },
    advanced_config: {
      max_messages: 5,            // messages per window
      window_ms: 5000,            // 5 seconds
      whitelist_roles: [],        // role IDs exempt from check
      whitelist_channels: [],     // channel IDs exempt
      delete_messages: true,
      warn_before_action: true,
      warn_threshold: 3,          // warnings before escalating
    },
  },

  ANTI_LINK: {
    name: 'Anti-Link',
    description: 'Block external URLs and invite links.',
    category: 'security',
    simple_config: {
      action: 'delete',
      block_all_links: false,
      block_invites: true,
    },
    advanced_config: {
      allowed_domains: [],        // e.g. ["youtube.com", "twitter.com"]
      whitelist_roles: [],
      whitelist_channels: [],
      delete_and_warn: true,
      punishment_action: 'timeout', // timeout | kick | ban | blacklist
      punishment_after_violations: 3,
      timeout_duration_ms: 600000,
    },
  },

  ANTI_RAID: {
    name: 'Anti-Raid',
    description: 'Detect mass join events and lock down the server.',
    category: 'security',
    simple_config: {
      action: 'kick',             // kick | ban | timeout | blacklist newly joined
      timeout_duration_ms: 300000,
      lockdown_on_raid: true,
    },
    advanced_config: {
      join_threshold: 10,         // joins per window triggers raid mode
      join_window_ms: 10000,      // 10 seconds
      account_age_min_days: 7,    // accounts newer than this are suspicious
      new_account_action: 'kick', // kick | ban | timeout | blacklist
      new_account_timeout_duration_ms: 300000,
      raid_duration_ms: 300000,   // how long raid mode lasts
      alert_channel_id: null,
      lockdown_verification_level: 'HIGH',
    },
  },

  ANTI_BOT: {
    name: 'Anti-Bot',
    description: 'Block known bot accounts from joining the server.',
    category: 'security',
    simple_config: {
      action: 'kick',             // kick | ban | blacklist
      check_pfp: true,            // kick accounts without avatar
    },
    advanced_config: {
      block_default_avatar: true,
      min_account_age_days: 7,
      block_pattern_usernames: true, // bot#0000 patterns
      whitelist_bots: [],         // bot IDs to allow
      whitelist_roles: [],
    },
  },

  ANTI_INVITE: {
    name: 'Anti-Invite',
    description: 'Delete Discord server invite links.',
    category: 'security',
    simple_config: {
      action: 'delete',
      allow_own_invites: true,    // allow invites for this server
    },
    advanced_config: {
      whitelist_servers: [],      // allow invites to these guild IDs
      whitelist_roles: [],
      whitelist_channels: [],
      punishment_action: 'timeout', // timeout | kick | ban | blacklist
      punishment_threshold: 3,
      timeout_duration_ms: 300000,
    },
  },

  ANTI_MASS_MENTION: {
    name: 'Anti-Mention',
    description: 'Block all mentions unless the member has an authorized role.',
    category: 'security',
    simple_config: {
      action: 'delete',
    },
    advanced_config: {
      authorized_roles: [],       // role IDs allowed to mention users/roles/everyone
      whitelist_channels: [],
      timeout_duration_ms: 300000,
    },
  },

  // ── Moderation Modules ──────────────────────────────────────────────────────

  WARNING_SYSTEM: {
    name: 'Warning System',
    description: 'Issue warnings to members with automatic escalation.',
    category: 'moderation',
    simple_config: {
      escalate_automatically: true,
    },
    advanced_config: {
      // Thresholds: [warning_count, action, duration_ms]
      escalation_steps: [
        { warnings: 3, action: 'timeout', duration_ms: 600000 },
        { warnings: 5, action: 'kick',    duration_ms: null },
        { warnings: 7, action: 'ban',     duration_ms: null },
      ],
      warning_expiry_days: 30,    // warnings expire after N days (0 = never)
      dm_on_warn: true,           // DM the user when warned
      moderator_roles: [],        // who can issue warnings
    },
  },

  AUTO_MOD: {
    name: 'AutoMod',
    description: 'Filter profanity, slurs, and custom banned words.',
    category: 'moderation',
    simple_config: {
      action: 'delete',
      filter_profanity: true,
    },
    advanced_config: {
      banned_words: [],           // custom banned words/regex patterns
      use_regex: false,
      whitelist_roles: [],
      whitelist_channels: [],
      punishment_action: 'warn',
      punishment_threshold: 3,
      dm_warning: true,
    },
  },

  // ── Utility Modules ─────────────────────────────────────────────────────────

  WELCOME_MESSAGE: {
    name: 'Welcome Message',
    description: 'Greet new members in a channel or via DM.',
    category: 'utility',
    simple_config: {
      channel_id: null,
      message: 'Welcome to **{server}**, {user}! 🎉',
    },
    advanced_config: {
      send_dm: false,
      dm_message: 'Welcome to {server}! Please read the rules.',
      embed: false,
      embed_color: '#5865F2',
      embed_title: 'Welcome!',
      embed_thumbnail: true,      // show server icon
      delete_after_ms: 0,         // 0 = never delete
    },
  },

  AUTO_ROLE: {
    name: 'Auto Role',
    description: 'Automatically assign roles to new members.',
    category: 'utility',
    simple_config: {
      roles: [],                  // role IDs to assign
    },
    advanced_config: {
      delay_ms: 0,                // delay before assigning
      only_humans: true,          // skip bots
      verify_member: false,       // wait for membership screening
    },
  },

  LOGGING: {
    name: 'Logging',
    description: 'Log server events to a designated channel.',
    category: 'utility',
    simple_config: {
      channel_id: null,
      events: ['message_delete', 'member_join', 'member_leave', 'ban', 'kick'],
    },
    advanced_config: {
      log_edits: true,
      log_voice: false,
      log_roles: true,
      log_nicknames: true,
      ignore_bots: true,
      ignore_channels: [],
      embed_color: '#FFA500',
    },
  },

  CUSTOM_COMMANDS: {
    name: 'Custom Commands',
    description: 'Create custom text commands for your server.',
    category: 'utility',
    simple_config: {
      prefix: '!',
    },
    advanced_config: {
      case_sensitive: false,
      cooldown_ms: 3000,
      allow_in_dm: false,
    },
  },
};

const MODULE_TYPES = Object.keys(MODULE_DEFINITIONS);

module.exports = { MODULE_DEFINITIONS, MODULE_TYPES };
