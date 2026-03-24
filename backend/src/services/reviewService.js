'use strict';

const db = require('../database');

function formatReview(row, currentUserId = null) {
  if (!row) return null;

  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username || 'User',
    avatar_url: row.avatar_url || null,
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
      u.avatar_url
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
      u.avatar_url
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
      u.avatar_url
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
