'use strict';

const fetch = require('node-fetch');
const db = require('../database');
const config = require('../config');
const botManager = require('./botManager');
const { decrypt } = require('./encryptionService');
const aiProviderKeyService = require('./aiProviderKeyService');
const discordService = require('./discordService');
const guildAccessService = require('./guildAccessService');
const { resolveLinkedModeratorAccess } = require('./discordModeratorAccessService');
const { safeSendModerationDm } = require('./moderationDmService');
const wsServer = require('../websocket');
const { addWarning } = require('../bot/utils/modHelpers');
const logger = require('../utils/logger').child('AIService');
const { LANGUAGE_LABELS } = require('../constants/languages');
const { resolveConfiguredModel, getProviderCatalog } = require('../config/aiCatalog');

const DEFAULT_AI_USER_QUOTA_TOKENS = 4000;
const DEFAULT_AI_SITE_QUOTA_TOKENS = 20000;
const DEFAULT_AI_QUOTA_WINDOW_HOURS = 5;
const GLOBAL_QUOTA_ID = 'site-global';
const DIRECT_ACTIONS = new Set(['start_bot', 'stop_bot', 'restart_bot', 'sync_guilds']);
const SENSITIVE_ASSISTANT_ACTIONS = new Set(['add_warning', 'kick_user', 'ban_user', 'timeout_user']);
const IMAGE_REQUEST_MATCHERS = [
  /\b(genere|genere moi|cree|creee?|fabrique|dessine|imagine|produis)\b.*\b(image|illustration|visuel|affiche|logo|banner|banniere|avatar|thumbnail)\b/i,
  /\b(generate|create|make|draw)\b.*\b(image|illustration|poster|logo|banner|avatar|thumbnail)\b/i,
  /\bimage\b.*\b(discord|serveur|server|logo|banner|avatar)\b/i,
];
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image-preview';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundToStep(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}

function getRuntimeAudience(stats = null) {
  const activeUsers = Math.max(
    1,
    Number(
      stats?.activeUsers
      ?? stats?.users
      ?? db.raw('SELECT COUNT(*) as c FROM users WHERE is_active = 1')[0]?.c
      ?? 1
    ) || 1
  );
  const connectedUsers = Math.max(
    0,
    Number(stats?.connectedUsers ?? wsServer.connectedUserCount ?? 0) || 0
  );
  const loadUsers = Math.max(1, connectedUsers, Math.ceil(activeUsers / 8));

  return { activeUsers, connectedUsers, loadUsers };
}

function getExpectedDemandUsers(audience) {
  return clamp(
    Math.max(
      1,
      Number(audience?.connectedUsers || 0),
      Math.ceil(Number(audience?.activeUsers || 1) / 4)
    ),
    1,
    250
  );
}

function getModelAutoProfile(provider, model) {
  const id = `${provider || ''}:${model || ''}`.toLowerCase();

  if (id.includes('gpt-5.4-nano')) {
    return {
      profile: 'light',
      maxReplyBase: 4608,
      minReply: 1024,
      maxReply: 6144,
      siteQuotaBase: 84000,
      minSiteQuota: 30000,
      maxSiteQuota: 140000,
      minUserQuota: 750,
      maxUserQuota: 18000,
      replyPressure: 0.18,
      sitePressure: 0.22,
    };
  }

  if (id.includes('gpt-5.4-mini')) {
    return {
      profile: 'balanced',
      maxReplyBase: 3584,
      minReply: 1024,
      maxReply: 4608,
      siteQuotaBase: 56000,
      minSiteQuota: 22000,
      maxSiteQuota: 96000,
      minUserQuota: 650,
      maxUserQuota: 12000,
      replyPressure: 0.22,
      sitePressure: 0.26,
    };
  }

  const premiumMatchers = [
    'gemini-2.5-pro',
    'claude-opus',
    'claude-sonnet',
    'gpt-5.4',
    'grok-4',
    'reasoning',
    'mistral-large',
    'sonar-pro',
    'pro'
  ];
  const lightMatchers = [
    'flash-lite',
    'haiku',
    'nano',
    'mini',
    'ministral',
    'fast',
    'scout',
    'lite'
  ];

  if (premiumMatchers.some((entry) => id.includes(entry))) {
    return {
      profile: 'premium',
      maxReplyBase: 2048,
      minReply: 768,
      maxReply: 3072,
      siteQuotaBase: 28000,
      minSiteQuota: 12000,
      maxSiteQuota: 52000,
      minUserQuota: 400,
      maxUserQuota: 6000,
      replyPressure: 0.3,
      sitePressure: 0.36,
    };
  }

  if (lightMatchers.some((entry) => id.includes(entry))) {
    return {
      profile: 'light',
      maxReplyBase: 4096,
      minReply: 1024,
      maxReply: 6144,
      siteQuotaBase: 72000,
      minSiteQuota: 26000,
      maxSiteQuota: 120000,
      minUserQuota: 800,
      maxUserQuota: 20000,
      replyPressure: 0.2,
      sitePressure: 0.24,
    };
  }

  return {
    profile: 'balanced',
    maxReplyBase: 3072,
    minReply: 896,
    maxReply: 4096,
    siteQuotaBase: 46000,
    minSiteQuota: 18000,
    maxSiteQuota: 82000,
    minUserQuota: 550,
    maxUserQuota: 10000,
    replyPressure: 0.24,
    sitePressure: 0.29,
  };
}

function getAutoAIConfig(arg1, maybeModel = null, maybeQuotaWindowHours = null, maybeStats = null) {
  const baseConfig = typeof arg1 === 'object' && arg1 !== null
    ? arg1
    : { provider: arg1, model: maybeModel, quotaWindowHours: maybeQuotaWindowHours, stats: maybeStats };

  const provider = String(baseConfig.provider || 'anthropic').trim().toLowerCase();
  const model = resolveConfiguredModel(provider, baseConfig.model);
  const quotaWindowHours = clamp(
    Number(baseConfig.quotaWindowHours ?? DEFAULT_AI_QUOTA_WINDOW_HOURS) || DEFAULT_AI_QUOTA_WINDOW_HOURS,
    1,
    168
  );
  const audience = getRuntimeAudience(baseConfig.stats);
  const profile = getModelAutoProfile(provider, model);
  const demandUsers = getExpectedDemandUsers(audience);
  const replyPenalty = 1 + (Math.log2(audience.loadUsers + 1) * profile.replyPressure);
  const sitePenalty = 1 + (Math.log2(audience.loadUsers + 1) * profile.sitePressure);
  const baseTemperature = profile.profile === 'premium'
    ? 0.35
    : profile.profile === 'balanced'
      ? 0.5
      : 0.65;
  const maxTokens = clamp(
    roundToStep(profile.maxReplyBase / replyPenalty, 32),
    profile.minReply,
    profile.maxReply
  );
  const siteQuotaTokens = clamp(
    roundToStep(profile.siteQuotaBase / sitePenalty, 500),
    profile.minSiteQuota,
    profile.maxSiteQuota
  );
  const userQuotaTokens = clamp(
    roundToStep(siteQuotaTokens / demandUsers, 250),
    profile.minUserQuota,
    Math.min(profile.maxUserQuota, siteQuotaTokens)
  );
  const temperature = clamp(
    Number((baseTemperature - (Math.log2(audience.loadUsers + 1) * 0.03)).toFixed(2)),
    0.2,
    0.9
  );

  return {
    provider,
    model,
    maxTokens,
    temperature,
    quotaWindowHours,
    userQuotaTokens,
    siteQuotaTokens,
    autoTuning: {
      profile: profile.profile,
      activeUsers: audience.activeUsers,
      connectedUsers: audience.connectedUsers,
      loadUsers: audience.loadUsers,
      demandUsers,
    },
  };
}

function estimateTokenCount(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function buildPromptText(systemPrompt, messages) {
  return [systemPrompt, ...messages.map((message) => message.content)].join('\n');
}

function normalizeTokenUsage(rawUsage, promptText, completionText) {
  const inputTokens = Number(
    rawUsage?.inputTokens
    ?? rawUsage?.promptTokens
    ?? rawUsage?.promptTokenCount
    ?? 0
  ) || estimateTokenCount(promptText);

  const outputTokens = Number(
    rawUsage?.outputTokens
    ?? rawUsage?.completionTokens
    ?? rawUsage?.candidateTokens
    ?? 0
  ) || estimateTokenCount(completionText);

  const totalTokens = Number(rawUsage?.totalTokens ?? 0) || (inputTokens + outputTokens);

  return { inputTokens, outputTokens, totalTokens };
}

function trimConversationHistory(conversationHistory = [], maxMessages = 6, maxChars = 700) {
  return (Array.isArray(conversationHistory) ? conversationHistory : [])
    .slice(-maxMessages)
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || '').trim().slice(0, maxChars),
    }))
    .filter((message) => message.content);
}

function buildGuildSummary(guilds = []) {
  const visibleGuilds = guilds.slice(0, 8);
  const items = visibleGuilds.map((guild) => `- ${guild.name} (${guild.id})`).join('\n');
  const hiddenCount = Math.max(0, guilds.length - visibleGuilds.length);
  return hiddenCount > 0 ? `${items}\n- +${hiddenCount} autres espaces` : (items || '- aucun serveur actif');
}

function getAccessibleGuilds(userId) {
  return guildAccessService.listAccessibleGuilds(userId) || [];
}

function findAccessibleGuildRecord(userId, guildId) {
  if (!guildId) return null;
  const access = guildAccessService.getGuildAccess(userId, guildId);
  return access || null;
}

function buildLinkedDiscordState(user) {
  const linkedDiscordId = String(user?.discord_id || '').trim();
  if (!linkedDiscordId) {
    return 'Compte Discord lie: non. Pour bannir, warn, timeout ou kick via l assistant, une liaison Discord est obligatoire.';
  }

  const label = user?.discord_global_name || user?.discord_username || linkedDiscordId;
  return `Compte Discord lie: oui (${label}, ${linkedDiscordId}).`;
}

function isImageGenerationRequest(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  return IMAGE_REQUEST_MATCHERS.some((matcher) => matcher.test(text));
}

function normalizeImagePrompt(message) {
  const raw = String(message || '').trim();
  return raw
    .replace(/^(peux[- ]?tu|tu peux|merci de|stp|svp)\s+/i, '')
    .replace(/^(genere|cree|fabrique|dessine|imagine|generate|create|draw|make)\s+(moi\s+)?/i, '')
    .replace(/^(une|un)\s+/i, '')
    .trim() || raw;
}

