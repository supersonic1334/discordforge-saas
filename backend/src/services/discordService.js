'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger').child('DiscordService');

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;
const DISCORD_TIMEOUT_MIN_MS = 60_000;
const DISCORD_TIMEOUT_MAX_MS = 2_419_200_000;

// ── Rate limit tracker ────────────────────────────────────────────────────────
const rateLimitBuckets = new Map(); // bucket -> { reset, remaining }

// ── Core fetch with retry + rate limit handling ───────────────────────────────
async function discordFetch(endpoint, token, options = {}, retryCount = 0) {
  const url = `${DISCORD_API}${endpoint}`;
  const headers = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DiscordBot (https://discord-saas.example.com, 1.0.0)',
    ...options.headers,
  };

  // Check known rate limits before sending
  const bucket = rateLimitBuckets.get(endpoint);
  if (bucket && bucket.remaining === 0) {
    const waitMs = Math.max(0, bucket.reset - Date.now());
    if (waitMs > 0) {
      logger.debug(`Rate limited on ${endpoint}, waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      timeout: 15000,
    });
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
      logger.warn(`Network error on ${endpoint}, retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms`, { error: err.message });
      await sleep(delay);
      return discordFetch(endpoint, token, options, retryCount + 1);
    }
    throw new DiscordAPIError(`Network error after ${MAX_RETRIES} retries: ${err.message}`, 0);
  }

  // Update rate limit tracking
  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetAfter = response.headers.get('x-ratelimit-reset-after');
  const bucketId = response.headers.get('x-ratelimit-bucket') || endpoint;
  if (remaining !== null) {
    rateLimitBuckets.set(bucketId, {
      remaining: parseInt(remaining),
      reset: Date.now() + (parseFloat(resetAfter || 0) * 1000),
    });
  }

  // Handle 429 Too Many Requests
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    const retryAfterMs = (body.retry_after || 1) * 1000;
    const isGlobal = body.global || false;
    logger.warn(`429 Rate limit hit on ${endpoint} (global=${isGlobal}), retrying after ${retryAfterMs}ms`);
    if (retryCount < MAX_RETRIES) {
      await sleep(retryAfterMs + 100);
      return discordFetch(endpoint, token, options, retryCount + 1);
    }
    throw new DiscordAPIError('Rate limited — max retries exceeded', 429);
  }

  // Handle 5xx errors with backoff
  if (response.status >= 500) {
    if (retryCount < MAX_RETRIES) {
      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
      logger.warn(`${response.status} on ${endpoint}, retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms`);
      await sleep(delay);
      return discordFetch(endpoint, token, options, retryCount + 1);
    }
  }

  // Parse JSON body
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const code = data?.code ?? 0;
    const message = data?.message ?? `HTTP ${response.status}`;
    throw new DiscordAPIError(message, response.status, code, data);
  }

  return data;
}

// ── Custom error class ────────────────────────────────────────────────────────
class DiscordAPIError extends Error {
  constructor(message, httpStatus, discordCode, rawBody) {
    super(message);
    this.name = 'DiscordAPIError';
    this.httpStatus = httpStatus;
    this.discordCode = discordCode;
    this.rawBody = rawBody;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a bot token. Returns bot user info or throws.
 */
async function validateToken(token) {
  const data = await discordFetch('/users/@me', token);
  if (!data.bot) throw new DiscordAPIError('Token does not belong to a bot account', 401);
  return data; // { id, username, discriminator, avatar, … }
}

/**
 * Fetch guilds the bot is in.
 * Note: Bots use /users/@me/guilds. Returns array of partial guild objects.
 */
async function getBotGuilds(token) {
  return discordFetch('/users/@me/guilds?limit=200', token);
}

/**
 * Fetch full guild info (requires bot to be in it).
 */
async function getGuild(token, guildId) {
  return discordFetch(`/guilds/${guildId}?with_counts=true`, token);
}

/**
 * Fetch guild channels.
 */
async function getGuildChannels(token, guildId) {
  return discordFetch(`/guilds/${guildId}/channels`, token);
}

/**
 * Fetch guild roles.
 */
async function getGuildRoles(token, guildId) {
  return discordFetch(`/guilds/${guildId}/roles`, token);
}

async function getUser(token, userId) {
  return discordFetch(`/users/${userId}`, token);
}

async function getGuildMember(token, guildId, userId) {
  return discordFetch(`/guilds/${guildId}/members/${userId}`, token);
}

async function searchGuildMembers(token, guildId, query, limit = 10) {
  const params = new URLSearchParams({
    query: String(query || '').trim(),
    limit: String(Math.max(1, Math.min(100, Number(limit) || 10))),
  });
  return discordFetch(`/guilds/${guildId}/members/search?${params.toString()}`, token);
}

async function getGuildBan(token, guildId, userId) {
  return discordFetch(`/guilds/${guildId}/bans/${userId}`, token);
}

async function getGuildBans(token, guildId, limit = 1000, before = '', after = '') {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(1000, Number(limit) || 1000))),
  });

  if (before) params.set('before', String(before));
  if (after) params.set('after', String(after));

  return discordFetch(`/guilds/${guildId}/bans?${params.toString()}`, token);
}

async function getGuildAuditLogs(token, guildId, options = {}) {
  const params = new URLSearchParams()
  if (options.userId) params.set('user_id', String(options.userId))
  if (options.actionType !== undefined && options.actionType !== null && options.actionType !== '') {
    params.set('action_type', String(options.actionType))
  }
  if (options.before) params.set('before', String(options.before))
  if (options.after) params.set('after', String(options.after))
  params.set('limit', String(Math.max(1, Math.min(100, Number(options.limit) || 50))))

  const query = params.toString()
  return discordFetch(`/guilds/${guildId}/audit-logs${query ? `?${query}` : ''}`, token)
}

async function listAutoModerationRules(token, guildId) {
  return discordFetch(`/guilds/${guildId}/auto-moderation/rules`, token);
}

async function createAutoModerationRule(token, guildId, payload, reason = '') {
  return discordFetch(`/guilds/${guildId}/auto-moderation/rules`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {},
  });
}

async function modifyAutoModerationRule(token, guildId, ruleId, payload, reason = '') {
  return discordFetch(`/guilds/${guildId}/auto-moderation/rules/${ruleId}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {},
  });
}

async function deleteAutoModerationRule(token, guildId, ruleId, reason = '') {
  return discordFetch(`/guilds/${guildId}/auto-moderation/rules/${ruleId}`, token, {
    method: 'DELETE',
    headers: reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {},
  });
}

/**
 * Leave a guild.
 */
async function leaveGuild(token, guildId) {
  return discordFetch(`/users/@me/guilds/${guildId}`, token, { method: 'DELETE' });
}

/**
 * Delete a message.
 */
async function deleteMessage(token, channelId, messageId) {
  return discordFetch(`/channels/${channelId}/messages/${messageId}`, token, { method: 'DELETE' });
}

/**
 * Timeout a member (communication_disabled_until = ISO timestamp or null).
 */
async function timeoutMember(token, guildId, userId, durationMs, reason = '') {
  const normalizedDuration = durationMs
    ? Math.max(DISCORD_TIMEOUT_MIN_MS, Math.min(DISCORD_TIMEOUT_MAX_MS, Number(durationMs) || DISCORD_TIMEOUT_MIN_MS))
    : null;
  const until = normalizedDuration ? new Date(Date.now() + normalizedDuration).toISOString() : null;
  return discordFetch(`/guilds/${guildId}/members/${userId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ communication_disabled_until: until }),
    headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) },
  });
}

/**
 * Kick a member.
 */
async function kickMember(token, guildId, userId, reason = '') {
  return discordFetch(`/guilds/${guildId}/members/${userId}`, token, {
    method: 'DELETE',
    headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) },
  });
}

/**
 * Ban a member.
 */
async function banMember(token, guildId, userId, reason = '', deleteMessageSeconds = 0) {
  return discordFetch(`/guilds/${guildId}/bans/${userId}`, token, {
    method: 'PUT',
    body: JSON.stringify({ delete_message_seconds: deleteMessageSeconds }),
    headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) },
  });
}

async function unbanMember(token, guildId, userId, reason = '') {
  return discordFetch(`/guilds/${guildId}/bans/${userId}`, token, {
    method: 'DELETE',
    headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) },
  });
}

/**
 * Add a role to a member.
 */
async function addRole(token, guildId, userId, roleId, reason = '') {
  return discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, token, {
    method: 'PUT',
    headers: { 'X-Audit-Log-Reason': encodeURIComponent(reason) },
  });
}

/**
 * Send a message to a channel.
 */
async function sendMessage(token, channelId, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  return discordFetch(`/channels/${channelId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function createDmChannel(token, userId) {
  return discordFetch('/users/@me/channels', token, {
    method: 'POST',
    body: JSON.stringify({ recipient_id: String(userId) }),
  });
}

async function sendDirectMessage(token, userId, payload) {
  const channel = await createDmChannel(token, userId);
  if (!channel?.id) {
    throw new DiscordAPIError('Unable to open DM channel', 400);
  }
  return sendMessage(token, channel.id, payload);
}

/**
 * Fetch guild members (requires GUILD_MEMBERS intent + privileged intent enabled).
 */
async function getGuildMembers(token, guildId, limit = 1000, after = '0') {
  return discordFetch(`/guilds/${guildId}/members?limit=${limit}&after=${after}`, token);
}

function buildBotInviteUrl(clientId, options = {}) {
  if (!clientId) return null;

  const permissions = String(options.permissions || '8');
  const scopes = Array.isArray(options.scopes) && options.scopes.length
    ? options.scopes
    : ['bot', 'applications.commands'];

  const params = new URLSearchParams({
    client_id: String(clientId),
    permissions,
    scope: scopes.join(' '),
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAvatarUrl(userId, avatarHash, size = 128) {
  if (!avatarHash) return `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`;
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
}

function getGuildIconUrl(guildId, iconHash, size = 128) {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}

module.exports = {
  DiscordAPIError,
  validateToken,
  getBotGuilds,
  getGuild,
  getGuildChannels,
  getGuildRoles,
  getUser,
  getGuildMember,
  searchGuildMembers,
  getGuildBan,
  getGuildBans,
  getGuildAuditLogs,
  listAutoModerationRules,
  createAutoModerationRule,
  modifyAutoModerationRule,
  deleteAutoModerationRule,
  leaveGuild,
  deleteMessage,
  timeoutMember,
  kickMember,
  banMember,
  unbanMember,
  addRole,
  sendMessage,
  createDmChannel,
  sendDirectMessage,
  getGuildMembers,
  getAvatarUrl,
  getGuildIconUrl,
  buildBotInviteUrl,
};
