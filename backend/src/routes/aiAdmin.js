'use strict';

const express = require('express');
const aiRouter = express.Router();
const adminRouter = express.Router();

const config = require('../config');
const { requireAuth, requireBotToken, requireFounder, requireAdminPanelAccess, validate } = require('../middleware');
const { aiMessageSchema, aiConfigSchema, userStatusSchema, adminRoleSchema, adminPasswordSchema } = require('../validators/schemas');
const aiService = require('../services/aiService');
const { encrypt } = require('../services/encryptionService');
const { applyAdvancedBlocksForUser, clearAdvancedBlocksForUser } = require('../services/accessControlService');
const db = require('../database');
const botManager = require('../services/botManager');
const authService = require('../services/authService');
const aiProviderKeyService = require('../services/aiProviderKeyService');
const wsServer = require('../websocket');
const logger = require('../utils/logger').child('AIAdminRoutes');
const { getAICatalog, getDefaultModel, resolveConfiguredModel } = require('../config/aiCatalog');

function isPrimaryFounder(user) {
  return String(user?.email || '').trim().toLowerCase() === String(config.FOUNDER_EMAIL || '').trim().toLowerCase();
}

function canViewRealEmails(viewer) {
  return isPrimaryFounder(viewer);
}

function getVisibleEmail(targetUser, viewer) {
  if (isPrimaryFounder(targetUser)) {
    return authService.maskEmail(targetUser?.email, { hideCompletely: true });
  }
  if (canViewRealEmails(viewer)) {
    return targetUser?.email || '';
  }
  return authService.maskEmail(targetUser?.email);
}

function notifyAndDisconnectUser(userId, event, code, reason) {
  wsServer.broadcastToUser(userId, { event, data: { reason } });
  setTimeout(() => wsServer.disconnectUser(userId, code, reason), 80);
}

function notifyUserProfileChanged(userId, reason) {
  notifyAndDisconnectUser(userId, 'account:profileUpdated', 4005, reason);
}

function requirePrimaryFounder(req, res, next) {
  if (!isPrimaryFounder(req.user)) {
    return res.status(403).json({ error: 'Primary founder access required' });
  }
  next();
}