function buildLinkRequiredMessage(actionBlock) {
  const action = String(actionBlock?.action || '').trim();
  const labels = {
    add_warning: 'mettre un avertissement',
    timeout_user: 'mettre un timeout',
    kick_user: 'expulser un membre',
    ban_user: 'bannir un membre',
  };
  const actionLabel = labels[action] || 'executer cette action';
  return `Lie ton compte Discord pour ${actionLabel}. Des que la liaison est terminee, je reprends automatiquement.`;
}

function buildPermissionDeniedMessage() {
  return 'Ton compte Discord lie n a pas les permissions necessaires sur ce serveur pour executer cette action.';
}

function buildMissingGuildMessage() {
  return 'Selectionne d abord un serveur actif pour que je puisse agir dessus.';
}

function buildActionResultMessage(actionBlock, actionResult, fallbackText = '') {
  if (actionResult?.error) {
    return `Action impossible: ${actionResult.error}`;
  }

  const successMessage = String(actionResult?.message || '').trim();
  if (successMessage) return successMessage;
  if (fallbackText) return fallbackText;
  return 'Action terminee.';
}

function mapAIConfigRow(row) {
  if (!row || !row.enabled) return null;

  const autoMode = Number(row.auto_mode ?? 1) !== 0;
  const quotaWindowHours = row.quota_window_hours ?? DEFAULT_AI_QUOTA_WINDOW_HOURS;
  const selectedProviderKey = aiProviderKeyService.getConfiguredProviderKey(row);

  if (selectedProviderKey?.encrypted_api_key) {
    const resolvedModel = resolveConfiguredModel(
      selectedProviderKey.provider,
      selectedProviderKey.selected_model || row.model
    );
    const decryptedApiKey = decrypt(selectedProviderKey.encrypted_api_key);
    const autoConfig = autoMode
      ? getAutoAIConfig({
        provider: selectedProviderKey.provider,
        model: resolvedModel,
        quotaWindowHours,
      })
      : null;

    if (!decryptedApiKey) return null;

    return {
      provider: selectedProviderKey.provider,
      apiKey: decryptedApiKey,
      model: resolvedModel,
      maxTokens: autoMode ? autoConfig.maxTokens : (row.max_tokens ?? 1024),
      temperature: autoMode ? autoConfig.temperature : (row.temperature ?? 0.7),
      userQuotaTokens: autoMode ? autoConfig.userQuotaTokens : (row.user_quota_tokens ?? DEFAULT_AI_USER_QUOTA_TOKENS),
      siteQuotaTokens: autoMode ? autoConfig.siteQuotaTokens : (row.site_quota_tokens ?? DEFAULT_AI_SITE_QUOTA_TOKENS),
      quotaWindowHours,
      autoMode,
      autoTuning: autoMode ? autoConfig.autoTuning : null,
      providerKeyId: selectedProviderKey.id || null,
      apiKeySource: 'provider_pool',
      providerKeyOwner: {
        username: selectedProviderKey.owner_username,
        role: selectedProviderKey.owner_role,
        avatar_url: selectedProviderKey.owner_avatar_url,
      },
    };
  }

  const resolvedModel = resolveConfiguredModel(row.provider, row.model);
  const decryptedApiKey = row.encrypted_api_key ? decrypt(row.encrypted_api_key) : null;
  const autoConfig = autoMode
    ? getAutoAIConfig({
      provider: row.provider,
      model: resolvedModel,
      quotaWindowHours,
    })
    : null;

  if (!decryptedApiKey) return null;

  return {
    provider: row.provider,
    apiKey: decryptedApiKey,
    model: resolvedModel,
    maxTokens: autoMode ? autoConfig.maxTokens : (row.max_tokens ?? 1024),
    temperature: autoMode ? autoConfig.temperature : (row.temperature ?? 0.7),
    userQuotaTokens: autoMode ? autoConfig.userQuotaTokens : (row.user_quota_tokens ?? DEFAULT_AI_USER_QUOTA_TOKENS),
    siteQuotaTokens: autoMode ? autoConfig.siteQuotaTokens : (row.site_quota_tokens ?? DEFAULT_AI_SITE_QUOTA_TOKENS),
    quotaWindowHours,
    autoMode,
    autoTuning: autoMode ? autoConfig.autoTuning : null,
    providerKeyId: selectedProviderKey?.id || null,
    apiKeySource: selectedProviderKey ? 'provider_pool' : 'admin',
    providerKeyOwner: selectedProviderKey ? {
      username: selectedProviderKey.owner_username,
      role: selectedProviderKey.owner_role,
      avatar_url: selectedProviderKey.owner_avatar_url,
    } : null,
  };
}

function getAIConfig() {
  const row = db.raw("SELECT * FROM ai_config WHERE id = 'singleton'")[0];
  const configured = mapAIConfigRow(row);
  if (configured) return configured;

  const fallbackProviderKey = aiProviderKeyService.getBestAvailableProviderKey();
  if (!fallbackProviderKey?.encrypted_api_key) return null;

  const quotaWindowHours = row?.quota_window_hours ?? DEFAULT_AI_QUOTA_WINDOW_HOURS;
  const autoMode = Number(row?.auto_mode ?? 1) !== 0;
  const resolvedModel = resolveConfiguredModel(
    fallbackProviderKey.provider,
    fallbackProviderKey.selected_model
  );
  const decryptedApiKey = decrypt(fallbackProviderKey.encrypted_api_key);
  const autoConfig = autoMode
    ? getAutoAIConfig({
      provider: fallbackProviderKey.provider,
      model: resolvedModel,
      quotaWindowHours,
    })
    : null;

  if (!decryptedApiKey) return null;

  return {
    provider: fallbackProviderKey.provider,
    apiKey: decryptedApiKey,
    model: resolvedModel,
    maxTokens: autoMode ? autoConfig.maxTokens : (row?.max_tokens ?? 1024),
    temperature: autoMode ? autoConfig.temperature : (row?.temperature ?? 0.7),
    userQuotaTokens: autoMode ? autoConfig.userQuotaTokens : (row?.user_quota_tokens ?? DEFAULT_AI_USER_QUOTA_TOKENS),
    siteQuotaTokens: autoMode ? autoConfig.siteQuotaTokens : (row?.site_quota_tokens ?? DEFAULT_AI_SITE_QUOTA_TOKENS),
    quotaWindowHours,
    autoMode,
    autoTuning: autoMode ? autoConfig.autoTuning : null,
    providerKeyId: fallbackProviderKey.id || null,
    apiKeySource: 'provider_pool',
    providerKeyOwner: {
      username: fallbackProviderKey.owner_username,
      role: fallbackProviderKey.owner_role,
      avatar_url: fallbackProviderKey.owner_avatar_url,
    },
  };
}

function getGeminiImageConfig() {
  const activeConfig = getAIConfig();
  if (activeConfig?.provider === 'gemini' && activeConfig.apiKey) {
    return {
      provider: 'gemini',
      apiKey: activeConfig.apiKey,
      model: GEMINI_IMAGE_MODEL,
      providerKeyId: activeConfig.providerKeyId || null,
    };
  }

  const pooledGeminiKey = aiProviderKeyService.getBestAvailableProviderKey('gemini');
  if (!pooledGeminiKey?.encrypted_api_key) return null;

  return {
    provider: 'gemini',
    apiKey: decrypt(pooledGeminiKey.encrypted_api_key),
    model: GEMINI_IMAGE_MODEL,
    providerKeyId: pooledGeminiKey.id || null,
  };
}

function getUserQuotaLimit(aiConfig) {
  return Number(aiConfig?.userQuotaTokens ?? DEFAULT_AI_USER_QUOTA_TOKENS) || 0;
}

function getSiteQuotaLimit(aiConfig) {
  return Number(aiConfig?.siteQuotaTokens ?? DEFAULT_AI_SITE_QUOTA_TOKENS) || 0;
}

function getQuotaWindowHours(aiConfig) {
  return Number(aiConfig?.quotaWindowHours ?? DEFAULT_AI_QUOTA_WINDOW_HOURS) || DEFAULT_AI_QUOTA_WINDOW_HOURS;
}

function resolveQuotaConfig(arg1, arg2) {
  if (arg2) return arg2;
  if (arg1 && typeof arg1 === 'object' && 'provider' in arg1) return arg1;
  return getAIConfig();
}

function upsertQuotaState(state) {
  db.db.prepare(`
    INSERT INTO ai_global_quota (
      id,
      window_started_at,
      window_ends_at,
      used_input_tokens,
      used_output_tokens,
      used_total_tokens,
      request_count,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      window_ends_at = excluded.window_ends_at,
      used_input_tokens = excluded.used_input_tokens,
      used_output_tokens = excluded.used_output_tokens,
      used_total_tokens = excluded.used_total_tokens,
      request_count = excluded.request_count,
      updated_at = excluded.updated_at
  `).run(
    GLOBAL_QUOTA_ID,
    state.windowStartedAt,
    state.windowEndsAt,
    state.usedInputTokens,
    state.usedOutputTokens,
    state.usedTotalTokens,
    state.requestCount,
    state.updatedAt
  );
}

function upsertUserQuotaState(userId, state) {
  db.db.prepare(`
    INSERT INTO ai_user_quotas (
      user_id,
      window_started_at,
      window_ends_at,
      used_input_tokens,
      used_output_tokens,
      used_total_tokens,
      request_count,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      window_ends_at = excluded.window_ends_at,
      used_input_tokens = excluded.used_input_tokens,
      used_output_tokens = excluded.used_output_tokens,
      used_total_tokens = excluded.used_total_tokens,
      request_count = excluded.request_count,
      updated_at = excluded.updated_at
  `).run(
    userId,
    state.windowStartedAt,
    state.windowEndsAt,
    state.usedInputTokens,
    state.usedOutputTokens,
    state.usedTotalTokens,
    state.requestCount,
    state.updatedAt
  );
}

function createFreshQuotaState(now, quotaWindowHours) {
  return {
    windowStartedAt: now.toISOString(),
    windowEndsAt: new Date(now.getTime() + quotaWindowHours * 60 * 60 * 1000).toISOString(),
    usedInputTokens: 0,
    usedOutputTokens: 0,
    usedTotalTokens: 0,
    requestCount: 0,
    updatedAt: now.toISOString(),
  };
}

