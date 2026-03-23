'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authService = require('./authService');

const STAFF_ROLES = new Set(['admin', 'founder']);
const OPEN_COOLDOWN_MS = 60 * 1000;
const MESSAGE_COOLDOWN_MS = 4 * 1000;
const DUPLICATE_TICKET_WINDOW_MS = 10 * 60 * 1000;
const DUPLICATE_MESSAGE_WINDOW_MS = 45 * 1000;
const MAX_OPEN_TICKETS_PER_USER = 3;

const AUTO_TICKET_TITLES = {
  bug: 'Bug signale',
  report: 'Signalement',
  account: 'Probleme de compte',
  question: 'Question',
  other: 'Demande de support',
};

function buildHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isSupportStaff(user) {
  return STAFF_ROLES.has(user?.role);
}

function isPrimaryFounder(user) {
  return authService.isPrimaryFounderEmail(user?.email);
}

function sanitizeSupportEmail(viewer, ownerUserId, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return '';
  if (authService.isPrimaryFounderEmail(normalizedEmail)) {
    return authService.maskEmail(normalizedEmail, { hideCompletely: true });
  }
  if (isPrimaryFounder(viewer)) {
    return normalizedEmail;
  }
  if (viewer?.id === ownerUserId) {
    return normalizedEmail;
  }
  return authService.maskEmail(normalizedEmail);
}

function serializeProfile(prefix, row, currentUser) {
  const id = row?.[`${prefix}_id`] || null;
  const username = row?.[`${prefix}_username`] || null;
  const avatarUrl = row?.[`${prefix}_avatar_url`] || null;
  const role = row?.[`${prefix}_role`] || (prefix === 'claimer' ? null : 'member');

  if (!id && !username && !avatarUrl && !role) return null;

  return {
    id,
    username: username || 'Support',
    avatar_url: avatarUrl,
    role: role || 'member',
    email: prefix === 'owner' ? sanitizeSupportEmail(currentUser, id, row?.owner_email) : '',
    joined_at: prefix === 'owner' ? row?.owner_created_at || null : null,
    last_login_at: prefix === 'owner' ? row?.owner_last_login_at || null : null,
  };
}

function decorateTicket(row, currentUser) {
  const owner = serializeProfile('owner', row, currentUser);
  const claimer = serializeProfile('claimer', row, currentUser);
  const staff = isSupportStaff(currentUser);
  const primaryFounder = isPrimaryFounder(currentUser);
  const isOwner = row.user_id === currentUser.id;
  const isClaimedByCurrentUser = row.claimed_by_user_id === currentUser.id;

  return {
    id: row.id,
    ticket_number: Number(row.ticket_number || 0),
    title: row.title,
    category: row.category,
    status: row.status,
    message_count: Number(row.message_count || 0),
    last_message_preview: row.last_message_preview || '',
    last_message_at: row.last_message_at || row.updated_at || row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at || null,
    closed_at: row.closed_at || null,
    closed_by_user_id: row.closed_by_user_id || null,
    owner,
    claimer,
    permissions: {
      can_reply: (isOwner || staff) && row.status !== 'closed',
      can_claim: staff && row.status !== 'closed' && (!row.claimed_by_user_id || isClaimedByCurrentUser || primaryFounder),
      can_unclaim: staff && !!row.claimed_by_user_id && (isClaimedByCurrentUser || primaryFounder),
      can_close: staff && row.status !== 'closed',
      can_reopen: staff && row.status === 'closed',
      can_edit: primaryFounder,
      can_delete: primaryFounder,
      can_delete_messages: primaryFounder,
    },
  };
}

function formatMessage(row) {
  const fallbackRole = row.kind === 'staff' ? 'admin' : row.kind === 'system' ? 'system' : 'member';
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    kind: row.kind,
    body: row.is_deleted ? '' : row.body,
    is_deleted: !!row.is_deleted,
    created_at: row.created_at,
    updated_at: row.updated_at,
    author: {
      id: row.author_user_id || null,
      username: row.author_username || (row.kind === 'system' ? 'Support' : 'Utilisateur'),
      avatar_url: row.author_avatar_url || null,
      role: row.author_role || fallbackRole,
    },
  };
}

