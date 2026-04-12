'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');
const guildAccessService = require('../services/guildAccessService');
const { findMatchingBlock, recordUserAccess, syncDeviceCookie } = require('../services/accessControlService');
const logger = require('../utils/logger').child('Middleware');

function getFounderByToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  try {
    const payload = jwt.verify(authHeader.slice(7), config.JWT_SECRET);
    const user = db.findOne('users', { id: payload.userId });
    if (user?.role === 'founder' && user.is_active) {
      return user;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveClientBlock(req, res, options = {}) {
  const { allowAccessStatus = false } = options;

  syncDeviceCookie(req, res);

  if (allowAccessStatus && req.path === '/auth/access-status') {
    return null;
  }

  const founder = getFounderByToken(req);
  if (founder) {
    req.blockBypassUser = founder;
    return null;
  }

  return findMatchingBlock(req);
}

function requireUnblockedClient(req, res, next) {
  const matchedBlock = resolveClientBlock(req, res, { allowAccessStatus: true });
  if (!matchedBlock) return next();

  logger.warn(`Blocked client access attempt`, {
    blockType: matchedBlock.block_type,
    ip: req.ip,
    path: req.path,
  });

  return res.status(403).json({
    error: 'Access blocked from this device or network',
    code: 'ACCESS_BLOCKED',
  });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = db.findOne('users', { id: payload.userId });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = user;

    try {
      recordUserAccess(user.id, req);
    } catch (recordError) {
      logger.warn(`Access metadata update failed: ${recordError.message}`);
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      logger.warn(`Auth failure: expired token`, { ip: req.ip, path: req.path });
      return res.status(401).json({ error: 'Token expired' });
    }
    logger.warn(`Auth failure: invalid token`, { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireFounder(req, res, next) {
  if (req.user?.role !== 'founder') {
    logger.warn(`Access violation: non-founder attempted founder route`, {
      userId: req.user?.id,
      role: req.user?.role,
      path: req.path,
    });
    return res.status(403).json({ error: 'Founder access required' });
  }
  next();
}

function requireAdminPanelAccess(req, res, next) {
  if (!['founder', 'admin'].includes(req.user?.role)) {
    logger.warn(`Access violation: unauthorized admin panel access`, {
      userId: req.user?.id,
      role: req.user?.role,
      path: req.path,
    });
    return res.status(403).json({ error: 'Admin panel access required' });
  }
  next();
}

function requireApiProvider(req, res, next) {
  if (req.user?.role !== 'api_provider') {
    return res.status(403).json({ error: 'API provider access required' });
  }
  next();
}

function requireOsintAccess(req, res, next) {
  if (!['founder', 'osint'].includes(req.user?.role)) {
    logger.warn(`Access violation: unauthorized OSINT tool access`, {
      userId: req.user?.id,
      role: req.user?.role,
      path: req.path,
    });
    return res.status(403).json({ error: 'OSINT access required' });
  }
  next();
}

function buildFeatureDeniedResponse(res, featureKeys = []) {
  return res.status(403).json({
    error: 'Section indisponible pour ce collaborateur',
    code: 'FEATURE_ACCESS_DENIED',
    blocked_features: featureKeys,
  });
}

function getGuildFeatureCandidates(req) {
  const baseUrl = String(req.baseUrl || '');
  const path = String(req.path || '');
  const moduleType = String(req.params?.type || req.query?.module_type || req.body?.module_type || '').trim().toUpperCase();
  const moduleScope = String(req.query?.scope || req.body?.scope || '').trim().toLowerCase();

  if (baseUrl.endsWith('/team')) return ['team'];
  if (baseUrl.endsWith('/scan') || baseUrl.endsWith('/rassican')) return ['scan'];
  if (baseUrl.endsWith('/logs')) return ['logs'];
  if (baseUrl.endsWith('/moderation')) return ['incidents'];
  if (baseUrl.endsWith('/blocked')) return ['blocked'];
  if (baseUrl.endsWith('/tickets')) return ['tickets'];
  if (baseUrl.endsWith('/captcha')) return ['captcha'];
  if (baseUrl.endsWith('/voice-rooms')) return ['voice_rooms'];

  if (baseUrl.endsWith('/messages')) {
    if (path.startsWith('/channel')) return ['bot_messages'];
    if (path.startsWith('/config')) return ['notifications', 'dm_center'];
    if (path.startsWith('/search') || path.startsWith('/direct')) return ['messages', 'dm_center', 'search'];
    return ['messages', 'dm_center', 'notifications', 'bot_messages', 'search'];
  }

  if (baseUrl.endsWith('/commands')) {
    if (path.startsWith('/assistant')) return ['commands_ai'];
    return ['commands', 'commands_ai'];
  }

  if (baseUrl.endsWith('/modules')) {
    if (moduleType === 'WELCOME_MESSAGE' || moduleType === 'AUTO_ROLE') return ['onboarding'];
    if (moduleType) return ['protection'];
    if (moduleScope === 'onboarding') return ['onboarding'];
    if (moduleScope === 'protection') return ['protection'];
    return ['protection', 'onboarding'];
  }

  return [];
}

function hasGuildFeatureAccess(access, featureKey) {
  if (!featureKey || access?.is_owner) return true;
  const blocked = new Set(guildAccessService.normalizeBlockedFeatures(access?.blocked_features));
  return !blocked.has(featureKey);
}

function requireGuildOwner(req, res, next) {
  const { guildId } = req.params;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId param' });

  const access = guildAccessService.getGuildAccess(req.user.id, guildId);
  if (!access) return res.status(404).json({ error: 'Guild not found or access denied' });

  const featureCandidates = getGuildFeatureCandidates(req);
  if (featureCandidates.length > 0 && !featureCandidates.some((featureKey) => hasGuildFeatureAccess(access, featureKey))) {
    return buildFeatureDeniedResponse(res, featureCandidates);
  }

  req.guild = access.guild;
  req.guildAccess = access;
  req.guildOwnerUserId = access.owner_user_id;
  next();
}

function requireGuildPrimaryOwner(req, res, next) {
  const { guildId } = req.params;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId param' });

  const access = req.guildAccess || guildAccessService.getGuildAccess(req.user.id, guildId);
  if (!access) return res.status(404).json({ error: 'Guild not found or access denied' });
  if (!access.is_owner) return res.status(403).json({ error: 'Primary guild owner access required' });

  req.guild = access.guild;
  req.guildAccess = access;
  req.guildOwnerUserId = access.owner_user_id;
  next();
}

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    req.body = result.data;
    next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid query parameters', errors: result.error.errors });
    }

    req.query = result.data;
    next();
  };
}

function requireBotToken(req, res, next) {
  let tokenOwnerUserId = req.user.id;

  if (req.params?.guildId) {
    const access = req.guildAccess || guildAccessService.getGuildAccess(req.user.id, req.params.guildId);
    if (access) {
      req.guild = access.guild;
      req.guildAccess = access;
      req.guildOwnerUserId = access.owner_user_id;
      tokenOwnerUserId = access.owner_user_id;
    }
  }

  const tokenRow = db.findOne('bot_tokens', { user_id: tokenOwnerUserId });
  if (!tokenRow) {
    return res.status(428).json({ error: 'Bot token required', code: 'NO_BOT_TOKEN' });
  }
  if (!tokenRow.is_valid) {
    return res.status(422).json({ error: 'Bot token is invalid', code: 'INVALID_BOT_TOKEN' });
  }

  req.botToken = tokenRow;
  req.botOwnerUserId = tokenOwnerUserId;
  next();
}

function errorHandler(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? err.httpStatus ?? 500;
  logger.error(`Unhandled error: ${err.message}`, {
    url: req.url,
    method: req.method,
    status,
    stack: config.isDev ? err.stack : undefined,
  });

  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    ...(config.isDev && { stack: err.stack }),
  });
}

function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.url}` });
}

module.exports = {
  resolveClientBlock,
  requireUnblockedClient,
  requireAuth,
  requireFounder,
  requireAdminPanelAccess,
  requireApiProvider,
  requireOsintAccess,
  requireGuildOwner,
  requireGuildPrimaryOwner,
  validate,
  validateQuery,
  requireBotToken,
  errorHandler,
  notFound,
};
