'use strict';

const aiService = require('./aiService');
const aiProviderKeyService = require('./aiProviderKeyService');
const usernameProbeService = require('./usernameProbeService');
const discordService = require('./discordService');
const db = require('../database');
const logger = require('../utils/logger').child('OSINTService');
const { getProviderCatalog } = require('../config/aiCatalog');
const { decrypt } = require('./encryptionService');
const exifParser = require('exif-parser');

const fetch = global.fetch ? global.fetch.bind(globalThis) : require('node-fetch');
const OSINT_FETCH_HEADERS = {
  'user-agent': 'DiscordForgerOSINT/2.0 (+https://discordforge.local)',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
};

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function normalizeShortText(value, maxLength = 320) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushUniqueModel(candidates, modelId) {
  const normalized = String(modelId || '').trim();
  if (!normalized || candidates.includes(normalized)) return;
  candidates.push(normalized);
}

function resolveGeminiOsintModelCandidates(selectedModel = '') {
  const normalized = String(selectedModel || '').trim().toLowerCase();
  const candidates = [];

  pushUniqueModel(candidates, selectedModel);

  if (normalized === 'gemini-2.5-flash-image' || normalized === 'gemini-3-pro-image-preview') {
    pushUniqueModel(candidates, 'gemini-2.5-flash');
    pushUniqueModel(candidates, 'gemini-2.5-pro');
    pushUniqueModel(candidates, 'gemini-2.5-flash-lite');
  } else if (normalized.startsWith('gemini-2.5-pro')) {
    pushUniqueModel(candidates, 'gemini-2.5-flash');
    pushUniqueModel(candidates, 'gemini-2.5-flash-lite');
  } else if (normalized.startsWith('gemini-2.5-flash-lite')) {
    pushUniqueModel(candidates, 'gemini-2.5-flash');
    pushUniqueModel(candidates, 'gemini-2.5-pro');
  } else if (normalized.startsWith('gemini-2.5-flash')) {
    pushUniqueModel(candidates, 'gemini-2.5-pro');
    pushUniqueModel(candidates, 'gemini-2.5-flash-lite');
  }

  pushUniqueModel(candidates, 'gemini-2.5-flash');
  pushUniqueModel(candidates, 'gemini-2.5-pro');
  pushUniqueModel(candidates, 'gemini-2.5-flash-lite');

  return candidates.length ? candidates : ['gemini-2.5-flash', 'gemini-2.5-pro'];
}

function uniqueStrings(values, limit = 8) {
  return Array.from(new Set(
    safeArray(values)
      .map((entry) => normalizeShortText(entry, 120))
      .filter(Boolean)
  )).slice(0, limit);
}

async function runLimited(items, limit, iterator) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await iterator(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return clamp(Math.round(parsed), 0, 100);
}

function normalizeConfidenceLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (['haute', 'high', 'forte', 'strong'].includes(normalized)) return 'haute';
  if (['moyenne', 'medium', 'moderate'].includes(normalized)) return 'moyenne';
  if (['faible', 'low', 'basse', 'weak'].includes(normalized)) return 'faible';

  return 'moyenne';
}

function normalizeClueWeight(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (['high', 'haute', 'forte', 'strong'].includes(normalized)) return 'high';
  if (['medium', 'moyenne', 'moderate'].includes(normalized)) return 'medium';
  return 'low';
}

function formatExifTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}h${minutes}`;
}

function normalizeFrenchTimeOfDay(value) {
  const normalized = normalizeShortText(value, 80);
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  const directMap = [
    ['early morning', 'tot le matin'],
    ['morning', 'matin'],
    ['late morning', 'fin de matinee'],
    ['noon', 'midi'],
    ['midday', 'midi'],
    ['early afternoon', 'debut d apres-midi'],
    ['afternoon', 'apres-midi'],
    ['late afternoon', 'fin d apres-midi'],
    ['golden hour', 'heure doree'],
    ['sunset', 'coucher du soleil'],
    ['dusk', 'crepuscule'],
    ['evening', 'soir'],
    ['night', 'nuit'],
    ['sunrise', 'lever du soleil'],
  ];

  for (const [source, target] of directMap) {
    if (lower.includes(source)) return target;
  }

  const hhmmMatch = lower.match(/\b(\d{1,2})[:h](\d{2})\b/);
  if (hhmmMatch) {
    return `${hhmmMatch[1]}h${hhmmMatch[2]}`;
  }

  const ampmMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ampmMatch) {
    const rawHours = Number(ampmMatch[1]);
    const minutes = ampmMatch[2] || '00';
    const suffix = ampmMatch[3];
    let hours = rawHours % 12;
    if (suffix === 'pm') hours += 12;
    return `${hours}h${minutes}`;
  }

  return normalized;
}

function extractImageMetadata(imageBase64) {
  try {
    const buffer = Buffer.from(String(imageBase64 || ''), 'base64');
    if (!buffer.length) return null;

    const parser = exifParser.create(buffer);
    parser.enableSimpleValues(true);
    const parsed = parser.parse();
    const tags = parsed?.tags || {};

    const lat = Number(tags.GPSLatitude);
    const lon = Number(tags.GPSLongitude);
    const coordinates = Number.isFinite(lat) && Number.isFinite(lon)
      ? normalizeCoordinates({ lat, lon })
      : null;

    const capturedAt = formatExifTime(tags.DateTimeOriginal || tags.CreateDate || tags.ModifyDate);
    return {
      coordinates,
      capturedAt,
      hasExactCoordinates: Boolean(coordinates),
      hasCapturedAt: Boolean(capturedAt),
    };
  } catch {
    return null;
  }
}

function tryParseJSON(candidate) {
  const normalized = String(candidate || '').trim();
  if (!normalized) return null;

  const attempts = [
    normalized,
    normalized.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
    normalized
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1'),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {}
  }

  return null;
}

function extractBalancedJSONObject(source) {
  const text = String(source || '');
  let depth = 0;
  let start = -1;
  let inString = false;
  let escapeNext = false;
  let bestChunk = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth <= 0) continue;
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const chunk = text.slice(start, index + 1);
        if (chunk.length > bestChunk.length) {
          bestChunk = chunk;
        }
        start = -1;
      }
    }
  }

  return bestChunk || null;
}

function buildJsonClosers(source) {
  const text = String(source || '');
  const stack = [];
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }

    if (char === '}' && stack[stack.length - 1] === '{') {
      stack.pop();
      continue;
    }

    if (char === ']' && stack[stack.length - 1] === '[') {
      stack.pop();
    }
  }

  const closers = [];
  if (inString) {
    closers.push('"');
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    closers.push(entry === '{' ? '}' : ']');
  }

  return closers.join('');
}

function collectOuterCutPoints(source) {
  const text = String(source || '');
  const positions = [];
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === ',' || char === '}' || char === ']') {
      positions.push(index);
    }
  }

  return positions;
}

function repairPartialJSONObject(source) {
  const text = String(source || '').trim();
  if (!text) return null;

  const start = text.indexOf('{');
  if (start === -1) return null;

  const candidate = text.slice(start);
  const directParsed = tryParseJSON(`${candidate}${buildJsonClosers(candidate)}`);
  if (directParsed && typeof directParsed === 'object') {
    return directParsed;
  }

  const cutPoints = collectOuterCutPoints(candidate);
  for (let index = cutPoints.length - 1; index >= 0; index -= 1) {
    const cutPoint = cutPoints[index];
    const prefix = candidate[cutPoint] === ','
      ? candidate.slice(0, cutPoint)
      : candidate.slice(0, cutPoint + 1);
    const repaired = `${prefix}${buildJsonClosers(prefix)}`;
    const parsed = tryParseJSON(repaired);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  }

  return null;
}

function extractJSON(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const candidates = [];

  const fullTagMatch = cleaned.match(/<result>([\s\S]*?)<\/result>/i) || cleaned.match(/<r>([\s\S]*?)<\/r>/i);
  if (fullTagMatch?.[1]) {
    candidates.push(fullTagMatch[1].trim());
  }

  const openTagIndex = cleaned.search(/<result>/i);
  if (openTagIndex !== -1) {
    candidates.push(cleaned.slice(openTagIndex).replace(/<result>/i, '').trim());
  }

  const shortTagIndex = cleaned.search(/<r>/i);
  if (shortTagIndex !== -1) {
    candidates.push(cleaned.slice(shortTagIndex).replace(/<r>/i, '').trim());
  }

  candidates.push(cleaned);

  const balanced = extractBalancedJSONObject(cleaned);
  if (balanced) {
    candidates.push(balanced);
  }

  for (const candidate of candidates) {
    const parsed = tryParseJSON(candidate);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    const nestedBalanced = extractBalancedJSONObject(candidate);
    if (nestedBalanced) {
      const nestedParsed = tryParseJSON(nestedBalanced);
      if (nestedParsed && typeof nestedParsed === 'object') {
        return nestedParsed;
      }
    }

    const repaired = repairPartialJSONObject(candidate);
    if (repaired && typeof repaired === 'object') {
      return repaired;
    }
  }

  return null;
}

function getProviderFailureStatus(statusCode, message) {
  const lowerMessage = String(message || '').toLowerCase();

  if (
    statusCode === 401
    || statusCode === 403
    || lowerMessage.includes('invalid api key')
    || lowerMessage.includes('incorrect api key')
    || lowerMessage.includes('authentication')
    || lowerMessage.includes('unauthorized')
  ) {
    return 'invalid';
  }

  if (
    statusCode === 429
    || lowerMessage.includes('quota')
    || lowerMessage.includes('rate limit')
    || lowerMessage.includes('resource exhausted')
    || lowerMessage.includes('insufficient_quota')
  ) {
    return 'quota_exhausted';
  }

  return 'unknown';
}

function markProviderKeyFailure(aiConfig, statusCode, message) {
  if (!aiConfig?.providerKeyId) return;
  aiProviderKeyService.markProviderKeyStatus(
    aiConfig.providerKeyId,
    getProviderFailureStatus(statusCode, message),
    message
  );
}

function markProviderKeySuccess(aiConfig) {
  if (!aiConfig?.providerKeyId) return;
  aiProviderKeyService.markProviderKeyStatus(aiConfig.providerKeyId, 'valid', 'OSINT request succeeded.');
  aiProviderKeyService.markProviderKeyUsed(aiConfig.providerKeyId);
}

async function readProviderError(response, provider) {
  const raw = String(await response.text().catch(() => '')).trim();
  let message = `${provider} request failed (${response.status})`;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      message = parsed?.error?.message || parsed?.error || parsed?.message || message;
    } catch {
      message = raw.slice(0, 240);
    }
  }

  const error = new Error(message);
  error.status = response.status;
  error.raw = raw.slice(0, 4000);
  throw error;
}

function getAnthropicText(data) {
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((block) => block?.type === 'text' && block?.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function getGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function getOpenAICompatibleText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part.trim();
        if (typeof part?.text === 'string') return part.text.trim();
        if (typeof part?.content === 'string') return part.content.trim();
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

async function requestAnthropic(aiConfig, { systemPrompt, userContent, maxTokens = 1800 }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': aiConfig.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: aiConfig.model,
      max_tokens: maxTokens,
      temperature: 0.15,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userContent,
      }],
    }),
  });

  if (!response.ok) {
    await readProviderError(response, 'Anthropic');
  }

  const payload = await response.json();
  return getAnthropicText(payload);
}

async function requestGemini(aiConfig, { systemPrompt, parts, maxTokens = 1800 }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${aiConfig.model}:generateContent?key=${aiConfig.apiKey}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [{
          role: 'user',
          parts,
        }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );

  if (!response.ok) {
    await readProviderError(response, 'Gemini');
  }

  const payload = await response.json();
  return getGeminiText(payload);
}

async function requestOpenAICompatible(aiConfig, { systemPrompt, content, maxTokens = 1800 }) {
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
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      max_tokens: maxTokens,
      temperature: 0.15,
    }),
  });

  if (!response.ok) {
    await readProviderError(response, aiConfig.provider);
  }

  const payload = await response.json();
  return getOpenAICompatibleText(payload);
}

async function requestOSINTCompletion(aiConfig, request) {
  if (aiConfig.provider === 'anthropic') {
    return requestAnthropic(aiConfig, request);
  }

  if (aiConfig.provider === 'gemini') {
    return requestGemini(aiConfig, request);
  }

  if (getProviderCatalog(aiConfig.provider)?.apiStyle === 'openai') {
    return requestOpenAICompatible(aiConfig, request);
  }

  throw Object.assign(new Error(`Unsupported AI provider: ${aiConfig.provider}`), { status: 400 });
}

function shouldFallbackGeminiOsintModel(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();

  return (
    status === 404
    || (
      status === 400
      && message.includes('model')
      && (
        message.includes('unavailable')
        || message.includes('not found')
        || message.includes('not supported')
        || message.includes('does not exist')
      )
    )
    || ((status === 429 || status === 503) && (
      message.includes('high demand')
      || message.includes('resource exhausted')
      || message.includes('unavailable')
      || message.includes('quota')
    ))
  );
}

function isRetryableGeminiOsintError(error) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  return (
    [429, 500, 502, 503, 504].includes(status)
    || message.includes('high demand')
    || message.includes('temporar')
  );
}

async function requestOSINTCompletionWithFallback(aiConfig, request) {
  if (aiConfig.provider !== 'gemini') {
    return {
      text: await requestOSINTCompletion(aiConfig, request),
      model: aiConfig.model,
    };
  }

  const candidateModels = resolveGeminiOsintModelCandidates(aiConfig.model);
  let lastError = null;

  for (const model of candidateModels) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return {
          text: await requestGemini({ ...aiConfig, model }, request),
          model,
        };
      } catch (error) {
        lastError = error;

        if (shouldFallbackGeminiOsintModel(error)) {
          break;
        }

        if (isRetryableGeminiOsintError(error) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
          continue;
        }

        throw error;
      }
    }
  }

  throw lastError || Object.assign(new Error('Analyse geolocator indisponible pour les modeles Gemini configures.'), { status: 503 });
}

function normalizeCoordinates(coordinates) {
  const lat = Number(coordinates?.lat);
  const lon = Number(coordinates?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };
}

function buildFetchSignal(timeoutMs = 8000) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...OSINT_FETCH_HEADERS,
      accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
    },
    signal: options.signal || buildFetchSignal(),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function parseDiscordSnowflakeCreatedAt(discordId) {
  const value = String(discordId || '').trim();
  if (!/^\d{16,22}$/.test(value)) return null;

  try {
    const timestamp = Number((BigInt(value) >> 22n) + 1420070400000n);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function cleanDiscordIdentity(value) {
  return String(value || '')
    .trim()
    .replace(/^<@!?(\d+)>$/, '$1')
    .replace(/^discord\.gg\//i, '')
    .replace(/^@+/, '')
    .slice(0, 120);
}

function scoreDiscordCandidate(identity, candidate) {
  const lowered = String(identity || '').trim().toLowerCase();
  const names = uniqueStrings([
    candidate?.display_name,
    candidate?.username,
    candidate?.global_name,
    ...(candidate?.observed_names || []),
  ], 12).map((entry) => entry.toLowerCase());

  let score = Number(candidate?.server_count || 0) * 4;
  if (candidate?.source === 'site_link') score += 20;

  for (const name of names) {
    if (!name) continue;
    if (name === lowered) score += 120;
    else if (name.startsWith(lowered)) score += 40;
    else if (name.includes(lowered)) score += 12;
  }

  return score;
}

function buildDiscordProfileFromApi(user) {
  if (!user?.id) return null;

  return {
    id: String(user.id),
    username: user.username || null,
    global_name: user.global_name || null,
    display_name: user.global_name || user.username || user.id,
    avatar_url: discordService.getAvatarUrl(user.id, user.avatar, 512, user.discriminator),
    banner_url: discordService.getBannerUrl(user.id, user.banner, 1024),
    banner_color: user.banner_color || null,
    avatar_animated: Boolean(user.avatar && String(user.avatar).startsWith('a_')),
    banner_animated: Boolean(user.banner && String(user.banner).startsWith('a_')),
    created_at: parseDiscordSnowflakeCreatedAt(user.id),
    source: 'discord_api',
  };
}

function buildDiscordProfileFromRow(row) {
  if (!row?.discord_id) return null;

  return {
    id: String(row.discord_id),
    username: row.discord_username || null,
    global_name: row.discord_global_name || null,
    display_name: row.discord_global_name || row.discord_username || row.username || row.discord_id,
    avatar_url: row.discord_avatar_url || row.avatar_url || null,
    banner_url: row.discord_banner_url || null,
    banner_color: row.discord_banner_color || null,
    avatar_animated: Boolean(Number(row.discord_avatar_animated || 0)),
    banner_animated: Boolean(Number(row.discord_banner_animated || 0)),
    created_at: parseDiscordSnowflakeCreatedAt(row.discord_id),
    source: 'site_link',
  };
}

function buildDiscordCandidate(row) {
  return {
    id: String(row.discord_id || row.id),
    username: row.discord_username || null,
    global_name: row.discord_global_name || null,
    display_name: row.discord_global_name || row.discord_username || row.username || row.discord_id || row.id,
    avatar_url: row.discord_avatar_url || row.avatar_url || null,
    source: row.discord_id ? 'site_link' : 'site_user',
    observed_names: uniqueStrings([row.discord_username, row.discord_global_name, row.username]),
    server_count: Number(row.server_count || 0) || 0,
  };
}

function buildDiscordCandidateFromGuildMember(member) {
  const user = member?.user || null;
  if (!user?.id) return null;

  const avatarHash = user.avatar || member.avatar || null;

  return {
    id: String(user.id),
    username: user.username || null,
    global_name: user.global_name || null,
    display_name: member.nick || user.global_name || user.username || user.id,
    avatar_url: discordService.getAvatarUrl(user.id, avatarHash, 256, user.discriminator),
    source: 'guild_search',
    observed_names: uniqueStrings([member.nick, user.global_name, user.username]),
    server_count: 1,
  };
}

function buildDiscordProfileFromGuildCandidate(candidate) {
  if (!candidate?.id) return null;

  return {
    id: String(candidate.id),
    username: candidate.username || null,
    global_name: candidate.global_name || null,
    display_name: candidate.display_name || candidate.global_name || candidate.username || candidate.id,
    avatar_url: candidate.avatar_url || null,
    banner_url: null,
    banner_color: null,
    avatar_animated: false,
    banner_animated: false,
    created_at: parseDiscordSnowflakeCreatedAt(candidate.id),
    source: 'guild_search',
  };
}

function mergeDiscordCandidates(...groups) {
  const byId = new Map();

  for (const candidate of groups.flat().filter(Boolean)) {
    const key = String(candidate.id || candidate.username || candidate.display_name || '').trim();
    if (!key) continue;

    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, {
        ...candidate,
        observed_names: uniqueStrings(candidate.observed_names || []),
        server_count: Number(candidate.server_count || 0) || 0,
      });
      continue;
    }

    existing.username = existing.username || candidate.username || null;
    existing.global_name = existing.global_name || candidate.global_name || null;
    existing.display_name = existing.display_name || candidate.display_name || existing.username || key;
    existing.avatar_url = existing.avatar_url || candidate.avatar_url || null;
    existing.server_count = Math.max(Number(existing.server_count || 0), Number(candidate.server_count || 0));
    existing.observed_names = uniqueStrings([...(existing.observed_names || []), ...(candidate.observed_names || [])]);
    if (existing.source !== 'site_link' && candidate.source === 'site_link') {
      existing.source = 'site_link';
    } else if (existing.source === 'site_user' && candidate.source === 'guild_search') {
      existing.source = 'guild_search';
    }
  }

  return Array.from(byId.values());
}

function enrichDiscordProfile(profile, context = {}) {
  const observedNames = uniqueStrings([
    profile?.username,
    profile?.global_name,
    profile?.display_name,
    ...(context.guildCandidate?.observed_names || []),
    context.linkedRow?.username,
    context.linkedRow?.discord_username,
    context.linkedRow?.discord_global_name,
  ], 10);

  const sources = uniqueStrings([
    profile?.source === 'discord_api' ? 'API Discord' : '',
    context.linkedRow ? 'Compte lie au site' : '',
    context.guildCandidate ? 'Serveurs relies au bot' : '',
  ], 4);

  const serverCount = Number(context.guildCandidate?.server_count || 0) || 0;
  const aliasCount = Math.max(0, observedNames.length - 1);
  const sourceCount = Math.max(1, sources.length);

  return {
    ...profile,
    summary: normalizeShortText(
      [
        serverCount ? `Profil recoupe sur ${serverCount} serveur(s) relie(s) au bot.` : '',
        sourceCount > 1 ? `${sourceCount} recoupements publics consolides.` : 'Profil public resolu.',
        aliasCount ? `${aliasCount} alias ou pseudo(s) public(s) observe(s).` : '',
      ].filter(Boolean).join(' '),
      320
    ),
    sources,
    server_count: serverCount,
    observed_names: observedNames,
    facts: [
      { label: 'Pseudo', value: profile?.username || '--' },
      { label: 'Nom global', value: profile?.global_name || '--' },
      { label: 'ID Discord', value: profile?.id || '--' },
      { label: 'Creation', value: profile?.created_at ? new Date(profile.created_at).toLocaleDateString('fr-FR') : '--' },
      sourceCount ? { label: 'Recoupements', value: `${sourceCount} source(s)` } : null,
      serverCount ? { label: 'Serveurs relies', value: String(serverCount) } : null,
      aliasCount ? { label: 'Alias observes', value: String(aliasCount) } : null,
    ].filter(Boolean),
    sections: [
      sources.length ? { title: 'Recoupements', items: sources } : null,
      observedNames.length > 1 ? { title: 'Alias observes', items: observedNames.filter((entry) => entry !== profile?.display_name).slice(0, 8) } : null,
    ].filter(Boolean),
  };
}

function formatDiscordLookupResponse(identity, profile, candidates = [], note = '') {
  return {
    query: identity,
    profile,
    candidates,
    note: note || '',
  };
}

async function fetchDiscordProfileFromBot(userId, discordId) {
  const tokenRow = db.findOne('bot_tokens', { user_id: userId });
  if (!tokenRow?.encrypted_token) return null;

  try {
    const token = decrypt(tokenRow.encrypted_token);
    const user = await discordService.getUser(token, discordId);
    return buildDiscordProfileFromApi(user);
  } catch (error) {
    logger.debug?.('Discord public profile lookup failed via bot token', {
      userId,
      discordId,
      message: error?.message || 'lookup_failed',
    });
    return null;
  }
}

function searchLinkedDiscordCandidates(identity) {
  const lowered = String(identity || '').trim().toLowerCase();
  if (!lowered) return [];
  const likeQuery = `%${lowered.replace(/[%_]/g, '')}%`;

  return db.raw(
    `
      SELECT
        id,
        username,
        avatar_url,
        discord_id,
        discord_username,
        discord_global_name,
        discord_avatar_url,
        discord_banner_url,
        discord_banner_color,
        discord_avatar_animated,
        discord_banner_animated,
        discord_profile_synced_at
      FROM users
      WHERE discord_id = ?
         OR lower(COALESCE(discord_username, '')) = ?
         OR lower(COALESCE(discord_global_name, '')) = ?
         OR lower(COALESCE(discord_username, '')) LIKE ?
         OR lower(COALESCE(discord_global_name, '')) LIKE ?
         OR lower(COALESCE(username, '')) LIKE ?
      ORDER BY updated_at DESC
      LIMIT 12
    `,
    [identity, lowered, lowered, likeQuery, likeQuery, likeQuery]
  );
}

async function searchDiscordCandidatesAcrossGuilds(userId, identity) {
  const cleanedIdentity = cleanDiscordIdentity(identity);
  if (!cleanedIdentity || cleanedIdentity.length < 2) return [];

  const tokenRow = db.findOne('bot_tokens', { user_id: userId });
  if (!tokenRow?.encrypted_token) return [];

  try {
    const token = decrypt(tokenRow.encrypted_token);
    const guilds = safeArray(await discordService.getBotGuilds(token)).slice(0, 40);
    if (!guilds.length) return [];

    const hits = await runLimited(guilds, 5, async (guild) => {
      try {
        const members = safeArray(await discordService.searchGuildMembers(token, guild.id, cleanedIdentity, 4));
        return members.map(buildDiscordCandidateFromGuildMember).filter(Boolean);
      } catch (error) {
        logger.debug?.('Discord guild search skipped', {
          guildId: guild.id,
          query: cleanedIdentity,
          message: error?.message || 'guild_search_failed',
        });
        return [];
      }
    });

    return mergeDiscordCandidates(...hits)
      .sort((left, right) => scoreDiscordCandidate(cleanedIdentity, right) - scoreDiscordCandidate(cleanedIdentity, left))
      .slice(0, 8);
  } catch (error) {
    logger.debug?.('Discord cross-guild search failed', {
      userId,
      query: cleanedIdentity,
      message: error?.message || 'cross_guild_search_failed',
    });
    return [];
  }
}

async function lookupDiscordPublicProfile(userId, identity) {
  const cleanedIdentity = cleanDiscordIdentity(identity);
  if (!cleanedIdentity) {
    const error = new Error('Identifiant Discord invalide');
    error.status = 400;
    throw error;
  }

  const directId = /^\d{16,22}$/.test(cleanedIdentity) ? cleanedIdentity : null;

  if (directId) {
    const liveProfile = await fetchDiscordProfileFromBot(userId, directId);
    const guildCandidate = (await searchDiscordCandidatesAcrossGuilds(userId, directId)).find((entry) => entry.id === directId) || null;
    if (liveProfile) {
      const linkedRow = db.findOne('users', { discord_id: directId });
      return formatDiscordLookupResponse(
        cleanedIdentity,
        enrichDiscordProfile(liveProfile, { linkedRow, guildCandidate }),
        mergeDiscordCandidates(linkedRow ? [buildDiscordCandidate(linkedRow)] : [], guildCandidate ? [guildCandidate] : [])
      );
    }

    const linkedRow = db.findOne('users', { discord_id: directId });
    if (linkedRow) {
      return formatDiscordLookupResponse(
        cleanedIdentity,
        enrichDiscordProfile(buildDiscordProfileFromRow(linkedRow), { linkedRow, guildCandidate }),
        mergeDiscordCandidates([buildDiscordCandidate(linkedRow)], guildCandidate ? [guildCandidate] : [])
      );
    }

    if (guildCandidate) {
      return formatDiscordLookupResponse(
        cleanedIdentity,
        enrichDiscordProfile(buildDiscordProfileFromGuildCandidate(guildCandidate), { guildCandidate }),
        [guildCandidate],
        'Profil resolu via les serveurs relies au bot.'
      );
    }

    const error = new Error('Profil Discord introuvable pour cet ID');
    error.status = 404;
    throw error;
  }

  const linkedCandidates = searchLinkedDiscordCandidates(cleanedIdentity).map(buildDiscordCandidate);
  const guildCandidates = await searchDiscordCandidatesAcrossGuilds(userId, cleanedIdentity);
  const candidates = mergeDiscordCandidates(linkedCandidates, guildCandidates)
    .sort((left, right) => scoreDiscordCandidate(cleanedIdentity, right) - scoreDiscordCandidate(cleanedIdentity, left));

  if (!candidates.length) {
    const error = new Error('Aucun profil Discord public resoluble pour ce pseudo ou cet identifiant.');
    error.status = 404;
    throw error;
  }

  const primary = candidates[0];
  const linkedRow = primary?.id ? db.findOne('users', { discord_id: primary.id }) : null;
  const guildCandidate = guildCandidates.find((entry) => entry.id === primary?.id) || null;
  const liveProfile = primary?.id ? await fetchDiscordProfileFromBot(userId, primary.id) : null;
  const profile = liveProfile || buildDiscordProfileFromRow(linkedRow) || buildDiscordProfileFromGuildCandidate(primary);

  return formatDiscordLookupResponse(
    cleanedIdentity,
    enrichDiscordProfile(profile, { linkedRow, guildCandidate }),
    candidates,
    candidates.length > 1
      ? 'Plusieurs correspondances publiques ont ete trouvees. La meilleure correspondance est affichee en premier.'
      : 'Profil public resolu.'
  );
}

function pickAddressField(address, keys) {
  for (const key of keys) {
    const value = normalizeShortText(address?.[key], 120);
    if (value) return value;
  }
  return '';
}

async function reverseGeocodeCoordinates(coordinates) {
  if (!coordinates) return null;

  try {
    return await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(coordinates.lat)}&lon=${encodeURIComponent(coordinates.lon)}&format=jsonv2&zoom=18&addressdetails=1`,
      {
        headers: {
          accept: 'application/json',
        },
      }
    );
  } catch {
    return null;
  }
}

