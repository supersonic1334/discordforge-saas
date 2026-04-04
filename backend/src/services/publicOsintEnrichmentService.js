'use strict';

const logger = require('../utils/logger').child('PublicOSINTEnrichment');

const fetch = global.fetch ? global.fetch.bind(globalThis) : require('node-fetch');

const REQUEST_TIMEOUT_MS = 7000;
const ENRICHMENT_CONCURRENCY = 6;
const USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/135.0.0.0 Safari/537.36',
  'DiscordForgerOSINT/2.0',
].join(' ');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function truncate(value, maxLength = 220) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function createSignal(timeoutMs = REQUEST_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
    },
    signal: options.signal || createSignal(),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
    },
    redirect: options.redirect || 'follow',
    signal: options.signal || createSignal(),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return {
    finalUrl: response.url || url,
    text: await response.text(),
  };
}

function extractMetaContent(html, attribute, value) {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${value}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const reversePattern = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${value}["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern) || html.match(reversePattern);
  return decodeHtmlEntities(match?.[1] || '');
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return truncate(decodeHtmlEntities(match?.[1] || ''), 160);
}

function buildFact(label, value) {
  const normalized = truncate(value, 120);
  return normalized ? { label, value: normalized } : null;
}

function compactFacts(items) {
  return safeArray(items).filter(Boolean).slice(0, 8);
}

function compactInsights(items) {
  return safeArray(items)
    .map((entry) => truncate(entry, 170))
    .filter(Boolean)
    .slice(0, 6);
}

function compactSection(title, items) {
  const normalizedItems = safeArray(items)
    .map((entry) => truncate(entry, 110))
    .filter(Boolean)
    .slice(0, 8);

  if (!normalizedItems.length) return null;
  return { title, items: normalizedItems };
}

async function enrichGenericPage(profileUrl, siteName) {
  const { text, finalUrl } = await fetchText(profileUrl);
  const title = extractTitle(text);
  const description = truncate(
    extractMetaContent(text, 'property', 'og:description')
    || extractMetaContent(text, 'name', 'description'),
    240
  );
  const imageUrl = extractMetaContent(text, 'property', 'og:image');
  const headline = truncate(
    extractMetaContent(text, 'property', 'og:title')
    || title
    || `Profil public verifie sur ${siteName}.`,
    120
  );

  return {
    openUrl: finalUrl,
    summary: description || `Profil public verifie sur ${siteName}.`,
    headline,
    imageUrl: imageUrl || null,
    facts: compactFacts([
      buildFact('Page', siteName),
      buildFact('Titre', title || ''),
    ]),
    insights: compactInsights(description ? [description] : []),
    sections: [],
  };
}

async function enrichGitHub(username) {
  const login = encodeURIComponent(username);
  const [user, repos] = await Promise.all([
    fetchJson(`https://api.github.com/users/${login}`),
    fetchJson(`https://api.github.com/users/${login}/repos?per_page=3&sort=updated`),
  ]);

  return {
    openUrl: user.html_url || `https://github.com/${username}`,
    summary: truncate(user.bio || `${user.login} possede un profil GitHub public actif.`),
    headline: truncate(user.name || user.login || username, 80),
    imageUrl: user.avatar_url || null,
    facts: compactFacts([
      buildFact('Repos', user.public_repos),
      buildFact('Followers', user.followers),
      buildFact('Following', user.following),
      buildFact('Localisation', user.location),
      buildFact('Entreprise', user.company),
      buildFact('Cree le', user.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR') : ''),
    ]),
    insights: compactInsights([
      user.bio,
      user.blog ? `Site: ${user.blog}` : '',
    ]),
    sections: [
      compactSection(
        'Repos recents',
        safeArray(repos).slice(0, 3).map((repo) => `${repo.name}${repo.language ? ` · ${repo.language}` : ''}`)
      ),
    ].filter(Boolean),
  };
}

async function enrichReddit(username) {
  const payload = await fetchJson(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`);
  const profile = payload?.data || {};
  const subreddit = profile.subreddit || {};

  return {
    openUrl: `https://www.reddit.com/user/${profile.name || username}`,
    summary: truncate(
      subreddit.public_description
      || `Profil Reddit public avec ${Number(profile.total_karma || 0).toLocaleString('fr-FR')} de karma.`
    ),
    headline: truncate(subreddit.title || profile.name || username, 90),
    imageUrl: subreddit.icon_img || subreddit.banner_img || null,
    facts: compactFacts([
      buildFact('Karma total', Number(profile.total_karma || 0).toLocaleString('fr-FR')),
      buildFact('Karma posts', Number(profile.link_karma || 0).toLocaleString('fr-FR')),
      buildFact('Karma commentaires', Number(profile.comment_karma || 0).toLocaleString('fr-FR')),
      buildFact('Cree le', profile.created_utc ? new Date(profile.created_utc * 1000).toLocaleDateString('fr-FR') : ''),
      buildFact('NSFW', profile.over_18 ? 'Oui' : 'Non'),
    ]),
    insights: compactInsights([
      subreddit.public_description,
      subreddit.title ? `Sous-profil: ${subreddit.title}` : '',
    ]),
    sections: [],
  };
}

async function resolveRobloxUser(username) {
  const payload = await fetchJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      usernames: [username],
      excludeBannedUsers: true,
    }),
  });

  return safeArray(payload?.data)[0] || null;
}