function getTicketRow(ticketId) {
  return db.db.prepare(`
    SELECT
      t.*,
      owner.id AS owner_id,
      owner.username AS owner_username,
      owner.avatar_url AS owner_avatar_url,
      owner.role AS owner_role,
      owner.email AS owner_email,
      owner.created_at AS owner_created_at,
      owner.last_login_at AS owner_last_login_at,
      claimer.id AS claimer_id,
      claimer.username AS claimer_username,
      claimer.avatar_url AS claimer_avatar_url,
      claimer.role AS claimer_role
    FROM support_tickets t
    JOIN users owner ON owner.id = t.user_id
    LEFT JOIN users claimer ON claimer.id = t.claimed_by_user_id
    WHERE t.id = ?
    LIMIT 1
  `).get(ticketId) || null;
}

function getTicketMessageRow(messageId) {
  return db.db.prepare('SELECT * FROM support_ticket_messages WHERE id = ? LIMIT 1').get(messageId) || null;
}

function assertTicketAccess(user, ticket) {
  if (!ticket) throw buildHttpError(404, 'Ticket introuvable');
  if (ticket.user_id === user.id || isSupportStaff(user)) return;
  throw buildHttpError(403, 'Acces refuse a ce ticket');
}

function assertSupportStaff(user) {
  if (!isSupportStaff(user)) {
    throw buildHttpError(403, 'Acces support staff requis');
  }
}

function assertPrimaryFounder(user) {
  if (!isPrimaryFounder(user)) {
    throw buildHttpError(403, 'Fondateur principal requis');
  }
}

