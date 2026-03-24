'use strict';

const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const logger = require('../utils/logger').child('AIProviderKeys');
const { encrypt, decrypt, hash } = require('./encryptionService');
const { getProviderCatalog, getDefaultModel, resolveConfiguredModel } = require('../config/aiCatalog');

const PROVIDER_KEY_STATUSES = ['unknown', 'valid', 'quota_exhausted', 'invalid'];

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

function normalizeStatus(status) {
  return PROVIDER_KEY_STATUSES.includes(status) ? status : 'unknown';
}

function normalizeReason(reason) {
  return String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 240);
}

function maskKeyHash(keyHash) {
  const value = String(keyHash || '').trim();
  return value ? `****${value.slice(-6)}` : '****';
}

function buildStatusOrderSql() {
  return `CASE k.status
    WHEN 'valid' THEN 0
    WHEN 'unknown' THEN 1
    WHEN 'quota_exhausted' THEN 2
    ELSE 3
  END`;
}

function resolveProviderModel(provider, selectedModel) {
  const normalizedProvider = normalizeProvider(provider);
  const catalogEntry = getProviderCatalog(normalizedProvider);
  if (!catalogEntry) return '';

  const requestedModel = String(selectedModel || '').trim();
  if (requestedModel && catalogEntry.models.some((model) => model.id === requestedModel)) {
    return resolveConfiguredModel(normalizedProvider, requestedModel);
  }

  return resolveConfiguredModel(normalizedProvider, catalogEntry.defaultModel || getDefaultModel(normalizedProvider));
}

function mapProviderKeyRow(row, selectedKeyId = null) {
  if (!row) return null;

  const selectedModel = resolveProviderModel(row.provider, row.selected_model);

  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    selected_model: selectedModel,
    status: normalizeStatus(row.status),
    status_reason: row.status_reason || '',
    is_enabled: !!row.is_enabled,
    checked_at: row.checked_at || null,
    last_used_at: row.last_used_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    key_masked: maskKeyHash(row.key_hash),
    owner_username: row.owner_username || '',
    owner_role: row.owner_role || 'member',
    owner_avatar_url: row.owner_avatar_url || null,
    owner_email: row.owner_email || '',
    is_selected: selectedKeyId ? row.id === selectedKeyId : false,
  };
}

async function readProviderError(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return payload?.error?.message || payload?.error || payload?.message || '';
  }

  return String(await response.text().catch(() => '')).trim();
}

function classifyProviderError(statusCode, rawMessage) {
  const message = normalizeReason(rawMessage) || `HTTP ${statusCode}`;
  const lower = message.toLowerCase();

  if (
    lower.includes('quota')
    || lower.includes('rate limit')
    || lower.includes('billing')
    || lower.includes('insufficient_quota')
    || lower.includes('resource exhausted')
  ) {
    return {
      status: 'quota_exhausted',
      reason: message,
    };
  }

  if (
    lower.includes('invalid api key')
    || lower.includes('api key not valid')
    || lower.includes('incorrect api key')
    || lower.includes('authentication')
    || lower.includes('unauthorized')
    || lower.includes('permission denied')
  ) {
    return {
      status: 'invalid',
      reason: message,
    };
  }

  return {
    status: 'unknown',
    reason: message,
  };
}

async function probeAnthropicKey(apiKey, model) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      temperature: 0,
      system: 'Reply with OK.',
      messages: [{ role: 'user', content: 'OK' }],
    }),
  });

  if (response.ok) {
    return { status: 'valid', reason: 'Key validated successfully.' };
  }

  const rawMessage = await readProviderError(response);
  return classifyProviderError(response.status, rawMessage);
}

async function probeGeminiKey(apiKey, model) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'Reply with OK.' }] },
        contents: [{ role: 'user', parts: [{ text: 'OK' }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8,
        },
      }),
    }
  );

  if (response.ok) {
    return { status: 'valid', reason: 'Key validated successfully.' };
  }

  const rawMessage = await readProviderError(response);
  return classifyProviderError(response.status, rawMessage);
}

async function probeOpenAICompatibleKey(provider, apiKey, model) {
  const catalogEntry = getProviderCatalog(provider);
  if (!catalogEntry?.baseUrl) {
    return { status: 'invalid', reason: 'Unsupported provider.' };
  }

  const response = await fetch(catalogEntry.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'Reply with OK.' },
        { role: 'user', content: 'OK' },
      ],
      max_tokens: 8,
      temperature: 0,
    }),
  });

  if (response.ok) {
    return { status: 'valid', reason: 'Key validated successfully.' };
  }

  const rawMessage = await readProviderError(response);
  return classifyProviderError(response.status, rawMessage);
}