function readQuotaState(aiConfig, now = new Date()) {
  const row = db.findOne('ai_global_quota', { id: GLOBAL_QUOTA_ID });
  const quotaWindowHours = getQuotaWindowHours(aiConfig);

  if (!row || Date.parse(row.window_ends_at) <= now.getTime()) {
    const freshState = createFreshQuotaState(now, quotaWindowHours);
    upsertQuotaState(freshState);
    return freshState;
  }

  return {
    windowStartedAt: row.window_started_at,
    windowEndsAt: row.window_ends_at,
    usedInputTokens: Number(row.used_input_tokens || 0),
    usedOutputTokens: Number(row.used_output_tokens || 0),
    usedTotalTokens: Number(row.used_total_tokens || 0),
    requestCount: Number(row.request_count || 0),
    updatedAt: row.updated_at,
  };
}

function readUserQuotaState(userId, aiConfig, now = new Date()) {
  const row = db.findOne('ai_user_quotas', { user_id: userId });
  const quotaWindowHours = getQuotaWindowHours(aiConfig);

  if (!row || Date.parse(row.window_ends_at) <= now.getTime()) {
    const freshState = createFreshQuotaState(now, quotaWindowHours);
    upsertUserQuotaState(userId, freshState);
    return freshState;
  }

  return {
    windowStartedAt: row.window_started_at,
    windowEndsAt: row.window_ends_at,
    usedInputTokens: Number(row.used_input_tokens || 0),
    usedOutputTokens: Number(row.used_output_tokens || 0),
    usedTotalTokens: Number(row.used_total_tokens || 0),
    requestCount: Number(row.request_count || 0),
    updatedAt: row.updated_at,
  };
}

function buildQuotaMetrics(limitTokens, state, aiConfig) {
  return {
    enabled: limitTokens > 0,
    limitTokens,
    usedTokens: state.usedTotalTokens,
    usedInputTokens: state.usedInputTokens,
    usedOutputTokens: state.usedOutputTokens,
    remainingTokens: limitTokens > 0 ? Math.max(0, limitTokens - state.usedTotalTokens) : null,
    requestCount: state.requestCount,
    windowHours: getQuotaWindowHours(aiConfig),
    windowStartedAt: state.windowStartedAt,
    windowEndsAt: state.windowEndsAt,
  };
}

function getQuotaOverview(userIdOrAiConfig, maybeAiConfig = null) {
  const aiConfig = resolveQuotaConfig(userIdOrAiConfig, maybeAiConfig);
  if (!aiConfig) return null;

  const userId = typeof userIdOrAiConfig === 'string' ? userIdOrAiConfig : null;
  const siteQuota = buildQuotaMetrics(getSiteQuotaLimit(aiConfig), readQuotaState(aiConfig), aiConfig);
  const perUserQuota = userId
    ? buildQuotaMetrics(getUserQuotaLimit(aiConfig), readUserQuotaState(userId, aiConfig), aiConfig)
    : buildQuotaMetrics(getUserQuotaLimit(aiConfig), createFreshQuotaState(new Date(), getQuotaWindowHours(aiConfig)), aiConfig);

  return {
    ...perUserQuota,
    perUser: perUserQuota,
    site: siteQuota,
  };
}

function formatQuotaResetDate(user, windowEndsAt) {
  const locale = user?.site_language === 'es'
    ? 'es-ES'
    : user?.site_language === 'fr'
      ? 'fr-FR'
      : 'en-US';
  return new Date(windowEndsAt).toLocaleString(locale);
}

function getSiteQuotaExceededMessage(user, windowEndsAt) {
  const formattedDate = formatQuotaResetDate(user, windowEndsAt);
  if (user?.site_language === 'es') {
    return `La cuota global de IA del sitio se alcanzo. Vuelve a intentarlo despues de ${formattedDate}.`;
  }
  if (user?.site_language === 'fr') {
    return `Le quota global IA du site est atteint. Reessaie apres ${formattedDate}.`;
  }
  return `The global site AI quota has been reached. Try again after ${formattedDate}.`;
}

function getUserQuotaExceededMessage(user, windowEndsAt) {
  const formattedDate = formatQuotaResetDate(user, windowEndsAt);

  if (user?.site_language === 'es') {
    return `Tu cuota personal de IA se alcanzo. Vuelve a intentarlo despues de ${formattedDate}.`;
  }
  if (user?.site_language === 'fr') {
    return `Ton quota IA personnel est atteint. Reessaie apres ${formattedDate}.`;
  }
  return `Your personal AI quota has been reached. Try again after ${formattedDate}.`;
}

function ensureQuotaAvailable(user, userId, aiConfig, estimatedPromptTokens) {
  const overview = getQuotaOverview(userId, aiConfig);
  if (!overview) return overview;

  if (overview.perUser?.enabled && (overview.perUser.remainingTokens <= 0 || estimatedPromptTokens > overview.perUser.remainingTokens)) {
    throw Object.assign(
      new Error(getUserQuotaExceededMessage(user, overview.perUser.windowEndsAt)),
      {
        status: 429,
        code: 'AI_USER_QUOTA_EXCEEDED',
        resetAt: overview.perUser.windowEndsAt,
      }
    );
  }

  if (overview.site?.enabled && (overview.site.remainingTokens <= 0 || estimatedPromptTokens > overview.site.remainingTokens)) {
    throw Object.assign(
      new Error(getSiteQuotaExceededMessage(user, overview.site.windowEndsAt)),
      {
        status: 429,
        code: 'AI_QUOTA_EXCEEDED',
        resetAt: overview.site.windowEndsAt,
      }
    );
  }

  return overview;
}

function recordQuotaUsage(userId, aiConfig, usage) {
  if (!aiConfig) return null;

  const now = new Date();
  const currentState = readQuotaState(aiConfig, now);
  const nextState = {
    windowStartedAt: currentState.windowStartedAt,
    windowEndsAt: currentState.windowEndsAt,
    usedInputTokens: currentState.usedInputTokens + Number(usage.inputTokens || 0),
    usedOutputTokens: currentState.usedOutputTokens + Number(usage.outputTokens || 0),
    usedTotalTokens: currentState.usedTotalTokens + Number(usage.totalTokens || 0),
    requestCount: currentState.requestCount + 1,
    updatedAt: now.toISOString(),
  };

  upsertQuotaState(nextState);

  const currentUserState = readUserQuotaState(userId, aiConfig, now);
  const nextUserState = {
    windowStartedAt: currentUserState.windowStartedAt,
    windowEndsAt: currentUserState.windowEndsAt,
    usedInputTokens: currentUserState.usedInputTokens + Number(usage.inputTokens || 0),
    usedOutputTokens: currentUserState.usedOutputTokens + Number(usage.outputTokens || 0),
    usedTotalTokens: currentUserState.usedTotalTokens + Number(usage.totalTokens || 0),
    requestCount: currentUserState.requestCount + 1,
    updatedAt: now.toISOString(),
  };

  upsertUserQuotaState(userId, nextUserState);
  return getQuotaOverview(userId, aiConfig);
}

async function readProviderError(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return payload?.error?.message || payload?.error || payload?.message || '';
  }
  return String(await response.text().catch(() => '')).trim();
}

function createProviderError(provider, statusCode, rawMessage, model) {
  const message = String(rawMessage || '').replace(/\s+/g, ' ').trim();
  const lower = message.toLowerCase();
  const providerName = getProviderCatalog(provider)?.label || String(provider || 'Provider');

  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('billing') || lower.includes('insufficient_quota') || lower.includes('resource exhausted')) {
    if (provider === 'gemini') {
      return Object.assign(
        new Error(`Gemini quota unavailable for model ${model}. Switch to Gemini 2.5 Flash or check your Google AI Studio quota and billing.`),
        { status: 429, providerKeyStatus: 'quota_exhausted' }
      );
    }
    return Object.assign(
      new Error(`${providerName} quota unavailable for the saved model. Check billing/usage or choose a lighter model.`),
      { status: 429, providerKeyStatus: 'quota_exhausted' }
    );
  }

  if (
    lower.includes('invalid api key') ||
    lower.includes('api key not valid') ||
    lower.includes('incorrect api key') ||
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('permission denied')
  ) {
    return Object.assign(
      new Error(`Invalid ${providerName} API key. Verify the saved key and save the configuration again.`),
      { status: 401, providerKeyStatus: 'invalid' }
    );
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('unsupported') || lower.includes('not supported') || lower.includes('does not exist'))
  ) {
    return Object.assign(
      new Error(`Model ${model} is unavailable for ${providerName}. Choose another model and save again.`),
      { status: 400 }
    );
  }

  return Object.assign(
    new Error(message || `${providerName} request failed with status ${statusCode}.`),
    { status: statusCode >= 500 ? 502 : statusCode }
  );
}

async function throwProviderError(provider, response, model) {
  const rawMessage = await readProviderError(response);
  logger.error(`${provider} API request failed`, {
    status: response.status,
    model,
    error: rawMessage,
  });
  throw createProviderError(provider, response.status, rawMessage, model);
}

function getPublicTeamSnapshot() {
  const staff = db.raw(
    `SELECT username, role, email
     FROM users
     WHERE is_active = 1 AND role IN ('founder', 'admin')
     ORDER BY CASE WHEN role = 'founder' THEN 0 ELSE 1 END, created_at ASC`
  );

  const founderEmail = String(config.FOUNDER_EMAIL || '').trim().toLowerCase();
  const primaryFounder = staff.find((member) => String(member.email || '').trim().toLowerCase() === founderEmail);
  const founders = staff
    .filter((member) => member.role === 'founder' && member !== primaryFounder)
    .map((member) => member.username)
    .filter(Boolean);
  const admins = staff
    .filter((member) => member.role === 'admin')
    .map((member) => member.username)
    .filter(Boolean);

  return {
    primaryFounder: primaryFounder?.username || config.FOUNDER_USERNAME || 'Supersonic',
    founders,
    admins,
  };
}

function buildLanguageInstruction(user) {
  if (user.ai_language && user.ai_language !== 'auto') {
    return `Always reply in ${LANGUAGE_LABELS[user.ai_language] || 'English'} unless the user explicitly asks you to switch language.`;
  }

  const fallbackLanguage = user.site_language && user.site_language !== 'auto'
    ? (LANGUAGE_LABELS[user.site_language] || 'English')
    : 'the same language as the user';

  return `Detect the language of the latest user message and reply in that same language. If the language is ambiguous, fall back to ${fallbackLanguage}.`;
}