async function geocodeFromQuery(query, limit = 3) {
  const cleanedQuery = normalizeShortText(query, 220);
  if (!cleanedQuery) return null;

  try {
    const payload = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${clamp(Number(limit) || 3, 1, 5)}&q=${encodeURIComponent(cleanedQuery)}`
    );
    return Array.isArray(payload) ? payload.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildLocationTokens(values) {
  return Array.from(new Set(
    safeArray(values)
      .flatMap((entry) => String(entry || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3))
  ));
}

function haversineDistanceMeters(left, right) {
  const lat1 = Number(left?.lat);
  const lon1 = Number(left?.lon);
  const lat2 = Number(right?.lat);
  const lon2 = Number(right?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = (
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  );
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pickFeatureClass(tags = {}) {
  return (
    tags.tourism
    || tags.amenity
    || tags.historic
    || tags.leisure
    || tags.shop
    || tags.office
    || tags.railway
    || tags.highway
    || tags.man_made
    || tags.natural
    || tags.waterway
    || tags.place
    || tags.building
    || ''
  );
}

async function fetchNearbyPublicFeatures(coordinates) {
  if (!coordinates) return [];

  const radius = 1800;
  const query = [
    '[out:json][timeout:15];',
    '(',
    `node(around:${radius},${coordinates.lat},${coordinates.lon})["name"];`,
    `way(around:${radius},${coordinates.lat},${coordinates.lon})["name"];`,
    `relation(around:${radius},${coordinates.lat},${coordinates.lon})["name"];`,
    ');',
    'out tags center;',
  ].join('');

  try {
    const payload = await fetchJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];

    return elements
      .map((element) => {
        const lat = Number(element?.lat ?? element?.center?.lat);
        const lon = Number(element?.lon ?? element?.center?.lon);
        const name = normalizeShortText(element?.tags?.name, 140);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        return {
          name,
          className: normalizeShortText(pickFeatureClass(element.tags), 60),
          coordinates: { lat, lon },
          distance_m: Math.round(haversineDistanceMeters(coordinates, { lat, lon })),
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.distance_m - right.distance_m)
      .slice(0, 60);
  } catch {
    return [];
  }
}

function scoreNearbyFeature(feature, result) {
  const haystack = `${feature?.name || ''} ${feature?.className || ''}`.toLowerCase();
  const tokens = buildLocationTokens([
    result.landmark,
    result.exact_location,
    result.district,
    result.city,
    result.region,
    result.country,
    result.maps_search,
    ...safeArray(result.clues).map((entry) => entry?.detail),
  ]);

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length > 5 ? 6 : 3;
  }

  const distance = Number(feature?.distance_m);
  if (Number.isFinite(distance)) {
    score += Math.max(0, 12 - (distance / 80));
    if (distance <= 80) score += 8;
    else if (distance <= 180) score += 5;
    else if (distance <= 350) score += 2;
  }

  if (['tourism', 'amenity', 'historic', 'leisure', 'railway', 'highway', 'man_made', 'place', 'building'].some((entry) => String(feature?.className || '').includes(entry))) {
    score += 1.5;
  }

  return score;
}

function scoreGeocodedCandidate(candidate, query, result) {
  const haystack = [
    candidate?.display_name,
    candidate?.name,
    candidate?.type,
    candidate?.class,
    candidate?.addresstype,
  ].join(' ').toLowerCase();

  const weightedSources = [
    { value: result.exact_location, weight: 10 },
    { value: result.landmark, weight: 9 },
    { value: result.district, weight: 7 },
    { value: result.city, weight: 7 },
    { value: result.region, weight: 5 },
    { value: result.country, weight: 4 },
    { value: query, weight: 3 },
  ];

  let score = 0;
  for (const source of weightedSources) {
    for (const token of buildLocationTokens([source.value])) {
      if (haystack.includes(token)) {
        score += source.weight;
      }
    }
  }

  const importance = Number(candidate?.importance);
  if (Number.isFinite(importance)) {
    score += importance * 5;
  }

  if (['building', 'amenity', 'tourism', 'leisure', 'shop', 'office'].includes(String(candidate?.class || '').toLowerCase())) {
    score += 2;
  }

  if (['house', 'building', 'retail', 'commercial', 'residential', 'amenity', 'suburb', 'neighbourhood', 'quarter'].includes(String(candidate?.type || '').toLowerCase())) {
    score += 2;
  }

  return score;
}

function buildGeolocationSearchQueries(result) {
  return uniqueStrings([
    result.exact_location,
    [result.landmark, result.exact_location, result.district, result.city, result.region, result.country].filter(Boolean).join(', '),
    [result.landmark, result.district, result.city, result.country].filter(Boolean).join(', '),
    [result.landmark, result.city, result.country].filter(Boolean).join(', '),
    [result.district, result.city, result.region, result.country].filter(Boolean).join(', '),
    [result.city, result.region, result.country].filter(Boolean).join(', '),
    result.maps_search,
  ], 8);
}

function mergeGeolocationClues(result, resolved, matchedQuery, referenceImages = []) {
  const nextClues = safeArray(result.clues).slice(0, 10);
  const seen = new Set(nextClues.map((entry) => `${entry.type}|${entry.detail}`));
  const additions = [
    matchedQuery ? {
      type: 'Recherche cartographique',
      detail: `Requete retenue: ${matchedQuery}`,
      weight: 'medium',
    } : null,
    resolved.landmark ? {
      type: 'Repere probable',
      detail: resolved.landmark,
      weight: 'high',
    } : null,
    [resolved.district, resolved.city, resolved.region, resolved.country].filter(Boolean).length ? {
      type: 'Zone resolue',
      detail: [resolved.district, resolved.city, resolved.region, resolved.country].filter(Boolean).join(', '),
      weight: 'medium',
    } : null,
    referenceImages.length ? {
      type: 'Reperes publics',
      detail: referenceImages.map((entry) => entry.title).filter(Boolean).slice(0, 3).join(', '),
      weight: 'medium',
    } : null,
  ].filter(Boolean);

  for (const clue of additions) {
    const key = `${clue.type}|${clue.detail}`;
    if (!clue.detail || seen.has(key)) continue;
    seen.add(key);
    nextClues.push(clue);
  }

  return nextClues.slice(0, 12);
}

async function fetchWikipediaReferences(coordinates) {
  if (!coordinates) return [];

  try {
    const geoPayload = await fetchJson(
      `https://fr.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${encodeURIComponent(`${coordinates.lat}|${coordinates.lon}`)}&gsradius=5000&gslimit=6&format=json&origin=*`
    );
    const geoItems = Array.isArray(geoPayload?.query?.geosearch) ? geoPayload.query.geosearch : [];
    if (!geoItems.length) return [];

    const pageIds = geoItems.map((entry) => entry.pageid).join('|');
    const pagePayload = await fetchJson(
      `https://fr.wikipedia.org/w/api.php?action=query&pageids=${encodeURIComponent(pageIds)}&prop=pageimages|info&inprop=url&pithumbsize=900&format=json&origin=*`
    );
    const pages = pagePayload?.query?.pages || {};

    return geoItems.map((item) => {
      const page = pages[item.pageid] || {};
      return {
        title: normalizeShortText(item.title, 120),
        distance_m: Number.isFinite(Number(item.dist)) ? Math.round(Number(item.dist)) : null,
        image_url: page?.thumbnail?.source || null,
        page_url: page?.fullurl || null,
        source: 'Wikipedia',
      };
    }).filter((entry) => entry.title && (entry.image_url || entry.page_url));
  } catch {
    return [];
  }
}

