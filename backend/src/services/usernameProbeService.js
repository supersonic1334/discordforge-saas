'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger').child('UsernameProbeService');
const { enrichUsernameProfiles } = require('./publicOsintEnrichmentService');

const fetch = global.fetch ? global.fetch.bind(globalThis) : require('node-fetch');

const SHERLOCK_DATA_PATH = path.resolve(__dirname, '..', 'data', 'sherlock-sites.json');
const REQUEST_TIMEOUT_MS = 3500;
const CONCURRENCY = 48;
const USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/135.0.0.0 Safari/537.36',
  'DiscordForgerOSINT/1.0',
].join(' ');

const FEATURED_PLATFORMS = [
  { id: 'instagram', name: 'Instagram', cat: 'Social', aliases: ['Instagram'] },
  { id: 'tiktok', name: 'TikTok', cat: 'Social', aliases: ['TikTok'] },
  { id: 'twitter', name: 'Twitter/X', cat: 'Social', aliases: ['Twitter'] },
  { id: 'youtube', name: 'YouTube', cat: 'Video', aliases: ['YouTube'] },
  { id: 'snapchat', name: 'Snapchat', cat: 'Social', aliases: ['Snapchat'] },
  { id: 'facebook', name: 'Facebook', cat: 'Social', aliases: [] },
  { id: 'reddit', name: 'Reddit', cat: 'Social', aliases: ['Reddit'] },
  { id: 'roblox', name: 'Roblox', cat: 'Gaming', aliases: ['Roblox'] },
  { id: 'steam', name: 'Steam', cat: 'Gaming', aliases: ['Steam Community (User)'] },
  { id: 'twitch', name: 'Twitch', cat: 'Gaming', aliases: ['Twitch'] },
  { id: 'github', name: 'GitHub', cat: 'Dev', aliases: ['GitHub'] },
  { id: 'gitlab', name: 'GitLab', cat: 'Dev', aliases: ['GitLab'] },
  { id: 'linkedin', name: 'LinkedIn', cat: 'Pro', aliases: ['LinkedIn'] },
  { id: 'spotify', name: 'Spotify', cat: 'Music', aliases: ['Spotify'] },
  { id: 'soundcloud', name: 'SoundCloud', cat: 'Music', aliases: ['SoundCloud'] },
  { id: 'telegram', name: 'Telegram', cat: 'Social', aliases: ['Telegram'] },
  { id: 'medium', name: 'Medium', cat: 'Blog', aliases: ['Medium'] },
  { id: 'pinterest', name: 'Pinterest', cat: 'Social', aliases: ['Pinterest'] },
  { id: 'tumblr', name: 'Tumblr', cat: 'Blog', aliases: ['tumblr'] },
  { id: 'patreon', name: 'Patreon', cat: 'Creator', aliases: ['Patreon'] },
  { id: 'vimeo', name: 'Vimeo', cat: 'Video', aliases: ['Vimeo'] },
  { id: 'lastfm', name: 'Last.fm', cat: 'Music', aliases: ['last.fm'] },
  { id: 'devto', name: 'Dev.to', cat: 'Dev', aliases: ['DEV Community'] },
  { id: 'kofi', name: 'Ko-fi', cat: 'Creator', aliases: ['kofi'] },
];

const FEATURED_BY_ALIAS = FEATURED_PLATFORMS.reduce((accumulator, platform) => {
  for (const alias of platform.aliases) {
    accumulator[alias.toLowerCase()] = platform;
  }
  return accumulator;
}, {});