aiRouter.post('/chat', requireAuth, validate(aiMessageSchema), async (req, res, next) => {
  try {
    const { message, guild_id, conversation_history } = req.body;
    const result = await aiService.chat(req.user.id, message, conversation_history, guild_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

aiRouter.get('/status', requireAuth, (req, res) => {
  const currentConfig = aiService.getAIConfig();
  res.json({
    configured: !!currentConfig,
  });
});

adminRouter.use(requireAuth, requireAdminPanelAccess);

adminRouter.get('/users', requireFounder, (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const users = db.raw(
    `SELECT id, email, username, role, avatar_url, is_active, last_login_at, created_at
     FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [Number(limit), offset]
  );

  const total = db.raw('SELECT COUNT(*) as count FROM users')[0]?.count ?? 0;
  const enriched = users.map((u) => {
    const visibleEmail = getVisibleEmail(u, req.user);

    return {
      ...u,
      email: visibleEmail,
      email_masked: visibleEmail !== (u.email || ''),
      is_primary_founder: isPrimaryFounder(u),
      botStatus: botManager.getBotStatus(u.id)?.status ?? 'stopped',
      hasBotToken: !!db.findOne('bot_tokens', { user_id: u.id }),
      providerKeyCount: aiProviderKeyService.getProviderKeyCountForUser(u.id),
    };
  });

  res.json({ users: enriched, total, page: Number(page), limit: Number(limit) });
});

adminRouter.patch('/users/:userId/role', requireFounder, validate(adminRoleSchema), (req, res, next) => {
  const { role } = req.body;
  const user = db.findOne('users', { id: req.params.userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isPrimaryFounder(user)) {
    return res.status(403).json({ error: 'Primary founder account is protected' });
  }
  if (req.user.id === user.id && role !== 'founder') {
    return res.status(400).json({ error: 'You cannot remove founder access from your own account' });
  }
  if (user.role === 'founder' && role !== 'founder') {
    const remainingFounders = db.raw(
      'SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = 1 AND id != ?',
      ['founder', user.id]
    )[0]?.count ?? 0;

    if (remainingFounders < 1) {
      return res.status(400).json({ error: 'At least one active founder must remain' });
    }
  }

  try {
    db.update('users', { role }, { id: user.id });
  } catch (err) {
    if (!String(err?.message || '').includes('CHECK constraint failed')) {
      return next(err);
    }

    try {
      db.runMigrations();
      db.update('users', { role }, { id: user.id });
    } catch (retryErr) {
      return next(retryErr);
    }
  }

  notifyUserProfileChanged(user.id, 'role_updated');

  res.json({ message: `Role updated to ${role}` });
});

adminRouter.patch('/users/:userId/status', requireFounder, validate(userStatusSchema), (req, res) => {
  const { is_active } = req.body;
  const user = db.findOne('users', { id: req.params.userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isPrimaryFounder(user)) {
    return res.status(403).json({ error: 'Primary founder account is protected' });
  }

  if (!is_active && req.user.id === user.id) {
    return res.status(400).json({ error: 'You cannot block access to your own account' });
  }

  if (!is_active && user.role === 'founder') {
    const remainingFounders = db.raw(
      'SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = 1 AND id != ?',
      ['founder', user.id]
    )[0]?.count ?? 0;

    if (remainingFounders < 1) {
      return res.status(400).json({ error: 'At least one active founder must remain' });
    }
  }

  db.update('users', { is_active: is_active ? 1 : 0 }, { id: user.id });
  if (!is_active) {
    applyAdvancedBlocksForUser(user.id, req.user.id, req);
    botManager.stopBot(user.id).catch(() => {});
    notifyAndDisconnectUser(user.id, 'account:blocked', 4003, 'Account blocked');
  } else {
    clearAdvancedBlocksForUser(user.id);
    notifyUserProfileChanged(user.id, 'access_restored');
  }

  res.json({ message: `User ${is_active ? 'activated' : 'deactivated'}` });
});

adminRouter.patch('/users/:userId/password', requireFounder, validate(adminPasswordSchema), async (req, res, next) => {
  try {
    const user = db.findOne('users', { id: req.params.userId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (isPrimaryFounder(user)) {
      return res.status(403).json({ error: 'Primary founder account is protected' });
    }

    await authService.setPassword(user.id, req.body.newPassword);
    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/users/:userId', requirePrimaryFounder, async (req, res) => {
  const user = db.findOne('users', { id: req.params.userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isPrimaryFounder(user)) return res.status(403).json({ error: 'Primary founder account is protected' });
  if (req.user.id === user.id) return res.status(400).json({ error: 'You cannot delete your own account from here' });
  if (user.role === 'founder') {
    const remainingFounders = db.raw(
      'SELECT COUNT(*) as count FROM users WHERE role = ? AND is_active = 1 AND id != ?',
      ['founder', user.id]
    )[0]?.count ?? 0;

    if (remainingFounders < 1) {
      return res.status(400).json({ error: 'At least one active founder must remain' });
    }
  }

  await botManager.stopBot(user.id).catch(() => {});
  notifyAndDisconnectUser(user.id, 'account:deleted', 4004, 'Account deleted');
  db.remove('users', { id: user.id });
  res.json({ message: 'User deleted' });
});

adminRouter.get('/ai', (req, res) => {
  const row = db.raw("SELECT * FROM ai_config WHERE id = 'singleton'")[0] ?? null;
  const providerKeys = isPrimaryFounder(req.user) ? aiProviderKeyService.listProviderKeys() : [];

  if (!row) {
    const autoConfig = aiService.getAutoAIConfig({
      provider: 'anthropic',
      model: getDefaultModel('anthropic'),
      quotaWindowHours: 5,
    });

    return res.json({
      configured: false,
      provider: autoConfig.provider,
      model: autoConfig.model,
      max_tokens: autoConfig.maxTokens,
      temperature: autoConfig.temperature,
      user_quota_tokens: autoConfig.userQuotaTokens,
      site_quota_tokens: autoConfig.siteQuotaTokens,
      quota_window_hours: autoConfig.quotaWindowHours,
      auto_mode: true,
      auto_tuning: autoConfig.autoTuning,
      hasApiKey: false,
      active_provider_key_id: null,
      provider_key_source: 'admin',
      provider_key_owner: null,
      provider_keys: providerKeys,
      quota: aiService.getQuotaOverview(req.user.id, autoConfig),
      catalog: getAICatalog(),
    });
  }

  const resolvedConfig = aiService.mapAIConfigRow(row) || {
    provider: row.provider,
    model: resolveConfiguredModel(row.provider, row.model),
    maxTokens: row.max_tokens ?? 1024,
    temperature: row.temperature ?? 0.7,
    userQuotaTokens: row.user_quota_tokens ?? 4000,
    siteQuotaTokens: row.site_quota_tokens ?? 20000,
    quotaWindowHours: row.quota_window_hours ?? 5,
    autoMode: Number(row.auto_mode ?? 1) !== 0,
    autoTuning: null,
    apiKey: row.encrypted_api_key ? '__saved__' : null,
    apiKeySource: row.active_provider_key_id ? 'provider_pool' : 'admin',
    providerKeyOwner: null,
  };

  res.json({
    configured: true,
    provider: resolvedConfig.provider,
    model: resolvedConfig.model,
    max_tokens: resolvedConfig.maxTokens,
    temperature: resolvedConfig.temperature,
    user_quota_tokens: resolvedConfig.userQuotaTokens,
    site_quota_tokens: resolvedConfig.siteQuotaTokens,
    quota_window_hours: resolvedConfig.quotaWindowHours,
    auto_mode: resolvedConfig.autoMode !== false,
    auto_tuning: resolvedConfig.autoTuning || null,
    enabled: !!row.enabled,
    hasApiKey: !!resolvedConfig.apiKey,
    active_provider_key_id: row.active_provider_key_id || null,
    provider_key_source: resolvedConfig.apiKeySource || 'admin',
    provider_key_owner: resolvedConfig.providerKeyOwner || null,
    updated_at: row.updated_at,
    quota: aiService.getQuotaOverview(req.user.id, resolvedConfig),
    provider_keys: providerKeys,
    catalog: getAICatalog(),
  });
});

adminRouter.get('/ai/recommendation', (req, res) => {
  const provider = getAICatalog().some((entry) => entry.id === req.query.provider)
    ? String(req.query.provider)
    : 'anthropic';
  const model = req.query.model || getDefaultModel(provider);
  const quotaWindowHours = Number(req.query.quota_window_hours) || 5;
  const autoConfig = aiService.getAutoAIConfig({
    provider,
    model,
    quotaWindowHours,
  });

  res.json({
    provider: autoConfig.provider,
    model: autoConfig.model,
    max_tokens: autoConfig.maxTokens,
    temperature: autoConfig.temperature,
    user_quota_tokens: autoConfig.userQuotaTokens,
    site_quota_tokens: autoConfig.siteQuotaTokens,
    quota_window_hours: autoConfig.quotaWindowHours,
    auto_tuning: autoConfig.autoTuning,
  });
});

adminRouter.put('/ai', validate(aiConfigSchema), (req, res) => {
  const {
    provider,
    api_key,
    model,
    max_tokens,
    temperature,
    user_quota_tokens,
    site_quota_tokens,
    quota_window_hours,
    auto_mode,
    active_provider_key_id,
  } = req.body;

  const now = new Date().toISOString();
  const normalizedActiveProviderKeyId = String(active_provider_key_id || '').trim() || null;
  const autoConfig = aiService.getAutoAIConfig({
    provider,
    model,
    quotaWindowHours: quota_window_hours,
  });
  const resolvedModel = autoConfig.model;
  const autoMode = auto_mode !== false;
  const savedMaxTokens = autoMode ? autoConfig.maxTokens : max_tokens;
  const savedTemperature = autoMode ? autoConfig.temperature : temperature;
  const savedQuotaTokens = autoMode ? autoConfig.userQuotaTokens : user_quota_tokens;
  const savedSiteQuotaTokens = autoMode ? autoConfig.siteQuotaTokens : site_quota_tokens;
  const savedQuotaWindowHours = autoMode ? autoConfig.quotaWindowHours : quota_window_hours;

  const existing = db.raw("SELECT id, encrypted_api_key FROM ai_config WHERE id = 'singleton'")[0];
  const encryptedKey = api_key ? encrypt(api_key) : existing?.encrypted_api_key ?? null;
  const selectedProviderKey = normalizedActiveProviderKeyId
    ? aiProviderKeyService.getProviderKeyById(normalizedActiveProviderKeyId)
    : null;

  if (normalizedActiveProviderKeyId && !isPrimaryFounder(req.user)) {
    return res.status(403).json({ error: 'Primary founder access required to choose a provider key' });
  }

  if (normalizedActiveProviderKeyId && (!selectedProviderKey || selectedProviderKey.provider !== provider)) {
    return res.status(400).json({ error: 'Selected provider key does not match the current provider' });
  }

  if (!encryptedKey && !selectedProviderKey && aiProviderKeyService.countProviderKeys(provider) < 1) {
    return res.status(400).json({ error: 'API key is required for the first AI configuration' });
  }

  if (existing) {
    db.db.prepare(
      `UPDATE ai_config
       SET provider = ?, encrypted_api_key = ?, active_provider_key_id = ?, model = ?, max_tokens = ?, temperature = ?, user_quota_tokens = ?, site_quota_tokens = ?, quota_window_hours = ?, auto_mode = ?, enabled = 1, updated_at = ?
       WHERE id = 'singleton'`
    ).run(
      provider,
      encryptedKey,
      normalizedActiveProviderKeyId,
      resolvedModel,
      savedMaxTokens,
      savedTemperature,
      savedQuotaTokens,
      savedSiteQuotaTokens,
      savedQuotaWindowHours,
      autoMode ? 1 : 0,
      now
    );
  } else {
    db.db.prepare(
      `INSERT INTO ai_config (id, provider, encrypted_api_key, active_provider_key_id, model, max_tokens, temperature, user_quota_tokens, site_quota_tokens, quota_window_hours, auto_mode, enabled, updated_at)
       VALUES ('singleton', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      provider,
      encryptedKey,
      normalizedActiveProviderKeyId,
      resolvedModel,
      savedMaxTokens,
      savedTemperature,
      savedQuotaTokens,
      savedSiteQuotaTokens,
      savedQuotaWindowHours,
      autoMode ? 1 : 0,
      now
    );
  }

  logger.info(`AI config updated: provider=${provider} model=${resolvedModel}`);
  res.json({
    message: 'AI configuration saved',
    provider,
    model: resolvedModel,
    max_tokens: savedMaxTokens,
    temperature: savedTemperature,
    hasApiKey: !!encryptedKey || !!selectedProviderKey,
    user_quota_tokens: savedQuotaTokens,
    site_quota_tokens: savedSiteQuotaTokens,
    quota_window_hours: savedQuotaWindowHours,
    auto_mode: autoMode,
    auto_tuning: autoMode ? autoConfig.autoTuning : null,
    active_provider_key_id: normalizedActiveProviderKeyId,
    provider_key_source: selectedProviderKey ? 'provider_pool' : 'admin',
    provider_key_owner: selectedProviderKey ? {
      username: selectedProviderKey.owner_username,
      role: selectedProviderKey.owner_role,
      avatar_url: selectedProviderKey.owner_avatar_url,
    } : null,
    quota: aiService.getQuotaOverview(req.user.id, {
      provider,
      model: resolvedModel,
      maxTokens: savedMaxTokens,
      temperature: savedTemperature,
      userQuotaTokens: savedQuotaTokens,
      siteQuotaTokens: savedSiteQuotaTokens,
      quotaWindowHours: savedQuotaWindowHours,
      autoMode,
      autoTuning: autoMode ? autoConfig.autoTuning : null,
    }),
  });
});

adminRouter.post('/ai/provider-keys/:keyId/refresh', requirePrimaryFounder, async (req, res, next) => {
  try {
    const key = await aiProviderKeyService.refreshProviderKeyStatus(req.params.keyId);
    if (!key) return res.status(404).json({ error: 'Provider key not found' });
    res.json({ key });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/ai/provider-keys/:keyId/secret', requirePrimaryFounder, (req, res) => {
  const key = aiProviderKeyService.getProviderKeyById(req.params.keyId);
  if (!key) return res.status(404).json({ error: 'Provider key not found' });

  const secret = aiProviderKeyService.getProviderKeySecret(req.params.keyId);
  if (!secret) return res.status(404).json({ error: 'Provider key secret not found' });

  res.json({
    keyId: key.id,
    provider: key.provider,
    owner: {
      username: key.owner_username,
      role: key.owner_role,
      avatar_url: key.owner_avatar_url,
      email: key.owner_email,
    },
    api_key: secret,
    created_at: key.created_at,
    updated_at: key.updated_at,
    checked_at: key.checked_at,
    last_used_at: key.last_used_at,
  });
});

adminRouter.delete('/ai/provider-keys/:keyId', requirePrimaryFounder, (req, res) => {
  const key = aiProviderKeyService.getProviderKeyById(req.params.keyId);
  if (!key) return res.status(404).json({ error: 'Provider key not found' });

  aiProviderKeyService.deleteProviderKey(req.params.keyId);
  res.json({ message: 'Provider key deleted' });
});

adminRouter.get('/system', (req, res) => {
  const userCount = db.raw('SELECT COUNT(*) as c FROM users WHERE is_active = 1')[0]?.c ?? 0;
  const guildCount = db.raw('SELECT COUNT(*) as c FROM guilds WHERE is_active = 1')[0]?.c ?? 0;
  const botCount = db.raw('SELECT COUNT(*) as c FROM bot_tokens WHERE is_valid = 1')[0]?.c ?? 0;
  const runningBots = botManager.getAllStatuses().filter((s) => s.status === 'running').length;

  const recentErrors = db.raw(
    "SELECT message, created_at FROM system_logs WHERE level = 'error' ORDER BY created_at DESC LIMIT 10"
  );

  res.json({
    users: userCount,
    connectedUsers: wsServer.connectedUserCount,
    wsConnections: wsServer.connectionCount,
    guilds: guildCount,
    botTokens: botCount,
    runningBots,
    recentErrors,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    nodeVersion: process.version,
  });
});

adminRouter.get('/bots', requireFounder, (req, res) => {
  const statuses = botManager.getAllStatuses();
  res.json({ bots: statuses });
});

adminRouter.post('/bots/:userId/restart', requireFounder, async (req, res, next) => {
  try {
    await botManager.restartBot(req.params.userId);
    res.json({ message: 'Bot restarted' });
  } catch (err) {
    next(err);
  }
});

module.exports = { aiRouter, adminRouter };