function buildSiteKnowledge() {
  const team = getPublicTeamSnapshot();
  const founderList = team.founders.length ? team.founders.join(', ') : 'none';
  const adminList = team.admins.length ? team.admins.join(', ') : 'none';

  return `SITE KNOWLEDGE:
- Product name: DiscordForger.
- Primary founder: ${team.primaryFounder}.
- Other active founders: ${founderList}.
- Active admins: ${adminList}.

PLATFORM SECTIONS (complete list):
- **Dashboard**: Overview with server stats, bot status, quick actions.
- **Servers**: List all connected Discord servers, select active server, manage connections.
- **Team**: Manage collaborators, invite admins, assign roles, manage snapshots.
- **Protection**: Security modules (anti-raid, anti-spam, anti-link, anti-mention, anti-caps, anti-invite, verification, auto-mod). Each module has simple and advanced config.
- **Search (Recherche & Actions)**: Look up any Discord user by ID/username, view full profile, execute direct moderation actions (warn, timeout, kick, ban/unban, DM).
- **Logs & Historique**: Three tabs — Site Logs (moderation actions from dashboard), Warning Logs (all warnings), Discord Logs (audit log events). Supports search, filters by action type/date/level.
- **Messages & Notifications**: Send DMs to server members via bot. Configure auto-DM notifications for warn/timeout/kick/ban/blacklist. Set appeal server info.
- **Access Control (Controle d'Acces)**: View and manage server bans and network blacklist. Unban users, remove from blacklist. Auto-refresh.
- **Commands**: Create custom bot commands (prefix or slash). AI-assisted command creation and editing. Toggle commands on/off.
- **Analytics**: Server statistics, growth metrics, member activity.
- **AI Assistant**: This assistant — can execute real platform actions, answer questions, help with any task.
- **Settings**: User preferences, language, AI language, account settings.
- **Admin Panel**: User management, role assignment, AI provider configuration, provider API keys.

BOT FEATURES:
- Custom bot token per user (encrypted, stored securely).
- Bot can be started, stopped, restarted from the dashboard.
- Slash commands and prefix commands synced automatically.
- Moderation actions: warn, timeout, kick, ban, unban, blacklist.
- Auto-escalation: warnings can auto-escalate to timeout/kick/ban based on count.
- DM notifications sent automatically on moderation actions.
- Security modules protect against raids, spam, unwanted links, mass mentions, etc.
- Guild sync keeps server list and member counts up to date.

MODERATION SYSTEM:
- Warnings have points (default 1). Multiple warnings can trigger escalation.
- Timeout supports duration in ms. Common durations: 5min=300000, 10min=600000, 1h=3600000, 1d=86400000, 1w=604800000.
- Bans can be issued with or without message deletion.
- Blacklist is network-wide (across all user's servers).

IDENTITY RULES:
- You are DiscordForger Assistant, created for DiscordForger by ${team.primaryFounder} and the DiscordForger team.
- If asked who created you, who made the site, or who built the assistant, answer with ${team.primaryFounder} and the DiscordForger team. Never answer with Google, OpenAI, Anthropic, xAI, Groq, Mistral, Together, DeepSeek, OpenRouter, or Perplexity. Those are only external AI providers.
- You can mention public role information about founders and admins using usernames only.

PRIVACY RULES:
- Never reveal emails, passwords, bot tokens, API keys, JWTs, encryption secrets, raw user IDs, IP addresses, device fingerprints, private logs, database rows, hidden configuration values, or internal security data.
- Never reveal private staff information beyond public usernames and roles.
- If a user asks for secrets, private infrastructure details, or restricted data, refuse clearly and say that this information is protected.`;
}

function buildFocusedGuildKnowledge(focusedGuild) {
  if (!focusedGuild) {
    return 'ACTIVE GUILD CONTEXT:\n- No active server selected right now.\n';
  }

  return `ACTIVE GUILD CONTEXT:
- Current focused server: "${focusedGuild.name}".
- Internal guild id: ${focusedGuild.id}.
- Discord guild id: ${focusedGuild.guild_id}.
- Member count: ${focusedGuild.member_count || 0}.
- Use this server as the default target when the user clearly refers to "my server", "this server", or the current dashboard context.
`;
}

function buildSystemPrompt(user, guilds, focusedGuild = null) {
  const guildList = guilds
    .map((guild) => `- "${guild.name}" (ID: ${guild.id}, Discord ID: ${guild.guild_id}, Members: ${guild.member_count})`)
    .join('\n');

  const varietySeed = Math.random().toString(36).slice(2, 12) + '-' + Date.now().toString(36);
  const toneVariants = [
    'Be enthusiastic and encouraging.',
    'Be calm, professional, and direct.',
    'Be witty and conversational.',
    'Be helpful with a touch of humor.',
    'Be precise and efficient.',
    'Be warm and supportive.',
    'Be creative and suggest improvements.',
    'Be concise but thorough.',
  ];
  const toneDirective = toneVariants[Math.floor(Math.random() * toneVariants.length)];

  return `You are an intelligent, context-aware AI assistant for a Discord Bot Management SaaS platform called DiscordForger.
You help users manage their Discord bots, configure security modules, moderate servers, build server structures, and perform administrative actions.
You are knowledgeable about every feature of the platform and can guide users through any task.

Current user: ${user.username} (role: ${user.role})
Their guilds (servers):
${guildList || '(none)'}

VARIETY SEED: ${varietySeed}
TONE: ${toneDirective}

${buildFocusedGuildKnowledge(focusedGuild)}
${buildSiteKnowledge()}

You can execute the following REAL ACTIONS by responding with a JSON action block:

\`\`\`action
{
  "action": "ACTION_NAME",
  "params": { ... }
}
\`\`\`

Available actions:
- toggle_module: { guildId, moduleType, enabled } — Enable/disable a security module
- update_module_config: { guildId, moduleType, simple_config?, advanced_config? } — Update module settings
- add_warning: { guildId, targetUserId, targetUsername, reason, points } — Issue a warning
- kick_user: { guildId, targetUserId, reason } — Kick a member
- ban_user: { guildId, targetUserId, reason } — Ban a member
- timeout_user: { guildId, targetUserId, durationMs, reason } — Timeout a member
- leave_guild: { guildId } — Make the bot leave a server
- start_bot: {} — Start the bot
- stop_bot: {} — Stop the bot
- restart_bot: {} — Restart the bot
- sync_guilds: {} — Synchronize all guild data
- server_builder: { guildId, structure } — Build a complete server structure. structure is an object with:
  - categories: array of { name, channels: [{ name, type: "text"|"voice"|"announcement"|"forum"|"stage" }] }
  - roles: array of { name, color (hex), permissions?: string[], hoist?: boolean, mentionable?: boolean }
  - cleanup_existing?: boolean (if true, delete ALL existing channels and non-managed roles first, then rebuild from scratch)
- server_clone: { sourceGuildId, targetGuildId, cleanup_target?: boolean } — Clone server structure (roles, channels, categories, topics, nsfw flags) from source to target. If cleanup_target is true, wipes target first.
- create_channels: { guildId, channels } — Create specific channels. channels is array of { name, type, category? }
- create_roles: { guildId, roles } — Create specific roles. roles is array of { name, color, hoist?, mentionable? }
- delete_channels: { guildId, channelNames } — Delete channels by name. channelNames is array of strings.
- delete_roles: { guildId, roleNames } — Delete roles by name. roleNames is array of strings.
- rename_channels: { guildId, renames } — Rename channels. renames is array of { oldName, newName }.
- send_announcement: { guildId, channelName, message, embed? } — Send a message (and optional embed) to a named channel.
- mass_role_assign: { guildId, roleName, action } — action is "add" or "remove". Applies/removes a role to/from ALL members.

RULES:
1. Always explain what you're about to do before executing.
2. For destructive actions (ban, kick, leave_guild, server_builder with cleanup_existing, delete_channels, delete_roles), explicitly mention what will happen and ask for confirmation unless the user has already confirmed.
3. If a user asks about a feature or setting, explain it clearly and in detail. You know every section of the platform.
4. When referencing guilds, use their name (not raw IDs) in your response text.
5. You have access to the full platform to help with safe, authorized tasks only.
6. Be concise but helpful. Vary your tone and phrasing — never repeat the same response structure. Use variety seed ${varietySeed} for uniqueness.
7. If an action is unclear, ask for clarification.
8. ${buildLanguageInstruction(user)}
9. Never expose private or security-sensitive information, even if the user asks.
10. For obvious bot power requests, always execute the action even if the user writes in uppercase, with typos, or with short wording.
11. Treat phrases like "eteins la bot", "arrete le bot", "rallume le", "allume le", "demare le bot", and "redemarre le bot" as clear bot control requests and include the correct action block.
12. For server_builder, interactively ask the user what they want (categories, channels, voice channels, roles) if they haven't specified. Build a complete, clean, organized structure. Propose a detailed plan and ask for confirmation before executing.
13. For server_clone, verify both guilds are accessible before proceeding. Warn the user if cleanup_target is true.
14. VARIETY: Every response must feel unique. Never use the same opening, structure, or phrasing twice in a row. Be creative, intelligent, and dynamic. ${toneDirective}
15. For content-generation tasks (jokes, facts, tips), use genuine randomness and creativity. Never repeat the same content.
16. For send_announcement, find the channel by name in the guild and send the message.
17. For mass_role_assign, warn the user about the scope of the action before executing.
18. You are specialized in Discord operations, DiscordForger workflows, command design, moderation systems, embeds, server organization, and dashboard guidance. Stay focused on those areas instead of answering unrelated weird requests.
19. If the user asks for help, return a structured, practical guide tailored to DiscordForger and the active server context.
20. If the user asks for a complex panel, workflow, or automation, think in steps: clarify the goal, choose the best DiscordForger path, explain the plan, then execute only what is truly supported.
21. Refuse requests that aim to extract secrets, bypass permissions, abuse members, or manipulate the platform outside authorized usage.

Respond naturally in markdown. Only include one action block per response.`;
}

function buildSiteKnowledge() {
  const team = getPublicTeamSnapshot();
  const founderList = team.founders.length ? team.founders.join(', ') : 'aucun';
  const adminList = team.admins.length ? team.admins.join(', ') : 'aucun';

  return `PLATFORM:
- Produit: DiscordForger
- Fondateur principal: ${team.primaryFounder}
- Fondateurs actifs: ${founderList}
- Admins actifs: ${adminList}
- Sections: Dashboard, Serveurs, Equipe, Protection, Search, Logs, Messages, Notifications, Controle d Acces, Commandes, Analytics, Scan, Centre DM, Incidents, Roles et Onboarding, Assistant IA, Parametres, Panel Admin
- Capacites: moderation, protection, logs, messages prives, commandes, scan, incidents, tickets, gestion du bot, construction ou clonage de serveur
- Regles: jamais de secret, jamais de donnees privees, jamais de contournement de permissions.`;
}