function buildMapLinks(coordinates, mapsSearch) {
  if (coordinates) {
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinates.lat},${coordinates.lon}`)}`,
      osm: `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lon}&zoom=19`,
    };
  }

  const cleanedQuery = normalizeShortText(mapsSearch, 220);
  if (!cleanedQuery) return null;

  return {
    google: `https://www.google.com/maps/search/${encodeURIComponent(cleanedQuery)}`,
    osm: `https://www.openstreetmap.org/search?query=${encodeURIComponent(cleanedQuery)}`,
  };
}

async function enhanceGeolocationResult(result) {
  let nextCoordinates = result.coordinates;
  let reverseGeocode = null;
  let matchedQuery = '';

  if (!nextCoordinates) {
    const queryCandidates = buildGeolocationSearchQueries(result);
    let bestCandidate = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const query of queryCandidates) {
      const geocodedResults = await geocodeFromQuery(query, 3);
      for (const geocoded of geocodedResults) {
        const lat = Number(geocoded?.lat);
        const lon = Number(geocoded?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const score = scoreGeocodedCandidate(geocoded, query, result);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = geocoded;
          matchedQuery = query;
        }
      }
    }

    if (bestCandidate) {
      nextCoordinates = normalizeCoordinates({
        lat: Number(bestCandidate.lat),
        lon: Number(bestCandidate.lon),
      });
    }
  }

  if (nextCoordinates) {
    reverseGeocode = await reverseGeocodeCoordinates(nextCoordinates);
  }

  const nearbyFeatures = await fetchNearbyPublicFeatures(nextCoordinates);
  const bestFeature = nearbyFeatures
    .map((feature) => ({ ...feature, score: scoreNearbyFeature(feature, result) }))
    .sort((left, right) => right.score - left.score)[0] || null;

  const address = reverseGeocode?.address || {};
  const resolvedCountry = result.country || normalizeShortText(address.country, 120);
  const resolvedCountryCode = result.country_code || normalizeShortText(address.country_code, 12).toUpperCase();
  const resolvedRegion = result.region || pickAddressField(address, ['state', 'region', 'county']);
  const resolvedCity = result.city || pickAddressField(address, ['city', 'town', 'village', 'municipality']);
  const resolvedDistrict = result.district || pickAddressField(address, ['neighbourhood', 'suburb', 'borough', 'city_district']);
  const resolvedLandmark = result.landmark || (bestFeature?.score >= 7 ? bestFeature.name : '');
  const resolvedExactLocation = (
    (bestFeature?.score >= 7 && bestFeature?.name)
      ? [bestFeature.name, resolvedDistrict, resolvedCity, resolvedRegion, resolvedCountry].filter(Boolean).join(', ')
      : result.exact_location || normalizeShortText(reverseGeocode?.display_name, 220)
  );
  const resolvedMapsSearch = result.maps_search || matchedQuery || [resolvedLandmark || bestFeature?.name, resolvedExactLocation, resolvedDistrict, resolvedCity, resolvedRegion, resolvedCountry].filter(Boolean).join(', ');
  const snappedCoordinates = (
    result.precision_source !== 'metadata_image'
    && bestFeature?.score >= 8
    && Number(bestFeature?.distance_m) <= 350
  ) ? normalizeCoordinates(bestFeature.coordinates) : nextCoordinates;
  const reference_images = [];

  return {
    ...result,
    country: resolvedCountry,
    country_code: resolvedCountryCode,
    region: resolvedRegion,
    city: resolvedCity,
    district: resolvedDistrict,
    exact_location: resolvedExactLocation,
    landmark: resolvedLandmark,
    coordinates: snappedCoordinates,
    maps_search: resolvedMapsSearch,
    clues: mergeGeolocationClues(result, {
      district: resolvedDistrict,
      city: resolvedCity,
      region: resolvedRegion,
      country: resolvedCountry,
      landmark: resolvedLandmark,
    }, matchedQuery, reference_images),
    map_links: buildMapLinks(snappedCoordinates, resolvedMapsSearch),
    reference_images,
  };
}

