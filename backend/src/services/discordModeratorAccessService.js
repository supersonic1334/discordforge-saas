'use strict';

const discordService = require('./discordService');

const DISCORD_PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE_MEMBERS: 1n << 40n,
};

const ASSISTANT_ACTION_PERMISSION = {
  add_warning: DISCORD_PERMISSIONS.MODERATE_MEMBERS,
  timeout_user: DISCORD_PERMISSIONS.MODERATE_MEMBERS,
  kick_user: DISCORD_PERMISSIONS.KICK_MEMBERS,
  ban_user: DISCORD_PERMISSIONS.BAN_MEMBERS,
};

function buildHttpError(status, message, code) {
  const error = new Error(message);
  error.httpStatus = status;
  error.code = code;
  return error;
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

async function getGuildMemberSafe(token, guildId, userId) {
  try {
    return await discordService.getGuildMember(token, guildId, userId);
  } catch (error) {
    if (error?.httpStatus === 404) return null;
    throw error;
  }
}

async function resolveLinkedModeratorAccess({ user, guildRow, botToken, actionName }) {
  const requiredPermission = ASSISTANT_ACTION_PERMISSION[actionName] || null;
  const linkedDiscordId = String(user?.discord_id || '').trim();

  if (!requiredPermission) {
    return {
      required: false,
      linked: Boolean(linkedDiscordId),
      permissionVerified: true,
      discordId: linkedDiscordId || null,
      guildOwner: linkedDiscordId && linkedDiscordId === String(guildRow?.owner_id || ''),
      member: linkedDiscordId ? await getGuildMemberSafe(botToken, guildRow.guild_id, linkedDiscordId) : null,
    };
  }

  if (!linkedDiscordId) {
    throw buildHttpError(
      403,
      'Lie d abord ton compte Discord pour utiliser cette action dans l assistant IA.',
      'DISCORD_LINK_REQUIRED'
    );
  }

  const guildRoleMap = new Map(
    (await discordService.getGuildRoles(botToken, guildRow.guild_id).catch(() => []))
      .map((role) => [String(role.id), role])
  );
  const permissionContext = {
    guildRoleMap,
    guildId: guildRow.guild_id,
    ownerId: guildRow.owner_id,
  };
  const guildOwner = linkedDiscordId === String(guildRow?.owner_id || '');

  if (guildOwner) {
    return {
      required: true,
      linked: true,
      permissionVerified: true,
      discordId: linkedDiscordId,
      guildOwner: true,
      member: await getGuildMemberSafe(botToken, guildRow.guild_id, linkedDiscordId),
    };
  }

  const member = await getGuildMemberSafe(botToken, guildRow.guild_id, linkedDiscordId);
  if (!member) {
    throw buildHttpError(
      403,
      'Le compte Discord lie doit etre present sur ce serveur pour executer cette action.',
      'DISCORD_LINK_NOT_IN_GUILD'
    );
  }

  if (!memberHasPermission(member, requiredPermission, permissionContext)) {
    throw buildHttpError(
      403,
      'Le compte Discord lie n a pas les permissions necessaires pour cette action.',
      'DISCORD_PERMISSION_DENIED'
    );
  }

  return {
    required: true,
    linked: true,
    permissionVerified: true,
    discordId: linkedDiscordId,
    guildOwner: false,
    member,
  };
}

module.exports = {
  DISCORD_PERMISSIONS,
  resolveLinkedModeratorAccess,
};
