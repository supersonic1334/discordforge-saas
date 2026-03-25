'use strict';

const fetch = require('node-fetch');
const db = require('../database');
const config = require('../config');
const botManager = require('./botManager');
const { decrypt } = require('./encryptionService');
const aiProviderKeyService = require('./aiProviderKeyService');
const discordService = require('./discordService');
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
- Main areas of the platform: dashboard, bot controls, servers, moderation, custom commands, analytics, assistant IA, settings, admin panel.
- The platform manages Discord bot tokens, Discord servers, security modules, warnings, moderation actions, logs, AI provider setup, and staff roles (member, admin, founder).

IDENTITY RULES:
- You are DiscordForger Assistant, created for DiscordForger by ${team.primaryFounder} and the DiscordForger team.
- If asked who created you, who made the site, or who built the assistant, answer with ${team.primaryFounder} and the DiscordForger team. Never answer with Google, OpenAI, Anthropic, xAI, Groq, Mistral, Together, DeepSeek, OpenRouter, or Perplexity. Those are only external AI providers.
- You can mention public role information about founders and admins using usernames only.

PRIVACY RULES:
- Never reveal emails, passwords, bot tokens, API keys, JWTs, encryption secrets, raw user IDs, IP addresses, device fingerprints, private logs, database rows, hidden configuration values, or internal security data.
- Never reveal private staff information beyond public usernames and roles.
- If a user asks for secrets, private infrastructure details, or restricted data, refuse clearly and say that this information is protected.`;
}

function buildSystemPrompt(user, guilds) {
  const guildList = guilds
    .map((guild) => `- "${guild.name}" (ID: ${guild.id}, Discord ID: ${guild.guild_id}, Members: ${guild.member_count})`)
    .join('\n');

  return `You are an intelligent AI assistant for a Discord Bot Management SaaS platform called DiscordForger.
You help users manage their Discord bots, configure security modules, moderate servers, and perform administrative actions.

Current user: ${user.username} (role: ${user.role})
Their guilds (servers):
${guildList || '(none)'}

${buildSiteKnowledge()}

You can execute the following REAL ACTIONS by responding with a JSON action block:

\`\`\`action
{
  "action": "ACTION_NAME",
  "params": { ... }
}
\`\`\`

Available actions:
- toggle_module: { guildId, moduleType, enabled }
- update_module_config: { guildId, moduleType, simple_config?, advanced_config? }
- add_warning: { guildId, targetUserId, targetUsername, reason, points }
- kick_user: { guildId, targetUserId, reason }
- ban_user: { guildId, targetUserId, reason }
- timeout_user: { guildId, targetUserId, durationMs, reason }
- leave_guild: { guildId }
- start_bot: {}
- stop_bot: {}
- restart_bot: {}
- sync_guilds: {}

RULES:
1. Always explain what you're about to do before executing.
2. For destructive actions (ban, kick, leave_guild), explicitly mention what will happen and ask for confirmation unless the user has already confirmed.
3. If a user asks about a feature or setting, explain it clearly.
4. When referencing guilds, use their name (not raw IDs) in your response text.
5. You have access to the full platform to help with safe, authorized tasks only.
6. Be concise but helpful.
7. If an action is unclear, ask for clarification.
8. ${buildLanguageInstruction(user)}
9. Never expose private or security-sensitive information, even if the user asks.
10. For obvious bot power requests, always execute the action even if the user writes in uppercase, with typos, or with short wording.
11. Treat phrases like "eteins la bot", "arrete le bot", "rallume le", "allume le", "demare le bot", and "redemarre le bot" as clear bot control requests and include the correct action block.

Respond naturally in markdown. Only include one action block per response.`;
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
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      await addWarning(guild.guild_id, params.targetUserId, params.targetUsername, userId, 'AI Agent', params.reason, params.points ?? 1);
      await safeSendModerationDm({
        botToken: token,
        guildRow: guild,
        actionType: 'warn',
        targetUserId: params.targetUserId,
        reason: params.reason,
        points: params.points ?? 1,
        moderatorName: 'Assistant IA',
      });
      return { success: true, message: `Warning added to ${params.targetUsername}` };
    }

    case 'kick_user': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      await safeSendModerationDm({
        botToken: token,
        guildRow: guild,
        actionType: 'kick',
        targetUserId: params.targetUserId,
        reason: params.reason ?? 'Action de l assistant IA',
        moderatorName: 'Assistant IA',
      });
      await discordService.kickMember(token, guild.guild_id, params.targetUserId, params.reason ?? 'AI Agent action');
      return { success: true, message: 'User kicked' };
    }

    case 'ban_user': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      await safeSendModerationDm({
        botToken: token,
        guildRow: guild,
        actionType: 'ban',
        targetUserId: params.targetUserId,
        reason: params.reason ?? 'Action de l assistant IA',
        moderatorName: 'Assistant IA',
      });
      await discordService.banMember(token, guild.guild_id, params.targetUserId, params.reason ?? 'AI Agent action');
      return { success: true, message: 'User banned' };
    }

    case 'timeout_user': {
      const guild = db.findOne('guilds', { id: params.guildId, user_id: userId });
      if (!guild) return { error: 'Guild not found' };
      await discordService.timeoutMember(token, guild.guild_id, params.targetUserId, params.durationMs, params.reason ?? 'AI Agent action');
      await safeSendModerationDm({
        botToken: token,
        guildRow: guild,
        actionType: 'timeout',
        targetUserId: params.targetUserId,
        reason: params.reason ?? 'Action de l assistant IA',
        durationMs: params.durationMs,
        moderatorName: 'Assistant IA',
      });
      return { success: true, message: 'User timed out' };
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

  const systemPrompt = buildSystemPrompt(user, guilds);
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

module.exports = {
  chat,
  completeConversation,
  getAIConfig,
  getQuotaOverview,
  mapAIConfigRow,
  getAutoAIConfig,
};