function normalizeGeolocationResult(rawResult) {
  const clues = Array.isArray(rawResult?.clues) ? rawResult.clues : [];
  const alternatives = Array.isArray(rawResult?.alternative_locations) ? rawResult.alternative_locations : [];

  return {
    confidence: normalizeConfidenceLabel(rawResult?.confidence),
    country: normalizeShortText(rawResult?.country, 120),
    country_code: normalizeShortText(rawResult?.country_code, 12).toUpperCase(),
    region: normalizeShortText(rawResult?.region, 120),
    city: normalizeShortText(rawResult?.city, 120),
    district: normalizeShortText(rawResult?.district, 120),
    exact_location: normalizeShortText(rawResult?.exact_location, 220),
    landmark: normalizeShortText(rawResult?.landmark, 160),
    coordinates: normalizeCoordinates(rawResult?.coordinates),
    maps_search: normalizeShortText(rawResult?.maps_search, 220),
    clues: clues
      .map((clue) => ({
        type: normalizeShortText(clue?.type || 'Other', 60) || 'Other',
        detail: normalizeShortText(clue?.detail, 240),
        weight: normalizeClueWeight(clue?.weight),
      }))
      .filter((clue) => clue.detail),
    time_of_day: normalizeFrenchTimeOfDay(rawResult?.time_of_day),
    weather_conditions: normalizeShortText(rawResult?.weather_conditions, 120),
    analysis: normalizeShortText(rawResult?.analysis, 1200),
    precision_source: normalizeShortText(rawResult?.precision_source, 80),
    captured_at: normalizeShortText(rawResult?.captured_at, 40),
    alternative_locations: alternatives
      .map((entry) => normalizeShortText(entry, 160))
      .filter(Boolean)
      .slice(0, 6),
  };
}

