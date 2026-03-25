'use strict';

const db = require('../database');
const discordService = require('./discordService');
const logger = require('../utils/logger').child('ModerationDM');

const DEFAULT_SETTINGS = {
  auto_dm_warn: true,
  auto_dm_timeout: true,
  auto_dm_kick: true,
  auto_dm_ban: true,
  auto_dm_blacklist: true,
  appeal_server_name: '',
  appeal_server_url: '',
};

const ACTION_STYLES = {
  warn: {
    color: 0xfbbf24,
    title: 'Avertissement officiel',
    summary: 'Un avertissement a ete ajoute a ton dossier moderation.',
    label: 'Avertissement',
  },
  timeout: {
    color: 0x22d3ee,
    title: 'Exclusion temporaire',
    summary: 'Tu ne peux plus parler pendant une duree limitee.',
    label: 'Exclusion temporaire',
  },
  kick: {
    color: 0xf97316,
    title: 'Exclusion du serveur',
    summary: 'Tu as ete retire du serveur par le staff.',
    label: 'Exclusion',
  },
  ban: {
    color: 0xef4444,
    title: 'Bannissement',
    summary: 'Ton acces au serveur a ete retire.',
    label: 'Bannissement',
  },
  blacklist: {
    color: 0xa855f7,
    title: 'Blocage reseau',
    summary: 'Ton acces au reseau de serveurs du bot a ete coupe.',
    label: 'Blacklist reseau',
  },
  unban: {
    color: 0x34d399,
    title: 'Debannissement',
    summary: 'Ton acces au serveur a ete restaure.',
    label: 'Deban',
  },
  untimeout: {
    color: 0x38bdf8,
    title: 'Fin de restriction',
    summary: 'Tu peux de nouveau parler normalement.',
    label: 'Restriction levee',
  },
};

function sanitizeText(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function sanitizeMultilineText(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : '';
}

function toBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(input = {}) {
  return {
    auto_dm_warn: toBoolean(input.auto_dm_warn, DEFAULT_SETTINGS.auto_dm_warn),
    auto_dm_timeout: toBoolean(input.auto_dm_timeout, DEFAULT_SETTINGS.auto_dm_timeout),
    auto_dm_kick: toBoolean(input.auto_dm_kick, DEFAULT_SETTINGS.auto_dm_kick),
    auto_dm_ban: toBoolean(input.auto_dm_ban, DEFAULT_SETTINGS.auto_dm_ban),
    auto_dm_blacklist: toBoolean(input.auto_dm_blacklist, DEFAULT_SETTINGS.auto_dm_blacklist),
    appeal_server_name: sanitizeText(input.appeal_server_name, 120),
    appeal_server_url: sanitizeUrl(input.appeal_server_url),
  };
}

function mapSettingsRow(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return normalizeSettings({
    auto_dm_warn: !!row.auto_dm_warn,
    auto_dm_timeout: !!row.auto_dm_timeout,
    auto_dm_kick: !!row.auto_dm_kick,
    auto_dm_ban: !!row.auto_dm_ban,
    auto_dm_blacklist: !!row.auto_dm_blacklist,
    appeal_server_name: row.appeal_server_name || '',
    appeal_server_url: row.appeal_server_url || '',
  });
}

function getGuildRow({ guildRow, guildId }) {
  if (guildRow?.id) return guildRow;
  if (!guildId) return null;
  return db.raw('SELECT * FROM guilds WHERE guild_id = ? LIMIT 1', [guildId])[0] || null;
}

function getGuildIdentity({ guildRow, guild, guildId }) {
  const row = getGuildRow({ guildRow, guildId });
  const resolvedGuildId = guild?.id || row?.guild_id || guildId || null;
  const iconUrl =
    (typeof guild?.iconURL === 'function' && (guild.iconURL({ size: 256 }) || guild.iconURL()))
    || (row?.icon && row?.guild_id ? discordService.getGuildIconUrl(row.guild_id, row.icon, 256) : null);

  return {
    row,
    guildId: resolvedGuildId,
    name: sanitizeText(guild?.name || row?.name || 'Serveur Discord', 120) || 'Serveur Discord',
    iconUrl,
  };
}

function getActionSettingKey(actionType) {
  switch (actionType) {
    case 'warn':
      return 'auto_dm_warn';
    case 'timeout':
      return 'auto_dm_timeout';
    case 'kick':
      return 'auto_dm_kick';
    case 'ban':
      return 'auto_dm_ban';
    case 'blacklist':
      return 'auto_dm_blacklist';
    default:
      return null;
  }
}

function formatDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return 'Non precisee';
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes > 1 ? 's' : ''}`;
  const totalHours = Math.round(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} heure${totalHours > 1 ? 's' : ''}`;
  const totalDays = Math.round(totalHours / 24);
  return `${totalDays} jour${totalDays > 1 ? 's' : ''}`;
}

