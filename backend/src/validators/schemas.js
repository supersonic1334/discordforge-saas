'use strict';

const { z } = require('zod');
const { MODULE_TYPES } = require('../bot/modules/definitions');
const { SITE_LANGUAGES, AI_LANGUAGES } = require('../constants/languages');
const { AI_PROVIDER_CATALOG } = require('../config/aiCatalog');

const AI_PROVIDER_IDS = AI_PROVIDER_CATALOG.map((provider) => provider.id);

// ── Auth ─────────────────────────────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_\-. ]+$/, 'Username contains invalid characters'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  captcha_token: z.string().trim().min(20, 'Captcha token missing'),
  captcha_answer: z.string().trim().min(4, 'Captcha answer missing').max(16),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
});

const changeUsernameSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_\-. ]+$/),
});

const avatarUpdateSchema = z.object({
  avatar_url: z.string()
    .trim()
    .max(1_200_000)
    .refine(
      (value) => (
        value === '' ||
        /^https?:\/\/\S+$/i.test(value) ||
        /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)
      ),
      'Invalid avatar image'
    ),
});

const analyticsLayoutSchema = z.object({
  version: z.number().int().min(1).max(5).optional(),
  order: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
  visible: z.array(z.string().trim().min(1).max(64)).max(32).optional(),
});

const preferencesSchema = z.object({
  site_language: z.enum(SITE_LANGUAGES),
  ai_language: z.enum(AI_LANGUAGES),
  analytics_layout: analyticsLayoutSchema.optional(),
});

const emailFastVaultSchema = z.object({
  payload: z.record(z.unknown()).refine((value) => {
    const mailboxes = Array.isArray(value?.mailboxes) ? value.mailboxes : [];
    return mailboxes.length <= 500;
  }, 'Invalid Email Fast payload'),
});

const emailFastVaultUnlockSchema = z.object({
  currentPassword: z.string().trim().min(1).max(200).optional(),
});

const discordLinkSchema = z.object({
  return_to: z.string().trim().max(500).optional().default('/dashboard/search'),
  mode: z.enum(['redirect', 'popup']).optional().default('popup'),
  force_prompt: z.boolean().optional().default(false),
});

// ── Bot Token ─────────────────────────────────────────────────────────────────
const botTokenSchema = z.object({
  token: z.string()
    .min(50, 'Token appears too short')
    .max(100, 'Token appears too long')
    .regex(/^[A-Za-z0-9._-]+$/, 'Token contains invalid characters'),
});

// ── Modules ──────────────────────────────────────────────────────────────────
const moduleToggleSchema = z.object({
  enabled: z.boolean(),
});

const moduleConfigSchema = z.object({
  simple_config: z.record(z.unknown()).optional(),
  advanced_config: z.record(z.unknown()).optional(),
});

const moduleTypeSchema = z.enum(MODULE_TYPES);

// ── Moderation ───────────────────────────────────────────────────────────────
const addWarningSchema = z.object({
  target_user_id: z.string().regex(/^\d+$/, 'Must be a Discord user ID'),
  target_username: z.string().optional(),
  reason: z.string().min(1).max(500),
  points: z.number().int().min(1).max(10).optional().default(1),
  moderator_discord_identity: z.string().trim().min(2).max(100).optional(),
  hide_moderator_identity: z.boolean().optional().default(false),
});

const modActionSchema = z.object({
  target_user_id: z.string().regex(/^\d+$/, 'Must be a Discord user ID'),
  target_username: z.string().optional(),
  action: z.enum(['warn', 'timeout', 'kick', 'ban', 'unban', 'untimeout', 'blacklist']),
  reason: z.string().min(1).max(500).optional(),
  duration_ms: z.number().int().min(60000).max(2419200000).optional(), // 1 min – 28 days
  points: z.number().int().min(1).max(10).optional().default(1),
  moderator_discord_identity: z.string().trim().min(2).max(100).optional(),
  hide_moderator_identity: z.boolean().optional().default(false),
});

const guildDmConfigSchema = z.object({
  auto_dm_warn: z.boolean().optional(),
  auto_dm_timeout: z.boolean().optional(),
  auto_dm_kick: z.boolean().optional(),
  auto_dm_ban: z.boolean().optional(),
  auto_dm_blacklist: z.boolean().optional(),
  appeal_server_name: z.string().trim().max(120).optional().default(''),
  appeal_server_url: z.string().trim().max(500).optional().default('').refine(
    (value) => value === '' || /^https?:\/\/\S+$/i.test(value),
    'Invalid appeal server URL'
  ),
  brand_name: z.string().trim().max(120).optional().default(''),
  brand_site_url: z.string().trim().max(500).optional().default('').refine(
    (value) => value === '' || /^https?:\/\/\S+$/i.test(value),
    'Invalid brand site URL'
  ),
  brand_icon_url: z.string().trim().max(1_200_000).optional().default('').refine(
    (value) => (
      value === '' ||
      /^https?:\/\/\S+$/i.test(value) ||
      /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)
    ),
    'Invalid brand icon'
  ),
  brand_logo_url: z.string().trim().max(1_200_000).optional().default('').refine(
    (value) => (
      value === '' ||
      /^https?:\/\/\S+$/i.test(value) ||
      /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)
    ),
    'Invalid brand logo'
  ),
  site_button_label: z.string().trim().max(80).optional().default(''),
  show_site_link: z.boolean().optional(),
  show_brand_logo: z.boolean().optional(),
  footer_text: z.string().trim().max(180).optional().default(''),
});