let cachedCatalog = null;
let cachedCatalogMeta = null;

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function createSiteKey(siteName) {
  return String(siteName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseDomain(template) {
  try {
    const sampleUrl = String(template || '').replace(/\{\}/g, 'sample-user');
    return new URL(sampleUrl).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function fillUrlTemplate(template, username) {
  return String(template || '').replace(/\{\}/g, encodeURIComponent(username));
}

function fillPayloadTemplate(value, username) {
  if (typeof value === 'string') {
    return value.replace(/\{\}/g, username);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => fillPayloadTemplate(entry, username));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
      accumulator[key] = fillPayloadTemplate(entryValue, username);
      return accumulator;
    }, {});
  }

  return value;
}

function normalizeMessageList(value) {
  const messages = Array.isArray(value) ? value : [value];
  return messages
    .map((entry) => normalizeWhitespace(String(entry || '').toLowerCase()))
    .filter(Boolean);
}

function isSameUrlFamily(candidate, target) {
  if (!candidate || !target) return false;

  const normalize = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '');

  const normalizedCandidate = normalize(candidate);
  const normalizedTarget = normalize(target);

  return normalizedCandidate === normalizedTarget || normalizedCandidate.startsWith(`${normalizedTarget}/`);
}

function compileRegex(pattern) {
  if (!pattern) return null;

  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function loadCatalog() {
  if (cachedCatalog && cachedCatalogMeta) {
    return { sites: cachedCatalog, meta: cachedCatalogMeta };
  }

  const raw = JSON.parse(fs.readFileSync(SHERLOCK_DATA_PATH, 'utf8'));
  const stat = fs.statSync(SHERLOCK_DATA_PATH);

  const sites = Object.entries(raw)
    .filter(([siteName]) => siteName !== '$schema')
    .map(([siteName, site]) => {
      const profileTemplate = normalizeWhitespace(site?.url);
      const probeTemplate = normalizeWhitespace(site?.urlProbe || site?.url);
      const requestMethod = String(site?.request_method || 'GET').trim().toUpperCase();
      const errorType = String(site?.errorType || '').trim();

      if (!profileTemplate || !probeTemplate) return null;
      if (site?.isNSFW) return null;
      if (!/^https:\/\//i.test(probeTemplate) || !/^https:\/\//i.test(profileTemplate)) return null;
      if (!['GET', 'POST'].includes(requestMethod)) return null;
      if (!['status_code', 'message', 'response_url'].includes(errorType)) return null;

      const featuredPlatform = FEATURED_BY_ALIAS[siteName.toLowerCase()] || null;

      return {
        key: createSiteKey(siteName),
        siteName,
        featuredPlatformId: featuredPlatform?.id || null,
        category: featuredPlatform?.cat || 'Extended',
        domain: parseDomain(probeTemplate || profileTemplate),
        mainUrl: normalizeWhitespace(site?.urlMain),
        profileTemplate,
        probeTemplate,
        requestMethod,
        requestPayload: site?.request_payload || null,
        errorType,
        errorMessages: normalizeMessageList(site?.errorMsg),
        errorUrl: normalizeWhitespace(site?.errorUrl),
        regexCheck: compileRegex(site?.regexCheck),
        priority: (
          (featuredPlatform ? 1000 : 0)
          + (site?.urlProbe ? 80 : 0)
          + (errorType === 'status_code' ? 30 : 0)
          + (requestMethod === 'GET' ? 10 : 0)
        ),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.siteName.localeCompare(right.siteName);
    });

  cachedCatalog = sites;
  cachedCatalogMeta = {
    count: sites.length,
    snapshotUpdatedAt: stat.mtime.toISOString(),
    source: 'Sherlock public corpus snapshot',
  };

  return { sites, meta: cachedCatalogMeta };
}

function buildProbeRequest(site, username) {
  const headers = {
    'accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'user-agent': USER_AGENT,
  };

  const request = {
    method: site.requestMethod,
    redirect: 'follow',
    headers,
    compress: true,
    size: 180000,
  };

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    request.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }

  if (site.requestMethod === 'POST' && site.requestPayload) {
    request.headers['content-type'] = 'application/json';
    request.body = JSON.stringify(fillPayloadTemplate(site.requestPayload, username));
  }

  return request;
}

function buildBaseResult(site, profileUrl, probeUrl) {
  return {
    id: site.key,
    siteName: site.siteName,
    profileUrl,
    probeUrl,
    openUrl: profileUrl || probeUrl || site.mainUrl || '',
    mainUrl: site.mainUrl || '',
    domain: site.domain,
    category: site.category,
    featuredPlatformId: site.featuredPlatformId,
  };
}

function foundResult(site, profileUrl, probeUrl, durationMs, info, confidence = 92, detectionType = 'network', openUrl = '') {
  return {
    ...buildBaseResult(site, profileUrl, probeUrl),
    status: 'found',
    found: true,
    confidence,
    info,
    detectionType,
    durationMs,
    openUrl: openUrl || profileUrl || probeUrl || site.mainUrl || '',
  };
}

function notFoundResult(site, profileUrl, probeUrl, durationMs, info, confidence = 96, detectionType = 'network') {
  return {
    ...buildBaseResult(site, profileUrl, probeUrl),
    status: 'not_found',
    found: false,
    confidence,
    info,
    detectionType,
    durationMs,
  };
}

function unknownResult(site, profileUrl, probeUrl, durationMs, info, confidence = 24, detectionType = 'network') {
  return {
    ...buildBaseResult(site, profileUrl, probeUrl),
    status: 'unknown',
    found: false,
    confidence,
    info,
    detectionType,
    durationMs,
  };
}

async function inspectResponse(site, response, profileUrl, probeUrl, durationMs) {
  const statusCode = Number(response.status || 0);

  if (site.errorType === 'status_code') {
    if (response.body?.destroy) {
      response.body.destroy();
    }

    if (statusCode >= 200 && statusCode < 300) {
      return foundResult(
        site,
        profileUrl,
        probeUrl,
        durationMs,
        `Profil public verifie sur ${site.siteName}.`,
        94,
        'status_code',
        response.url
      );
    }

    if ([404, 410].includes(statusCode)) {
      return notFoundResult(site, profileUrl, probeUrl, durationMs, 'Aucun profil public visible sur cette plateforme.', 97, 'status_code');
    }

    if (statusCode === 429 || statusCode >= 500) {
      return unknownResult(site, profileUrl, probeUrl, durationMs, 'Le site limite ou bloque temporairement la verification.', 22, 'status_code');
    }

    return unknownResult(site, profileUrl, probeUrl, durationMs, 'Le site a repondu, mais la page reste ambiguë.', 42, 'status_code');
  }

  const text = normalizeWhitespace((await response.text().catch(() => '')).toLowerCase());

  if ([404, 410].includes(statusCode)) {
    return notFoundResult(site, profileUrl, probeUrl, durationMs, 'Aucun profil public visible sur cette plateforme.', 97, site.errorType);
  }

  if (statusCode === 429 || statusCode >= 500) {
    return unknownResult(site, profileUrl, probeUrl, durationMs, 'Le site limite ou refuse temporairement la verification.', 22, site.errorType);
  }

  if (site.errorType === 'message') {
    const matchesErrorMessage = site.errorMessages.some((entry) => text.includes(entry));

    if (matchesErrorMessage) {
      return notFoundResult(site, profileUrl, probeUrl, durationMs, 'Le site signale qu aucun profil public ne correspond.', 95, 'message');
    }

    if (statusCode >= 200 && statusCode < 300) {
      return foundResult(
        site,
        profileUrl,
        probeUrl,
        durationMs,
        `Profil public verifie sur ${site.siteName}.`,
        88,
        'message',
        response.url
      );
    }

    return unknownResult(site, profileUrl, probeUrl, durationMs, 'Le site a repondu, mais le signal reste ambigu.', 40, 'message');
  }

  const responseUrl = normalizeWhitespace(response.url);
  if (site.errorUrl && isSameUrlFamily(responseUrl, site.errorUrl)) {
    return notFoundResult(site, profileUrl, probeUrl, durationMs, 'Le site redirige vers sa page d erreur, aucun profil public detecte.', 95, 'response_url');
  }

  if (statusCode >= 200 && statusCode < 300) {
    return foundResult(
      site,
      profileUrl,
      probeUrl,
      durationMs,
      `Profil public verifie sur ${site.siteName}.`,
      86,
      'response_url',
      responseUrl
    );
  }

  return unknownResult(site, profileUrl, probeUrl, durationMs, 'L URL finale ne permet pas de conclure proprement.', 38, 'response_url');
}

async function probeSite(site, username) {
  const profileUrl = fillUrlTemplate(site.profileTemplate, username);
  const probeUrl = fillUrlTemplate(site.probeTemplate, username);
  const startedAt = Date.now();

  try {
    const response = await fetch(probeUrl, buildProbeRequest(site, username));
    const durationMs = Date.now() - startedAt;
    return await inspectResponse(site, response, profileUrl, probeUrl, durationMs);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = normalizeWhitespace(error?.type === 'request-timeout'
      ? 'Le site a depasse le temps de reponse imparti.'
      : error?.message || 'Probe impossible.');

    return unknownResult(site, profileUrl, probeUrl, durationMs, message, 18, 'network_error');
  }
}

async function runConcurrentProbe(sites, username) {
  const results = new Array(sites.length);
  let cursor = 0;

  async function worker() {
    while (cursor < sites.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await probeSite(sites[currentIndex], username);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sites.length) }, () => worker())
  );

  return results;
}

