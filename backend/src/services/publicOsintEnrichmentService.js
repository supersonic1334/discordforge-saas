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

const GENERIC_DESCRIPTION_PATTERNS = [
  'share your videos with friends, family, and the world',
  'watch the latest video from',
  'make your day',
  'join telegram',
  'steam community',
  'see what ',
  'has discovered on pinterest',
  'biggest collection of ideas',
  'if you have telegram',
  'you can contact',
  'view more info about',
  'view my complete profile on steam',
  'official profile',
  'official account',
  'internet archive: digital library',
  'digital library of free & borrowable books',
  'digital library of free and borrowable books',
  'listen to music from',
  'view the profile',
  'watch popular videos',
  'discover more creators',
];

const MISSING_PROFILE_PATTERNS = [
  'page not found',
  'profile not found',
  'user not found',
  'channel does not exist',
  'this account does not exist',
  'sorry, this page is not available',
  'sorry, this page isn\'t available',
  '404',
];

const GENERIC_IMAGE_PATTERNS = [
  /favicon/i,
  /apple-touch/i,
  /touch-icon/i,
  /placeholder/i,
  /default/i,
  /logo/i,
  /brand/i,
  /\/assets\//i,
  /\/static\//i,
  /telegram\.org\/img\//i,
  /steamcommunity\.com\/public\/images\//i,
];

const SIGNAL_RULES = [
  { kind: 'theme', label: 'Gaming', keywords: ['gaming', 'gameplay', 'jeu video', 'jeux video', 'gamer'] },
  { kind: 'theme', label: 'Roblox', keywords: ['roblox', 'blox fruits', 'brookhaven', 'dress to impress', 'blade ball', 'adopt me'] },
  { kind: 'theme', label: 'Minecraft', keywords: ['minecraft'] },
  { kind: 'theme', label: 'GTA', keywords: ['gta', 'grand theft auto'] },
  { kind: 'theme', label: 'Call of Duty', keywords: ['call of duty', 'warzone', 'cod '] },
  { kind: 'theme', label: 'ASMR', keywords: ['asmr'] },
  { kind: 'theme', label: 'Musique', keywords: ['music', 'musique', 'beat', 'song', 'spotify', 'soundcloud'] },
  { kind: 'theme', label: 'Sport', keywords: ['sport', 'fitness', 'musculation', 'football', 'soccer', 'nba'] },
  { kind: 'theme', label: 'Tech', keywords: ['tech', 'coding', 'developer', 'developpeur', 'programming', 'javascript', 'python'] },
  { kind: 'theme', label: 'Mode de vie', keywords: ['vlog', 'lifestyle', 'daily', 'voyage', 'travel'] },
  { kind: 'theme', label: 'Humour', keywords: ['meme', 'humour', 'funny', 'comedie', 'comedy'] },
  { kind: 'theme', label: 'Education', keywords: ['education', 'tutorial', 'tutoriel', 'apprendre', 'cours'] },
  { kind: 'game', label: 'Blox Fruits', keywords: ['blox fruits'] },
  { kind: 'game', label: 'Brookhaven', keywords: ['brookhaven'] },
  { kind: 'game', label: 'Adopt Me!', keywords: ['adopt me'] },
  { kind: 'game', label: 'Blade Ball', keywords: ['blade ball'] },
  { kind: 'game', label: 'Minecraft', keywords: ['minecraft'] },
  { kind: 'game', label: 'GTA', keywords: ['gta', 'grand theft auto'] },
  { kind: 'game', label: 'Call of Duty', keywords: ['call of duty', 'warzone'] },
  { kind: 'game', label: 'Fortnite', keywords: ['fortnite'] },
  { kind: 'game', label: 'Valorant', keywords: ['valorant'] },
  { kind: 'game', label: 'League of Legends', keywords: ['league of legends', 'lol '] },
  { kind: 'game', label: 'Counter-Strike', keywords: ['counter-strike', 'cs2', 'csgo'] },
  { kind: 'activity', label: 'PvP', keywords: ['pvp', 'ranked', 'combat', 'duel'] },
  { kind: 'activity', label: 'Trade', keywords: ['trade', 'trading', 'echange', 'market'] },
  { kind: 'activity', label: 'Roleplay', keywords: ['roleplay', 'rp'] },
  { kind: 'activity', label: 'Shorts / clips', keywords: ['shorts', 'clips', 'tiktok', 'reels'] },
  { kind: 'activity', label: 'Live', keywords: ['live', 'stream', 'streaming', 'twitch'] },
  { kind: 'activity', label: 'Trend / viral', keywords: ['trend', 'viral', 'challenge', 'pour toi', 'fyp'] },
];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#([0-9]+);/gi, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
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
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
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

