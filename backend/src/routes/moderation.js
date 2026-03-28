'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const { requireAuth, requireBotToken, requireGuildOwner, validate, validateQuery } = require('../middleware');
const { addWarningSchema, modActionSchema, paginationSchema, moderationSearchSchema } = require('../validators/schemas');
const { addWarning, getWarningCount, recordModAction, checkEscalation } = require('../bot/utils/modHelpers');
const discordService = require('../services/discordService');
const { safeSendModerationDm } = require('../services/moderationDmService');
const { decrypt } = require('../services/encryptionService');
const authService = require('../services/authService');
const botBlacklistService = require('../services/botBlacklistService');
const db = require('../database');

router.use(requireAuth, requireBotToken, requireGuildOwner);

const DISCORD_PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE_MEMBERS: 1n << 40n,
};

const QUICK_ACTION_PERMISSION = {
  warn: DISCORD_PERMISSIONS.MODERATE_MEMBERS,
  timeout: DISCORD_PERMISSIONS.MODERATE_MEMBERS,
  untimeout: DISCORD_PERMISSIONS.MODERATE_MEMBERS,
  kick: DISCORD_PERMISSIONS.KICK_MEMBERS,
  ban: DISCORD_PERMISSIONS.BAN_MEMBERS,
  unban: DISCORD_PERMISSIONS.BAN_MEMBERS,
  blacklist: DISCORD_PERMISSIONS.BAN_MEMBERS,
};

const DISCORD_HISTORY_ACTIONS = new Set([20, 22, 23, 24, 25, 26, 27, 28, 72, 73, 74, 75, 145]);

function parseJson(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildHttpError(status, message) {
  const error = new Error(message);
  error.httpStatus = status;
  return error;
}

function isPrimaryFounder(user) {
  return authService.isPrimaryFounderEmail(user?.email);
}

function normalizeDiscordIdentity(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function parseDiscordIdentity(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: '', id: null, lookupQuery: '', normalized: '' };

  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return { raw, id: mentionMatch[1], lookupQuery: mentionMatch[1], normalized: normalizeDiscordIdentity(raw) };
  }
  if (/^\d+$/.test(raw)) {
    return { raw, id: raw, lookupQuery: raw, normalized: normalizeDiscordIdentity(raw) };
  }

  const cleaned = raw.replace(/^@/, '').trim();
  const legacyTagMatch = cleaned.match(/^(.+?)#(\d{4})$/);
  const lookupQuery = (legacyTagMatch?.[1] || cleaned).trim();

  return {
    raw,
    id: null,
    lookupQuery,
    normalized: normalizeDiscordIdentity(cleaned),
  };
}

function parseDiscordDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/, '$1');
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getActiveTimeoutUntil(value) {
  const timestamp = parseDiscordDate(value);
  if (!timestamp || timestamp <= Date.now()) return null;
  return new Date(timestamp).toISOString();
}

function buildMemberIdentitySet(member) {
  const user = member?.user || {};
  const values = new Set();
  const push = (entry) => {
    const normalized = normalizeDiscordIdentity(entry);
    if (normalized) values.add(normalized);
  };

  push(user.id);
  push(`<@${user.id}>`);
  push(`<@!${user.id}>`);
  push(user.username);
  push(user.global_name);
  push(member?.nick);
  if (user.username && user.discriminator && user.discriminator !== '0') {
    push(`${user.username}#${user.discriminator}`);
  }

  return values;
}

function memberMatchesIdentity(member, identity) {
  const normalizedInput = normalizeDiscordIdentity(identity);
  if (!normalizedInput) return false;
  return buildMemberIdentitySet(member).has(normalizedInput);
}

async function resolveModeratorMemberByIdentity(token, guildId, identityInput, expectedDiscordId = null) {
  const identity = parseDiscordIdentity(identityInput);
  if (!identity.raw) {
    throw buildHttpError(400, 'Identite Discord du moderateur obligatoire');
  }

  if (identity.id) {
    const member = await getGuildMemberSafe(token, guildId, identity.id);
    if (!member) throw buildHttpError(404, 'Compte Discord du moderateur introuvable sur ce serveur');
    return { identity, member };
  }

  const members = await discordService.searchGuildMembers(token, guildId, identity.lookupQuery, 25).catch(() => []);
  const exactMatches = [];
  const seen = new Set();
  for (const member of Array.isArray(members) ? members : []) {
    const memberId = member?.user?.id;
    if (!memberId || seen.has(memberId)) continue;
    seen.add(memberId);
    if (memberMatchesIdentity(member, identity.raw)) {
      exactMatches.push(member);
    }
  }

  if (expectedDiscordId) {
    const linkedMember = exactMatches.find((member) => String(member?.user?.id) === String(expectedDiscordId));
    if (linkedMember) return { identity, member: linkedMember };
  }

  if (exactMatches.length === 0) {
    throw buildHttpError(404, 'Identite Discord invalide ou introuvable sur ce serveur');
  }

  if (exactMatches.length > 1) {
    throw buildHttpError(400, 'Identite Discord ambigue, utilise un ID ou une mention');
  }

  return { identity, member: exactMatches[0] };
}