function buildFocusedGuildKnowledge(focusedGuild) {
  if (!focusedGuild) {
    return 'SERVEUR ACTIF:\n- Aucun serveur selectionne.\n';
  }

  return `SERVEUR ACTIF:
- Nom: ${focusedGuild.name}
- Id interne: ${focusedGuild.id}
- Id Discord: ${focusedGuild.guild_id}
- Membres: ${focusedGuild.member_count || 0}
- Utilise ce serveur par defaut si la demande vise ce serveur.
`;
}

function buildSystemPrompt(user, guilds, focusedGuild = null) {
  const guildList = buildGuildSummary(guilds);

  return `Tu es l assistant IA de DiscordForger.

UTILISATEUR:
- Pseudo site: ${user.username}
- Role site: ${user.role}
- ${buildLinkedDiscordState(user)}
- Espaces accessibles:
${guildList}

${buildFocusedGuildKnowledge(focusedGuild)}
${buildSiteKnowledge()}

ACTION BLOCK UNIQUE:
\`\`\`action
{"action":"ACTION_NAME","params":{}}
\`\`\`

ACTIONS REELLES:
- toggle_module { guildId, moduleType, enabled }
- update_module_config { guildId, moduleType, simple_config?, advanced_config? }
- add_warning { guildId, targetUserId, targetUsername?, reason, points? }
- kick_user { guildId, targetUserId, reason }
- ban_user { guildId, targetUserId, reason }
- timeout_user { guildId, targetUserId, durationMs, reason }
- leave_guild { guildId }
- start_bot {}
- stop_bot {}
- restart_bot {}
- sync_guilds {}
- server_builder { guildId, structure }
- server_clone { sourceGuildId, targetGuildId, cleanup_target? }
- create_channels { guildId, channels }
- create_roles { guildId, roles }
- delete_channels { guildId, channelNames }
- delete_roles { guildId, roleNames }
- rename_channels { guildId, renames }
- send_announcement { guildId, channelName, message, embed? }
- mass_role_assign { guildId, roleName, action }

REGLES:
1. ${buildLanguageInstruction(user)}
2. Reponds court, clair, utile et personnalise.
3. Suis strictement la demande utilisateur, jamais un mot hors sujet.
4. Si un ID, une raison, une duree ou un serveur manque, pose seulement la ou les questions minimales.
5. Pour warn, timeout, kick ou ban: ne promets jamais le succes sans les infos minimales et sans compte Discord lie.
6. Pour les actions destructrices, demande confirmation si elle n a pas deja ete donnee.
7. Utilise le serveur actif par defaut quand la demande vise ce serveur.
8. N invente jamais un resultat d action. Si l execution echoue, la verite backend prime.
9. N expose jamais de secret, token, cle, email prive ou detail interne sensible.
10. Reste specialise Discord, DiscordForger, moderation, protection, commandes, messages, tickets, roles, structure serveur et gestion du bot.

Reponds en markdown naturel. Un seul action block maximum par reponse.`;
}

