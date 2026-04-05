'use strict';

const fetch = require('node-fetch');

const config = require('../config');
const db = require('../database');
const logger = require('../utils/logger').child('SecurityTelemetry');

const LOOKUP_TIMEOUT_MS = 2500;
const LOOKUP_CACHE_TTL_MS = 10 * 60 * 1000;
const MERGE_WINDOW_MS = 12 * 60 * 1000;
const HISTORY_LIMIT = 6;

const intelCache = new Map();
const pendingLookups = new Map();
let schemaReady = false;

function normalizeString(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
  }
  return false;
}

function isPrivateIp(ip) {
  const value = normalizeString(ip, 80);
  if (!value) return true;
  return (
    value === '::1'
    || value === '127.0.0.1'
    || value.startsWith('10.')
    || value.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe80:')
  );
}

function summarizeUserAgent(userAgent) {
  const value = String(userAgent || '');
  const browser = (
    /edg\//i.test(value) ? 'Edge'
      : /chrome\//i.test(value) ? 'Chrome'
        : /firefox\//i.test(value) ? 'Firefox'
          : /safari\//i.test(value) && !/chrome\//i.test(value) ? 'Safari'
            : /opr\//i.test(value) ? 'Opera'
              : 'Navigateur inconnu'
  );

  const os = (
    /windows/i.test(value) ? 'Windows'
      : /android/i.test(value) ? 'Android'
        : /iphone|ipad|ios/i.test(value) ? 'iOS'
          : /mac os|macintosh/i.test(value) ? 'macOS'
            : /linux/i.test(value) ? 'Linux'
              : 'OS inconnu'
  );

  return `${browser} · ${os}`;
}

function normalizeBrandToken(value) {
  return normalizeString(value, 120)
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '');
}

function parseClientHintBrands(value) {
  return String(value || '')
    .split(',')
    .map((part) => normalizeBrandToken(part.split(';')[0]))
    .filter(Boolean);
}

