'use strict';

const db = require('../database');
const { hash } = require('./encryptionService');
const securityTelemetryService = require('./securityTelemetryService');

const DEVICE_COOKIE_NAME = 'discordforge_device';
const BLOCK_TYPES = ['ip', 'device', 'client_signature'];

function normalizeIp(ip) {
  if (!ip) return null;
  const value = String(ip).split(',')[0].trim();
  if (!value) return null;
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return acc;

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function normalizeDeviceId(value) {
  if (!value) return null;
  const cleaned = String(value).trim().slice(0, 200);
  return cleaned || null;
}

function getClientIp(req) {
  return normalizeIp(
    req.headers['cf-connecting-ip']
    || req.headers['true-client-ip']
    || req.headers['x-client-ip']
    || req.headers['x-cluster-client-ip']
    || req.headers['fly-client-ip']
    || req.headers['fastly-client-ip']
    || req.headers['x-forwarded-for']
    || req.headers['x-real-ip']
    || req.ip
    || req.socket?.remoteAddress
    || null
  );
}

function getDeviceId(req) {
  const headerValue = normalizeDeviceId(req.get('x-device-id'));
  if (headerValue) return headerValue;

  const cookies = parseCookies(req.headers.cookie);
  return normalizeDeviceId(cookies[DEVICE_COOKIE_NAME]);
}

function syncDeviceCookie(req, res) {
  const headerDeviceId = normalizeDeviceId(req.get('x-device-id'));
  if (!headerDeviceId) return;

  const cookies = parseCookies(req.headers.cookie);
  const cookieDeviceId = normalizeDeviceId(cookies[DEVICE_COOKIE_NAME]);
  if (cookieDeviceId === headerDeviceId) return;

  res.cookie(DEVICE_COOKIE_NAME, headerDeviceId, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    path: '/',
  });
}

function getRequestAccessMetadata(req) {
  const ip = getClientIp(req);
  const deviceId = getDeviceId(req);
  const userAgent = String(req.get('user-agent') || '').slice(0, 500);
  const acceptLanguage = String(req.get('accept-language') || '').slice(0, 200);
  const clientHintsUa = String(req.get('sec-ch-ua') || '').slice(0, 200);
  const clientHintsUaFull = String(req.get('sec-ch-ua-full-version-list') || '').slice(0, 400);
  const clientHintsPlatform = String(req.get('sec-ch-ua-platform') || '').slice(0, 120);
  const clientHintsPlatformVersion = String(req.get('sec-ch-ua-platform-version') || '').slice(0, 120);
  const clientHintsMobile = String(req.get('sec-ch-ua-mobile') || '').slice(0, 40);
  const clientHintsModel = String(req.get('sec-ch-ua-model') || '').slice(0, 160);
  const clientSignatureSource = [
    userAgent.trim().toLowerCase(),
    acceptLanguage.trim().toLowerCase(),
    clientHintsUa.trim().toLowerCase(),
    clientHintsUaFull.trim().toLowerCase(),
    clientHintsPlatform.trim().toLowerCase(),
    clientHintsPlatformVersion.trim().toLowerCase(),
    clientHintsMobile.trim().toLowerCase(),
    clientHintsModel.trim().toLowerCase(),
  ].filter(Boolean).join('|');
  const clientSignatureHash = clientSignatureSource ? hash(`client_signature:${clientSignatureSource}`) : null;

  return {
    ip,
    deviceId,
    userAgent,
    clientHintsUa,
    clientHintsUaFull,
    clientHintsPlatform,
    clientHintsPlatformVersion,
    clientHintsMobile,
    clientHintsModel,
    clientSignatureHash,
    ipHash: ip ? hash(`ip:${ip}`) : null,
    deviceHash: deviceId ? hash(`device:${deviceId}`) : null,
  };
}