function parsePermissions(value) {
  try {
    return BigInt(String(value || '0'));
  } catch {
    return 0n;
  }
}

function computeMemberPermissions(member, context = {}) {
  if (!member) return 0n;

  const guildRoleMap = context.guildRoleMap instanceof Map ? context.guildRoleMap : new Map();
  const guildId = String(context.guildId || '');
  const ownerId = String(context.ownerId || '');
  const memberUserId = String(member?.user?.id || member?.user_id || '');

  if (ownerId && memberUserId && ownerId === memberUserId) {
    return DISCORD_PERMISSIONS.ADMINISTRATOR;
  }

  const explicitPermissions = parsePermissions(member?.permissions);
  if (explicitPermissions > 0n) return explicitPermissions;

  let permissions = 0n;
  const includeRole = (roleId) => {
    const role = guildRoleMap.get(String(roleId));
    if (role) permissions |= parsePermissions(role.permissions);
  };

  if (guildId) includeRole(guildId);
  for (const roleId of Array.isArray(member?.roles) ? member.roles : []) {
    includeRole(roleId);
  }

  return permissions;
}

function memberHasPermission(member, permission, context = {}) {
  if (!permission) return true;
  const permissions = computeMemberPermissions(member, context);
  if ((permissions & DISCORD_PERMISSIONS.ADMINISTRATOR) === DISCORD_PERMISSIONS.ADMINISTRATOR) return true;
  return (permissions & permission) === permission;
}