function extractAction(text) {
  const match = text.match(/```action\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function normalizeIntentText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasIntent(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

function matchesIntentPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isQuestionLike(rawMessage, normalizedMessage) {
  if (String(rawMessage || '').includes('?')) return true;

  return hasIntent(normalizedMessage, [
    'tu l as',
    'tu la',
    'as tu',
    'est ce que',
    'peux tu',
    'comment ',
    'pourquoi ',
    'quand ',
    'est il',
  ]);
}

function detectImplicitAction(userMessage) {
  const rawMessage = String(userMessage || '').trim();
  const normalizedMessage = normalizeIntentText(rawMessage);
  if (!normalizedMessage) return null;

  if (isQuestionLike(rawMessage, normalizedMessage)) return null;
  if (/\bne\b.*\bpas\b/.test(normalizedMessage)) return null;

  if (matchesIntentPattern(normalizedMessage, [
    /^(vas y )?(merci de )?(redemarre|restart|reboot|relance)\b/,
    /\b(redemarre|restart|reboot|relance)\b.*\b(bot|le bot|la bot|le|la|lui)\b/,
  ])) {
    return { action: 'restart_bot', params: {} };
  }

  if (matchesIntentPattern(normalizedMessage, [
    /^(vas y )?(merci de )?(eteins|eteint|arrete|stop|coupe|shutdown)\b/,
    /\b(eteins|eteint|arrete|stop|coupe|shutdown)\b.*\b(bot|le bot|la bot|le|la|lui)\b/,
    /\b(turn off|power off)\b/,
    /\bmet(s)?\b.*\b(bot|le bot|la bot)\b.*\bhors ligne\b/,
  ])) {
    return { action: 'stop_bot', params: {} };
  }

  if (matchesIntentPattern(normalizedMessage, [
    /^(vas y )?(merci de )?(rallume|allume|demarre|demare|lance|start|reconnecte)\b/,
    /\b(rallume|allume|demarre|demare|lance|start|reconnecte)\b.*\b(bot|le bot|la bot|le|la|lui)\b/,
    /\b(turn on|power on)\b/,
    /\b(remets en route|mets en route)\b/,
  ])) {
    return { action: 'start_bot', params: {} };
  }

  if (hasIntent(normalizedMessage, ['synchronise les serveurs', 'synchronise', 'resynchronise', 'resync', 'sync les serveurs', 'sync serveurs'])) {
    return { action: 'sync_guilds', params: {} };
  }

  return null;
}

function getActionGuildId(actionBlock) {
  return String(
    actionBlock?.params?.guildId
    || actionBlock?.params?.targetGuildId
    || actionBlock?.params?.sourceGuildId
    || ''
  ).trim();
}

function getActionBotOwnerUserId(userId, actionBlock) {
  const guildId = getActionGuildId(actionBlock);
  if (!guildId) return userId;
  const access = findAccessibleGuildRecord(userId, guildId);
  return access?.owner_user_id || userId;
}

function resolveActionGuildContext(userId, guildId) {
  const access = findAccessibleGuildRecord(userId, guildId);
  if (!access) return null;

  const tokenOwnerUserId = access.owner_user_id || access.guild.user_id || userId;
  const tokenRow = db.findOne('bot_tokens', { user_id: tokenOwnerUserId });

  return {
    access,
    guild: access.guild,
    tokenOwnerUserId,
    tokenRow,
  };
}

function buildAssistantModeratorName(user, member) {
  return (
    member?.nick
    || member?.user?.global_name
    || member?.user?.username
    || user?.discord_global_name
    || user?.discord_username
    || user?.username
    || 'Assistant IA'
  );
}

async function executeAction(userId, actionBlock, botToken) {
  const { action, params } = actionBlock;
  const token = decrypt(botToken.encrypted_token);
  logger.info(`AI executing action: ${action}`, { userId, params });

  switch (action) {
    case 'toggle_module': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      const type = params.moduleType?.toUpperCase();
      db.db.prepare('UPDATE modules SET enabled = ?, updated_at = ? WHERE guild_id = ? AND module_type = ?')
        .run(params.enabled ? 1 : 0, new Date().toISOString(), guild.id, type);
      botManager.invalidateModuleCache(userId, guild.guild_id);
      return { success: true, message: `Module ${type} ${params.enabled ? 'enabled' : 'disabled'}` };
    }

    case 'update_module_config': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      const type = params.moduleType?.toUpperCase();
      const existing = db.raw('SELECT * FROM modules WHERE guild_id = ? AND module_type = ?', [guild.id, type])[0];
      if (!existing) return { error: 'Module not found' };

      const currentSimple = JSON.parse(existing.simple_config);
      const currentAdv = JSON.parse(existing.advanced_config);
      db.db.prepare('UPDATE modules SET simple_config = ?, advanced_config = ?, updated_at = ? WHERE id = ?')
        .run(
          JSON.stringify({ ...currentSimple, ...(params.simple_config ?? {}) }),
          JSON.stringify({ ...currentAdv, ...(params.advanced_config ?? {}) }),
          new Date().toISOString(),
          existing.id
        );
      botManager.invalidateModuleCache(userId, guild.guild_id);
      return { success: true, message: `Module ${type} config updated` };
    }

    case 'add_warning': {
      const user = db.findOne('users', { id: userId });
      const guildContext = resolveActionGuildContext(userId, params.guildId);
      if (!guildContext?.guild) return { error: 'Guild not found' };
      if (!guildContext.tokenRow) return { error: 'Bot token missing' };
      const moderationAccess = await resolveLinkedModeratorAccess({
        user,
        guildRow: guildContext.guild,
        botToken: decrypt(guildContext.tokenRow.encrypted_token),
        actionName: action,
      });
      const moderatorName = buildAssistantModeratorName(user, moderationAccess.member);
      await addWarning(
        guildContext.guild.guild_id,
        params.targetUserId,
        params.targetUsername,
        userId,
        moderatorName,
        params.reason,
        params.points ?? 1
      );
      await safeSendModerationDm({
        botToken: decrypt(guildContext.tokenRow.encrypted_token),
        guildRow: guildContext.guild,
        actionType: 'warn',
        targetUserId: params.targetUserId,
        reason: params.reason,
        points: params.points ?? 1,
        moderatorName,
      });
      return { success: true, message: `Avertissement ajoute a ${params.targetUsername || params.targetUserId}` };
    }

    case 'kick_user': {
      const user = db.findOne('users', { id: userId });
      const guildContext = resolveActionGuildContext(userId, params.guildId);
      if (!guildContext?.guild) return { error: 'Guild not found' };
      if (!guildContext.tokenRow) return { error: 'Bot token missing' };
      const actionToken = decrypt(guildContext.tokenRow.encrypted_token);
      const moderationAccess = await resolveLinkedModeratorAccess({
        user,
        guildRow: guildContext.guild,
        botToken: actionToken,
        actionName: action,
      });
      const moderatorName = buildAssistantModeratorName(user, moderationAccess.member);
      await safeSendModerationDm({
        botToken: actionToken,
        guildRow: guildContext.guild,
        actionType: 'kick',
        targetUserId: params.targetUserId,
        reason: params.reason ?? 'Action de l assistant IA',
        moderatorName,
      });
      await discordService.kickMember(actionToken, guildContext.guild.guild_id, params.targetUserId, params.reason ?? 'Action de l assistant IA');
      return { success: true, message: 'Membre expulse' };
    }

    case 'ban_user': {
      const user = db.findOne('users', { id: userId });
      const guildContext = resolveActionGuildContext(userId, params.guildId);
      if (!guildContext?.guild) return { error: 'Guild not found' };
      if (!guildContext.tokenRow) return { error: 'Bot token missing' };
      const actionToken = decrypt(guildContext.tokenRow.encrypted_token);
      const moderationAccess = await resolveLinkedModeratorAccess({
        user,
        guildRow: guildContext.guild,
        botToken: actionToken,
        actionName: action,
      });
      const moderatorName = buildAssistantModeratorName(user, moderationAccess.member);
      await safeSendModerationDm({
        botToken: actionToken,
        guildRow: guildContext.guild,
        actionType: 'ban',
        targetUserId: params.targetUserId,
        reason: params.reason ?? 'Action de l assistant IA',
        moderatorName,
      });
      await discordService.banMember(actionToken, guildContext.guild.guild_id, params.targetUserId, params.reason ?? 'Action de l assistant IA');
      return { success: true, message: 'Membre banni' };
    }

    case 'timeout_user': {
      const user = db.findOne('users', { id: userId });
      const guildContext = resolveActionGuildContext(userId, params.guildId);
      if (!guildContext?.guild) return { error: 'Guild not found' };
      if (!guildContext.tokenRow) return { error: 'Bot token missing' };
      const actionToken = decrypt(guildContext.tokenRow.encrypted_token);
      const moderationAccess = await resolveLinkedModeratorAccess({
        user,
        guildRow: guildContext.guild,
        botToken: actionToken,
        actionName: action,
      });
      const moderatorName = buildAssistantModeratorName(user, moderationAccess.member);
      await discordService.timeoutMember(
        actionToken,
        guildContext.guild.guild_id,
        params.targetUserId,
        params.durationMs,
        params.reason ?? 'Action de l assistant IA'
      );
      await safeSendModerationDm({
        botToken: actionToken,
        guildRow: guildContext.guild,
        actionType: 'timeout',
        targetUserId: params.targetUserId,
        reason: params.reason ?? 'Action de l assistant IA',
        durationMs: params.durationMs,
        moderatorName,
      });
      return { success: true, message: 'Timeout applique' };
    }

    case 'leave_guild': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      await discordService.leaveGuild(token, guild.guild_id);
      db.db.prepare('UPDATE guilds SET is_active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), guild.id);
      return { success: true, message: 'Bot left the server' };
    }

    case 'start_bot':
      await botManager.startBot(userId);
      return { success: true, message: 'Bot starting...' };

    case 'stop_bot':
      await botManager.stopBot(userId);
      return { success: true, message: 'Bot stopped' };

    case 'restart_bot':
      await botManager.restartBot(userId);
      return { success: true, message: 'Bot restarting...' };

    case 'sync_guilds': {
      const proc = botManager.getProcess(userId);
      if (!proc?.client) return { error: 'Bot is not running' };
      const { syncGuildsForUser } = require('./guildSyncService');
      await syncGuildsForUser(userId, proc.client, token);
      return { success: true, message: 'Guilds synced' };
    }

    case 'server_builder': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      const structure = params.structure;
      if (!structure) return { error: 'No structure provided' };

      const results = { categories: 0, channels: 0, roles: 0, deleted: { channels: 0, roles: 0 }, errors: [] };

      try {
        // Cleanup existing channels and roles if requested
        if (structure.cleanup_existing) {
          try {
            const existingChannels = await discordService.getGuildChannels(token, guild.guild_id);
            const existingRoles = await discordService.getGuildRoles(token, guild.guild_id);

            // Delete all channels (categories last since they contain children)
            const nonCategories = existingChannels.filter(c => c.type !== 4);
            const categories = existingChannels.filter(c => c.type === 4);

            for (const ch of nonCategories) {
              try {
                await discordService.deleteChannel(token, ch.id, 'Server Builder cleanup');
                results.deleted.channels++;
              } catch (err) {
                results.errors.push(`Delete channel "${ch.name}": ${err.message}`);
              }
            }
            for (const cat of categories) {
              try {
                await discordService.deleteChannel(token, cat.id, 'Server Builder cleanup');
                results.deleted.channels++;
              } catch (err) {
                results.errors.push(`Delete category "${cat.name}": ${err.message}`);
              }
            }

            // Delete non-managed, non-@everyone roles
            const deletableRoles = existingRoles.filter(r => !r.managed && r.name !== '@everyone');
            for (const role of deletableRoles) {
              try {
                await discordService.deleteRole(token, guild.guild_id, role.id, 'Server Builder cleanup');
                results.deleted.roles++;
              } catch (err) {
                results.errors.push(`Delete role "${role.name}": ${err.message}`);
              }
            }
          } catch (err) {
            results.errors.push(`Cleanup phase failed: ${err.message}`);
          }
        }

        // Create roles
        if (structure.roles && Array.isArray(structure.roles)) {
          for (const role of structure.roles) {
            try {
              await discordService.createRole(token, guild.guild_id, {
                name: role.name,
                color: role.color ? parseInt(role.color.replace('#', ''), 16) : 0,
                hoist: role.hoist || false,
                mentionable: role.mentionable || false,
              });
              results.roles++;
            } catch (err) {
              results.errors.push(`Role "${role.name}": ${err.message}`);
            }
          }
        }

        // Create categories and their channels
        if (structure.categories && Array.isArray(structure.categories)) {
          for (const category of structure.categories) {
            try {
              const catChannel = await discordService.createChannel(token, guild.guild_id, {
                name: category.name,
                type: 4,
              });
              results.categories++;

              if (category.channels && Array.isArray(category.channels)) {
                for (const ch of category.channels) {
                  try {
                    const channelType = ch.type === 'voice' ? 2 : ch.type === 'announcement' ? 5 : ch.type === 'forum' ? 15 : ch.type === 'stage' ? 13 : 0;
                    await discordService.createChannel(token, guild.guild_id, {
                      name: ch.name,
                      type: channelType,
                      parent_id: catChannel.id,
                    });
                    results.channels++;
                  } catch (err) {
                    results.errors.push(`Channel "${ch.name}": ${err.message}`);
                  }
                }
              }
            } catch (err) {
              results.errors.push(`Category "${category.name}": ${err.message}`);
            }
          }
        }
      } catch (err) {
        return { error: `Server builder failed: ${err.message}` };
      }

      const cleanupInfo = structure.cleanup_existing
        ? `Cleaned up ${results.deleted.channels} channels and ${results.deleted.roles} roles. `
        : '';
      const summary = `${cleanupInfo}Created ${results.roles} roles, ${results.categories} categories, ${results.channels} channels`;
      if (results.errors.length > 0) {
        return { success: true, message: `${summary}. ${results.errors.length} error(s): ${results.errors.slice(0, 5).join('; ')}` };
      }
      return { success: true, message: summary };
    }

    case 'server_clone': {
      const sourceGuild = db.findOne('guilds', { id: params.sourceGuildId, user_id: userId });
      const targetGuild = db.findOne('guilds', { id: params.targetGuildId, user_id: userId });
      if (!sourceGuild) return { error: 'Source guild not found' };
      if (!targetGuild) return { error: 'Target guild not found' };

      const results = { roles: 0, categories: 0, channels: 0, deleted: { channels: 0, roles: 0 }, errors: [] };

      try {
        // Optional: cleanup target before cloning
        if (params.cleanup_target) {
          try {
            const targetChannels = await discordService.getGuildChannels(token, targetGuild.guild_id);
            const targetRoles = await discordService.getGuildRoles(token, targetGuild.guild_id);

            for (const ch of targetChannels) {
              try {
                await discordService.deleteChannel(token, ch.id, 'Server Clone cleanup');
                results.deleted.channels++;
              } catch (err) {
                results.errors.push(`Delete "${ch.name}": ${err.message}`);
              }
            }

            for (const role of targetRoles.filter(r => !r.managed && r.name !== '@everyone')) {
              try {
                await discordService.deleteRole(token, targetGuild.guild_id, role.id, 'Server Clone cleanup');
                results.deleted.roles++;
              } catch (err) {
                results.errors.push(`Delete role "${role.name}": ${err.message}`);
              }
            }
          } catch (err) {
            results.errors.push(`Target cleanup failed: ${err.message}`);
          }
        }

        const sourceChannels = await discordService.getGuildChannels(token, sourceGuild.guild_id);
        const sourceRoles = await discordService.getGuildRoles(token, sourceGuild.guild_id);

        // Clone roles (sorted by position, highest first for hierarchy)
        const userRoles = sourceRoles.filter(r => !r.managed && r.name !== '@everyone').sort((a, b) => b.position - a.position);
        for (const role of userRoles) {
          try {
            await discordService.createRole(token, targetGuild.guild_id, {
              name: role.name,
              color: role.color || 0,
              hoist: role.hoist || false,
              mentionable: role.mentionable || false,
            });
            results.roles++;
          } catch (err) {
            results.errors.push(`Role "${role.name}": ${err.message}`);
          }
        }

        // Clone categories first
        const srcCategories = sourceChannels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
        const categoryMap = new Map();
        for (const cat of srcCategories) {
          try {
            const newCat = await discordService.createChannel(token, targetGuild.guild_id, {
              name: cat.name,
              type: 4,
            });
            categoryMap.set(cat.id, newCat.id);
            results.categories++;
          } catch (err) {
            results.errors.push(`Category "${cat.name}": ${err.message}`);
          }
        }

        // Clone non-category channels with topic & nsfw preservation
        const nonCategories = sourceChannels.filter(c => c.type !== 4).sort((a, b) => a.position - b.position);
        for (const ch of nonCategories) {
          try {
            const opts = {
              name: ch.name,
              type: ch.type,
            };
            if (ch.parent_id && categoryMap.has(ch.parent_id)) {
              opts.parent_id = categoryMap.get(ch.parent_id);
            }
            if (ch.topic) opts.topic = ch.topic;
            if (ch.nsfw) opts.nsfw = ch.nsfw;
            if (ch.rate_limit_per_user) opts.rate_limit_per_user = ch.rate_limit_per_user;
            if (ch.bitrate && ch.type === 2) opts.bitrate = ch.bitrate;
            if (ch.user_limit && ch.type === 2) opts.user_limit = ch.user_limit;
            await discordService.createChannel(token, targetGuild.guild_id, opts);
            results.channels++;
          } catch (err) {
            results.errors.push(`Channel "${ch.name}": ${err.message}`);
          }
        }
      } catch (err) {
        return { error: `Server clone failed: ${err.message}` };
      }

      const cleanupInfo = params.cleanup_target
        ? `Cleaned up ${results.deleted.channels} channels and ${results.deleted.roles} roles. `
        : '';
      const summary = `${cleanupInfo}Cloned ${results.roles} roles, ${results.categories} categories, ${results.channels} channels`;
      if (results.errors.length > 0) {
        return { success: true, message: `${summary}. ${results.errors.length} error(s): ${results.errors.slice(0, 5).join('; ')}` };
      }
      return { success: true, message: summary };
    }

    case 'create_channels': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.channels || !Array.isArray(params.channels)) return { error: 'No channels provided' };

      let created = 0;
      const errors = [];
      for (const ch of params.channels) {
        try {
          const channelType = ch.type === 'voice' ? 2 : ch.type === 'announcement' ? 5 : ch.type === 'forum' ? 15 : ch.type === 'stage' ? 13 : ch.type === 'category' ? 4 : 0;
          await discordService.createChannel(token, guild.guild_id, {
            name: ch.name,
            type: channelType,
            parent_id: ch.parent_id || undefined,
          });
          created++;
        } catch (err) {
          errors.push(`"${ch.name}": ${err.message}`);
        }
      }

      return { success: true, message: `Created ${created}/${params.channels.length} channels${errors.length ? `. Errors: ${errors.slice(0, 3).join('; ')}` : ''}` };
    }

    case 'create_roles': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.roles || !Array.isArray(params.roles)) return { error: 'No roles provided' };

      let created = 0;
      const errors = [];
      for (const role of params.roles) {
        try {
          await discordService.createRole(token, guild.guild_id, {
            name: role.name,
            color: role.color ? parseInt(String(role.color).replace('#', ''), 16) : 0,
            hoist: role.hoist || false,
            mentionable: role.mentionable || false,
          });
          created++;
        } catch (err) {
          errors.push(`"${role.name}": ${err.message}`);
        }
      }

      return { success: true, message: `Created ${created}/${params.roles.length} roles${errors.length ? `. Errors: ${errors.slice(0, 3).join('; ')}` : ''}` };
    }

    case 'delete_channels': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.channelNames || !Array.isArray(params.channelNames)) return { error: 'No channel names provided' };

      const existingChannels = await discordService.getGuildChannels(token, guild.guild_id);
      const nameLower = params.channelNames.map(n => String(n).toLowerCase());
      const toDelete = existingChannels.filter(ch => nameLower.includes(ch.name.toLowerCase()));

      let deleted = 0;
      const errors = [];
      for (const ch of toDelete) {
        try {
          await discordService.deleteChannel(token, ch.id, 'AI Agent action');
          deleted++;
        } catch (err) {
          errors.push(`"${ch.name}": ${err.message}`);
        }
      }

      return { success: true, message: `Deleted ${deleted}/${params.channelNames.length} channels${errors.length ? `. Errors: ${errors.slice(0, 3).join('; ')}` : ''}` };
    }

    case 'delete_roles': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.roleNames || !Array.isArray(params.roleNames)) return { error: 'No role names provided' };

      const existingRoles = await discordService.getGuildRoles(token, guild.guild_id);
      const nameLower = params.roleNames.map(n => String(n).toLowerCase());
      const toDelete = existingRoles.filter(r => !r.managed && r.name !== '@everyone' && nameLower.includes(r.name.toLowerCase()));

      let deleted = 0;
      const errors = [];
      for (const role of toDelete) {
        try {
          await discordService.deleteRole(token, guild.guild_id, role.id, 'AI Agent action');
          deleted++;
        } catch (err) {
          errors.push(`"${role.name}": ${err.message}`);
        }
      }

      return { success: true, message: `Deleted ${deleted}/${params.roleNames.length} roles${errors.length ? `. Errors: ${errors.slice(0, 3).join('; ')}` : ''}` };
    }

    case 'rename_channels': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.renames || !Array.isArray(params.renames)) return { error: 'No renames provided' };

      const existingChannels = await discordService.getGuildChannels(token, guild.guild_id);
      let renamed = 0;
      const errors = [];

      for (const { oldName, newName } of params.renames) {
        const channel = existingChannels.find(ch => ch.name.toLowerCase() === String(oldName || '').toLowerCase());
        if (!channel) {
          errors.push(`Channel "${oldName}" not found`);
          continue;
        }
        try {
          await discordService.modifyChannel(token, channel.id, { name: newName }, 'AI Agent rename');
          renamed++;
        } catch (err) {
          errors.push(`"${oldName}": ${err.message}`);
        }
      }

      return { success: true, message: `Renamed ${renamed}/${params.renames.length} channels${errors.length ? `. Errors: ${errors.slice(0, 3).join('; ')}` : ''}` };
    }

    case 'send_announcement': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.channelName && !params.channelId) return { error: 'No channel specified' };

      let channelId = params.channelId;
      if (!channelId && params.channelName) {
        const existingChannels = await discordService.getGuildChannels(token, guild.guild_id);
        const found = existingChannels.find(ch => ch.name.toLowerCase() === String(params.channelName).toLowerCase());
        if (!found) return { error: `Channel "${params.channelName}" not found` };
        channelId = found.id;
      }

      const payload = {};
      if (params.message) payload.content = params.message;
      if (params.embed) {
        payload.embeds = [{
          title: params.embed.title || undefined,
          description: params.embed.description || params.message || undefined,
          color: params.embed.color ? parseInt(String(params.embed.color).replace('#', ''), 16) : 0x22d3ee,
          footer: params.embed.footer ? { text: params.embed.footer } : undefined,
          timestamp: new Date().toISOString(),
        }];
        if (payload.embeds[0] && payload.content) delete payload.content;
      }

      try {
        await discordService.sendMessage(token, channelId, payload);
        return { success: true, message: `Announcement sent to #${params.channelName || channelId}` };
      } catch (err) {
        return { error: `Failed to send announcement: ${err.message}` };
      }
    }

    case 'mass_role_assign': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      if (!params.roleName) return { error: 'No role name provided' };

      const existingRoles = await discordService.getGuildRoles(token, guild.guild_id);
      const targetRole = existingRoles.find(r => r.name.toLowerCase() === String(params.roleName).toLowerCase());
      if (!targetRole) return { error: `Role "${params.roleName}" not found` };

      // Fetch members (limited to first batch for safety)
      const members = await discordService.getGuildMembers(token, guild.guild_id, 1000);
      let affected = 0;
      const errors = [];
      const action = params.action === 'remove' ? 'remove' : 'add';

      for (const member of members) {
        if (member.user?.bot) continue;
        const hasRole = member.roles?.includes(targetRole.id);

        if (action === 'add' && !hasRole) {
          try {
            await discordService.addRole(token, guild.guild_id, member.user.id, targetRole.id, 'AI Agent mass assign');
            affected++;
          } catch (err) {
            errors.push(`${member.user?.username || member.user?.id}: ${err.message}`);
          }
        }
        if (action === 'remove' && hasRole) {
          try {
            await discordService.removeRole(token, guild.guild_id, member.user.id, targetRole.id, 'AI Agent mass remove');
            affected++;
          } catch (err) {
            errors.push(`${member.user?.username || member.user?.id}: ${err.message}`);
          }
        }
      }

      return { success: true, message: `${action === 'add' ? 'Added' : 'Removed'} role "${params.roleName}" for ${affected} members${errors.length ? `. ${errors.length} issue(s)` : ''}` };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