function recordUserAccess(userId, req) {
  if (!userId || !req) return;

  const metadata = getRequestAccessMetadata(req);
  const now = new Date().toISOString();

  db.update('users', {
    last_seen_ip_hash: metadata.ipHash,
    last_seen_device_hash: metadata.deviceHash,
    last_seen_client_signature_hash: metadata.clientSignatureHash,
    last_seen_user_agent: metadata.userAgent || null,
    last_seen_at: now,
  }, { id: userId });

  securityTelemetryService.recordSecurityAccess(userId, metadata).catch(() => {});
}

function findMatchingBlock(req) {
  const metadata = getRequestAccessMetadata(req);
  const conditions = [];
  const params = [];

  if (metadata.ipHash) {
    conditions.push("(block_type = 'ip' AND value_hash = ?)");
    params.push(metadata.ipHash);
  }

  if (metadata.deviceHash) {
    conditions.push("(block_type = 'device' AND value_hash = ?)");
    params.push(metadata.deviceHash);
  }

  if (metadata.clientSignatureHash) {
    conditions.push("(block_type = 'client_signature' AND value_hash = ?)");
    params.push(metadata.clientSignatureHash);
  }

  if (!conditions.length) return null;

  return db.db.prepare(
    `SELECT *
     FROM access_blocks
     WHERE is_active = 1
       AND (${conditions.join(' OR ')})
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`
  ).get(...params) ?? null;
}

function upsertBlock({ userId, blockType, valueHash, userAgent }) {
  if (!BLOCK_TYPES.includes(blockType) || !valueHash) return false;

  const now = new Date().toISOString();
  const existing = db.db.prepare(
    `SELECT id
     FROM access_blocks
     WHERE user_id = ?
       AND block_type = ?
       AND value_hash = ?
     LIMIT 1`
  ).get(userId, blockType, valueHash);

  if (existing) {
    db.db.prepare(
      `UPDATE access_blocks
       SET is_active = 1,
           user_agent = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(userAgent || null, now, existing.id);
    return false;
  }

  db.insert('access_blocks', {
    user_id: userId,
    block_type: blockType,
    value_hash: valueHash,
    user_agent: userAgent || null,
    is_active: 1,
    created_at: now,
    updated_at: now,
  });

  return true;
}

function applyAdvancedBlocksForUser(userId, actorUserId, req) {
  const user = db.findOne('users', { id: userId });
  if (!user) return { created: 0, skipped: 0 };

  const actorMetadata = actorUserId ? getRequestAccessMetadata(req) : null;
  const candidates = [
    { blockType: 'ip', valueHash: user.last_seen_ip_hash, actorValueHash: actorMetadata?.ipHash ?? null },
    { blockType: 'device', valueHash: user.last_seen_device_hash, actorValueHash: actorMetadata?.deviceHash ?? null },
    { blockType: 'client_signature', valueHash: user.last_seen_client_signature_hash, actorValueHash: actorMetadata?.clientSignatureHash ?? null },
  ];

  let created = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const candidate of candidates) {
      if (!candidate.valueHash) continue;

      if (candidate.actorValueHash && candidate.actorValueHash === candidate.valueHash) {
        skipped += 1;
        continue;
      }

      if (upsertBlock({
        userId,
        blockType: candidate.blockType,
        valueHash: candidate.valueHash,
        userAgent: user.last_seen_user_agent,
      })) {
        created += 1;
      }
    }
  });

  return { created, skipped };
}

function clearAdvancedBlocksForUser(userId) {
  db.db.prepare(
    `UPDATE access_blocks
     SET is_active = 0,
         updated_at = ?
     WHERE user_id = ?
       AND is_active = 1`
  ).run(new Date().toISOString(), userId);
}

module.exports = {
  DEVICE_COOKIE_NAME,
  getRequestAccessMetadata,
  recordUserAccess,
  findMatchingBlock,
  applyAdvancedBlocksForUser,
  clearAdvancedBlocksForUser,
  syncDeviceCookie,
};
