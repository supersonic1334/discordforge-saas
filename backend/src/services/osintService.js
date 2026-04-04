'use strict';

const aiService = require('./aiService');
const aiProviderKeyService = require('./aiProviderKeyService');
const usernameProbeService = require('./usernameProbeService');
const discordService = require('./discordService');
const db = require('../database');
const logger = require('../utils/logger').child('OSINTService');
const { getProviderCatalog } = require('../config/aiCatalog');
const { decrypt } = require('./encryptionService');

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
      ORDER BY updated_at DESC
      LIMIT 8
    `,
    [identity, lowered, lowered]
  );
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
    if (liveProfile) {
      const linkedRow = db.findOne('users', { discord_id: directId });
      return formatDiscordLookupResponse(cleanedIdentity, liveProfile, linkedRow ? [buildDiscordCandidate(linkedRow)] : []);
    }

    const linkedRow = db.findOne('users', { discord_id: directId });
    if (linkedRow) {
      return formatDiscordLookupResponse(cleanedIdentity, buildDiscordProfileFromRow(linkedRow), [buildDiscordCandidate(linkedRow)]);
    }

    const error = new Error('Profil Discord introuvable pour cet ID');
    error.status = 404;
    throw error;
  }

  const candidates = searchLinkedDiscordCandidates(cleanedIdentity);
  if (!candidates.length) {
    const error = new Error('Aucun profil Discord public resoluble. Utilise de preference un ID ou une mention.');
    error.status = 404;
    throw error;
  }

  const primary = candidates[0];
  const liveProfile = primary?.discord_id ? await fetchDiscordProfileFromBot(userId, primary.discord_id) : null;

  return formatDiscordLookupResponse(
    cleanedIdentity,
    liveProfile || buildDiscordProfileFromRow(primary),
    candidates.map(buildDiscordCandidate),
    'Recherche publique fiable : ID ou mention Discord recommandes.'
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

async function geocodeFromQuery(query) {
  const cleanedQuery = normalizeShortText(query, 220);
  if (!cleanedQuery) return null;

  try {
    const payload = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(cleanedQuery)}`
    );
    return Array.isArray(payload) ? payload[0] || null : null;
  } catch {
    return null;
  }
}

async function fetchWikipediaReferences(coordinates) {
  if (!coordinates) return [];

  try {
    const geoPayload = await fetchJson(
      `https://fr.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${encodeURIComponent(`${coordinates.lat}|${coordinates.lon}`)}&gsradius=2500&gslimit=4&format=json&origin=*`
    );
    const geoItems = Array.isArray(geoPayload?.query?.geosearch) ? geoPayload.query.geosearch : [];
    if (!geoItems.length) return [];

    const pageIds = geoItems.map((entry) => entry.pageid).join('|');
    const pagePayload = await fetchJson(
      `https://fr.wikipedia.org/w/api.php?action=query&pageids=${encodeURIComponent(pageIds)}&prop=pageimages|info&inprop=url&pithumbsize=720&format=json&origin=*`
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
      osm: `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lon}&zoom=16`,
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

  if (!nextCoordinates && result.maps_search) {
    const geocoded = await geocodeFromQuery(result.maps_search);
    const lat = Number(geocoded?.lat);
    const lon = Number(geocoded?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      nextCoordinates = normalizeCoordinates({ lat, lon });
    }
  }

  if (nextCoordinates) {
    reverseGeocode = await reverseGeocodeCoordinates(nextCoordinates);
  }

  const address = reverseGeocode?.address || {};
  const resolvedCountry = result.country || normalizeShortText(address.country, 120);
  const resolvedCountryCode = result.country_code || normalizeShortText(address.country_code, 12).toUpperCase();
  const resolvedRegion = result.region || pickAddressField(address, ['state', 'region', 'county']);
  const resolvedCity = result.city || pickAddressField(address, ['city', 'town', 'village', 'municipality']);
  const resolvedDistrict = result.district || pickAddressField(address, ['suburb', 'borough', 'city_district', 'neighbourhood']);
  const resolvedExactLocation = result.exact_location || normalizeShortText(reverseGeocode?.display_name, 220);
  const resolvedMapsSearch = result.maps_search || [resolvedExactLocation, resolvedCity, resolvedRegion, resolvedCountry].filter(Boolean).join(', ');
  const reference_images = await fetchWikipediaReferences(nextCoordinates);

  return {
    ...result,
    country: resolvedCountry,
    country_code: resolvedCountryCode,
    region: resolvedRegion,
    city: resolvedCity,
    district: resolvedDistrict,
    exact_location: resolvedExactLocation,
    coordinates: nextCoordinates,
    maps_search: resolvedMapsSearch,
    map_links: buildMapLinks(nextCoordinates, resolvedMapsSearch),
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
    time_of_day: normalizeShortText(rawResult?.time_of_day, 80),
    weather_conditions: normalizeShortText(rawResult?.weather_conditions, 120),
    analysis: normalizeShortText(rawResult?.analysis, 1200),
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

  const systemPrompt = [
    'You are a cautious image geolocation analyst.',
    'Inspect the photo carefully and infer only what is visually supported.',
    'Prefer city/region precision over invented exact points.',
    'If coordinates are uncertain, leave them empty instead of guessing.',
    'Return only one JSON object wrapped in <result></result>.',
    'Do not use markdown.',
  ].join(' ');
  const userPrompt = [
    'Analyze this image and estimate where it was taken using visible clues only.',
    'Respond with compact JSON only.',
    'Use this exact schema:',
    '<result>{"confidence":"haute","country":"...","country_code":"...","region":"...","city":"...","district":"...","exact_location":"...","landmark":null,"coordinates":{"lat":0.0,"lon":0.0},"maps_search":"...","clues":[{"type":"Architecture","detail":"...","weight":"high"}],"time_of_day":"...","weather_conditions":"...","analysis":"...","alternative_locations":["..."]}</result>',
    'Target the most plausible city or area when possible.',
    'Do not return more than 7 clues or 5 alternative locations.',
    'If a field is unknown, return an empty string or null instead of inventing data.',
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
    const rawText = await requestOSINTCompletion(aiConfig, {
      systemPrompt,
      userContent: anthropicImageContent,
      parts: geminiParts,
      content: openAIContent,
      maxTokens: 1400,
    });
    const parsed = extractJSON(rawText);

    if (!parsed || typeof parsed !== 'object') {
      const error = new Error('JSON de geolocalisation introuvable dans la reponse IA');
      error.status = 502;
      error.raw = rawText.slice(0, 2500);
      throw error;
    }

    markProviderKeySuccess(aiConfig);

    const normalized = normalizeGeolocationResult(parsed);
    const enhanced = await enhanceGeolocationResult(normalized);

    return {
      ...enhanced,
      meta: {
        provider: aiConfig.provider,
        model: aiConfig.model,
      },
    };
  } catch (error) {
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