function insertMessage(ticketId, payload, timestamp = nowIso()) {
  db.insert('support_ticket_messages', {
    id: uuidv4(),
    ticket_id: ticketId,
    author_user_id: payload.author_user_id || null,
    author_role: payload.author_role || 'member',
    author_username: payload.author_username || null,
    author_avatar_url: payload.author_avatar_url || null,
    kind: payload.kind || 'user',
    body: payload.body,
    is_deleted: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function recomputeTicketSnapshot(ticketId) {
  const visibleCount = db.db.prepare(`
    SELECT COUNT(*) AS count
    FROM support_ticket_messages
    WHERE ticket_id = ? AND is_deleted = 0
  `).get(ticketId)?.count || 0;

  const latestActivity = db.db.prepare(`
    SELECT created_at
    FROM support_ticket_messages
    WHERE ticket_id = ? AND is_deleted = 0
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(ticketId);

  const latestPreview = db.db.prepare(`
    SELECT body
    FROM support_ticket_messages
    WHERE ticket_id = ? AND is_deleted = 0 AND kind IN ('user', 'staff')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(ticketId) || db.db.prepare(`
    SELECT body
    FROM support_ticket_messages
    WHERE ticket_id = ? AND is_deleted = 0
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(ticketId);

  db.db.prepare(`
    UPDATE support_tickets
    SET message_count = ?,
        last_message_preview = ?,
        last_message_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    Number(visibleCount || 0),
    String(latestPreview?.body || '').slice(0, 220),
    latestActivity?.created_at || null,
    nowIso(),
    ticketId
  );
}

function addSystemMessage(ticketId, message, actor) {
  insertMessage(ticketId, {
    author_user_id: actor?.id || null,
    author_role: 'system',
    author_username: 'Support',
    author_avatar_url: actor?.avatar_url || null,
    kind: 'system',
    body: message,
  });
}

function buildListWhere(user, query, includeStatus = true) {
  const staff = isSupportStaff(user);
  const conditions = [];
  const params = [];

  if (!staff || query.view === 'mine') {
    conditions.push('t.user_id = ?');
    params.push(user.id);
  }

  if (includeStatus && query.status !== 'all') {
    conditions.push('t.status = ?');
    params.push(query.status);
  }

  if (query.category !== 'all') {
    conditions.push('t.category = ?');
    params.push(query.category);
  }

  if (staff && query.view === 'staff') {
    if (query.claim === 'mine') {
      conditions.push('t.claimed_by_user_id = ?');
      params.push(user.id);
    } else if (query.claim === 'unclaimed') {
      conditions.push('t.claimed_by_user_id IS NULL');
    }
  }

  if (query.q) {
    const search = `%${String(query.q).trim().toLowerCase()}%`;
    conditions.push(`(
      lower(t.title) LIKE ?
      OR lower(t.last_message_preview) LIKE ?
      OR lower(COALESCE(owner.username, '')) LIKE ?
      OR CAST(t.ticket_number AS TEXT) LIKE ?
    )`);
    params.push(search, search, search, search);
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function getTicketCounts(user, query) {
  const { whereSql, params } = buildListWhere(user, query, false);
  const row = db.db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN t.status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count,
      SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_count,
      SUM(CASE WHEN t.claimed_by_user_id IS NULL AND t.status != 'closed' THEN 1 ELSE 0 END) AS unclaimed_count
    FROM support_tickets t
    JOIN users owner ON owner.id = t.user_id
    ${whereSql}
  `).get(...params) || {};

  return {
    total: Number(row.total || 0),
    open: Number(row.open_count || 0),
    claimed: Number(row.claimed_count || 0),
    closed: Number(row.closed_count || 0),
    unclaimed: Number(row.unclaimed_count || 0),
  };
}

function listTickets(user, query) {
  const staff = isSupportStaff(user);
  if (query.view === 'staff' && !staff) {
    throw buildHttpError(403, 'Acces support staff requis');
  }

  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  const offset = (page - 1) * limit;
  const { whereSql, params } = buildListWhere(user, query, true);

  const rows = db.db.prepare(`
    SELECT
      t.*,
      owner.id AS owner_id,
      owner.username AS owner_username,
      owner.avatar_url AS owner_avatar_url,
      owner.role AS owner_role,
      owner.email AS owner_email,
      owner.created_at AS owner_created_at,
      owner.last_login_at AS owner_last_login_at,
      claimer.id AS claimer_id,
      claimer.username AS claimer_username,
      claimer.avatar_url AS claimer_avatar_url,
      claimer.role AS claimer_role
    FROM support_tickets t
    JOIN users owner ON owner.id = t.user_id
    LEFT JOIN users claimer ON claimer.id = t.claimed_by_user_id
    ${whereSql}
    ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.ticket_number DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const totalRow = db.db.prepare(`
    SELECT COUNT(*) AS count
    FROM support_tickets t
    JOIN users owner ON owner.id = t.user_id
    ${whereSql}
  `).get(...params) || {};

  return {
    tickets: rows.map((row) => decorateTicket(row, user)),
    total: Number(totalRow.count || 0),
    page,
    limit,
    counts: getTicketCounts(user, query),
  };
}

function getTicketDetail(user, ticketId) {
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);

  const rows = db.db.prepare(`
    SELECT *
    FROM support_ticket_messages
    WHERE ticket_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(ticketId);

  return {
    ticket: decorateTicket(ticket, user),
    messages: rows.map(formatMessage),
  };
}

function createTicket(user, payload) {
  const timestamp = nowIso();
  const message = String(payload.message || '').trim();
  const autoTitleBase = AUTO_TICKET_TITLES[payload.category] || AUTO_TICKET_TITLES.other;
  const generatedTitle = `${autoTitleBase} - ${message.slice(0, 52).trim()}`.trim().replace(/\s+/g, ' ');
  const title = String(payload.title || '').trim() || generatedTitle;
  const normalizedTitle = normalizeText(title);
  const normalizedMessage = normalizeText(message);

  const openCount = db.db.prepare(`
    SELECT COUNT(*) AS count
    FROM support_tickets
    WHERE user_id = ? AND status IN ('open', 'claimed')
  `).get(user.id)?.count || 0;

  if (Number(openCount) >= MAX_OPEN_TICKETS_PER_USER) {
    throw buildHttpError(429, 'Trop de tickets ouverts en meme temps');
  }

  const recentTicket = db.db.prepare(`
    SELECT created_at
    FROM support_tickets
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(user.id);

  if (recentTicket?.created_at) {
    const delta = Date.now() - new Date(recentTicket.created_at).getTime();
    if (delta < OPEN_COOLDOWN_MS) {
      throw buildHttpError(429, 'Attends un peu avant d ouvrir un nouveau ticket');
    }
  }

  const duplicateTicket = db.db.prepare(`
    SELECT id
    FROM support_tickets
    WHERE user_id = ?
      AND lower(trim(title)) = ?
      AND lower(trim(last_message_preview)) = ?
      AND created_at >= ?
    LIMIT 1
  `).get(
    user.id,
    normalizedTitle,
    normalizedMessage,
    new Date(Date.now() - DUPLICATE_TICKET_WINDOW_MS).toISOString()
  );

  if (duplicateTicket) {
    throw buildHttpError(409, 'Un ticket similaire existe deja');
  }

  const ticketId = uuidv4();

  db.transaction(() => {
    const nextNumber = Number(
      db.db.prepare('SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next_number FROM support_tickets').get()?.next_number || 1
    );

    db.insert('support_tickets', {
      id: ticketId,
      ticket_number: nextNumber,
      user_id: user.id,
      category: payload.category,
      title,
      status: 'open',
      claimed_by_user_id: null,
      claimed_at: null,
      closed_at: null,
      closed_by_user_id: null,
      message_count: 0,
      last_message_preview: '',
      last_message_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });

    insertMessage(ticketId, {
      author_user_id: user.id,
      author_role: user.role || 'member',
      author_username: user.username,
      author_avatar_url: user.avatar_url || null,
      kind: 'user',
      body: message,
    }, timestamp);

    addSystemMessage(ticketId, 'Ticket recu. Le support te repondra ici.', {
      id: null,
      avatar_url: null,
    });

    recomputeTicketSnapshot(ticketId);
  });

  return getTicketDetail(user, ticketId);
}

function addTicketMessage(user, ticketId, body) {
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);

  if (ticket.status === 'closed') {
    throw buildHttpError(409, 'Le ticket est ferme');
  }

  const timestamp = nowIso();
  const latestFromAuthor = db.db.prepare(`
    SELECT body, created_at
    FROM support_ticket_messages
    WHERE ticket_id = ? AND author_user_id = ? AND is_deleted = 0
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(ticketId, user.id);

  if (latestFromAuthor?.created_at) {
    const delta = Date.now() - new Date(latestFromAuthor.created_at).getTime();
    if (delta < MESSAGE_COOLDOWN_MS) {
      throw buildHttpError(429, 'Attends quelques secondes avant de renvoyer un message');
    }

    if (
      normalizeText(latestFromAuthor.body) === normalizeText(body)
      && delta < DUPLICATE_MESSAGE_WINDOW_MS
    ) {
      throw buildHttpError(409, 'Ce message vient deja d etre envoye');
    }
  }

  db.transaction(() => {
    insertMessage(ticketId, {
      author_user_id: user.id,
      author_role: isSupportStaff(user) ? user.role : 'member',
      author_username: user.username,
      author_avatar_url: user.avatar_url || null,
      kind: isSupportStaff(user) ? 'staff' : 'user',
      body,
    }, timestamp);

    recomputeTicketSnapshot(ticketId);
  });

  return getTicketDetail(user, ticketId);
}

function claimTicket(user, ticketId) {
  assertSupportStaff(user);
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);

  if (ticket.status === 'closed') {
    throw buildHttpError(409, 'Le ticket est deja ferme');
  }

  const primaryFounder = isPrimaryFounder(user);
  if (ticket.claimed_by_user_id && ticket.claimed_by_user_id !== user.id && !primaryFounder) {
    throw buildHttpError(409, 'Ticket deja reclame par un autre membre du support');
  }

  db.transaction(() => {
    db.db.prepare(`
      UPDATE support_tickets
      SET claimed_by_user_id = ?, claimed_at = ?, status = 'claimed', closed_at = NULL, closed_by_user_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(user.id, nowIso(), nowIso(), ticketId);

    addSystemMessage(ticketId, `Ticket reclame par ${user.username}.`, user);
    recomputeTicketSnapshot(ticketId);
  });

  return getTicketDetail(user, ticketId);
}

function unclaimTicket(user, ticketId) {
  assertSupportStaff(user);
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);

  const primaryFounder = isPrimaryFounder(user);
  if (!ticket.claimed_by_user_id) {
    throw buildHttpError(409, 'Ce ticket n est pas reclame');
  }

  if (ticket.claimed_by_user_id !== user.id && !primaryFounder) {
    throw buildHttpError(403, 'Seul le membre qui a reclame ou le fondateur principal peut liberer le ticket');
  }

  db.transaction(() => {
    db.db.prepare(`
      UPDATE support_tickets
      SET claimed_by_user_id = NULL, claimed_at = NULL, status = 'open', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), ticketId);

    addSystemMessage(ticketId, `Ticket relache par ${user.username}.`, user);
    recomputeTicketSnapshot(ticketId);
  });

  return getTicketDetail(user, ticketId);
}

function setTicketStatus(user, ticketId, status) {
  assertSupportStaff(user);
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);

  const nextStatus = status === 'open'
    ? (ticket.claimed_by_user_id ? 'claimed' : 'open')
    : 'closed';

  db.transaction(() => {
    db.db.prepare(`
      UPDATE support_tickets
      SET status = ?,
          closed_at = ?,
          closed_by_user_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      nextStatus,
      nextStatus === 'closed' ? nowIso() : null,
      nextStatus === 'closed' ? user.id : null,
      nowIso(),
      ticketId
    );

    addSystemMessage(
      ticketId,
      nextStatus === 'closed'
        ? `Ticket ferme par ${user.username}.`
        : `Ticket rouvert par ${user.username}.`,
      user
    );
    recomputeTicketSnapshot(ticketId);
  });

  return getTicketDetail(user, ticketId);
}

function updateTicket(user, ticketId, changes) {
  assertPrimaryFounder(user);
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);

  const updates = [];
  const params = [];
  const changesSummary = [];

  if (typeof changes.title === 'string') {
    updates.push('title = ?');
    params.push(String(changes.title).trim());
    changesSummary.push('titre');
  }

  if (typeof changes.category === 'string') {
    updates.push('category = ?');
    params.push(changes.category);
    changesSummary.push('categorie');
  }

  if (typeof changes.status === 'string') {
    let nextStatus = changes.status;
    if (nextStatus === 'open' && ticket.claimed_by_user_id) nextStatus = 'claimed';
    if (nextStatus === 'claimed' && !ticket.claimed_by_user_id) {
      throw buildHttpError(400, 'Impossible de passer en reclame sans claim');
    }

    updates.push('status = ?');
    params.push(nextStatus);
    updates.push('closed_at = ?');
    params.push(nextStatus === 'closed' ? nowIso() : null);
    updates.push('closed_by_user_id = ?');
    params.push(nextStatus === 'closed' ? user.id : null);
    changesSummary.push('statut');
  }

  if (!updates.length) {
    throw buildHttpError(400, 'Aucune modification a appliquer');
  }

  db.transaction(() => {
    db.db.prepare(`
      UPDATE support_tickets
      SET ${updates.join(', ')}, updated_at = ?
      WHERE id = ?
    `).run(...params, nowIso(), ticketId);

    addSystemMessage(ticketId, `Ticket modifie par ${user.username} (${changesSummary.join(', ')}).`, user);
    recomputeTicketSnapshot(ticketId);
  });

  return getTicketDetail(user, ticketId);
}

function deleteTicket(user, ticketId) {
  assertPrimaryFounder(user);
  const ticket = getTicketRow(ticketId);
  assertTicketAccess(user, ticket);
  db.remove('support_tickets', { id: ticketId });
  return { deleted: true, ticket_id: ticketId };
}

function deleteTicketMessage(user, messageId) {
  assertPrimaryFounder(user);
  const message = getTicketMessageRow(messageId);
  if (!message) {
    throw buildHttpError(404, 'Message introuvable');
  }

  const ticket = getTicketRow(message.ticket_id);
  assertTicketAccess(user, ticket);

  if (message.kind === 'system') {
    throw buildHttpError(400, 'Les messages systeme ne peuvent pas etre supprimes');
  }

  if (message.is_deleted) {
    return getTicketDetail(user, message.ticket_id);
  }

  db.transaction(() => {
    db.db.prepare(`
      UPDATE support_ticket_messages
      SET is_deleted = 1, body = '', deleted_at = ?, deleted_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso(), user.id, nowIso(), messageId);

    recomputeTicketSnapshot(message.ticket_id);
  });

  return getTicketDetail(user, message.ticket_id);
}

module.exports = {
  isSupportStaff,
  isPrimaryFounder,
  listTickets,
  getTicketDetail,
  createTicket,
  addTicketMessage,
  claimTicket,
  unclaimTicket,
  setTicketStatus,
  updateTicket,
  deleteTicket,
  deleteTicketMessage,
};