async function scanUsername(userId, username) {
  const cleanedUsername = cleanDiscordIdentity(username).slice(0, 60);
  let resolvedInput = {
    query: cleanedUsername,
    type: 'username',
    username: cleanedUsername,
    discord_user: null,
  };

  try {
    if (/^\d{16,22}$/.test(cleanedUsername)) {
      const tokenRow = db.findOne('bot_tokens', { user_id: userId });
      if (tokenRow?.encrypted_token) {
        try {
          const token = decrypt(tokenRow.encrypted_token);
          const discordUser = await discordService.getUser(token, cleanedUsername);
          const resolvedUsername = String(discordUser?.username || '').trim() || cleanedUsername;
          resolvedInput = {
            query: cleanedUsername,
            type: 'discord_id',
            username: resolvedUsername,
            discord_user: discordUser ? {
              id: discordUser.id,
              username: discordUser.username || null,
              global_name: discordUser.global_name || null,
              display_name: discordUser.global_name || discordUser.username || discordUser.id,
              avatar_url: discordService.getAvatarUrl(discordUser.id, discordUser.avatar, 128, discordUser.discriminator),
            } : null,
          };
        } catch (resolutionError) {
          logger.debug?.('Discord ID resolution failed for OSINT username scan', {
            userId,
            query: cleanedUsername,
            message: resolutionError?.message || 'resolution_failed',
          });
        }
      }
    }

    const payload = await usernameProbeService.scanUsername(resolvedInput.username);
    return {
      ...payload,
      input: resolvedInput,
    };
  } catch (error) {
    logger.warn('Username OSINT scan failed', {
      userId,
      message: error?.message || 'unknown_error',
      status: error?.status || null,
    });
    throw error;
  }
}