function extractMetaKeywords(html) {
  const raw = decodeHtmlEntities(
    extractMetaContent(html, 'name', 'keywords')
    || extractMetaContent(html, 'property', 'og:keywords')
  );

  return raw
    .split(',')
    .map((entry) => truncate(entry, 40))
    .filter(Boolean)
    .slice(0, 10);
}

function extractHeadingSnippets(html) {
  const matches = Array.from(String(html || '').matchAll(/<(h1|h2)[^>]*>([\s\S]*?)<\/\1>/gi));
  return matches
    .map((match) => truncate(decodeHtmlEntities(String(match?.[2] || '').replace(/<[^>]+>/g, '')), 90))
    .filter(Boolean)
    .slice(0, 6);
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

function isGenericDescription(value, siteName = '') {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;

  if (GENERIC_DESCRIPTION_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  const loweredSite = normalizeWhitespace(siteName).toLowerCase();
  return loweredSite ? normalized === loweredSite : false;
}

function looksLikeMissingProfile(siteName, title, description, finalUrl) {
  const haystack = [siteName, title, description, finalUrl]
    .map((entry) => normalizeWhitespace(entry).toLowerCase())
    .join(' ');

  return MISSING_PROFILE_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function sanitizeImageUrl(url, baseUrl = '') {
  const rawValue = normalizeWhitespace(url);
  if (!rawValue) return null;

  let value = rawValue;
  if (/^\/\//.test(value)) {
    value = `https:${value}`;
  } else if (!/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value, baseUrl || 'https://discordforger.local').href;
    } catch {
      return null;
    }
  }

  const lowered = value.toLowerCase();
  if (GENERIC_IMAGE_PATTERNS.some((pattern) => pattern.test(lowered))) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return null;
  } catch {
    return null;
  }

  return value;
}

function extractHandleFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const parts = parsed.pathname.split('/').filter(Boolean);
    const candidates = parts
      .map((entry) => entry.replace(/^@/, ''))
      .filter((entry) => entry && !['users', 'user', 'profile', 'channel', 'c'].includes(entry.toLowerCase()));
    return truncate(candidates[candidates.length - 1] || '', 60);
  } catch {
    return '';
  }
}

function collectSignals(values) {
  const haystack = values
    .map((entry) => normalizeWhitespace(entry).toLowerCase())
    .filter(Boolean)
    .join(' ');

  const themes = [];
  const games = [];
  const activities = [];

  for (const rule of SIGNAL_RULES) {
    if (!rule.keywords.some((keyword) => haystack.includes(keyword))) continue;

    if (rule.kind === 'theme' && !themes.includes(rule.label)) {
      themes.push(rule.label);
    }
    if (rule.kind === 'game' && !games.includes(rule.label)) {
      games.push(rule.label);
    }
    if (rule.kind === 'activity' && !activities.includes(rule.label)) {
      activities.push(rule.label);
    }
  }

  return {
    themes: themes.slice(0, 6),
    games: games.slice(0, 6),
    activities: activities.slice(0, 6),
  };
}

function buildSignalInsights(signals) {
  const items = [];

  if (signals.themes.length) {
    items.push(`Univers reperes: ${signals.themes.join(', ')}.`);
  }

  if (signals.games.length) {
    items.push(`Jeux reperes: ${signals.games.join(', ')}.`);
  }

  if (signals.activities.length) {
    items.push(`Styles ou activites reperes: ${signals.activities.join(', ')}.`);
  }

  return items;
}