async function validateProviderKey(provider, apiKey, selectedModel = null) {
  const normalizedProvider = normalizeProvider(provider);
  const catalogEntry = getProviderCatalog(normalizedProvider);
  if (!catalogEntry) {
    return { status: 'invalid', reason: 'Unknown provider.' };
  }

  const model = resolveProviderModel(normalizedProvider, selectedModel);

  try {
    if (catalogEntry.apiStyle === 'anthropic') {
      return await probeAnthropicKey(apiKey, model);
    }

    if (catalogEntry.apiStyle === 'gemini') {
      return await probeGeminiKey(apiKey, model);
    }

    if (catalogEntry.apiStyle === 'openai') {
      return await probeOpenAICompatibleKey(normalizedProvider, apiKey, model);
    }
  } catch (error) {
    logger.warn('Provider key probe failed unexpectedly', {
      provider: normalizedProvider,
      error: error?.message || 'Unknown error',
    });
  }

  return {
    status: 'unknown',
    reason: 'Unable to verify the key right now.',
  };
}

function getProviderKeyById(id) {
  const row = db.raw(
    `SELECT k.*, u.username AS owner_username, u.role AS owner_role, u.avatar_url AS owner_avatar_url, u.email AS owner_email
     FROM ai_provider_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.id = ?
     LIMIT 1`,
    [id]
  )[0];

  const selectedKeyId = db.raw("SELECT active_provider_key_id FROM ai_config WHERE id = 'singleton'")[0]?.active_provider_key_id || null;
  return mapProviderKeyRow(row, selectedKeyId);
}

function listProviderKeys(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.userId) {
    conditions.push('k.user_id = ?');
    params.push(filters.userId);
  }

  if (filters.provider) {
    conditions.push('k.provider = ?');
    params.push(normalizeProvider(filters.provider));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const selectedKeyId = db.raw("SELECT active_provider_key_id FROM ai_config WHERE id = 'singleton'")[0]?.active_provider_key_id || null;
  const rows = db.raw(
    `SELECT k.*, u.username AS owner_username, u.role AS owner_role, u.avatar_url AS owner_avatar_url, u.email AS owner_email
     FROM ai_provider_keys k
     JOIN users u ON u.id = k.user_id
     ${whereClause}
     ORDER BY ${buildStatusOrderSql()}, k.updated_at DESC`,
    params
  );

  return rows.map((row) => mapProviderKeyRow(row, selectedKeyId));
}

function countProviderKeys(provider) {
  return Number(
    db.raw(
      'SELECT COUNT(*) AS count FROM ai_provider_keys WHERE provider = ? AND is_enabled = 1',
      [normalizeProvider(provider)]
    )[0]?.count || 0
  );
}

function getConfiguredProviderKey(aiConfigRow) {
  if (!aiConfigRow?.provider) return null;

  const provider = normalizeProvider(aiConfigRow.provider);

  if (aiConfigRow.active_provider_key_id) {
    const selectedRow = db.raw(
      `SELECT k.*, u.username AS owner_username, u.role AS owner_role, u.avatar_url AS owner_avatar_url, u.email AS owner_email
       FROM ai_provider_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.id = ? AND k.provider = ? AND k.is_enabled = 1
       LIMIT 1`,
      [aiConfigRow.active_provider_key_id, provider]
    )[0];

    if (selectedRow && !['invalid', 'quota_exhausted'].includes(String(selectedRow.status || '').trim().toLowerCase())) {
      return selectedRow;
    }
  }

  const pooledKey = db.raw(
    `SELECT k.*, u.username AS owner_username, u.role AS owner_role, u.avatar_url AS owner_avatar_url, u.email AS owner_email
     FROM ai_provider_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.provider = ? AND k.is_enabled = 1 AND k.status IN ('valid','unknown')
     ORDER BY CASE k.status
       WHEN 'valid' THEN 0
       WHEN 'unknown' THEN 1
       WHEN 'quota_exhausted' THEN 2
       ELSE 3
     END, k.updated_at DESC
     LIMIT 1`,
    [provider]
  )[0] || null;

  if (pooledKey) return pooledKey;
  if (aiConfigRow.encrypted_api_key) return null;
  return null;
}