function buildFeaturedResults(siteResults) {
  return FEATURED_PLATFORMS.reduce((accumulator, platform) => {
    const candidates = siteResults.filter((entry) => entry.featuredPlatformId === platform.id && entry.found);
    const selected = candidates.sort((left, right) => {
      if (left.found !== right.found) return left.found ? -1 : 1;
      return right.confidence - left.confidence;
    })[0];

    const details = [];
    if (selected?.siteName) details.push(selected.siteName);
    if (selected?.domain) details.push(selected.domain);

    accumulator[platform.id] = {
      found: Boolean(selected?.found),
      confidence: selected?.confidence ?? 0,
      info: selected?.found
        ? `Profil public verifie sur ${selected.siteName || platform.name}.`
        : '',
      site_name: selected?.siteName || platform.name,
      profile_url: selected?.profileUrl || '',
      open_url: selected?.openUrl || selected?.profileUrl || '',
      main_url: selected?.mainUrl || '',
      domain: selected?.domain || '',
      details,
      supported: platform.aliases.length > 0,
    };

    return accumulator;
  }, {});
}

function buildSummary(results, durationMs, meta) {
  const found = results.filter((entry) => entry.status === 'found').length;
  const notFound = results.filter((entry) => entry.status === 'not_found').length;
  const unknown = results.filter((entry) => entry.status === 'unknown').length;

  return {
    checked: results.length,
    found,
    notFound,
    unknown,
    durationMs,
    source: meta.source,
    snapshotUpdatedAt: meta.snapshotUpdatedAt,
  };
}