const directMessageSchema = z.object({
  target_user_id: z.string().regex(/^\d+$/, 'Must be a Discord user ID'),
  target_username: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(2).max(2000),
  hide_sender_identity: z.boolean().optional().default(false),
});

const guildAccessInviteSchema = z.object({
  target: z.string().trim().min(2).max(160),
  access_role: z.enum(['admin', 'moderator', 'viewer']).optional().default('admin'),
  expires_in_hours: z.number().int().min(0).max(8760).optional().default(0),
});

const guildAccessCodeCreateSchema = z.object({
  access_role: z.enum(['admin', 'moderator', 'viewer']).optional().default('admin'),
  expires_in_hours: z.number().int().min(0).max(8760).optional().default(1),
});

const guildAccessCodeRedeemSchema = z.object({
  code: z.string().trim().min(6).max(64),
});

const guildAccessRoleSchema = z.object({
  access_role: z.enum(['admin', 'moderator', 'viewer']),
});

const guildSnapshotCreateSchema = z.object({
  label: z.string().trim().max(120).optional().default(''),
});

const guildBackupImportSchema = z.object({
  backup: z.any().refine(
    (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    'Backup invalide'
  ),
});

const guildAccessSuspendSchema = z.object({
  is_suspended: z.boolean(),
  duration_hours: z.number().int().min(0).max(8760).optional().default(0),
});

const collaborationAuditListSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

// ── Custom Commands ───────────────────────────────────────────────────────────
const commandKeySchema = z.string().trim().min(1).max(50).regex(/^\S+$/, 'Trigger cannot contain spaces');
const commandNameSchema = z.string().trim().min(1).max(32).regex(/^[\w-]+$/, 'Invalid command name');
const commandPrefixSchema = z.string().trim().min(1).max(5).regex(/^\S+$/, 'Invalid prefix');
const nativeActionTypeSchema = z.enum([
  'clear_messages',
  'ticket_panel',
  'ban_member',
  'blacklist_member',
  'kick_member',
  'softban_member',
  'timeout_member',
  'untimeout_member',
  'warn_member',
  'unban_member',
  'unblacklist_member',
  'add_role',
  'remove_role',
  'set_nickname',
  'lock_channel',
  'unlock_channel',
  'slowmode_channel',
  'say_message',
  'announce_message',
  'move_member',
  'disconnect_member',
]);

const customCommandSchema = z.object({
  trigger: commandKeySchema,
  command_type: z.enum(['prefix', 'slash']).optional().default('prefix'),
  command_prefix: commandPrefixSchema.optional().default('!'),
  command_name: commandNameSchema.optional(),
  execution_mode: z.enum(['response', 'native']).optional().default('response'),
  action_type: z.union([z.literal(''), nativeActionTypeSchema]).optional().default(''),
  action_config: z.record(z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
  description: z.string().trim().max(120).optional().default(''),
  aliases: z.array(commandKeySchema).max(15).optional().default([]),
  response: z.string().trim().min(1).max(2000),
  response_mode: z.enum(['channel', 'reply', 'dm']).optional().default('channel'),
  reply_in_dm: z.boolean().optional(),
  delete_trigger: z.boolean().optional().default(false),
  allowed_roles: z.array(z.string()).max(50).optional().default([]),
  allowed_channels: z.array(z.string()).max(100).optional().default([]),
  cooldown_ms: z.number().int().min(0).max(86400000).optional().default(0),
  delete_response_after_ms: z.number().int().min(0).max(86400000).optional().default(0),
  embed_enabled: z.boolean().optional().default(false),
  embed_title: z.string().trim().max(256).optional().default(''),
  embed_color: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, 'Invalid embed color').optional().default('#22d3ee'),
  mention_user: z.boolean().optional().default(false),
  require_args: z.boolean().optional().default(false),
  usage_hint: z.string().trim().max(200).optional().default(''),
});

const commandAssistantSchema = z.object({
  mode: z.enum(['prefix', 'slash']),
  prefix: commandPrefixSchema.optional(),
  trigger: z.string().trim().min(1).max(50).optional(),
  command_name: commandNameSchema.optional(),
  prompt: z.string().trim().min(1).max(3000),
  command_id: z.string().trim().optional(),
  conversation_history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(3000),
  })).optional().default([]),
});