async function requestAnthropicChat(aiConfig, systemPrompt, messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': aiConfig.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: aiConfig.model,
      max_tokens: aiConfig.maxTokens,
      temperature: aiConfig.temperature,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    await throwProviderError('anthropic', response, aiConfig.model);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';
  return {
    text,
    usage: normalizeTokenUsage(
      {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
      buildPromptText(systemPrompt, messages),
      text
    ),
  };
}

async function requestOpenAICompatibleChat(aiConfig, systemPrompt, messages) {
  const providerCatalog = getProviderCatalog(aiConfig.provider);
  if (!providerCatalog?.baseUrl) {
    throw Object.assign(new Error(`Unsupported AI provider: ${aiConfig.provider}`), { status: 400 });
  }

  const response = await fetch(providerCatalog.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${aiConfig.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: aiConfig.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: aiConfig.maxTokens,
      temperature: aiConfig.temperature,
    }),
  });

  if (!response.ok) {
    await throwProviderError(aiConfig.provider, response, aiConfig.model);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return {
    text,
    usage: normalizeTokenUsage(
      {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      buildPromptText(systemPrompt, messages),
      text
    ),
  };
}

async function requestGeminiChat(aiConfig, systemPrompt, messages) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: aiConfig.maxTokens,
          temperature: aiConfig.temperature,
        },
      }),
    }
  );

  if (!response.ok) {
    await throwProviderError('gemini', response, aiConfig.model);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return {
    text,
    usage: normalizeTokenUsage(
      {
        promptTokenCount: data.usageMetadata?.promptTokenCount,
        candidateTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
      buildPromptText(systemPrompt, messages),
      text
    ),
  };
}

async function requestGeminiImage(imageConfig, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${imageConfig.model}:generateContent?key=${imageConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    }
  );

  if (!response.ok) {
    await throwProviderError('gemini', response, imageConfig.model);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part?.inlineData?.data);
  const textPart = parts.find((part) => typeof part?.text === 'string' && part.text.trim());

  if (!imagePart?.inlineData?.data) {
    throw Object.assign(new Error('Aucune image generee par le fournisseur IA.'), { status: 502 });
  }

  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  const base64 = imagePart.inlineData.data;
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return {
    image: {
      mimeType,
      dataUrl,
      prompt,
      model: imageConfig.model,
    },
    text: String(textPart?.text || '').trim(),
    usage: normalizeTokenUsage(
      {
        promptTokenCount: data?.usageMetadata?.promptTokenCount,
        candidateTokens: data?.usageMetadata?.candidatesTokenCount,
        totalTokens: data?.usageMetadata?.totalTokenCount,
      },
      prompt,
      textPart?.text || '[image]'
    ),
  };
}