function buildActionPayload({
  guildIdentity,
  actionType,
  reason,
  durationMs,
  points,
  moderatorName,
  moderatorAvatarUrl,
  settings,
}) {
  const style = ACTION_STYLES[actionType] || ACTION_STYLES.warn;
  const appealName = sanitizeText(settings.appeal_server_name || '', 120) || 'Serveur d appel';
  const appealUrl = sanitizeUrl(settings.appeal_server_url);
  const fields = [
    {
      name: 'Serveur',
      value: guildIdentity.name,
      inline: true,
    },
    {
      name: 'Sanction',
      value: style.label,
      inline: true,
    },
    {
      name: 'Par',
      value: sanitizeText(moderatorName, 80) || 'Staff du serveur',
      inline: true,
    },
  ];

  if (actionType === 'warn' && Number(points || 0) > 0) {
    fields.push({
      name: 'Points',
      value: String(Number(points)),
      inline: true,
    });
  }

  if (actionType === 'timeout' && durationMs) {
    fields.push({
      name: 'Duree',
      value: formatDuration(durationMs),
      inline: true,
    });
  }

  fields.push({
    name: 'Raison',
    value: sanitizeMultilineText(reason, 900) || 'Aucune raison precisee.',
    inline: false,
  });

  if ((actionType === 'ban' || actionType === 'blacklist') && appealUrl) {
    fields.push({
      name: 'Derniere chance',
      value: `Si tu veux demander un deban, rejoins **${appealName}** via le bouton ci-dessous.`,
      inline: false,
    });
  }

  const embed = {
    color: style.color,
    author: {
      name: guildIdentity.name,
      icon_url: guildIdentity.iconUrl || undefined,
    },
    title: style.title,
    description: style.summary,
    thumbnail: guildIdentity.iconUrl ? { url: guildIdentity.iconUrl } : undefined,
    footer: {
      text: 'DiscordForger • Notification automatique',
      icon_url: moderatorAvatarUrl || guildIdentity.iconUrl || undefined,
    },
    timestamp: new Date().toISOString(),
    fields,
  };

  const components = (actionType === 'ban' || actionType === 'blacklist') && appealUrl
    ? [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: `Rejoindre ${appealName}`,
              url: appealUrl,
            },
          ],
        },
      ]
    : undefined;

  return {
    embeds: [embed],
    components,
  };
}

function buildDirectMessagePayload({
  guildIdentity,
  title,
  message,
  senderName,
}) {
  return {
    embeds: [
      {
        color: 0x22d3ee,
        author: {
          name: guildIdentity.name,
          icon_url: guildIdentity.iconUrl || undefined,
        },
        title: sanitizeText(title, 120) || 'Message du staff',
        description: sanitizeMultilineText(message, 1800),
        thumbnail: guildIdentity.iconUrl ? { url: guildIdentity.iconUrl } : undefined,
        fields: [
          {
            name: 'Envoye par',
            value: sanitizeText(senderName, 80) || 'Staff du serveur',
            inline: true,
          },
          {
            name: 'Depuis',
            value: guildIdentity.name,
            inline: true,
          },
        ],
        footer: {
          text: 'DiscordForger • Message prive',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function getGuildDmSettings(guildInternalId) {
  const row = db.findOne('guild_dm_settings', { guild_id: guildInternalId });
  return mapSettingsRow(row);
}

function saveGuildDmSettings(guildInternalId, input) {
  const settings = normalizeSettings(input);
  const existing = db.findOne('guild_dm_settings', { guild_id: guildInternalId });

  if (existing) {
    db.update('guild_dm_settings', settings, { id: existing.id });
  } else {
    db.insert('guild_dm_settings', {
      guild_id: guildInternalId,
      ...settings,
    });
  }

  return getGuildDmSettings(guildInternalId);
}

async function sendModerationDm({
  botToken,
  guildRow,
  guildId,
  guild,
  actionType,
  targetUserId,
  reason,
  durationMs,
  points,
  moderatorName,
  moderatorAvatarUrl,
}) {
  const guildIdentity = getGuildIdentity({ guildRow, guildId, guild });
  if (!guildIdentity.row?.id) {
    throw new Error('Guild not found for moderation DM');
  }

  const settings = getGuildDmSettings(guildIdentity.row.id);
  const settingKey = getActionSettingKey(actionType);
  if (settingKey && !settings[settingKey]) {
    return { sent: false, skipped: true };
  }

  const payload = buildActionPayload({
    guildIdentity,
    actionType,
    reason,
    durationMs,
    points,
    moderatorName,
    moderatorAvatarUrl,
    settings,
  });

  await discordService.sendDirectMessage(botToken, targetUserId, payload);
  return { sent: true, skipped: false };
}

async function safeSendModerationDm(options) {
  try {
    return await sendModerationDm(options);
  } catch (error) {
    logger.warn('Failed to send moderation DM', {
      actionType: options?.actionType,
      targetUserId: options?.targetUserId,
      guildId: options?.guildId || options?.guild?.id || options?.guildRow?.guild_id || null,
      error: error?.message || 'Unknown error',
    });
    return { sent: false, skipped: false, error: error?.message || 'Unknown error' };
  }
}

async function sendDirectStaffMessage({
  botToken,
  guildRow,
  guildId,
  guild,
  targetUserId,
  title,
  message,
  senderName,
}) {
  const guildIdentity = getGuildIdentity({ guildRow, guildId, guild });
  const payload = buildDirectMessagePayload({
    guildIdentity,
    title,
    message,
    senderName,
  });

  await discordService.sendDirectMessage(botToken, targetUserId, payload);
  return { sent: true };
}

module.exports = {
  DEFAULT_SETTINGS,
  getGuildDmSettings,
  saveGuildDmSettings,
  sendModerationDm,
  safeSendModerationDm,
  sendDirectStaffMessage,
};
