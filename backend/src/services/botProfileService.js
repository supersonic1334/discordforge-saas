'use strict';

const db = require('../database');

const DEFAULT_BOT_PROFILE_SETTINGS = Object.freeze({
  presence_status: 'online',
  activity_type: 'playing',
  activity_text: '',
});

const ALLOWED_PRESENCE_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);
const ALLOWED_ACTIVITY_TYPES = new Set(['playing', 'listening', 'watching', 'competing', 'streaming']);

function normalizePresenceStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_PRESENCE_STATUSES.has(normalized)
    ? normalized
    : DEFAULT_BOT_PROFILE_SETTINGS.presence_status;
}

function normalizeActivityType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_ACTIVITY_TYPES.has(normalized)
    ? normalized
    : DEFAULT_BOT_PROFILE_SETTINGS.activity_type;
}

function normalizeActivityText(value) {
  return String(value || '').trim().slice(0, 128);
}

function sanitizeSettings(input = {}) {
  return {
    presence_status: normalizePresenceStatus(input.presence_status),
    activity_type: normalizeActivityType(input.activity_type),
    activity_text: normalizeActivityText(input.activity_text),
  };
}

function getBotProfileSettings(userId) {
  const row = db.findOne('bot_profile_settings', { user_id: userId });
  if (!row) {
    return { ...DEFAULT_BOT_PROFILE_SETTINGS };
  }

  return sanitizeSettings(row);
}

function saveBotProfileSettings(userId, nextSettings = {}) {
  const currentRow = db.findOne('bot_profile_settings', { user_id: userId });
  const current = currentRow ? sanitizeSettings(currentRow) : { ...DEFAULT_BOT_PROFILE_SETTINGS };
  const merged = sanitizeSettings({ ...current, ...nextSettings });

  if (currentRow) {
    db.update('bot_profile_settings', merged, { user_id: userId });
  } else {
    db.insert('bot_profile_settings', {
      user_id: userId,
      ...merged,
    });
  }

  return merged;
}

module.exports = {
  DEFAULT_BOT_PROFILE_SETTINGS,
  getBotProfileSettings,
  saveBotProfileSettings,
  normalizePresenceStatus,
  normalizeActivityType,
  normalizeActivityText,
};
