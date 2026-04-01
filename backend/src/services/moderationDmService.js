'use strict';

const config = require('../config');
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
  brand_name: '',
  brand_icon_url: '',
  brand_logo_url: '',
  brand_site_url: '',
  site_button_label: '',
  show_site_link: true,
  show_brand_logo: true,
  footer_text: '',
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

function sanitizeAssetUrl(value) {
  const asset = String(value || '').trim();
  if (!asset) return '';
  if (/^https?:\/\/\S+$/i.test(asset)) return asset;
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(asset)) return asset;
  return '';
}

function toBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(input = {}, baseSettings = DEFAULT_SETTINGS) {
  return {
    auto_dm_warn: toBoolean(input.auto_dm_warn, baseSettings.auto_dm_warn),
    auto_dm_timeout: toBoolean(input.auto_dm_timeout, baseSettings.auto_dm_timeout),
    auto_dm_kick: toBoolean(input.auto_dm_kick, baseSettings.auto_dm_kick),
    auto_dm_ban: toBoolean(input.auto_dm_ban, baseSettings.auto_dm_ban),
    auto_dm_blacklist: toBoolean(input.auto_dm_blacklist, baseSettings.auto_dm_blacklist),
    appeal_server_name: sanitizeText(input.appeal_server_name, 120),
    appeal_server_url: sanitizeUrl(input.appeal_server_url),
    brand_name: sanitizeText(input.brand_name, 120),
    brand_icon_url: sanitizeAssetUrl(input.brand_icon_url),
    brand_logo_url: sanitizeAssetUrl(input.brand_logo_url),
    brand_site_url: sanitizeUrl(input.brand_site_url),
    site_button_label: sanitizeText(input.site_button_label, 80),
    show_site_link: toBoolean(input.show_site_link, baseSettings.show_site_link),
    show_brand_logo: toBoolean(input.show_brand_logo, baseSettings.show_brand_logo),
    footer_text: sanitizeText(input.footer_text, 180),
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
    brand_name: row.brand_name || '',
    brand_icon_url: row.brand_icon_url || '',
    brand_logo_url: row.brand_logo_url || '',
    brand_site_url: row.brand_site_url || '',
    site_button_label: row.site_button_label || '',
    show_site_link: !!row.show_site_link,
    show_brand_logo: !!row.show_brand_logo,
    footer_text: row.footer_text || '',
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

function truncateField(value, max = 1024) {
  const text = sanitizeMultilineText(value, max);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function getBrandAssets(settings, guildIdentity) {
  const fallbackUrl = 'https://discordforger.onrender.com';
  const customSiteUrl = sanitizeUrl(settings?.brand_site_url);
  const candidateUrl = sanitizeUrl(config.FRONTEND_URL);
  const siteUrl = customSiteUrl || ((candidateUrl && !candidateUrl.includes('localhost')) ? candidateUrl : fallbackUrl);
  const siteRoot = siteUrl.replace(/\/+$/, '');
  const brandName = sanitizeText(settings?.brand_name, 120) || guildIdentity?.name || 'Serveur Discord';
  const customIconUrl = sanitizeAssetUrl(settings?.brand_icon_url);
  const customLogoUrl = sanitizeAssetUrl(settings?.brand_logo_url);
  const siteButtonLabel = sanitizeText(settings?.site_button_label, 80) || `Ouvrir ${brandName}`;

  return {
    brandName,
    siteUrl,
    siteButtonLabel,
    showSiteLink: toBoolean(settings?.show_site_link, DEFAULT_SETTINGS.show_site_link),
    showBrandLogo: toBoolean(settings?.show_brand_logo, DEFAULT_SETTINGS.show_brand_logo),
    footerText: sanitizeText(settings?.footer_text, 180) || 'Notification automatique',
    brandIconUrl: customIconUrl || guildIdentity?.iconUrl || `${siteRoot}/discordforger-icon.png`,
    brandLogoUrl: customLogoUrl || `${siteRoot}/discordforger-logo-full.png`,
  };
}

function buildSiteButton(brandAssets) {
  if (!brandAssets?.showSiteLink || !brandAssets?.siteUrl) return null;
  return {
    type: 2,
    style: 5,
    label: brandAssets.siteButtonLabel || 'Ouvrir le tableau de bord',
    url: brandAssets.siteUrl,
  };
}

function buildAppealButton(settings) {
  const appealUrl = sanitizeUrl(settings.appeal_server_url);
  if (!appealUrl) return null;

  const appealName = sanitizeText(settings.appeal_server_name || '', 120) || 'Serveur d appel';
  return {
    type: 2,
    style: 5,
    label: `Recours - ${appealName}`,
    url: appealUrl,
  };
}

function buildActionPayload({
  guildIdentity,
  actionType,
  reason,
  durationMs,
  points,
  moderatorName,
  moderatorAvatarUrl,
  hideModeratorIdentity,
  settings,
}) {
  const style = ACTION_STYLES[actionType] || ACTION_STYLES.warn;
  const brandAssets = getBrandAssets(settings, guildIdentity);
  const moderatorLabel = hideModeratorIdentity
    ? 'Staff du serveur'
    : (sanitizeText(moderatorName, 80) || 'Staff du serveur');
  const appealButton = buildAppealButton(settings);
  const appealName = sanitizeText(settings.appeal_server_name || '', 120) || 'Serveur d appel';
  const detailLines = [
    `**Serveur** : ${guildIdentity.name}`,
    `**Action** : ${style.label}`,
    `**Par** : ${moderatorLabel}`,
  ];

  if (actionType === 'warn' && Number(points || 0) > 0) {
    detailLines.push(`**Points** : ${Number(points)}`);
  }

  if (actionType === 'timeout' && durationMs) {
    detailLines.push(`**Duree** : ${formatDuration(durationMs)}`);
  }

  const description = [
    style.summary,
    '',
    detailLines.join('\n'),
    '',
    '**Raison**',
    truncateField(reason || 'Aucune raison precisee.', 900),
  ];

  const fields = [
    {
      name: 'Notification',
      value: truncateField(brandAssets.brandName, 100),
      inline: true,
    },
    {
      name: 'Etat',
      value: actionType === 'unban' || actionType === 'untimeout'
        ? 'Restriction retiree'
        : 'Notification envoyee',
      inline: true,
    },
  ];
  if (brandAssets.showSiteLink && brandAssets.siteUrl) {
    fields.push({
      name: 'Lien utile',
      value: `[${brandAssets.siteButtonLabel}](${brandAssets.siteUrl})`,
      inline: true,
    });
  }

  if ((actionType === 'ban' || actionType === 'blacklist') && appealButton) {
    description.push('', `**Recours**\nTu peux demander une nouvelle etude via **${appealName}**.`);
    fields.push({
      name: 'Recours',
      value: truncateField(`Utilise le bouton ci-dessous pour rejoindre ${appealName}.`, 220),
      inline: false,
    });
  }

  const embed = {
    color: style.color,
    author: {
      name: `${brandAssets.brandName} - Notification staff`,
      icon_url: brandAssets.brandIconUrl,
    },
    title: style.title,
    description: description.join('\n'),
    thumbnail: {
      url: guildIdentity.iconUrl || brandAssets.brandIconUrl,
    },
    footer: {
      text: brandAssets.footerText,
      icon_url: hideModeratorIdentity
        ? (guildIdentity.iconUrl || brandAssets.brandIconUrl)
        : (moderatorAvatarUrl || guildIdentity.iconUrl || brandAssets.brandIconUrl),
    },
    timestamp: new Date().toISOString(),
    fields,
  };
  if (brandAssets.showBrandLogo && brandAssets.brandLogoUrl) {
    embed.image = {
      url: brandAssets.brandLogoUrl,
    };
  }

  const components = [];
  const siteButton = buildSiteButton(brandAssets);
  if (siteButton) components.push(siteButton);
  if ((actionType === 'ban' || actionType === 'blacklist') && appealButton) {
    components.push(appealButton);
  }

  const payload = {
    embeds: [embed],
  };
  if (components.length > 0) {
    payload.components = [
      {
        type: 1,
        components,
      },
    ];
  }
  return payload;
}

function buildDirectMessagePayload({
  guildIdentity,
  title,
  message,
  senderName,
  hideSenderIdentity,
  settings,
}) {
  const brandAssets = getBrandAssets(settings, guildIdentity);
  const cleanTitle = sanitizeText(title, 120) || 'Message du staff';
  const cleanMessage = truncateField(message || 'Aucun contenu.', 1600);
  const senderLabel = hideSenderIdentity
    ? 'Staff du serveur'
    : (sanitizeText(senderName, 80) || 'Staff du serveur');

  const fields = [
    {
      name: 'Serveur',
      value: guildIdentity.name,
      inline: true,
    },
    {
      name: 'Envoye par',
      value: senderLabel,
      inline: true,
    },
  ];
  if (brandAssets.showSiteLink && brandAssets.siteUrl) {
    fields.push({
      name: 'Lien utile',
      value: `[${brandAssets.siteButtonLabel}](${brandAssets.siteUrl})`,
      inline: true,
    });
  }

  const embed = {
    color: 0x22d3ee,
    author: {
      name: `${brandAssets.brandName} - Message staff`,
      icon_url: brandAssets.brandIconUrl,
    },
    title: cleanTitle,
    description: [
      'Tu as recu un message prive depuis le dashboard staff.',
      '',
      '**Message**',
      cleanMessage,
    ].join('\n'),
    thumbnail: {
      url: guildIdentity.iconUrl || brandAssets.brandIconUrl,
    },
    fields,
    footer: {
      text: brandAssets.footerText,
      icon_url: guildIdentity.iconUrl || brandAssets.brandIconUrl,
    },
    timestamp: new Date().toISOString(),
  };
  if (brandAssets.showBrandLogo && brandAssets.brandLogoUrl) {
    embed.image = {
      url: brandAssets.brandLogoUrl,
    };
  }

  const payload = {
    embeds: [embed],
  };
  const siteButton = buildSiteButton(brandAssets);
  if (siteButton) {
    payload.components = [
      {
        type: 1,
        components: [siteButton],
      },
    ];
  }

  return payload;
}

function getSettingsForGuildIdentity(guildIdentity) {
  if (!guildIdentity?.row?.id) return { ...DEFAULT_SETTINGS };
  return getGuildDmSettings(guildIdentity.row.id);
}

function buildMergedSettings(existing, input = {}) {
  return normalizeSettings({
    ...(existing || DEFAULT_SETTINGS),
    ...(input || {}),
  }, existing || DEFAULT_SETTINGS);
}

function getGuildDmSettings(guildInternalId) {
  const row = db.findOne('guild_dm_settings', { guild_id: guildInternalId });
  return mapSettingsRow(row);
}

function saveGuildDmSettings(guildInternalId, input) {
  const existingSettings = getGuildDmSettings(guildInternalId);
  const settings = buildMergedSettings(existingSettings, input);
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
  hideModeratorIdentity,
}) {
  const guildIdentity = getGuildIdentity({ guildRow, guildId, guild });
  if (!guildIdentity.row?.id) {
    throw new Error('Guild not found for moderation DM');
  }

  const settings = getSettingsForGuildIdentity(guildIdentity);
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
    hideModeratorIdentity,
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
  hideSenderIdentity,
}) {
  const guildIdentity = getGuildIdentity({ guildRow, guildId, guild });
  const settings = getSettingsForGuildIdentity(guildIdentity);
  const payload = buildDirectMessagePayload({
    guildIdentity,
    title,
    message,
    senderName,
    hideSenderIdentity,
    settings,
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