function snowflakeToIso(snowflake) {
  if (!snowflake) return null;
  try {
    const timestamp = Number((BigInt(String(snowflake)) >> 22n) + 1420070400000n);
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function formatAuditActionLabel(type, changes = []) {
  const actionType = Number(type || 0);
  if (actionType === 20) return 'kick';
  if (actionType === 22) return 'ban';
  if (actionType === 23) return 'unban';
  if (actionType === 24) {
    const isTimeout = changes.some((entry) => entry?.key === 'communication_disabled_until');
    return isTimeout ? 'timeout' : 'member_update';
  }
  if (actionType === 25) return 'role_update';
  if (actionType === 26) return 'voice_move';
  if (actionType === 27) return 'voice_disconnect';
  if (actionType === 28) return 'bot_add';
  if (actionType === 72) return 'message_delete';
  if (actionType === 73) return 'message_bulk_delete';
  if (actionType === 74) return 'message_pin';
  if (actionType === 75) return 'message_unpin';
  if (actionType === 145) return 'timeout_remove';
  return `action_${actionType || 'unknown'}`;
}

function getChangeValue(changes, key) {
  const change = (Array.isArray(changes) ? changes : []).find((entry) => entry?.key === key);
  if (!change) return null;
  return change.new_value ?? change.old_value ?? null;
}

function translateAuditReason(reason) {
  const raw = String(reason || '').trim();
  if (!raw) return '';

  const lowered = raw.toLowerCase();
  if (lowered.includes('message contained keyword defined in automod rule')) {
    return 'Message contenant un mot-cle defini dans une regle AutoMod.';
  }
  if (lowered.includes('keyword defined in automod rule')) {
    return 'Mot-cle detecte par une regle AutoMod.';
  }
  if (lowered.includes('mention spam')) {
    return 'Spam de mentions detecte par AutoMod.';
  }
  if (lowered.includes('spam')) {
    return 'Spam detecte automatiquement.';
  }
  if (lowered.includes('harmful link')) {
    return 'Lien potentiellement dangereux detecte.';
  }

  return raw;
}

function formatRoleList(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return '';
  return roles
    .map((role) => `@${role?.name || role?.id || 'Role inconnu'}`)
    .join(', ');
}

function buildDiscordAuditSummary(entry) {
  const changes = Array.isArray(entry?.changes) ? entry.changes : [];
  const actionType = Number(entry?.action_type || 0);
  const translatedReason = translateAuditReason(entry?.reason);

  if (actionType === 25) {
    const addedRoles = changes.find((change) => change?.key === '$add')?.new_value || [];
    const removedRoles = changes.find((change) => change?.key === '$remove')?.new_value || [];
    const lines = [];
    const addedLabel = formatRoleList(addedRoles);
    const removedLabel = formatRoleList(removedRoles);

    if (addedLabel) lines.push(`Roles ajoutes : ${addedLabel}`);
    if (removedLabel) lines.push(`Roles retires : ${removedLabel}`);
    if (translatedReason) lines.push(`Contexte : ${translatedReason}`);

    return lines.join('\n') || 'Mise a jour des roles detectee.';
  }

  if (actionType === 24) {
    const timeoutChange = changes.find((change) => change?.key === 'communication_disabled_until');
    const nickChange = changes.find((change) => change?.key === 'nick');
    const lines = [];

    if (timeoutChange?.new_value) {
      lines.push(`Restriction de parole jusqu'au ${new Date(timeoutChange.new_value).toLocaleString('fr-FR')}.`);
    } else if (timeoutChange && timeoutChange.old_value && !timeoutChange.new_value) {
      lines.push('Restriction de parole retiree.');
    }

    if (nickChange) {
      const before = nickChange.old_value || 'aucun';
      const after = nickChange.new_value || 'aucun';
      lines.push(`Surnom : ${before} -> ${after}`);
    }

    if (translatedReason) lines.push(`Contexte : ${translatedReason}`);

    return lines.join('\n') || translatedReason || 'Mise a jour du membre detectee.';
  }

  if (actionType === 145) {
    return translatedReason || 'Le timeout a ete retire.';
  }

  if (actionType === 26) {
    return translatedReason || 'Deplacement vocal detecte.';
  }

  if (actionType === 27) {
    return translatedReason || 'Deconnexion vocale detectee.';
  }

  return translatedReason || '';
}

function buildRoleSummary(member, guildRoleMap, guildId) {
  if (!member || !Array.isArray(member.roles)) return [];

  return member.roles
    .filter((roleId) => roleId && roleId !== guildId)
    .map((roleId) => {
      const role = guildRoleMap.get(roleId);
      return {
        id: roleId,
        name: role?.name || roleId,
        color: role?.color || 0,
        position: role?.position || 0,
      };
    })
    .sort((a, b) => b.position - a.position);
}

function buildMemberProfile(member, guildRoleMap, guildId, ownerId) {
  if (!member?.user) return null;
  const user = member.user;
  const permissionContext = { guildRoleMap, guildId, ownerId };
  const permissions = computeMemberPermissions(member, permissionContext);
  const displayName = member.nick || user.global_name || user.username || user.id;
  const activeTimeoutUntil = getActiveTimeoutUntil(member.communication_disabled_until);

  return {
    id: user.id,
    username: user.username || null,
    global_name: user.global_name || null,
    nickname: member.nick || null,
    display_name: displayName,
    avatar_url: discordService.getAvatarUrl(user.id, user.avatar, 128, user.discriminator),
    bot: Boolean(user.bot),
    created_at: snowflakeToIso(user.id),
    joined_at: member.joined_at || null,
    premium_since: member.premium_since || null,
    timed_out_until: activeTimeoutUntil,
    timeout_active: Boolean(activeTimeoutUntil),
    roles: buildRoleSummary(member, guildRoleMap, guildId),
    permissions: {
      administrator: memberHasPermission(member, DISCORD_PERMISSIONS.ADMINISTRATOR, permissionContext),
      moderate_members: memberHasPermission(member, DISCORD_PERMISSIONS.MODERATE_MEMBERS, permissionContext),
      kick_members: memberHasPermission(member, DISCORD_PERMISSIONS.KICK_MEMBERS, permissionContext),
      ban_members: memberHasPermission(member, DISCORD_PERMISSIONS.BAN_MEMBERS, permissionContext),
      view_audit_log: memberHasPermission(member, DISCORD_PERMISSIONS.VIEW_AUDIT_LOG, permissionContext),
      manage_messages: memberHasPermission(member, DISCORD_PERMISSIONS.MANAGE_MESSAGES, permissionContext),
      raw: permissions.toString(),
    },
  };
}

function buildBasicUserProfile(user, fallbackId = null) {
  if (!user) {
    return {
      id: fallbackId,
      username: null,
      global_name: null,
      nickname: null,
      display_name: fallbackId || 'Unknown',
      avatar_url: null,
      bot: false,
      created_at: snowflakeToIso(fallbackId),
      joined_at: null,
      premium_since: null,
      timed_out_until: null,
      timeout_active: false,
      roles: [],
      permissions: null,
    };
  }

  return {
    id: user.id,
    username: user.username || null,
    global_name: user.global_name || null,
    nickname: null,
    display_name: user.global_name || user.username || user.id,
    avatar_url: discordService.getAvatarUrl(user.id, user.avatar, 128, user.discriminator),
    bot: Boolean(user.bot),
    created_at: snowflakeToIso(user.id),
    joined_at: null,
    premium_since: null,
    timed_out_until: null,
    timeout_active: false,
    roles: [],
    permissions: null,
  };
}

async function getGuildMemberSafe(token, guildId, userId) {
  try {
    return await discordService.getGuildMember(token, guildId, userId);
  } catch (error) {
    if (error?.httpStatus === 404) return null;
    throw error;
  }
}

async function getGuildBanSafe(token, guildId, userId) {
  try {
    return await discordService.getGuildBan(token, guildId, userId);
  } catch (error) {
    if (error?.httpStatus === 404) return null;
    throw error;
  }
}

async function resolveModeratorAccess(req, token, actionName, identityInput) {
  const linkedDiscordId = req.user.discord_id || null;
  const trimmedIdentity = String(identityInput || '').trim();
  const requiredPermission = QUICK_ACTION_PERMISSION[actionName] || DISCORD_PERMISSIONS.MODERATE_MEMBERS;
  const linkedIsGuildOwner = linkedDiscordId && String(linkedDiscordId) === String(req.guild.owner_id || '');
  const guildRoleMap = new Map(
    (await discordService.getGuildRoles(token, req.guild.guild_id).catch(() => []))
      .map((role) => [String(role.id), role])
  );
  const permissionContext = {
    guildRoleMap,
    guildId: req.guild.guild_id,
    ownerId: req.guild.owner_id,
  };

  if (linkedDiscordId && !trimmedIdentity) {
    if (linkedIsGuildOwner) {
      return {
        linked: true,
        permissionVerified: true,
        discordId: linkedDiscordId,
        member: await getGuildMemberSafe(token, req.guild.guild_id, linkedDiscordId),
      };
    }

    const linkedMember = await getGuildMemberSafe(token, req.guild.guild_id, linkedDiscordId);
    if (!linkedMember) {
      const error = buildHttpError(403, 'Le compte Discord lie doit etre present sur ce serveur pour utiliser les actions rapides');
      error.code = 'DISCORD_LINK_NOT_IN_GUILD';
      throw error;
    }
    if (!memberHasPermission(linkedMember, requiredPermission, permissionContext)) {
      const error = buildHttpError(403, 'Le compte Discord lie n a pas les permissions necessaires pour cette action');
      error.code = 'DISCORD_PERMISSION_DENIED';
      throw error;
    }

    return {
      linked: true,
      permissionVerified: true,
      discordId: linkedDiscordId,
      member: linkedMember,
    };
  }

  if (!linkedDiscordId && !trimmedIdentity) {
    const error = buildHttpError(403, 'Connecte d abord ton compte Discord pour utiliser les actions rapides');
    error.code = 'DISCORD_LINK_REQUIRED';
    throw error;
  }

  const { member } = await resolveModeratorMemberByIdentity(token, req.guild.guild_id, trimmedIdentity, linkedDiscordId);

  if (linkedDiscordId) {
    if (String(member?.user?.id || '') !== String(linkedDiscordId)) {
      const error = buildHttpError(403, 'L identite Discord ne correspond pas au compte Discord lie a ce profil');
      error.code = 'DISCORD_LINK_MISMATCH';
      throw error;
    }

    if (!linkedIsGuildOwner && !memberHasPermission(member, requiredPermission, permissionContext)) {
      const error = buildHttpError(403, 'Le compte Discord lie n a pas les permissions necessaires pour cette action');
      error.code = 'DISCORD_PERMISSION_DENIED';
      throw error;
    }

    return {
      linked: true,
      permissionVerified: true,
      discordId: linkedDiscordId,
      member,
    };
  }

  if (!memberHasPermission(member, requiredPermission, permissionContext)) {
    const error = buildHttpError(403, 'L identite Discord fournie n a pas les permissions necessaires pour cette action');
    error.code = 'DISCORD_PERMISSION_DENIED';
    throw error;
  }

  return {
    linked: false,
    permissionVerified: true,
    discordId: member?.user?.id || null,
    member,
  };
}

function buildViewerCapabilities(req, member, guildRoleMap) {
  const permissionContext = {
    guildRoleMap,
    guildId: req.guild.guild_id,
    ownerId: req.guild.owner_id,
  };
  const linkedIsGuildOwner = req.user.discord_id && String(req.user.discord_id) === String(req.guild.owner_id || '');

  if ((isPrimaryFounder(req.user) && !member) || linkedIsGuildOwner) {
    return {
      linked_discord: Boolean(req.user.discord_id),
      permission_verified: true,
      can_warn: true,
      can_timeout: true,
      can_kick: true,
      can_ban: true,
      can_unban: true,
      can_blacklist_network: true,
      can_view_audit_log: true,
    };
  }

  return {
    linked_discord: Boolean(req.user.discord_id),
    permission_verified: Boolean(member),
    can_warn: memberHasPermission(member, DISCORD_PERMISSIONS.MODERATE_MEMBERS, permissionContext),
    can_timeout: memberHasPermission(member, DISCORD_PERMISSIONS.MODERATE_MEMBERS, permissionContext),
    can_kick: memberHasPermission(member, DISCORD_PERMISSIONS.KICK_MEMBERS, permissionContext),
    can_ban: memberHasPermission(member, DISCORD_PERMISSIONS.BAN_MEMBERS, permissionContext),
    can_unban: memberHasPermission(member, DISCORD_PERMISSIONS.BAN_MEMBERS, permissionContext),
    can_blacklist_network: memberHasPermission(member, DISCORD_PERMISSIONS.BAN_MEMBERS, permissionContext),
    can_view_audit_log: memberHasPermission(member, DISCORD_PERMISSIONS.VIEW_AUDIT_LOG, permissionContext),
  };
}

async function resolveDiscordProfile(token, identityInput) {
  const identity = parseDiscordIdentity(identityInput);
  if (!identity.id) {
    return {
      identity,
      profile: null,
      avatarUrl: null,
    };
  }

  try {
    const profile = await discordService.getUser(token, identity.id);
    return {
      identity,
      profile,
      avatarUrl: discordService.getAvatarUrl(profile.id, profile.avatar, 128, profile.discriminator),
    };
  } catch {
    return {
      identity,
      profile: null,
      avatarUrl: null,
    };
  }
}

async function buildModeratorMetadata(req, token, identityInput, moderationAccess = null) {
  const trimmedIdentity = String(identityInput || '').trim();
  const resolvedAccess = moderationAccess || await resolveModeratorAccess(req, token, 'warn', trimmedIdentity);
  let profile = resolvedAccess.member?.user || null;
  let avatarUrl = profile ? discordService.getAvatarUrl(profile.id, profile.avatar, 128, profile.discriminator) : null;
  let identityId = resolvedAccess.discordId || null;

  if (!profile && trimmedIdentity) {
    const resolved = await resolveDiscordProfile(token, trimmedIdentity);
    profile = resolved.profile;
    avatarUrl = resolved.avatarUrl;
    identityId = identityId || resolved.identity?.id || null;
  }

  const fallbackIdentity = trimmedIdentity || profile?.id || req.user.discord_id || null;
  const displayName = profile?.global_name || profile?.username || trimmedIdentity || req.user.username;

  return {
    moderator_site_user_id: req.user.id,
    moderator_site_username: req.user.username,
    moderator_site_avatar_url: req.user.avatar_url || null,
    moderator_discord_identity: fallbackIdentity,
    moderator_discord_id: profile?.id || identityId || null,
    moderator_discord_username: profile?.username || null,
    moderator_discord_global_name: profile?.global_name || null,
    moderator_discord_avatar_url: avatarUrl || null,
    moderator_display_name: displayName,
    moderator_linked_discord_verified: resolvedAccess.linked,
    moderator_permission_verified: resolvedAccess.permissionVerified,
  };
}

async function resolveTargetUser(token, targetUserId, targetUsername) {
  if (targetUsername) {
    return {
      username: targetUsername,
      avatarUrl: null,
    };
  }

  try {
    const profile = await discordService.getUser(token, targetUserId);
    return {
      username: profile.global_name || profile.username || targetUserId,
      avatarUrl: discordService.getAvatarUrl(profile.id, profile.avatar, 128, profile.discriminator),
    };
  } catch {
    return {
      username: targetUserId,
      avatarUrl: null,
    };
  }
}

async function issueWarning(req, token, payload) {
  const { target_user_id, target_username, reason, points, moderator_discord_identity, hide_moderator_identity } = payload;
  const moderatorAccess = await resolveModeratorAccess(req, token, 'warn', moderator_discord_identity);
  const moderatorMetadata = await buildModeratorMetadata(req, token, moderator_discord_identity, moderatorAccess);
  const target = await resolveTargetUser(token, target_user_id, target_username);
  const moderatorId = moderatorMetadata.moderator_discord_id || req.user.id;
  const moderatorUsername = moderatorMetadata.moderator_display_name || req.user.username;

  await addWarning(
    req.guild.guild_id,
    target_user_id,
    target.username,
    moderatorId,
    moderatorUsername,
    reason,
    points,
    {
      ...moderatorMetadata,
      target_avatar_url: target.avatarUrl,
    }
  );

  await recordModAction(
    req.guild.guild_id,
    'warn',
    target_user_id,
    target.username,
    moderatorId,
    moderatorUsername,
    reason,
    null,
    'MANUAL',
    {
      ...moderatorMetadata,
      target_avatar_url: target.avatarUrl,
      points,
    }
  );

  await safeSendModerationDm({
    botToken: token,
    guildRow: req.guild,
    actionType: 'warn',
    targetUserId: target_user_id,
    reason,
    points,
    moderatorName: moderatorUsername,
    moderatorAvatarUrl: moderatorMetadata.moderator_avatar_url || null,
    hideModeratorIdentity: Boolean(hide_moderator_identity),
  });

  const total = getWarningCount(req.guild.guild_id, target_user_id);
  const botProcess = require('../services/botManager').getProcess(req.guildOwnerUserId || req.user.id);
  if (botProcess?.client) {
    const discordGuild = botProcess.client.guilds.cache.get(req.guild.guild_id);
    if (discordGuild) {
      await checkEscalation(
        req.guild.guild_id,
        target_user_id,
        target.username,
        token,
        discordGuild
      );
    }
  }

  return {
    totalPoints: total,
    targetUsername: target.username,
    moderator: moderatorMetadata,
  };
}

function parseWarningRow(warning) {
  return {
    ...warning,
    metadata: parseJson(warning.metadata),
  };
}

function parseActionRow(action) {
  return {
    ...action,
    metadata: parseJson(action.metadata),
  };
}

function warningHistoryEntry(warning) {
  const metadata = warning.metadata || {};
  const moderatorName = metadata.moderator_display_name || metadata.moderator_site_username || warning.moderator_username || 'Unknown';
  return {
    id: `warning-${warning.id}`,
    source: 'site_warning',
    action: 'warn',
    label: 'Warning',
    created_at: warning.created_at,
    reason: warning.reason || '',
    points: warning.points || 0,
    active: Boolean(warning.active),
    moderator: {
      id: metadata.moderator_discord_id || warning.moderator_id || null,
      name: moderatorName,
      avatar_url: metadata.moderator_discord_avatar_url || metadata.moderator_site_avatar_url || null,
    },
  };
}

function siteActionHistoryEntry(action) {
  const metadata = action.metadata || {};
  const moderatorName = metadata.moderator_display_name || metadata.moderator_site_username || action.moderator_username || 'Unknown';
  return {
    id: `site-action-${action.id}`,
    source: 'site_action',
    action: action.action_type,
    label: action.action_type,
    created_at: action.created_at,
    reason: action.reason || '',
    duration_ms: action.duration_ms || null,
    points: metadata.points || 0,
    moderator: {
      id: metadata.moderator_discord_id || action.moderator_id || null,
      name: moderatorName,
      avatar_url: metadata.moderator_discord_avatar_url || metadata.moderator_site_avatar_url || null,
    },
  };
}

function discordActionHistoryEntry(entry, executorMap, userId) {
  const executor = executorMap.get(entry.user_id) || null;
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const action = formatAuditActionLabel(entry.action_type, changes);
  const timeoutUntil = getChangeValue(changes, 'communication_disabled_until');
  const summary = buildDiscordAuditSummary(entry);

  return {
    id: `discord-${entry.id}`,
    source: 'discord',
    action,
    label: action,
    created_at: snowflakeToIso(entry.id),
    reason: summary || entry.reason || '',
    duration_ms: timeoutUntil ? Math.max(0, new Date(timeoutUntil).getTime() - Date.now()) : null,
    target_user_id: userId,
    moderator: {
      id: executor?.id || entry.user_id || null,
      name: executor?.global_name || executor?.username || entry.user_id || 'Unknown',
      avatar_url: executor ? discordService.getAvatarUrl(executor.id, executor.avatar, 128, executor.discriminator) : null,
    },
  };
}

async function buildUserModerationProfile(req, token, userId) {
  const guildId = req.guild.guild_id;
  const guildRowId = req.guild.id;
  const ownerUserId = req.guildOwnerUserId || req.user.id;

  const [guildRoles, member, ban, remoteUser, warningRows, siteActionRows, auditPayload, viewerMember, blacklistEntry] = await Promise.all([
    discordService.getGuildRoles(token, guildId).catch(() => []),
    getGuildMemberSafe(token, guildId, userId),
    getGuildBanSafe(token, guildId, userId),
    discordService.getUser(token, userId).catch(() => null),
    Promise.resolve(
      db.raw(
        'SELECT * FROM warnings WHERE guild_id = ? AND target_user_id = ? ORDER BY created_at DESC',
        [guildRowId, userId]
      ).map(parseWarningRow)
    ),
    Promise.resolve(
      db.raw(
        'SELECT * FROM mod_actions WHERE guild_id = ? AND target_user_id = ? ORDER BY created_at DESC',
        [guildRowId, userId]
      ).map(parseActionRow)
    ),
    discordService.getGuildAuditLogs(token, guildId, { limit: 100 }).catch(() => ({ audit_log_entries: [], users: [] })),
    req.user.discord_id ? getGuildMemberSafe(token, guildId, req.user.discord_id) : Promise.resolve(null),
    Promise.resolve(botBlacklistService.getBlacklistEntry(ownerUserId, userId)),
  ]);

  const roleMap = new Map((Array.isArray(guildRoles) ? guildRoles : []).map((role) => [role.id, role]));
  const baseProfile = member
    ? buildMemberProfile(member, roleMap, guildId, req.guild.owner_id)
    : buildBasicUserProfile(ban?.user || remoteUser, userId);

  const warnings = warningRows;
  const siteActions = siteActionRows;
  const auditUsers = Array.isArray(auditPayload?.users) ? auditPayload.users : [];
  const auditEntries = Array.isArray(auditPayload?.audit_log_entries) ? auditPayload.audit_log_entries : [];
  const auditExecutorMap = new Map(auditUsers.map((user) => [user.id, user]));
  const discordActions = auditEntries
    .filter((entry) => String(entry?.target_id || '') === String(userId) && DISCORD_HISTORY_ACTIONS.has(Number(entry?.action_type || 0)))
    .map((entry) => discordActionHistoryEntry(entry, auditExecutorMap, userId))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const combinedHistory = [
    ...warnings.map(warningHistoryEntry),
    ...siteActions.map(siteActionHistoryEntry),
    ...discordActions,
  ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const activePoints = warnings.filter((warning) => warning.active).reduce((sum, warning) => sum + (warning.points || 0), 0);

  return {
    profile: {
      ...baseProfile,
      in_server: Boolean(member),
      banned: Boolean(ban),
      ban_reason: ban?.reason || '',
      network_blacklisted: Boolean(blacklistEntry),
      blacklist: blacklistEntry ? {
        reason: blacklistEntry.reason || '',
        source_module: blacklistEntry.source_module || 'SYSTEM',
        created_at: blacklistEntry.created_at || null,
        updated_at: blacklistEntry.updated_at || null,
      } : null,
    },
    viewer: buildViewerCapabilities(req, viewerMember, roleMap),
    site: {
      warnings,
      actions: siteActions,
      summary: {
        total_warnings: warnings.length,
        active_warning_points: activePoints,
        total_actions: siteActions.length,
      },
    },
    discord: {
      actions: discordActions,
      summary: {
        total_actions: discordActions.length,
        total_bans: discordActions.filter((entry) => entry.action === 'ban').length,
        total_kicks: discordActions.filter((entry) => entry.action === 'kick').length,
        total_timeouts: discordActions.filter((entry) => entry.action === 'timeout').length,
      },
    },
    combined_history: combinedHistory,
  };
}

router.get('/search', validateQuery(moderationSearchSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const guildId = req.guild.guild_id;
    const query = String(req.query.q || '').trim();
    const limit = Number(req.query.limit || 8);
    const results = [];
    const seen = new Set();

    if (/^\d+$/.test(query)) {
      const member = await getGuildMemberSafe(token, guildId, query);
      if (member?.user && !seen.has(member.user.id)) {
        seen.add(member.user.id);
        results.push({
          id: member.user.id,
          username: member.user.username || null,
          global_name: member.user.global_name || null,
          display_name: member.nick || member.user.global_name || member.user.username || member.user.id,
          avatar_url: discordService.getAvatarUrl(member.user.id, member.user.avatar, 128, member.user.discriminator),
          nickname: member.nick || null,
          joined_at: member.joined_at || null,
          in_server: true,
          banned: false,
          bot: Boolean(member.user.bot),
        });
      }

      const ban = await getGuildBanSafe(token, guildId, query);
      if (ban?.user && !seen.has(ban.user.id)) {
        seen.add(ban.user.id);
        results.push({
          id: ban.user.id,
          username: ban.user.username || null,
          global_name: ban.user.global_name || null,
          display_name: ban.user.global_name || ban.user.username || ban.user.id,
          avatar_url: discordService.getAvatarUrl(ban.user.id, ban.user.avatar, 128, ban.user.discriminator),
          nickname: null,
          joined_at: null,
          in_server: false,
          banned: true,
          bot: Boolean(ban.user.bot),
        });
      }
    }

    if (results.length < limit) {
      const members = await discordService.searchGuildMembers(token, guildId, query, limit).catch(() => []);
      for (const member of Array.isArray(members) ? members : []) {
        if (!member?.user?.id || seen.has(member.user.id)) continue;
        seen.add(member.user.id);
        results.push({
          id: member.user.id,
          username: member.user.username || null,
          global_name: member.user.global_name || null,
          display_name: member.nick || member.user.global_name || member.user.username || member.user.id,
          avatar_url: discordService.getAvatarUrl(member.user.id, member.user.avatar, 128, member.user.discriminator),
          nickname: member.nick || null,
          joined_at: member.joined_at || null,
          in_server: true,
          banned: false,
          bot: Boolean(member.user.bot),
        });
        if (results.length >= limit) break;
      }
    }

    res.json({
      results: results.slice(0, limit),
      total: results.length,
      q: query,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:discordUserId', async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const data = await buildUserModerationProfile(req, token, req.params.discordUserId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/warnings', validateQuery(paginationSchema), (req, res) => {
  const { page, limit } = req.query;
  const offset = (page - 1) * limit;

  const warnings = db.raw(
    `SELECT * FROM warnings WHERE guild_id = ? AND active = 1
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [req.guild.id, limit, offset]
  );

  const total = db.raw(
    'SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND active = 1',
    [req.guild.id]
  )[0]?.count ?? 0;

  res.json({
    warnings: warnings.map((warning) => ({
      ...warning,
      metadata: parseJson(warning.metadata),
    })),
    total,
    page,
    limit,
  });
});

router.get('/warnings/user/:discordUserId', (req, res) => {
  const warnings = db.raw(
    'SELECT * FROM warnings WHERE guild_id = ? AND target_user_id = ? ORDER BY created_at DESC',
    [req.guild.id, req.params.discordUserId]
  );

  const activePoints = warnings
    .filter((warning) => warning.active)
    .reduce((sum, warning) => sum + warning.points, 0);

  res.json({
    warnings: warnings.map((warning) => ({
      ...warning,
      metadata: parseJson(warning.metadata),
    })),
    activePoints,
    total: warnings.length,
  });
});

router.post('/warnings', validate(addWarningSchema), async (req, res, next) => {
  try {
    const token = decrypt(req.botToken.encrypted_token);
    const result = await issueWarning(req, token, req.body);

    res.status(201).json({
      message: 'Warning issued',
      totalPoints: result.totalPoints,
      moderator: result.moderator,
      targetUsername: result.targetUsername,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/warnings/:warningId', (req, res) => {
  const warning = db.raw(
    'SELECT * FROM warnings WHERE id = ? AND guild_id = ?',
    [req.params.warningId, req.guild.id]
  )[0];

  if (!warning) return res.status(404).json({ error: 'Warning not found' });

  db.db.prepare('UPDATE warnings SET active = 0 WHERE id = ?').run(warning.id);
  res.json({ message: 'Warning removed' });
});

router.get('/actions', validateQuery(paginationSchema), (req, res) => {
  const { page, limit } = req.query;
  const offset = (page - 1) * limit;

  const actions = db.raw(
    `SELECT * FROM mod_actions WHERE guild_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [req.guild.id, limit, offset]
  );

  const total = db.raw(
    'SELECT COUNT(*) as count FROM mod_actions WHERE guild_id = ?',
    [req.guild.id]
  )[0]?.count ?? 0;

  res.json({
    actions: actions.map((action) => ({ ...action, metadata: parseJson(action.metadata) })),
    total,
    page,
    limit,
  });
});

router.post('/actions', validate(modActionSchema), async (req, res, next) => {
  try {
    const { target_user_id, target_username, action, reason, duration_ms, points, moderator_discord_identity, hide_moderator_identity } = req.body;
    const token = decrypt(req.botToken.encrypted_token);
    const guildId = req.guild.guild_id;
    const moderatorAccess = await resolveModeratorAccess(req, token, action, moderator_discord_identity);
    const moderatorMetadata = await buildModeratorMetadata(req, token, moderator_discord_identity, moderatorAccess);
    const target = await resolveTargetUser(token, target_user_id, target_username);
    const moderatorId = moderatorMetadata.moderator_discord_id || req.user.id;
    const moderatorUsername = moderatorMetadata.moderator_display_name || req.user.username;

    if (action === 'warn') {
      const result = await issueWarning(req, token, req.body);
      return res.json({
        message: 'warn executed successfully',
        totalPoints: result.totalPoints,
        moderator: result.moderator,
      });
    }

    switch (action) {
      case 'timeout':
        if (!duration_ms) return res.status(400).json({ error: 'duration_ms required for timeout' });
        await discordService.timeoutMember(token, guildId, target_user_id, duration_ms, reason ?? 'Manual action');
        break;
      case 'untimeout':
        await discordService.timeoutMember(token, guildId, target_user_id, null, reason ?? 'Manual remove timeout');
        break;
      case 'kick':
        await safeSendModerationDm({
          botToken: token,
          guildRow: req.guild,
          actionType: 'kick',
          targetUserId: target_user_id,
          reason,
          moderatorName: moderatorUsername,
          moderatorAvatarUrl: moderatorMetadata.moderator_avatar_url || null,
          hideModeratorIdentity: Boolean(hide_moderator_identity),
        });
        await discordService.kickMember(token, guildId, target_user_id, reason ?? 'Manual kick');
        break;
      case 'ban':
        await safeSendModerationDm({
          botToken: token,
          guildRow: req.guild,
          actionType: 'ban',
          targetUserId: target_user_id,
          reason,
          moderatorName: moderatorUsername,
          moderatorAvatarUrl: moderatorMetadata.moderator_avatar_url || null,
          hideModeratorIdentity: Boolean(hide_moderator_identity),
        });
        await discordService.banMember(token, guildId, target_user_id, reason ?? 'Manual ban', 0);
        break;
      case 'unban':
        await discordService.unbanMember(token, guildId, target_user_id, reason ?? 'Manual unban');
        break;
      case 'blacklist':
        await safeSendModerationDm({
          botToken: token,
          guildRow: req.guild,
          actionType: 'blacklist',
          targetUserId: target_user_id,
          reason,
          moderatorName: moderatorUsername,
          moderatorAvatarUrl: moderatorMetadata.moderator_avatar_url || null,
          hideModeratorIdentity: Boolean(hide_moderator_identity),
        });
        await botBlacklistService.banUserAcrossBotNetwork(
          req.guildOwnerUserId || req.user.id,
          target_user_id,
          target.username,
          token,
          reason ?? 'Blacklist reseau manuelle',
          'MANUAL'
        );
        break;
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }

    if (action !== 'blacklist') {
      await recordModAction(
        guildId,
        action,
        target_user_id,
        target.username,
        moderatorId,
        moderatorUsername,
        reason,
        duration_ms,
        'MANUAL',
        {
          ...moderatorMetadata,
          target_avatar_url: target.avatarUrl,
          points,
        }
      );
    }

    if (action === 'timeout') {
      await safeSendModerationDm({
        botToken: token,
        guildRow: req.guild,
        actionType: 'timeout',
        targetUserId: target_user_id,
        reason,
        durationMs: duration_ms,
        moderatorName: moderatorUsername,
        moderatorAvatarUrl: moderatorMetadata.moderator_avatar_url || null,
        hideModeratorIdentity: Boolean(hide_moderator_identity),
      });
    }

    res.json({
      message: `${action} executed successfully`,
      moderator: moderatorMetadata,
      targetUsername: target.username,
      network_blacklisted: action === 'blacklist',
    });
  } catch (err) {
    if (err.httpStatus === 403) return res.status(403).json({ error: err.message || 'Action interdite' });
    if (err.httpStatus === 404) return res.status(404).json({ error: err.message || 'Utilisateur introuvable sur ce serveur' });
    if (err.httpStatus === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
