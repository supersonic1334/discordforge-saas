'use strict';

/**
 * Canonical list of all module types with their default configurations.
 * simple_config  = basic fields shown to all users
 * advanced_config = power-user settings
 */
const MODULE_DEFINITIONS = {
  ULTIMATE_PROTECTION: {
    name: 'Ultimate Protection',
    description: 'Apply a full security shield in one click across chat, raid, and staff abuse scenarios.',
    category: 'security',
    simple_config: {
      profile: 'smart',
      quarantine_role_id: null,
    },
    advanced_config: {
      trusted_roles: [],
      alert_channel_id: null,
      shield_chat: true,
      shield_raid: true,
      shield_staff: true,
      shield_quarantine: true,
      strip_staff_roles: true,
    },
  },

  ANTI_SPAM: {
    name: 'Anti-Spam',
    description: 'Detect and punish members sending messages too quickly.',
    category: 'security',
    simple_config: {
      action: 'timeout',
      timeout_duration_ms: 300000,
    },
    advanced_config: {
      max_messages: 5,
      window_ms: 5000,
      whitelist_roles: [],
      whitelist_channels: [],
      delete_messages: true,
      warn_before_action: true,
      warn_threshold: 3,
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
      allowed_domains: [],
      whitelist_roles: [],
      whitelist_channels: [],
      delete_and_warn: true,
      punishment_action: 'timeout',
      punishment_after_violations: 3,
      timeout_duration_ms: 600000,
    },
  },

  ANTI_RAID: {
    name: 'Anti-Raid',
    description: 'Detect mass join events and protect the server.',
    category: 'security',
    simple_config: {
      action: 'kick',
      timeout_duration_ms: 300000,
      lockdown_on_raid: true,
    },
    advanced_config: {
      join_threshold: 10,
      join_window_ms: 10000,
      account_age_min_days: 7,
      new_account_action: 'kick',
      new_account_timeout_duration_ms: 300000,
      raid_duration_ms: 300000,
      alert_channel_id: null,
      lockdown_verification_level: 'HIGH',
    },
  },

  LOCKDOWN: {
    name: 'Lockdown',
    description: 'Temporarily lock text channels when raid or nuke behaviour is detected.',
    category: 'security',
    simple_config: {
      trigger_on_raid: true,
      trigger_on_nuke: true,
    },
    advanced_config: {
      duration_ms: 300000,
      excluded_channels: [],
      alert_channel_id: null,
    },
  },

  ANTI_NUKE: {
    name: 'Anti-Nuke',
    description: 'Detect destructive moderation bursts on channels and roles.',
    category: 'security',
    simple_config: {
      action: 'ban',
    },
    advanced_config: {
      event_threshold: 3,
      window_ms: 15000,
      timeout_duration_ms: 300000,
      whitelist_roles: [],
      whitelist_users: [],
      alert_channel_id: null,
      watch_ban_bursts: false,
      watch_kick_bursts: false,
      strip_executor_roles: false,
    },
  },

  ANTI_ALT_ACCOUNT: {
    name: 'Anti-Alt',
    description: 'Flag suspicious fresh accounts and react before they settle in.',
    category: 'security',
    simple_config: {
      action: 'timeout',
      timeout_duration_ms: 300000,
    },
    advanced_config: {
      max_account_age_days: 14,
      require_custom_avatar: true,
      suspicious_name_patterns: true,
      alert_channel_id: null,
    },
  },

  ANTI_BOT: {
    name: 'Anti-Bot',
    description: 'Block known bot accounts from joining the server.',
    category: 'security',
    simple_config: {
      action: 'kick',
      check_pfp: true,
    },
    advanced_config: {
      block_default_avatar: true,
      min_account_age_days: 7,
      block_pattern_usernames: true,
      whitelist_bots: [],
      whitelist_roles: [],
    },
  },

  ANTI_INVITE: {
    name: 'Anti-Invite',
    description: 'Delete Discord server invite links.',
    category: 'security',
    simple_config: {
      action: 'delete',
      allow_own_invites: true,
    },
    advanced_config: {
      whitelist_servers: [],
      whitelist_roles: [],
      whitelist_channels: [],
      punishment_action: 'timeout',
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
      authorized_roles: [],
      whitelist_channels: [],
      timeout_duration_ms: 300000,
    },
  },

  ANTI_TOKEN_SCAM: {
    name: 'Anti-Token Scam',
    description: 'Detect leaked tokens, phishing bait, and token-scam messages.',
    category: 'security',
    simple_config: {
      action: 'timeout',
      timeout_duration_ms: 1800000,
    },
    advanced_config: {
      whitelist_roles: [],
      whitelist_channels: [],
      alert_channel_id: null,
    },
  },

  AUTO_SLOWMODE: {
    name: 'Auto Slowmode',
    description: 'Temporarily enable slowmode when a channel suddenly spikes.',
    category: 'security',
    simple_config: {
      slowmode_seconds: 15,
    },
    advanced_config: {
      trigger_messages: 8,
      window_ms: 10000,
      duration_ms: 180000,
      whitelist_channels: [],
    },
  },

  WARNING_SYSTEM: {
    name: 'Warning System',
    description: 'Issue warnings to members with automatic escalation.',
    category: 'moderation',
    simple_config: {
      escalate_automatically: true,
    },
    advanced_config: {
      escalation_steps: [
        { warnings: 3, action: 'timeout', duration_ms: 600000 },
        { warnings: 5, action: 'kick', duration_ms: null },
        { warnings: 7, action: 'ban', duration_ms: null },
      ],
      warning_expiry_days: 30,
      dm_on_warn: true,
      moderator_roles: [],
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
      banned_words: [],
      use_regex: false,
      whitelist_roles: [],
      whitelist_channels: [],
      punishment_action: 'warn',
      punishment_threshold: 3,
      dm_warning: true,
    },
  },

  AUTO_QUARANTINE: {
    name: 'Auto Quarantine',
    description: 'Automatically place risky members into a quarantine role.',
    category: 'moderation',
    simple_config: {
      role_id: null,
    },
    advanced_config: {
      release_after_ms: 0,
      on_alt_account: true,
      on_token_scam: true,
    },
  },

  TRUST_SCORE: {
    name: 'Trust Score',
    description: 'Tune how confidence is calculated for member profiles in Scan.',
    category: 'moderation',
    simple_config: {
      trusted_after_days: 30,
    },
    advanced_config: {
      warning_penalty: 8,
      action_penalty: 10,
      suspicious_penalty: 14,
      role_bonus: 6,
    },
  },

  WELCOME_MESSAGE: {
    name: 'Welcome Message',
    description: 'Greet new members in a channel or via DM.',
    category: 'utility',
    simple_config: {
      channel_id: null,
      message: '',
    },
    advanced_config: {
      send_dm: false,
      dm_message: '',
      embed: true,
      embed_color: '#5865F2',
      embed_title: '',
      embed_thumbnail: true,
      template_locale: 'fr',
      delete_after_ms: 0,
    },
  },

  AUTO_ROLE: {
    name: 'Auto Role',
    description: 'Automatically assign roles to new members.',
    category: 'utility',
    simple_config: {
      roles: [],
    },
    advanced_config: {
      delay_ms: 0,
      only_humans: true,
      verify_member: false,
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

  PROTECTION_PRESETS: {
    name: 'Protection Presets',
    description: 'Apply a ready-made protection profile in one save.',
    category: 'utility',
    simple_config: {
      profile: 'balanced',
    },
    advanced_config: {},
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
