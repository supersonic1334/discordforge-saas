'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');
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

function requireUnblockedClient(req, res, next) {
  syncDeviceCookie(req, res);

  if (req.path === '/auth/access-status') {
    return next();
  }

  const founder = getFounderByToken(req);
  if (founder) {
    req.blockBypassUser = founder;
    return next();
  }

  const matchedBlock = findMatchingBlock(req);
  if (!matchedBlock) return next();

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
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireFounder(req, res, next) {
  if (req.user?.role !== 'founder') {
    return res.status(403).json({ error: 'Founder access required' });
  }
  next();
}

function requireAdminPanelAccess(req, res, next) {
  if (!['founder', 'admin'].includes(req.user?.role)) {
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

function requireGuildOwner(req, res, next) {
  const { guildId } = req.params;
  if (!guildId) return res.status(400).json({ error: 'Missing guildId param' });

  const guild = db.findOne('guilds', { id: guildId });
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  if (guild.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  req.guild = guild;
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
  const tokenRow = db.findOne('bot_tokens', { user_id: req.user.id });
  if (!tokenRow) {
    return res.status(428).json({ error: 'Bot token required', code: 'NO_BOT_TOKEN' });
  }
  if (!tokenRow.is_valid) {
    return res.status(422).json({ error: 'Bot token is invalid', code: 'INVALID_BOT_TOKEN' });
  }

  req.botToken = tokenRow;
  next();
}

function errorHandler(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? 500;
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
  requireUnblockedClient,
  requireAuth,
  requireFounder,
  requireAdminPanelAccess,
  requireApiProvider,
  requireGuildOwner,
  validate,
  validateQuery,
  requireBotToken,
  errorHandler,
  notFound,
};
