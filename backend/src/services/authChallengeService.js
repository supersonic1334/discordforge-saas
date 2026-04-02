'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const config = require('../config');
const { generateToken, hash } = require('./encryptionService');

function nowIso() {
  return new Date().toISOString();
}

function toExpiry(minutes) {
  return new Date(Date.now() + (minutes * 60 * 1000)).toISOString();
}

function isChallengeExpired(row) {
  return !row?.expires_at || new Date(row.expires_at).getTime() <= Date.now();
}

function createEmailChallenge({ userId, email, challengeType, requestInsight, metadata = {}, ttlMinutes }) {
  const token = generateToken(32);
  const now = nowIso();
  const expiresAt = toExpiry(ttlMinutes);

  db.insert('auth_email_challenges', {
    id: uuidv4(),
    user_id: userId,
    email,
    challenge_type: challengeType,
    token_hash: hash(token),
    device_hash: requestInsight?.deviceHash || null,
    client_signature_hash: requestInsight?.clientSignatureHash || null,
    ip_hash: requestInsight?.ipHash || null,
    ip_address: requestInsight?.ipAddress || null,
    location_label: requestInsight?.locationLabel || null,
    user_agent: requestInsight?.userAgent || null,
    metadata: JSON.stringify(metadata || {}),
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
  });

  return {
    token,
    expiresAt,
  };
}

function getActiveChallengeByToken(token, challengeType) {
  if (!token) return null;

  const row = db.db.prepare(`
    SELECT *
    FROM auth_email_challenges
    WHERE token_hash = ?
      AND challenge_type = ?
      AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(hash(token), challengeType);

  if (!row || isChallengeExpired(row)) return null;
  return row;
}

function consumeChallenge(challengeId) {
  db.update('auth_email_challenges', {
    consumed_at: nowIso(),
  }, { id: challengeId });
}

function parseChallengeMetadata(row) {
  if (!row?.metadata) return {};
  try {
    const parsed = JSON.parse(row.metadata);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isTrustedDevice(userId, requestInsight) {
  const deviceHash = requestInsight?.deviceHash || null;
  const clientSignatureHash = requestInsight?.clientSignatureHash || null;

  if (!userId || (!deviceHash && !clientSignatureHash)) return false;

  const conditions = [];
  const params = [userId];

  if (deviceHash) {
    conditions.push('device_hash = ?');
    params.push(deviceHash);
  }

  if (clientSignatureHash) {
    conditions.push('client_signature_hash = ?');
    params.push(clientSignatureHash);
  }

  if (!conditions.length) return false;

  const row = db.db.prepare(`
    SELECT id
    FROM auth_trusted_devices
    WHERE user_id = ?
      AND (${conditions.join(' OR ')})
    LIMIT 1
  `).get(...params);

  return !!row;
}

function trustDevice(userId, requestInsight, label = 'Appareil approuve') {
  const deviceHash = requestInsight?.deviceHash || null;
  const clientSignatureHash = requestInsight?.clientSignatureHash || null;
  if (!userId || (!deviceHash && !clientSignatureHash)) return;

  const now = nowIso();

  const existing = db.db.prepare(`
    SELECT id
    FROM auth_trusted_devices
    WHERE user_id = ?
      AND (
        (? IS NOT NULL AND device_hash = ?)
        OR (? IS NOT NULL AND client_signature_hash = ?)
      )
    LIMIT 1
  `).get(
    userId,
    deviceHash,
    deviceHash,
    clientSignatureHash,
    clientSignatureHash
  );

  if (existing) {
    db.update('auth_trusted_devices', {
      device_hash: deviceHash,
      client_signature_hash: clientSignatureHash,
      user_agent: requestInsight?.userAgent || null,
      label,
      last_ip_hash: requestInsight?.ipHash || null,
      last_seen_at: now,
    }, { id: existing.id });
    return;
  }

  db.insert('auth_trusted_devices', {
    id: uuidv4(),
    user_id: userId,
    device_hash: deviceHash,
    client_signature_hash: clientSignatureHash,
    user_agent: requestInsight?.userAgent || null,
    label,
    last_ip_hash: requestInsight?.ipHash || null,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  });
}

function buildVerificationUrl(token, type) {
  const route = type === 'login_approve' ? 'approve-login' : 'verify-email';
  return `${config.publicBackendUrl}${config.API_PREFIX}/auth/${route}?token=${encodeURIComponent(token)}`;
}

module.exports = {
  createEmailChallenge,
  getActiveChallengeByToken,
  consumeChallenge,
  parseChallengeMetadata,
  isTrustedDevice,
  trustDevice,
  buildVerificationUrl,
};