async function enrichRoblox(username) {
  const resolved = await resolveRobloxUser(username);
  if (!resolved?.id) {
    throw new Error('roblox_user_not_found');
  }

  const userId = resolved.id;
  const [profile, avatarPayload, favoriteGames, groupRoles, badges] = await Promise.all([
    fetchJson(`https://users.roblox.com/v1/users/${userId}`),
    fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`),
    fetchJson(`https://games.roblox.com/v2/users/${userId}/favorite/games?limit=10&sortOrder=Desc`),
    fetchJson(`https://groups.roblox.com/v2/users/${userId}/groups/roles`),
    fetchJson(`https://accountinformation.roblox.com/v1/users/${userId}/roblox-badges`),
  ]);

  const avatarUrl = safeArray(avatarPayload?.data)[0]?.imageUrl || null;
  const favoriteGameItems = safeArray(favoriteGames?.data).slice(0, 5);
  const groupItems = safeArray(groupRoles?.data).slice(0, 4);
  const badgeItems = safeArray(badges).slice(0, 4);

  return {
    openUrl: `https://www.roblox.com/users/${userId}/profile`,
    summary: truncate(
      profile.description
      || `${profile.displayName || profile.name || username} possede un profil Roblox public.`
    ),
    headline: truncate(profile.displayName || profile.name || username, 90),
    imageUrl: avatarUrl,
    facts: compactFacts([
      buildFact('Compte', profile.name),
      buildFact('Display name', profile.displayName),
      buildFact('Badge verifie', resolved.hasVerifiedBadge ? 'Oui' : 'Non'),
      buildFact('Cree le', profile.created ? new Date(profile.created).toLocaleDateString('fr-FR') : ''),
      buildFact('Banni', profile.isBanned ? 'Oui' : 'Non'),
    ]),
    insights: compactInsights([
      profile.description,
      favoriteGameItems.length ? `${favoriteGameItems.length} jeu(x) favori(s) public(s) visible(s).` : '',
      groupItems.length ? `${groupItems.length} groupe(s) public(s) remonte(s).` : '',
    ]),
    sections: [
      compactSection('Jeux favoris publics', favoriteGameItems.map((game) => game.name)),
      compactSection('Groupes', groupItems.map((entry) => `${entry.group?.name || 'Groupe'}${entry.role?.name ? ` · ${entry.role.name}` : ''}`)),
      compactSection('Badges publics', badgeItems.map((badge) => badge.name)),
    ].filter(Boolean),
  };
}

function buildFallbackProfile(entry) {
  return {
    id: entry.id,
    platformId: entry.featuredPlatformId || entry.id,
    platformName: entry.featuredPlatformId ? entry.siteName : entry.siteName,
    siteName: entry.siteName,
    category: entry.category || 'Extended',
    domain: entry.domain || '',
    openUrl: entry.profileUrl || entry.probeUrl || entry.mainUrl || '',
    imageUrl: null,
    headline: truncate(entry.siteName || entry.domain || 'Profil public'),
    summary: `Profil public verifie sur ${entry.siteName || entry.domain || 'le site'}.`,
    facts: compactFacts([
      buildFact('Source', entry.siteName),
      buildFact('Domaine', entry.domain),
    ]),
    insights: [],
    sections: [],
    verified: true,
  };
}

async function enrichEntry(entry, username) {
  const fallback = buildFallbackProfile(entry);

  try {
    let enrichment = null;

    if (entry.featuredPlatformId === 'github') {
      enrichment = await enrichGitHub(username);
    } else if (entry.featuredPlatformId === 'reddit') {
      enrichment = await enrichReddit(username);
    } else if (entry.featuredPlatformId === 'roblox') {
      enrichment = await enrichRoblox(username);
    } else {
      enrichment = await enrichGenericPage(fallback.openUrl, entry.siteName);
    }

    return {
      ...fallback,
      openUrl: enrichment.openUrl || fallback.openUrl,
      imageUrl: enrichment.imageUrl || fallback.imageUrl,
      headline: enrichment.headline || fallback.headline,
      summary: enrichment.summary || fallback.summary,
      facts: compactFacts([...(enrichment.facts || []), ...fallback.facts]),
      insights: compactInsights(enrichment.insights || []),
      sections: safeArray(enrichment.sections).filter(Boolean),
    };
  } catch (error) {
    logger.debug?.('Public profile enrichment failed', {
      site: entry.siteName,
      platform: entry.featuredPlatformId,
      message: error?.message || 'enrichment_failed',
    });
    return fallback;
  }
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

async function enrichUsernameProfiles(foundEntries, username) {
  const limitedEntries = safeArray(foundEntries).slice(0, 80);
  if (!limitedEntries.length) return [];
  return runLimited(limitedEntries, ENRICHMENT_CONCURRENCY, (entry) => enrichEntry(entry, username));
}

module.exports = {
  enrichUsernameProfiles,
};