function buildSignalSections(signals, keywords) {
  return [
    compactSection('Univers reperes', signals.themes),
    compactSection('Jeux reperes', signals.games),
    compactSection('Styles reperes', signals.activities),
    compactSection('Mots reperes', safeArray(keywords).slice(0, 6)),
  ].filter(Boolean);
}

function buildFrenchSummary(siteName, description, signals) {
  const cleanedDescription = isGenericDescription(description, siteName) ? '' : truncate(description, 220);
  if (cleanedDescription) return cleanedDescription;

  const parts = [];
  if (signals.themes.length) parts.push(`univers reperes: ${signals.themes.join(', ')}`);
  if (signals.games.length) parts.push(`jeux reperes: ${signals.games.join(', ')}`);
  if (signals.activities.length) parts.push(`styles reperes: ${signals.activities.join(', ')}`);

  if (parts.length) {
    return truncate(`Profil public detecte sur ${siteName}. ${parts.join(' - ')}.`, 240);
  }

  return `Profil public detecte sur ${siteName}.`;
}

function buildSiteIntro(siteName, username, headline = '') {
  const displayName = truncate(headline || username || '', 80);
  const namedSite = String(siteName || '').trim();

  if (/pinterest/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede un profil Pinterest public.`
      : 'Profil Pinterest public detecte.';
  }

  if (/telegram/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede un compte Telegram public.`
      : 'Compte Telegram public detecte.';
  }

  if (/steam/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede un profil Steam public.`
      : 'Profil Steam public detecte.';
  }

  if (/youtube/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede une chaine YouTube publique.`
      : 'Chaine YouTube publique detectee.';
  }

  if (/tiktok/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede un profil TikTok public.`
      : 'Profil TikTok public detecte.';
  }

  if (/twitch/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede une chaine Twitch publique.`
      : 'Chaine Twitch publique detectee.';
  }

  if (/archive/i.test(namedSite)) {
    return displayName
      ? `${displayName} possede une page Archive.org publique.`
      : 'Page Archive.org publique detectee.';
  }

  return `Profil public detecte sur ${namedSite || 'ce site'}.`;
}

async function enrichGenericPage(profileUrl, siteName) {
  const { text, finalUrl } = await fetchText(profileUrl);
  const title = extractTitle(text);
  const headings = extractHeadingSnippets(text);
  const description = truncate(
    extractMetaContent(text, 'property', 'og:description')
    || extractMetaContent(text, 'name', 'description'),
    240
  );
  const imageUrl = (
    sanitizeImageUrl(extractMetaContent(text, 'property', 'og:image:secure_url'), finalUrl)
    || sanitizeImageUrl(extractMetaContent(text, 'name', 'twitter:image:src'), finalUrl)
    || sanitizeImageUrl(extractMetaContent(text, 'name', 'image'), finalUrl)
    || sanitizeImageUrl(extractMetaContent(text, 'property', 'og:image'), finalUrl)
    || sanitizeImageUrl(extractMetaContent(text, 'name', 'twitter:image'), finalUrl)
    || sanitizeImageUrl(extractMetaContent(text, 'property', 'twitter:image'), finalUrl)
  );
  const keywords = extractMetaKeywords(text);
  const handle = extractHandleFromUrl(finalUrl);
  const signals = collectSignals([title, description, keywords.join(' '), headings.join(' '), handle, finalUrl]);

  if (looksLikeMissingProfile(siteName, title, description, finalUrl)) {
    return { invalid: true };
  }

  const headline = truncate(
    extractMetaContent(text, 'property', 'og:title')
    || title
    || buildSiteIntro(siteName, handle, ''),
    120
  );
  const summarySource = isGenericDescription(description, siteName)
    ? buildSiteIntro(siteName, handle, headline)
    : description;

  return {
    openUrl: finalUrl,
    summary: buildFrenchSummary(siteName, summarySource, signals),
    headline,
    imageUrl: imageUrl || null,
    facts: [],
    insights: compactInsights([
      ...buildSignalInsights(signals),
      !isGenericDescription(description, siteName) ? `Bio publique: ${truncate(description, 180)}` : '',
    ]),
    sections: [
      ...buildSignalSections(signals, [...keywords, ...headings]),
      compactSection('Elements visibles', headings),
    ].filter(Boolean),
  };
}