async function scanUsername(username) {
  const cleanedUsername = String(username || '').trim().replace(/^@+/, '');
  const { sites, meta } = loadCatalog();
  const eligibleSites = sites.filter((site) => !site.regexCheck || site.regexCheck.test(cleanedUsername));
  const startedAt = Date.now();
  const siteResults = await runConcurrentProbe(eligibleSites, cleanedUsername);
  const durationMs = Date.now() - startedAt;
  const foundEntries = siteResults.filter((entry) => entry.status === 'found');
  const profiles = await enrichUsernameProfiles(foundEntries, cleanedUsername);

  const sortedResults = [...siteResults].sort((left, right) => {
    const score = { found: 3, unknown: 2, not_found: 1 };
    if (score[right.status] !== score[left.status]) {
      return score[right.status] - score[left.status];
    }

    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }

    return left.siteName.localeCompare(right.siteName);
  });

  logger.info('Username sweep completed', {
    username: cleanedUsername,
    checked: sortedResults.length,
    found: sortedResults.filter((entry) => entry.found).length,
    durationMs,
  });

  return {
    results: buildFeaturedResults(siteResults),
    profiles,
    sites: sortedResults,
    summary: buildSummary(sortedResults, durationMs, meta),
  };
}

function getCatalogStatus() {
  const { meta } = loadCatalog();
  return meta;
}

module.exports = {
  FEATURED_PLATFORMS,
  scanUsername,
  getCatalogStatus,
};