function detectBrowser(metadata = {}) {
  const userAgent = String(metadata.userAgent || '');
  const brands = [
    ...parseClientHintBrands(metadata.clientHintsUa),
    ...parseClientHintBrands(metadata.clientHintsUaFull),
  ].map((item) => item.toLowerCase());

  if (brands.some((item) => item.includes('brave'))) return 'Brave';
  if (/opt\//i.test(userAgent) || brands.some((item) => item.includes('opera gx'))) return 'Opera GX';
  if (/opr\//i.test(userAgent) || brands.some((item) => item.includes('opera'))) return 'Opera';
  if (/edg\//i.test(userAgent) || brands.some((item) => item.includes('edge'))) return 'Edge';
  if (/samsungbrowser/i.test(userAgent)) return 'Samsung Internet';
  if (/firefox\//i.test(userAgent) || brands.some((item) => item.includes('firefox'))) return 'Firefox';
  if (/vivaldi/i.test(userAgent)) return 'Vivaldi';
  if (/duckduckgo/i.test(userAgent)) return 'DuckDuckGo';
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) return 'Safari';
  if (/chrome\//i.test(userAgent) || brands.some((item) => item.includes('chrome'))) return 'Chrome';
  return 'Navigateur inconnu';
}

function detectOs(metadata = {}) {
  const platformHint = normalizeString(metadata.clientHintsPlatform, 120).replace(/['"]/g, '').toLowerCase();
  const userAgent = String(metadata.userAgent || '').toLowerCase();

  if (platformHint.includes('android') || userAgent.includes('android')) return 'Android';
  if (platformHint.includes('ios') || /iphone|ipad|ipod/.test(userAgent)) return 'iOS';
  if (platformHint.includes('mac') || userAgent.includes('mac os') || userAgent.includes('macintosh')) return 'macOS';
  if (platformHint.includes('windows') || userAgent.includes('windows')) return 'Windows';
  if (platformHint.includes('linux') || userAgent.includes('linux')) return 'Linux';
  if (platformHint.includes('chrome os') || platformHint.includes('chromeos') || userAgent.includes('cros')) return 'ChromeOS';
  return 'OS inconnu';
}

function detectDeviceType(metadata = {}) {
  const mobileHint = normalizeString(metadata.clientHintsMobile, 20).replace(/['"]/g, '').toLowerCase();
  const userAgent = String(metadata.userAgent || '').toLowerCase();

  if (/ipad|tablet/.test(userAgent)) return 'Tablette';
  if (mobileHint === '?1' || /iphone|ipod|android.+mobile|windows phone|mobile/.test(userAgent)) return 'Mobile';
  return 'Ordinateur';
}

function detectDeviceModel(metadata = {}) {
  const modelHint = normalizeString(metadata.clientHintsModel, 160).replace(/['"]/g, '');
  if (modelHint) return modelHint;

  const userAgent = String(metadata.userAgent || '');
  const androidMatch = userAgent.match(/Android [^;]+;\s*([^;)]+?)\s+Build\//i);
  if (androidMatch?.[1]) return normalizeString(androidMatch[1], 120);
  if (/iphone/i.test(userAgent)) return 'iPhone';
  if (/ipad/i.test(userAgent)) return 'iPad';

  const samsungMatch = userAgent.match(/(SM-[A-Z0-9]+)/i);
  if (samsungMatch?.[1]) return samsungMatch[1].toUpperCase();

  return '';
}

function looksLikeDatacenter(text) {
  const normalized = normalizeString(text, 240).toLowerCase();
  if (!normalized) return false;
  return [
    'amazon',
    'aws',
    'google cloud',
    'microsoft',
    'azure',
    'digitalocean',
    'ovh',
    'hetzner',
    'oracle cloud',
    'linode',
    'vultr',
    'datacamp',
    'datacentre',
    'datacenter',
    'hosting',
    'cloud',
    'colo',
    'server',
  ].some((keyword) => normalized.includes(keyword));
}

function buildLookupEndpoint(ipAddress) {
  return String(config.AUTH_GEOLOOKUP_ENDPOINT || '')
    .trim()
    .replace('{ip}', encodeURIComponent(ipAddress));
}

function looksSuspiciousProvider(provider) {
  const value = normalizeString(provider, 160).toLowerCase();
  if (!value) return true;
  return ['popmon', 'point of presence', 'backbone', 'transit', 'gateway'].some((token) => value.includes(token));
}

function ensureSecuritySchema() {
  if (schemaReady) return;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_security_access_log (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address        TEXT,
        ip_hash           TEXT,
        city              TEXT NOT NULL DEFAULT '',
        region            TEXT NOT NULL DEFAULT '',
        country           TEXT NOT NULL DEFAULT '',
        location_label    TEXT NOT NULL DEFAULT '',
        network_provider  TEXT NOT NULL DEFAULT '',
        network_domain    TEXT NOT NULL DEFAULT '',
        network_type      TEXT NOT NULL DEFAULT '',
        browser_name      TEXT NOT NULL DEFAULT '',
        os_name           TEXT NOT NULL DEFAULT '',
        device_type       TEXT NOT NULL DEFAULT '',
        device_model      TEXT NOT NULL DEFAULT '',
        is_proxy          INTEGER NOT NULL DEFAULT 0,
        is_vpn            INTEGER NOT NULL DEFAULT 0,
        is_tor            INTEGER NOT NULL DEFAULT 0,
        is_datacenter     INTEGER NOT NULL DEFAULT 0,
        user_agent        TEXT,
        device_hash       TEXT,
        client_signature_hash TEXT,
        first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
        seen_count        INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_security_access_log_user_last_seen ON user_security_access_log(user_id, last_seen_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_security_access_log_user_ip ON user_security_access_log(user_id, ip_hash)');
    for (const column of [
      "browser_name TEXT NOT NULL DEFAULT ''",
      "os_name TEXT NOT NULL DEFAULT ''",
      "device_type TEXT NOT NULL DEFAULT ''",
      "device_model TEXT NOT NULL DEFAULT ''",
    ]) {
      const name = column.split(' ')[0];
      try {
        db.exec(`ALTER TABLE user_security_access_log ADD COLUMN ${column}`);
      } catch (error) {
        if (!String(error?.message || '').includes(`duplicate column name: ${name}`)) {
          throw error;
        }
      }
    }
  } catch (error) {
    logger.warn('Security telemetry migration check failed', {
      message: error?.message || 'unknown_error',
    });
  }

  schemaReady = true;
}

function parseIpIntelPayload(ipAddress, payload) {
  const connection = payload?.connection || payload?.network || payload?.connection_info || {};
  const security = payload?.security || payload?.privacy || payload?.threat || {};
  const city = normalizeString(payload?.city, 120);
  const region = normalizeString(payload?.region || payload?.region_name || payload?.regionName, 120);
  const country = normalizeString(payload?.country || payload?.country_name || payload?.countryName, 120);
  const provider = normalizeString(
    connection?.isp
    || connection?.org
    || payload?.org
    || payload?.isp
    || payload?.organization
    || payload?.asn_org,
    160
  );
  const domain = normalizeString(
    connection?.domain
    || payload?.domain
    || payload?.hostname,
    160
  );
  const networkType = normalizeString(
    connection?.type
    || connection?.connection_type
    || payload?.type
    || payload?.usage_type,
    80
  );

  const isProxy = toBoolean(security?.proxy || security?.is_proxy || payload?.proxy || payload?.is_proxy);
  const isVpn = toBoolean(security?.vpn || security?.is_vpn || payload?.vpn || payload?.is_vpn);
  const isTor = toBoolean(security?.tor || security?.is_tor || payload?.tor || payload?.is_tor);
  const isDatacenter = Boolean(
    toBoolean(security?.hosting || security?.is_hosting || payload?.hosting || payload?.is_hosting || payload?.datacenter || payload?.is_datacenter)
    || /hosting|datacenter|datacentre|cloud/i.test(networkType)
    || looksLikeDatacenter(provider)
    || looksLikeDatacenter(domain)
  );

  return {
    ip_address: normalizeString(ipAddress, 80),
    city,
    region,
    country,
    location_label: [city, region, country].filter(Boolean).join(', '),
    network_provider: provider,
    network_domain: domain,
    network_type: networkType,
    is_proxy: isProxy ? 1 : 0,
    is_vpn: isVpn ? 1 : 0,
    is_tor: isTor ? 1 : 0,
    is_datacenter: isDatacenter ? 1 : 0,
  };
}

function parseSecondaryIpIntelPayload(ipAddress, payload) {
  const city = normalizeString(payload?.city, 120);
  const region = normalizeString(payload?.region || payload?.region_name || payload?.regionName, 120);
  const country = normalizeString(payload?.country_name || payload?.country || payload?.countryName, 120);

  return {
    ip_address: normalizeString(payload?.ip || ipAddress, 80),
    city,
    region,
    country,
    location_label: [city, region, country].filter(Boolean).join(', '),
    network_provider: normalizeString(payload?.org || payload?.asn || '', 160),
    network_domain: normalizeString(payload?.org || '', 160),
    network_type: normalizeString(payload?.version || payload?.network || '', 80),
    is_proxy: 0,
    is_vpn: 0,
    is_tor: 0,
    is_datacenter: 0,
  };
}

async function lookupSecondaryIpIntel(ipAddress) {
  const response = await fetch(`https://ipapi.co/${encodeURIComponent(ipAddress)}/json/`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'discordforger-security',
    },
  });

  if (!response.ok) {
    throw new Error(`secondary_lookup_failed_${response.status}`);
  }

  const payload = await response.json();
  return parseSecondaryIpIntelPayload(ipAddress, payload);
}

async function lookupIpIntel(ipAddress) {
  const ip = normalizeString(ipAddress, 80);
  if (!ip || isPrivateIp(ip)) {
    return parseIpIntelPayload(ip, {});
  }

  const cached = intelCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (pendingLookups.has(ip)) {
    return pendingLookups.get(ip);
  }

  const endpoint = buildLookupEndpoint(ip);
  if (!endpoint || !config.AUTH_LOOKUP_LOGIN_LOCATION) {
    return parseIpIntelPayload(ip, {});
  }

  const lookupPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'discordforger-security',
        },
      });

      if (!response.ok) {
        throw new Error(`lookup_failed_${response.status}`);
      }

      const payload = await response.json();
      let intel = parseIpIntelPayload(ip, payload);
      if (!intel.location_label || looksSuspiciousProvider(intel.network_provider)) {
        try {
          const secondaryIntel = await lookupSecondaryIpIntel(ip);
          intel = {
            ...intel,
            city: secondaryIntel.city || intel.city,
            region: secondaryIntel.region || intel.region,
            country: secondaryIntel.country || intel.country,
            location_label: secondaryIntel.location_label || intel.location_label,
            network_provider: secondaryIntel.network_provider || intel.network_provider,
            network_domain: secondaryIntel.network_domain || intel.network_domain,
            network_type: secondaryIntel.network_type || intel.network_type,
          };
        } catch (fallbackError) {
          logger.warn('Secondary IP intel lookup failed', {
            ip,
            message: fallbackError?.message || 'unknown_error',
          });
        }
      }
      intelCache.set(ip, {
        value: intel,
        expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
      });
      return intel;
    } catch (error) {
      logger.warn('IP intel lookup failed', {
        ip,
        message: error?.message || 'unknown_error',
      });
      const fallback = parseIpIntelPayload(ip, {});
      intelCache.set(ip, {
        value: fallback,
        expiresAt: Date.now() + Math.min(LOOKUP_CACHE_TTL_MS, 2 * 60 * 1000),
      });
      return fallback;
    } finally {
      clearTimeout(timer);
      pendingLookups.delete(ip);
    }
  })();

  pendingLookups.set(ip, lookupPromise);
  return lookupPromise;
}

async function recordSecurityAccess(userId, metadata) {
  if (!userId || !metadata) return null;
  ensureSecuritySchema();

  const ipHash = normalizeString(metadata.ipHash, 120);
  const deviceHash = normalizeString(metadata.deviceHash, 120);
  const clientSignatureHash = normalizeString(metadata.clientSignatureHash, 120);
  const userAgent = normalizeString(metadata.userAgent, 500);
  const ipAddress = normalizeString(metadata.ip, 80);
  const browserName = detectBrowser(metadata);
  const osName = detectOs(metadata);
  const deviceType = detectDeviceType(metadata);
  const deviceModel = detectDeviceModel(metadata);

  if (!ipHash && !deviceHash && !clientSignatureHash && !ipAddress) {
    return null;
  }

  const now = new Date().toISOString();
  const intel = await lookupIpIntel(ipAddress);
  const existing = db.db.prepare(`
    SELECT *
    FROM user_security_access_log
    WHERE user_id = ?
      AND COALESCE(ip_hash, '') = ?
      AND COALESCE(device_hash, '') = ?
      AND COALESCE(client_signature_hash, '') = ?
    ORDER BY last_seen_at DESC
    LIMIT 1
  `).get(
    userId,
    ipHash || '',
    deviceHash || '',
    clientSignatureHash || ''
  );

  const payload = {
    ip_address: ipAddress || intel.ip_address || '',
    ip_hash: ipHash || null,
    city: intel.city || '',
    region: intel.region || '',
    country: intel.country || '',
    location_label: intel.location_label || '',
    network_provider: intel.network_provider || '',
    network_domain: intel.network_domain || '',
    network_type: intel.network_type || '',
    browser_name: browserName,
    os_name: osName,
    device_type: deviceType,
    device_model: deviceModel,
    is_proxy: intel.is_proxy ? 1 : 0,
    is_vpn: intel.is_vpn ? 1 : 0,
    is_tor: intel.is_tor ? 1 : 0,
    is_datacenter: intel.is_datacenter ? 1 : 0,
    user_agent: userAgent || null,
    device_hash: deviceHash || null,
    client_signature_hash: clientSignatureHash || null,
  };

  if (existing) {
    const existingLastSeenAt = Date.parse(existing.last_seen_at || existing.updated_at || existing.created_at || 0);
    if (existingLastSeenAt && (Date.now() - existingLastSeenAt) < MERGE_WINDOW_MS) {
      db.db.prepare(`
        UPDATE user_security_access_log
        SET ip_address = ?,
            city = ?,
            region = ?,
            country = ?,
            location_label = ?,
            network_provider = ?,
            network_domain = ?,
            network_type = ?,
            browser_name = ?,
            os_name = ?,
            device_type = ?,
            device_model = ?,
            is_proxy = ?,
            is_vpn = ?,
            is_tor = ?,
            is_datacenter = ?,
            user_agent = ?,
            last_seen_at = ?,
            seen_count = COALESCE(seen_count, 0) + 1,
            updated_at = ?
        WHERE id = ?
      `).run(
        payload.ip_address || null,
        payload.city,
        payload.region,
        payload.country,
        payload.location_label,
        payload.network_provider,
        payload.network_domain,
        payload.network_type,
        payload.browser_name,
        payload.os_name,
        payload.device_type,
        payload.device_model,
        payload.is_proxy,
        payload.is_vpn,
        payload.is_tor,
        payload.is_datacenter,
        payload.user_agent,
        now,
        now,
        existing.id
      );

      return existing.id;
    }
  }

  const row = db.insert('user_security_access_log', {
    user_id: userId,
    ...payload,
    first_seen_at: now,
    last_seen_at: now,
    seen_count: 1,
    created_at: now,
    updated_at: now,
  });

  return row.id;
}

function mapSecurityRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    ip_address: normalizeString(row.ip_address, 80),
    city: row.city || '',
    region: row.region || '',
    country: row.country || '',
    location_label: row.location_label || '',
    network_provider: row.network_provider || '',
    network_domain: row.network_domain || '',
    network_type: row.network_type || '',
    browser_name: row.browser_name || '',
    os_name: row.os_name || '',
    device_type: row.device_type || '',
    device_model: row.device_model || '',
    is_proxy: !!row.is_proxy,
    is_vpn: !!row.is_vpn,
    is_tor: !!row.is_tor,
    is_datacenter: !!row.is_datacenter,
    user_agent: row.user_agent || '',
    device_label: [row.browser_name || '', row.os_name || '', row.device_type || ''].filter(Boolean).join(' · ') || summarizeUserAgent(row.user_agent),
    first_seen_at: row.first_seen_at || row.created_at || null,
    last_seen_at: row.last_seen_at || row.updated_at || row.created_at || null,
    seen_count: Number(row.seen_count || 0),
  };
}

function getUserSecuritySnapshot(userId, options = {}) {
  if (!userId) {
    return { current: null, recent: [] };
  }

  ensureSecuritySchema();

  const limit = Math.max(1, Math.min(Number(options.limit || HISTORY_LIMIT), 12));
  const rows = db.db.prepare(`
    SELECT *
    FROM user_security_access_log
    WHERE user_id = ?
    ORDER BY last_seen_at DESC, updated_at DESC, created_at DESC
    LIMIT ?
  `).all(userId, limit);

  return {
    current: mapSecurityRow(rows[0] || null),
    recent: rows.map(mapSecurityRow),
  };
}

module.exports = {
  getUserSecuritySnapshot,
  recordSecurityAccess,
  summarizeUserAgent,
};