async function saveProviderKey(userId, { provider, apiKey, selectedModel }) {
  const normalizedProvider = normalizeProvider(provider);
  const resolvedModel = resolveProviderModel(normalizedProvider, selectedModel);
  const probe = await validateProviderKey(normalizedProvider, apiKey, resolvedModel);
  const existing = db.raw(
    'SELECT * FROM ai_provider_keys WHERE user_id = ? AND provider = ? LIMIT 1',
    [userId, normalizedProvider]
  )[0];
  const now = new Date().toISOString();
  const payload = {
    provider: normalizedProvider,
    encrypted_api_key: encrypt(apiKey),
    key_hash: hash(apiKey),
    selected_model: resolvedModel,
    status: probe.status,
    status_reason: probe.reason,
    is_enabled: 1,
    checked_at: now,
    updated_at: now,
  };

  let keyId = existing?.id;

  if (existing) {
    db.update('ai_provider_keys', payload, { id: existing.id });
  } else {
    keyId = uuidv4();
    db.insert('ai_provider_keys', {
      id: keyId,
      user_id: userId,
      ...payload,
      created_at: now,
    });
  }

  const aiConfig = db.raw("SELECT * FROM ai_config WHERE id = 'singleton' LIMIT 1")[0] || null;
  if (!aiConfig) {
    db.db.prepare(`
      INSERT INTO ai_config (
        id, provider, encrypted_api_key, active_provider_key_id, model, max_tokens, temperature,
        user_quota_tokens, site_quota_tokens, quota_window_hours, auto_mode, enabled, updated_at
      ) VALUES ('singleton', ?, NULL, ?, ?, 1024, 0.7, 4000, 20000, 5, 1, 1, ?)
    `).run(normalizedProvider, keyId, resolvedModel, now);
  } else if (
    normalizeProvider(aiConfig.provider) === normalizedProvider
    && (!aiConfig.active_provider_key_id || aiConfig.active_provider_key_id === existing?.id)
  ) {
    db.db.prepare(`
      UPDATE ai_config
      SET active_provider_key_id = ?, enabled = 1, updated_at = ?
      WHERE id = 'singleton'
    `).run(keyId, now);
  }

  return getProviderKeyById(keyId);
}

async function refreshProviderKeyStatus(id) {
  const row = db.findOne('ai_provider_keys', { id });
  if (!row) return null;

  const probe = await validateProviderKey(row.provider, decrypt(row.encrypted_api_key), row.selected_model);
  const now = new Date().toISOString();
  db.update('ai_provider_keys', {
    status: probe.status,
    status_reason: probe.reason,
    checked_at: now,
  }, { id });

  return getProviderKeyById(id);
}

async function updateProviderKeyModel(id, selectedModel) {
  const row = db.findOne('ai_provider_keys', { id });
  if (!row) return null;

  const resolvedModel = resolveProviderModel(row.provider, selectedModel);
  const probe = await validateProviderKey(row.provider, decrypt(row.encrypted_api_key), resolvedModel);
  const now = new Date().toISOString();

  db.update('ai_provider_keys', {
    selected_model: resolvedModel,
    status: probe.status,
    status_reason: probe.reason,
    checked_at: now,
  }, { id });

  return getProviderKeyById(id);
}

function markProviderKeyStatus(id, status, reason = '') {
  const row = db.findOne('ai_provider_keys', { id });
  if (!row) return;

  db.update('ai_provider_keys', {
    status: normalizeStatus(status),
    status_reason: normalizeReason(reason),
    checked_at: new Date().toISOString(),
  }, { id });
}

function markProviderKeyUsed(id) {
  const row = db.findOne('ai_provider_keys', { id });
  if (!row) return;

  db.update('ai_provider_keys', {
    last_used_at: new Date().toISOString(),
  }, { id });
}

function deleteProviderKey(id) {
  const deleted = db.remove('ai_provider_keys', { id });
  if (!deleted) return false;

  db.db.prepare("UPDATE ai_config SET active_provider_key_id = NULL WHERE id = 'singleton' AND active_provider_key_id = ?")
    .run(id);

  return true;
}

function getProviderKeySecret(id) {
  const row = db.findOne('ai_provider_keys', { id });
  if (!row?.encrypted_api_key) return null;
  return decrypt(row.encrypted_api_key);
}

function getProviderKeyCountForUser(userId) {
  return Number(db.raw('SELECT COUNT(*) AS count FROM ai_provider_keys WHERE user_id = ?', [userId])[0]?.count || 0);
}

module.exports = {
  listProviderKeys,
  getProviderKeyById,
  getConfiguredProviderKey,
  saveProviderKey,
  refreshProviderKeyStatus,
  updateProviderKeyModel,
  markProviderKeyStatus,
  markProviderKeyUsed,
  deleteProviderKey,
  getProviderKeySecret,
  countProviderKeys,
  getProviderKeyCountForUser,
};