const commandToggleSchema = z.object({
  enabled: z.boolean().optional(),
});

// ── AI ────────────────────────────────────────────────────────────────────────
const aiMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  guild_id: z.string().optional(),    // internal UUID for context
  conversation_history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().default([]),
});

const aiPendingActionSchema = z.object({
  action: z.string().trim().min(1).max(80),
  params: z.record(z.unknown()).optional().default({}),
});

const aiContinueActionSchema = z.object({
  guild_id: z.string().trim().optional(),
  pending_action: aiPendingActionSchema,
});

const osintUsernameScanSchema = z.object({
  username: z.string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9._-]+$/, 'Pseudo invalide'),
});

const osintImageScanSchema = z.object({
  image_base64: z.string().trim().min(32).max(10_000_000),
  mime_type: z.string()
    .trim()
    .toLowerCase()
    .regex(/^image\/(?:png|jpe?g|webp|gif)$/i, 'Format image non supporte'),
});

// ── Admin ─────────────────────────────────────────────────────────────────────
const aiConfigSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  api_key: z.string().trim().optional().default(''),
  model: z.string().min(1),
  max_tokens: z.number().int().min(256).max(8192).optional().default(1024),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  user_quota_tokens: z.number().int().min(0).max(5_000_000).optional().default(4000),
  site_quota_tokens: z.number().int().min(0).max(5_000_000).optional().default(20000),
  quota_window_hours: z.number().int().min(1).max(168).optional().default(5),
  auto_mode: z.boolean().optional().default(true),
  active_provider_key_id: z.string().trim().optional().nullable(),
});

const providerAiKeySchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS),
  api_key: z.string().trim().min(10).max(500),
  model: z.string().trim().min(1).max(120),
});

const providerAiModelSchema = z.object({
  model: z.string().trim().min(1).max(120),
});

const userStatusSchema = z.object({
  is_active: z.boolean(),
});

const adminRoleSchema = z.object({
  role: z.preprocess(
    (value) => typeof value === 'string' ? value.trim().toLowerCase() : value,
    z.enum(['member', 'admin', 'founder', 'api_provider'])
  ),
});

const adminPasswordSchema = z.object({
  newPassword: z.string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
});

// ── Pagination ────────────────────────────────────────────────────────────────
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const moderationSearchSchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});

// ── Log channel ───────────────────────────────────────────────────────────────
const logChannelSchema = z.object({
  channel_id: z.string().regex(/^\d+$/, 'Must be a Discord channel ID'),
  log_events: z.array(z.string()).optional().default([]),
  enabled: z.boolean().optional().default(true),
});

// ── Support ───────────────────────────────────────────────────────────────────
const supportCategorySchema = z.enum(['bug', 'report', 'account', 'question', 'other']);

const supportTicketListSchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  view: z.enum(['mine', 'staff']).optional().default('mine'),
  status: z.enum(['all', 'open', 'claimed', 'closed']).optional().default('all'),
  category: z.enum(['all', 'bug', 'report', 'account', 'question', 'other']).optional().default('all'),
  claim: z.enum(['all', 'mine', 'unclaimed']).optional().default('all'),
  q: z.string().trim().max(120).optional().default(''),
});

const supportTicketCreateSchema = z.object({
  category: supportCategorySchema,
  title: z.string().trim().min(4).max(120).optional().or(z.literal('')),
  message: z.string().trim().min(12).max(2000),
});

const supportTicketMessageSchema = z.object({
  message: z.string().trim().min(2).max(3000),
});

const supportTicketStatusSchema = z.object({
  status: z.enum(['open', 'closed']),
});

