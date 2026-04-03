'use strict';

const db = require('../database');

function formatReview(row, currentUserId = null) {
  if (!row) return null;

  const identitySource = row.discord_id ? 'discord' : 'site';
  const displayName = row.discord_global_name || row.discord_username || row.username || 'User';
  const displayAvatarUrl = row.discord_avatar_url || row.avatar_url || null;
  const displayHandle = row.discord_username
    ? `@${row.discord_username}`
    : row.username
      ? `@${row.username}`
      : '';

  return {
    id: row.id,
    user_id: row.user_id,
    username: displayName,
    avatar_url: displayAvatarUrl,
    site_username: row.username || 'User',
    site_avatar_url: row.avatar_url || null,
    display_name: displayName,
    display_avatar_url: displayAvatarUrl,
    display_handle: displayHandle,
    identity_source: identitySource,
    discord_id: row.discord_id || null,
    discord_username: row.discord_username || null,
    discord_global_name: row.discord_global_name || null,
    rating_half: Number(row.rating_half || 0),
    rating: Number(row.rating_half || 0) / 2,
    message: row.message || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    is_mine: currentUserId ? row.user_id === currentUserId : false,
  };
}

function getReviewRows() {
  return db.raw(`
    SELECT
      r.*,
      u.username,
      u.avatar_url,
      u.discord_id,
      u.discord_username,
      u.discord_global_name,
      u.discord_avatar_url
    FROM site_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE u.is_active = 1
    ORDER BY datetime(r.updated_at) DESC, datetime(r.created_at) DESC
  `);
}

function getReviewStats() {
  const row = db.raw(`
    SELECT
      COUNT(*) AS total_reviews,
      COALESCE(ROUND(AVG(rating_half) / 2.0, 2), 0) AS average_rating
    FROM site_reviews
  `)[0] || {};

  return {
    total_reviews: Number(row.total_reviews || 0),
    average_rating: Number(row.average_rating || 0),
  };
}

function getOverview(currentUserId) {
  const rows = getReviewRows();
  const myReview = rows.find((row) => row.user_id === currentUserId) || null;

  return {
    stats: getReviewStats(),
    my_review: formatReview(myReview, currentUserId),
    reviews: rows.map((row) => formatReview(row, currentUserId)),
  };
}

function createReview(userId, { rating_half, message }) {
  const existing = db.findOne('site_reviews', { user_id: userId });
  if (existing) {
    throw Object.assign(new Error('Review already exists for this account'), { status: 409 });
  }

  const now = new Date().toISOString();
  const review = db.insert('site_reviews', {
    user_id: userId,
    rating_half: Number(rating_half),
    message: String(message || '').trim(),
    created_at: now,
    updated_at: now,
  });

  const row = db.raw(`
    SELECT
      r.*,
      u.username,
      u.avatar_url,
      u.discord_id,
      u.discord_username,
      u.discord_global_name,
      u.discord_avatar_url
    FROM site_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
    LIMIT 1
  `, [review.id])[0];

  return formatReview(row, userId);
}

function updateOwnReviewMessage(userId, { message }) {
  const existing = db.findOne('site_reviews', { user_id: userId });
  if (!existing) {
    throw Object.assign(new Error('Review not found'), { status: 404 });
  }

  db.update('site_reviews', {
    message: String(message || '').trim(),
  }, { id: existing.id });

  const row = db.raw(`
    SELECT
      r.*,
      u.username,
      u.avatar_url,
      u.discord_id,
      u.discord_username,
      u.discord_global_name,
      u.discord_avatar_url
    FROM site_reviews r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
    LIMIT 1
  `, [existing.id])[0];

  return formatReview(row, userId);
}

module.exports = {
  getOverview,
  createReview,
  updateOwnReviewMessage,
};