async function completeConversation(userId, { systemPrompt, messages }) {
  const aiConfig = getAIConfig();
  if (!aiConfig) {
    throw Object.assign(new Error('AI not configured - contact the founder to set an API key.'), { status: 503 });
  }

  const user = db.findOne('users', { id: userId });
  const estimatedPromptTokens = estimateTokenCount(buildPromptText(systemPrompt, messages));
  ensureQuotaAvailable(user, userId, aiConfig, estimatedPromptTokens);

  let providerResult;
  try {
    if (aiConfig.provider === 'anthropic') {
      providerResult = await requestAnthropicChat(aiConfig, systemPrompt, messages);
    } else if (aiConfig.provider === 'gemini') {
      providerResult = await requestGeminiChat(aiConfig, systemPrompt, messages);
    } else if (getProviderCatalog(aiConfig.provider)?.apiStyle === 'openai') {
      providerResult = await requestOpenAICompatibleChat(aiConfig, systemPrompt, messages);
    } else {
      throw new Error('Unsupported AI provider');
    }
  } catch (error) {
    if (aiConfig.providerKeyId && error?.providerKeyStatus) {
      aiProviderKeyService.markProviderKeyStatus(aiConfig.providerKeyId, error.providerKeyStatus, error.message);
    }
    throw error;
  }

  if (aiConfig.providerKeyId) {
    aiProviderKeyService.markProviderKeyStatus(aiConfig.providerKeyId, 'valid', 'Key used successfully.');
    aiProviderKeyService.markProviderKeyUsed(aiConfig.providerKeyId);
  }

  const quota = recordQuotaUsage(userId, aiConfig, providerResult.usage);

  return {
    text: providerResult.text,
    usage: providerResult.usage,
    quota,
    aiConfig,
    user,
  };
}

async function chat(userId, userMessage, conversationHistory = [], guildId = null) {
  const user = db.findOne('users', { id: userId });
  const guilds = db.findMany('guilds', { user_id: userId, is_active: 1 });
  const focusedGuild = guildId
    ? db.raw(
      `SELECT g.*
       FROM guilds g
       LEFT JOIN guild_access_members gam ON gam.guild_id = g.id AND gam.user_id = ?
       WHERE g.id = ?
         AND g.is_active = 1
         AND (g.user_id = ? OR gam.user_id IS NOT NULL)
       LIMIT 1`,
      [userId, guildId, userId]
    )[0] || null
    : null;

  const systemPrompt = buildSystemPrompt(user, guilds, focusedGuild);
  const messages = [
    ...conversationHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];

  const completion = await completeConversation(userId, { systemPrompt, messages });

  let actionResult = null;
  const actionBlock = extractAction(completion.text) || detectImplicitAction(userMessage);
  if (actionBlock) {
    const tokenRow = db.findOne('bot_tokens', { user_id: userId });
    if (tokenRow) {
      actionResult = await executeAction(userId, actionBlock, tokenRow).catch((error) => ({ error: error.message }));
    } else {
      actionResult = { error: 'Bot token missing' };
    }
  }

  const cleanText = completion.text.replace(/```action[\s\S]*?```/g, '').trim();

  return {
    message: cleanText,
    actionExecuted: actionBlock ? { action: actionBlock.action, result: actionResult } : null,
    usage: completion.usage,
    quota: completion.quota,
  };
}

function normalizePendingAction(actionBlock, guildId = null) {
  if (!actionBlock || typeof actionBlock !== 'object') return null;
  const nextAction = {
    action: String(actionBlock.action || '').trim(),
    params: actionBlock.params && typeof actionBlock.params === 'object'
      ? { ...actionBlock.params }
      : {},
  };

  if (!nextAction.action) return null;

  if (
    guildId
    && !nextAction.params.guildId
    && !nextAction.params.targetGuildId
    && !nextAction.params.sourceGuildId
  ) {
    nextAction.params.guildId = guildId;
  }

  return nextAction;
}

async function executeAssistantActionFlow(userId, actionBlock, { guildId = null, fallbackMessage = '' } = {}) {
  const normalizedAction = normalizePendingAction(actionBlock, guildId);
  if (!normalizedAction) {
    return {
      message: 'Action IA invalide.',
      actionExecuted: null,
      requiresDiscordLink: false,
      pendingAction: null,
    };
  }

  if (SENSITIVE_ASSISTANT_ACTIONS.has(normalizedAction.action) && !normalizedAction.params.guildId) {
    return {
      message: buildMissingGuildMessage(),
      actionExecuted: {
        action: normalizedAction.action,
        result: { error: 'Serveur actif manquant', code: 'MISSING_GUILD_CONTEXT' },
      },
      requiresDiscordLink: false,
      pendingAction: null,
    };
  }

  const tokenOwnerUserId = getActionBotOwnerUserId(userId, normalizedAction);
  const tokenRow = db.findOne('bot_tokens', { user_id: tokenOwnerUserId });
  if (!tokenRow) {
    return {
      message: 'Aucun token de bot valide n est disponible pour executer cette action.',
      actionExecuted: {
        action: normalizedAction.action,
        result: { error: 'Bot token missing', code: 'NO_BOT_TOKEN' },
      },
      requiresDiscordLink: false,
      pendingAction: null,
    };
  }

  try {
    const actionResult = await executeAction(userId, normalizedAction, tokenRow);
    return {
      message: fallbackMessage && !actionResult?.error
        ? fallbackMessage
        : buildActionResultMessage(normalizedAction, actionResult, fallbackMessage),
      actionExecuted: { action: normalizedAction.action, result: actionResult },
      requiresDiscordLink: false,
      pendingAction: null,
    };
  } catch (error) {
    const result = { error: error.message, code: error.code || null };
    if (error.code === 'DISCORD_LINK_REQUIRED') {
      return {
        message: buildLinkRequiredMessage(normalizedAction),
        actionExecuted: { action: normalizedAction.action, result },
        requiresDiscordLink: true,
        pendingAction: normalizedAction,
      };
    }

    if (error.code === 'DISCORD_PERMISSION_DENIED' || error.code === 'DISCORD_LINK_NOT_IN_GUILD') {
      return {
        message: error.code === 'DISCORD_PERMISSION_DENIED'
          ? buildPermissionDeniedMessage()
          : error.message,
        actionExecuted: { action: normalizedAction.action, result },
        requiresDiscordLink: false,
        pendingAction: null,
      };
    }

    return {
      message: `Action impossible: ${error.message}`,
      actionExecuted: { action: normalizedAction.action, result },
      requiresDiscordLink: false,
      pendingAction: null,
    };
  }
}

async function generateAssistantImage(userId, userMessage) {
  const imageConfig = getGeminiImageConfig();
  if (!imageConfig?.apiKey) {
    return {
      message: 'La generation d image demande une cle Gemini configuree sur le site.',
      generatedImage: null,
      actionExecuted: null,
      requiresDiscordLink: false,
      pendingAction: null,
      usage: null,
      quota: null,
    };
  }

  const aiConfig = getAIConfig();
  const user = db.findOne('users', { id: userId });
  const prompt = normalizeImagePrompt(userMessage);
  if (aiConfig) {
    ensureQuotaAvailable(user, userId, aiConfig, estimateTokenCount(prompt));
  }

  let providerResult;
  try {
    providerResult = await requestGeminiImage(imageConfig, prompt);
  } catch (error) {
    if (imageConfig.providerKeyId && error?.providerKeyStatus) {
      aiProviderKeyService.markProviderKeyStatus(imageConfig.providerKeyId, error.providerKeyStatus, error.message);
    }
    throw error;
  }

  if (imageConfig.providerKeyId) {
    aiProviderKeyService.markProviderKeyStatus(imageConfig.providerKeyId, 'valid', 'Image generation succeeded.');
    aiProviderKeyService.markProviderKeyUsed(imageConfig.providerKeyId);
  }

  const quota = aiConfig ? recordQuotaUsage(userId, aiConfig, providerResult.usage) : null;

  return {
    message: providerResult.text || 'Image generee. Tu peux la telecharger ou la copier.',
    generatedImage: providerResult.image,
    actionExecuted: null,
    requiresDiscordLink: false,
    pendingAction: null,
    usage: providerResult.usage,
    quota,
  };
}

async function continueAction(userId, pendingAction, guildId = null) {
  const result = await executeAssistantActionFlow(userId, pendingAction, { guildId });
  return {
    message: result.message,
    actionExecuted: result.actionExecuted,
    requiresDiscordLink: result.requiresDiscordLink,
    pendingAction: result.pendingAction,
    usage: null,
    quota: null,
  };
}

async function chat(userId, userMessage, conversationHistory = [], guildId = null) {
  const user = db.findOne('users', { id: userId });
  const guilds = getAccessibleGuilds(userId);
  const focusedGuild = guildId ? (findAccessibleGuildRecord(userId, guildId)?.guild || null) : null;
  const trimmedMessage = String(userMessage || '').trim().slice(0, 2000);

  if (!trimmedMessage) {
    return {
      message: 'Message vide.',
      actionExecuted: null,
      requiresDiscordLink: false,
      pendingAction: null,
      usage: null,
      quota: null,
    };
  }

  const directAction = detectImplicitAction(trimmedMessage);
  if (directAction && DIRECT_ACTIONS.has(directAction.action)) {
    const directResult = await executeAssistantActionFlow(userId, directAction, {
      guildId: focusedGuild?.id || guildId || null,
      fallbackMessage: '',
    });
    return {
      message: directResult.message,
      actionExecuted: directResult.actionExecuted,
      requiresDiscordLink: directResult.requiresDiscordLink,
      pendingAction: directResult.pendingAction,
      usage: null,
      quota: null,
    };
  }

  if (isImageGenerationRequest(trimmedMessage)) {
    return generateAssistantImage(userId, trimmedMessage);
  }

  const systemPrompt = buildSystemPrompt(user, guilds, focusedGuild);
  const messages = [
    ...trimConversationHistory(conversationHistory),
    { role: 'user', content: trimmedMessage },
  ];

  const completion = await completeConversation(userId, { systemPrompt, messages });
  const cleanText = completion.text.replace(/```action[\s\S]*?```/g, '').trim();
  const actionBlock = extractAction(completion.text);

  if (!actionBlock) {
    return {
      message: cleanText || 'Je suis pret.',
      actionExecuted: null,
      requiresDiscordLink: false,
      pendingAction: null,
      usage: completion.usage,
      quota: completion.quota,
    };
  }

  const actionFlow = await executeAssistantActionFlow(userId, actionBlock, {
    guildId: focusedGuild?.id || guildId || null,
    fallbackMessage: cleanText,
  });

  return {
    message: actionFlow.message,
    actionExecuted: actionFlow.actionExecuted,
    requiresDiscordLink: actionFlow.requiresDiscordLink,
    pendingAction: actionFlow.pendingAction,
    generatedImage: null,
    usage: completion.usage,
    quota: completion.quota,
  };
}

module.exports = {
  chat,
  continueAction,
  completeConversation,
  getAIConfig,
  getQuotaOverview,
  mapAIConfigRow,
  getAutoAIConfig,
};