const supportTicketUpdateSchema = z.object({
  title: z.string().trim().min(4).max(120).optional(),
  category: supportCategorySchema.optional(),
  status: z.enum(['open', 'claimed', 'closed']).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const discordSnowflakeSchema = z.string().trim().regex(/^\d+$/, 'Must be a Discord ID');
const optionalDiscordSnowflakeSchema = z.string().trim().max(32).optional().default('').refine(
  (value) => value === '' || /^\d+$/.test(value),
  'Must be a Discord ID'
);
const optionalImageAssetSchema = z.string().trim().max(1_200_000).optional().default('').refine(
  (value) => (
    value === '' ||
    /^https?:\/\/\S+$/i.test(value) ||
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)
  ),
  'Invalid image asset'
);

const ticketGeneratorOptionSchema = z.object({
  key: z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid option key'),
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().max(100).optional().default(''),
  emoji: z.string().trim().max(16).optional().default(''),
  category_id: optionalDiscordSnowflakeSchema,
  role_ids: z.array(discordSnowflakeSchema).max(12).optional().default([]),
  ping_roles: z.boolean().optional().default(true),
  question_label: z.string().trim().min(1).max(45),
  question_placeholder: z.string().trim().max(100).optional().default(''),
  modal_title: z.string().trim().min(1).max(45),
  intro_message: z.string().trim().max(1600).optional().default(''),
  ticket_name_template: z.string().trim().min(1).max(80),
  ticket_topic_template: z.string().trim().max(220).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

const ticketGeneratorConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  panel_channel_id: optionalDiscordSnowflakeSchema,
  panel_message_id: optionalDiscordSnowflakeSchema,
  transcript_channel_id: optionalDiscordSnowflakeSchema,
  panel_title: z.string().trim().min(1).max(120),
  panel_description: z.string().trim().max(2000).optional().default(''),
  panel_footer: z.string().trim().max(200).optional().default(''),
  menu_placeholder: z.string().trim().min(1).max(120),
  panel_color: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, 'Invalid color'),
  panel_thumbnail_url: optionalImageAssetSchema,
  panel_image_url: optionalImageAssetSchema,
  default_category_id: optionalDiscordSnowflakeSchema,
  ticket_name_template: z.string().trim().min(1).max(80),
  ticket_topic_template: z.string().trim().max(220).optional().default(''),
  intro_message: z.string().trim().max(1600).optional().default(''),
  claim_message: z.string().trim().min(1).max(240),
  close_message: z.string().trim().min(1).max(240),
  auto_ping_support: z.boolean().optional().default(true),
  allow_user_close: z.boolean().optional().default(true),
  prevent_duplicates: z.boolean().optional().default(true),
  options: z.array(ticketGeneratorOptionSchema).min(1).max(10),
});

const captchaChallengeTypeSchema = z.object({
  key: z.enum(['image_code', 'quick_math']),
  label: z.string().trim().min(1).max(40),
  description: z.string().trim().max(140).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

const captchaConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  channel_mode: z.enum(['existing', 'create']).optional().default('existing'),
  panel_channel_id: optionalDiscordSnowflakeSchema,
  panel_channel_name: z.string().trim().min(1).max(90),
  panel_message_id: optionalDiscordSnowflakeSchema,
  panel_title: z.string().trim().min(1).max(120),
  panel_description: z.string().trim().max(2000).optional().default(''),
  panel_color: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, 'Invalid color'),
  panel_thumbnail_url: optionalImageAssetSchema,
  panel_image_url: optionalImageAssetSchema,
  verified_role_ids: z.array(discordSnowflakeSchema).max(12).optional().default([]),
  log_channel_id: optionalDiscordSnowflakeSchema,
  success_message: z.string().trim().min(1).max(240),
  failure_message: z.string().trim().min(1).max(240),
  challenge_types: z.array(captchaChallengeTypeSchema).min(1).max(4),
});

// ── Site reviews ─────────────────────────────────────────────────────────────
const siteReviewCreateSchema = z.object({
  rating_half: z.number().int().min(1).max(10),
  message: z.string().trim().min(4).max(1500),
});

const siteReviewUpdateSchema = z.object({
  message: z.string().trim().min(4).max(1500),
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  changeUsernameSchema,
  avatarUpdateSchema,
  preferencesSchema,
  emailFastVaultSchema,
  emailFastVaultUnlockSchema,
  discordLinkSchema,
  botTokenSchema,
  moduleToggleSchema,
  moduleConfigSchema,
  moduleTypeSchema,
  addWarningSchema,
  modActionSchema,
  guildDmConfigSchema,
  directMessageSchema,
  guildAccessInviteSchema,
  guildAccessCodeCreateSchema,
  guildAccessCodeRedeemSchema,
  guildAccessRoleSchema,
  guildAccessSuspendSchema,
  guildSnapshotCreateSchema,
  guildBackupImportSchema,
  collaborationAuditListSchema,
  customCommandSchema,
  commandAssistantSchema,
  commandToggleSchema,
  aiMessageSchema,
  aiContinueActionSchema,
  osintUsernameScanSchema,
  osintImageScanSchema,
  aiConfigSchema,
  providerAiKeySchema,
  providerAiModelSchema,
  userStatusSchema,
  adminRoleSchema,
  adminPasswordSchema,
  paginationSchema,
  moderationSearchSchema,
  logChannelSchema,
  supportTicketListSchema,
  supportTicketCreateSchema,
  supportTicketMessageSchema,
  supportTicketStatusSchema,
  supportTicketUpdateSchema,
  ticketGeneratorOptionSchema,
  ticketGeneratorConfigSchema,
  captchaConfigSchema,
  siteReviewCreateSchema,
  siteReviewUpdateSchema,
};
