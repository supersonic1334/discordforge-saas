'use strict';

const fetch = require('node-fetch');
const config = require('../config');
const { getRequestAccessMetadata } = require('./accessControlService');

function isPrivateIp(ip) {
  const value = String(ip || '').trim();
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

async function lookupLocation(ipAddress) {
  if (!config.AUTH_LOOKUP_LOGIN_LOCATION || !ipAddress || isPrivateIp(ipAddress)) {
    return null;
  }

  const endpoint = String(config.AUTH_GEOLOOKUP_ENDPOINT || '').replace('{ip}', encodeURIComponent(ipAddress));
  if (!endpoint) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'discordforger-security',
      },
    });

    if (!response.ok) return null;

    const payload = await response.json();
    if (payload?.success === false) return null;

    const city = String(payload?.city || '').trim();
    const region = String(payload?.region || payload?.region_name || '').trim();
    const country = String(payload?.country || payload?.country_name || '').trim();
    const label = [city, region, country].filter(Boolean).join(', ');

    return {
      city,
      region,
      country,
      label,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildRequestInsight(req) {
  const metadata = getRequestAccessMetadata(req);
  const location = await lookupLocation(metadata.ip);

  return {
    ...metadata,
    ipAddress: metadata.ip || 'Inconnue',
    userAgentLabel: summarizeUserAgent(metadata.userAgent),
    locationLabel: location?.label || '',
    location,
  };
}

module.exports = {
  buildRequestInsight,
  lookupLocation,
  summarizeUserAgent,
};