async function geolocateImage(userId, { imageBase64, mimeType }) {
  const aiConfig = aiService.getAIConfig();
  if (!aiConfig) {
    const error = new Error('OSINT indisponible - IA non configuree');
    error.status = 503;
    throw error;
  }

  const imageMetadata = extractImageMetadata(imageBase64);
  const systemPrompt = [
    'You are a cautious image geolocation analyst.',
    'Inspect the photo carefully and infer only what is visually supported.',
    'Prefer city, district, landmark, neighbourhood, or public place precision over invented exact addresses.',
    'If coordinates are uncertain, leave them empty instead of guessing.',
    'Extract public visual clues such as language, signs, storefronts, road layout, architecture, vegetation, terrain, transit hints, brands, uniforms, plates, landmarks, skyline, coastline, mountains, and public infrastructure.',
    'Explain likely environment, nearby landmark hypotheses, probable city zone, and plausible alternatives.',
    'Return only one JSON object wrapped in <result></result>.',
    'Do not use markdown.',
  ].join(' ');
  const userPrompt = [
    'Analyze this image and estimate where it was taken using visible clues only.',
    'Respond with compact JSON only.',
    'Use this exact schema:',
    '<result>{"confidence":"haute","country":"...","country_code":"...","region":"...","city":"...","district":"...","exact_location":"...","landmark":null,"coordinates":{"lat":0.0,"lon":0.0},"maps_search":"...","clues":[{"type":"Architecture","detail":"...","weight":"high"}],"time_of_day":"...","weather_conditions":"...","analysis":"...","alternative_locations":["..."]}</result>',
    'Target the most plausible city, district, street area, or landmark when possible.',
    'When a public landmark, district, station, avenue, beach, stadium, mall, bridge, or mountain is likely, include it in landmark or exact_location.',
    'Return 6 to 12 concrete clues when possible, not generic clues.',
    'Do not return more than 12 clues or 6 alternative locations.',
    'If a field is unknown, return an empty string or null instead of inventing data.',
    'maps_search must be a clean map query with the best probable public location, not a sentence.',
  ].join('\n');

  const anthropicImageContent = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: imageBase64,
      },
    },
    {
      type: 'text',
      text: userPrompt,
    },
  ];

  const geminiParts = [
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: userPrompt,
    },
  ];

  const openAIContent = [
    {
      type: 'text',
      text: userPrompt,
    },
    {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${imageBase64}`,
      },
    },
  ];

  try {
    const completion = await requestOSINTCompletionWithFallback(aiConfig, {
      systemPrompt,
      userContent: anthropicImageContent,
      parts: geminiParts,
      content: openAIContent,
      maxTokens: 1400,
    });
    const rawText = String(completion?.text || '');
    const parsed = extractJSON(rawText);

    if (!parsed || typeof parsed !== 'object') {
      const error = new Error('JSON de geolocalisation introuvable dans la reponse IA');
      error.status = 502;
      error.raw = rawText.slice(0, 2500);
      throw error;
    }

    markProviderKeySuccess(aiConfig);

    const normalized = normalizeGeolocationResult(parsed);
    if (imageMetadata?.hasExactCoordinates) {
      normalized.coordinates = imageMetadata.coordinates;
      normalized.precision_source = 'metadata_image';
    }
    if (imageMetadata?.hasCapturedAt) {
      normalized.time_of_day = imageMetadata.capturedAt;
      normalized.captured_at = imageMetadata.capturedAt;
    }
    const enhanced = await enhanceGeolocationResult(normalized);

    return {
      ...enhanced,
      meta: {
        provider: aiConfig.provider,
        model: completion?.model || aiConfig.model,
        exact_coordinates_from_metadata: Boolean(imageMetadata?.hasExactCoordinates),
        captured_at_from_metadata: Boolean(imageMetadata?.hasCapturedAt),
      },
    };
  } catch (error) {
    const lowerMessage = String(error?.message || '').toLowerCase();
    if (Number(error?.status || 0) === 503 && lowerMessage.includes('high demand')) {
      error.message = 'Le moteur visuel est temporairement sature. Reessaie dans quelques instants.';
      error.raw = '';
    } else if (
      Number(error?.status || 0) === 429
      || lowerMessage.includes('quota')
      || lowerMessage.includes('resource exhausted')
      || lowerMessage.includes('insufficient_quota')
    ) {
      error.message = 'Le quota visuel IA est temporairement indisponible ou atteint. Reessaie plus tard ou change de modele.';
      error.raw = '';
    }
    markProviderKeyFailure(aiConfig, error?.status, error?.message);
    logger.warn('Image geolocation failed', {
      userId,
      provider: aiConfig.provider,
      model: aiConfig.model,
      message: error?.message || 'unknown_error',
      status: error?.status || null,
    });
    throw error;
  }
}

function getStatus() {
  const aiConfig = aiService.getAIConfig();
  const usernameCatalog = usernameProbeService.getCatalogStatus();

  return {
    configured: Boolean(usernameCatalog?.count || aiConfig),
    usernameConfigured: Boolean(usernameCatalog?.count),
    usernameSiteCount: usernameCatalog?.count || 0,
    usernameSource: usernameCatalog?.source || null,
    usernameSnapshotUpdatedAt: usernameCatalog?.snapshotUpdatedAt || null,
    imageConfigured: Boolean(aiConfig),
    provider: aiConfig?.provider || null,
    model: aiConfig?.model || null,
    imageSupported: Boolean(aiConfig),
  };
}

module.exports = {
  scanUsername,
  lookupDiscordPublicProfile,
  geolocateImage,
  getStatus,
};