async function enrichGitHub(username) {
  const login = encodeURIComponent(username);
  const [user, repos] = await Promise.all([
    fetchJson(`https://api.github.com/users/${login}`),
    fetchJson(`https://api.github.com/users/${login}/repos?per_page=3&sort=updated`),
  ]);
  const signals = collectSignals([
    user.bio,
    user.name,
    safeArray(repos).map((repo) => `${repo.name} ${repo.description || ''} ${repo.language || ''}`).join(' '),
  ]);

  return {
    openUrl: user.html_url || `https://github.com/${username}`,
    summary: buildFrenchSummary('GitHub', user.bio, signals),
    headline: truncate(user.name || user.login || username, 80),
    imageUrl: sanitizeImageUrl(user.avatar_url) || null,
    facts: compactFacts([
      buildFact('Repos', user.public_repos),
      buildFact('Followers', user.followers),
      buildFact('Following', user.following),
      buildFact('Localisation', user.location),
      buildFact('Entreprise', user.company),
      buildFact('Cree le', user.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR') : ''),
    ]),
    insights: compactInsights([
      ...buildSignalInsights(signals),
      user.blog ? `Site public: ${user.blog}` : '',
      !isGenericDescription(user.bio, 'GitHub') ? `Bio publique: ${truncate(user.bio, 180)}` : '',
    ]),
    sections: [
      compactSection(
        'Repos recents',
        safeArray(repos).slice(0, 3).map((repo) => `${repo.name}${repo.language ? ` - ${repo.language}` : ''}`)
      ),
      ...buildSignalSections(signals, []),
    ].filter(Boolean),
  };
}

async function enrichReddit(username) {
  const payload = await fetchJson(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`);
  const profile = payload?.data || {};
  const subreddit = profile.subreddit || {};
  const signals = collectSignals([subreddit.public_description, subreddit.title, profile.name]);

  return {
    openUrl: `https://www.reddit.com/user/${profile.name || username}`,
    summary: buildFrenchSummary(
      'Reddit',
      subreddit.public_description || `Profil Reddit public avec ${Number(profile.total_karma || 0).toLocaleString('fr-FR')} de karma.`,
      signals
    ),
    headline: truncate(subreddit.title || profile.name || username, 90),
    imageUrl: sanitizeImageUrl(subreddit.icon_img || subreddit.banner_img) || null,
    facts: compactFacts([
      buildFact('Karma total', Number(profile.total_karma || 0).toLocaleString('fr-FR')),
      buildFact('Karma posts', Number(profile.link_karma || 0).toLocaleString('fr-FR')),
      buildFact('Karma commentaires', Number(profile.comment_karma || 0).toLocaleString('fr-FR')),
      buildFact('Cree le', profile.created_utc ? new Date(profile.created_utc * 1000).toLocaleDateString('fr-FR') : ''),
      buildFact('NSFW', profile.over_18 ? 'Oui' : 'Non'),
    ]),
    insights: compactInsights([
      ...buildSignalInsights(signals),
      subreddit.title ? `Sous-profil public: ${subreddit.title}` : '',
    ]),
    sections: buildSignalSections(signals, []),
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

  const avatarUrl = sanitizeImageUrl(safeArray(avatarPayload?.data)[0]?.imageUrl) || null;
  const favoriteGameItems = safeArray(favoriteGames?.data).slice(0, 5);
  const groupItems = safeArray(groupRoles?.data).slice(0, 4);
  const badgeItems = safeArray(badges).slice(0, 4);
  const signals = collectSignals([
    profile.description,
    favoriteGameItems.map((game) => game.name).join(' '),
    groupItems.map((entry) => `${entry.group?.name || ''} ${entry.role?.name || ''}`).join(' '),
    badgeItems.map((badge) => badge.name).join(' '),
  ]);

  return {
    openUrl: `https://www.roblox.com/users/${userId}/profile`,
    summary: buildFrenchSummary(
      'Roblox',
      profile.description || `${profile.displayName || profile.name || username} possede un profil Roblox public.`,
      signals
    ),
    headline: truncate(profile.displayName || profile.name || username, 90),
    imageUrl: avatarUrl,
    facts: compactFacts([
      buildFact('Compte', profile.name),
      buildFact('Pseudo affiche', profile.displayName),
      buildFact('Badge verifie', resolved.hasVerifiedBadge ? 'Oui' : 'Non'),
      buildFact('Cree le', profile.created ? new Date(profile.created).toLocaleDateString('fr-FR') : ''),
      buildFact('Banni', profile.isBanned ? 'Oui' : 'Non'),
    ]),
    insights: compactInsights([
      ...buildSignalInsights(signals),
      !isGenericDescription(profile.description, 'Roblox') ? `Bio publique: ${truncate(profile.description, 180)}` : '',
      favoriteGameItems.length ? `${favoriteGameItems.length} jeu(x) favori(s) public(s) visible(s).` : '',
      groupItems.length ? `${groupItems.length} groupe(s) public(s) remontes.` : '',
    ]),
    sections: [
      compactSection('Jeux favoris publics', favoriteGameItems.map((game) => game.name)),
      compactSection('Groupes', groupItems.map((entry) => `${entry.group?.name || 'Groupe'}${entry.role?.name ? ` - ${entry.role.name}` : ''}`)),
      compactSection('Badges publics', badgeItems.map((badge) => badge.name)),
      ...buildSignalSections(signals, []),
    ].filter(Boolean),
  };
}

function buildFallbackProfile(entry) {
  return {
    id: entry.id,
    platformId: entry.featuredPlatformId || entry.id,
    platformName: entry.siteName,
    siteName: entry.siteName,
    category: entry.category || 'Extended',
    domain: entry.domain || '',
    openUrl: entry.profileUrl || entry.probeUrl || entry.mainUrl || '',
    imageUrl: null,
    headline: truncate(entry.siteName || entry.domain || 'Profil public'),
    summary: `Profil public detecte sur ${entry.siteName || entry.domain || 'le site'}.`,
    facts: [],
    insights: [],
    sections: [],
    verified: true,
  };
}

async function buildManualProfile(platformId, username) {
  if (platformId === 'github') {
    const enrichment = await enrichGitHub(username);
    return {
      id: `manual-${platformId}-${username}`,
      platformId: 'github',
      platformName: 'GitHub',
      siteName: 'GitHub',
      category: 'Dev',
      domain: 'github.com',
      verified: true,
      ...enrichment,
    };
  }

  if (platformId === 'reddit') {
    const enrichment = await enrichReddit(username);
    return {
      id: `manual-${platformId}-${username}`,
      platformId: 'reddit',
      platformName: 'Reddit',
      siteName: 'Reddit',
      category: 'Social',
      domain: 'reddit.com',
      verified: true,
      ...enrichment,
    };
  }

  if (platformId === 'roblox') {
    const enrichment = await enrichRoblox(username);
    return {
      id: `manual-${platformId}-${username}`,
      platformId: 'roblox',
      platformName: 'Roblox',
      siteName: 'Roblox',
      category: 'Gaming',
      domain: 'roblox.com',
      verified: true,
      ...enrichment,
    };
  }

  return null;
}

async function appendManualProfiles(profiles, username) {
  const existingIds = new Set(safeArray(profiles).map((entry) => String(entry?.platformId || '').toLowerCase()).filter(Boolean));
  const manualPlatforms = ['roblox', 'github', 'reddit'];
  const additions = [];

  for (const platformId of manualPlatforms) {
    if (existingIds.has(platformId)) continue;
    try {
      const profile = await buildManualProfile(platformId, username);
      if (profile) additions.push(profile);
    } catch {}
  }

  return [...safeArray(profiles), ...additions];
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

    if (enrichment?.invalid) {
      return null;
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
    if (
      error?.status === 404
      || error?.message === 'roblox_user_not_found'
      || String(error?.message || '').toLowerCase().includes('not found')
    ) {
      return null;
    }

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
  const results = limitedEntries.length
    ? await runLimited(limitedEntries, ENRICHMENT_CONCURRENCY, (entry) => enrichEntry(entry, username))
    : [];
  return appendManualProfiles(results.filter(Boolean), username);
}

module.exports = {
  enrichUsernameProfiles,
};
