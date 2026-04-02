'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');
const url = require('url');
const config = require('../config');
const db = require('../database');
const logger = require('../utils/logger').child('WebSocket');

const WS_AUTH_TICKET_TTL_MS = 45 * 1000;
const WS_AUTH_TICKET_CLEANUP_MS = 15 * 1000;

/**
 * A per-user WebSocket broadcaster.
 * Each connected client authenticates via JWT query param.
 */
class WSServer {
  constructor() {
    this._wss = null;
    // Map<userId, Set<WebSocket>>
    this._clients = new Map();
    this._authTickets = new Map();
    // Global ping interval
    this._pingInterval = null;
    this._ticketCleanupInterval = null;
  }

  attach(httpServer) {
    this._wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this._wss.on('connection', (ws, req) => {
      if (!this._isAllowedOrigin(req)) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      const userId = this._authenticate(req);
      if (!userId) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      // Register
      if (!this._clients.has(userId)) this._clients.set(userId, new Set());
      this._clients.get(userId).add(ws);

      logger.info(`WS connected: user ${userId} (${this._clients.get(userId).size} conn)`);

      // Send welcome
      this._send(ws, { event: 'connected', data: { userId } });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') this._send(ws, { event: 'pong' });
        } catch { /* ignore bad messages */ }
      });

      ws.on('close', () => {
        const set = this._clients.get(userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) this._clients.delete(userId);
        }
        logger.debug(`WS disconnected: user ${userId}`);
      });

      ws.on('error', (err) => {
        logger.debug(`WS error: ${err.message}`);
      });
    });

    // Server-level keepalive ping every 30s
    this._pingInterval = setInterval(() => {
      for (const [, sockets] of this._clients.entries()) {
        for (const ws of sockets) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }
      }
    }, 30_000);

    this._ticketCleanupInterval = setInterval(() => {
      this._cleanupExpiredTickets();
    }, WS_AUTH_TICKET_CLEANUP_MS);

    logger.info('WebSocket server attached');
    return this;
  }

  issueAuthTicket(userId) {
    const ticket = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + WS_AUTH_TICKET_TTL_MS;

    this._authTickets.set(ticket, {
      userId: String(userId),
      expiresAt,
    });

    return {
      ticket,
      expires_at: new Date(expiresAt).toISOString(),
    };
  }

  _cleanupExpiredTickets() {
    const now = Date.now();
    for (const [ticket, meta] of this._authTickets.entries()) {
      if (!meta || meta.expiresAt <= now) {
        this._authTickets.delete(ticket);
      }
    }
  }

  _consumeAuthTicket(ticket) {
    if (!ticket) return null;

    const record = this._authTickets.get(String(ticket));
    if (!record) return null;

    this._authTickets.delete(String(ticket));
    if (record.expiresAt <= Date.now()) return null;
    return record.userId;
  }

  _isAllowedOrigin(req) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (!origin) return true;
    if (config.allowedOrigins.includes(origin) || origin === config.FRONTEND_URL) return true;

    const forwardedHost = Array.isArray(req.headers['x-forwarded-host'])
      ? req.headers['x-forwarded-host'][0]
      : req.headers['x-forwarded-host'];
    const requestHost = forwardedHost || req.headers.host;

    try {
      return new URL(origin).host === requestHost;
    } catch {
      return false;
    }
  }

  _authenticate(req) {
    try {
      const parsed = url.parse(req.url, true);
      const ticketUserId = this._consumeAuthTicket(parsed.query.ticket);
      if (!ticketUserId) return null;

      const user = db.findOne('users', { id: ticketUserId });
      if (!user || !user.is_active) return null;
      return ticketUserId;
    } catch {
      return null;
    }
  }

  _send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  /** Broadcast an event to all connections of a specific user. */
  broadcastToUser(userId, payload) {
    const sockets = this._clients.get(userId);
    if (!sockets) return;
    const data = JSON.stringify(payload);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  disconnectUser(userId, code = 4003, reason = 'Account unavailable') {
    const sockets = this._clients.get(userId);
    if (!sockets) return;

    for (const ws of sockets) {
      try {
        ws.close(code, reason);
      } catch {
        try { ws.terminate(); } catch { /* ignore */ }
      }
    }

    this._clients.delete(userId);
  }

  /** Broadcast to all connected users (e.g. system announcements). */
  broadcastAll(payload) {
    const data = JSON.stringify(payload);
    for (const [, sockets] of this._clients.entries()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  }

  /** Number of connected users. */
  get connectionCount() {
    let count = 0;
    for (const set of this._clients.values()) count += set.size;
    return count;
  }

  get connectedUserCount() {
    return this._clients.size;
  }

  shutdown() {
    clearInterval(this._pingInterval);
    clearInterval(this._ticketCleanupInterval);
    this._authTickets.clear();
    this._wss?.close();
  }
}

module.exports = new WSServer();
