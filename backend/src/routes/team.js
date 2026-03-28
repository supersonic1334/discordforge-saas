'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  requireAuth,
  requireBotToken,
  requireGuildOwner,
  requireGuildPrimaryOwner,
  validate,
  validateQuery,
} = require('../middleware');
const {
  guildAccessInviteSchema,
  guildAccessCodeCreateSchema,
  guildAccessRoleSchema,
  guildAccessSuspendSchema,
  guildSnapshotCreateSchema,
  collaborationAuditListSchema,
} = require('../validators/schemas');
const guildAccessService = require('../services/guildAccessService');
const botManager = require('../services/botManager');
const wsServer = require('../websocket');

router.use(requireAuth, requireBotToken, requireGuildOwner);

// ── Helpers ──────────────────────────────────────────────────────────────────

function notifyProfileRefresh(userId, reason = 'guild_access_updated') {
  if (!userId) return;
  wsServer.broadcastToUser(String(userId), {
    event: 'account:profileUpdated',
    data: { reason },
  });
}

function notifyAllCollaborators(guildId, event, data, excludeUserId) {
  const collaborators = guildAccessService.listGuildCollaborators(guildId);
  for (const collab of collaborators) {
    if (collab.user_id === excludeUserId) continue;
    wsServer.broadcastToUser(String(collab.user_id), {
      event,
      data,
    });
  }
}

async function refreshGuildRuntime(ownerUserId, guildId) {
  botManager.invalidateModuleCache(ownerUserId, guildId);
  await botManager.syncCommandDefinitions(ownerUserId, guildId).catch(() => {});
  wsServer.broadcastToUser(String(ownerUserId), {
    event: 'bot:guildUpdate',
    data: { guildId },
  });
}

function buildOverview(req) {
  const access = req.guildAccess || guildAccessService.getGuildAccess(req.user.id, req.guild.id);

  return {
    guild: {
      id: req.guild.id,
      guild_id: req.guild.guild_id,
      name: req.guild.name,
      icon: req.guild.icon || null,
      member_count: req.guild.member_count || 0,
    },
    access: {
      is_owner: !!access?.is_owner,
      access_role: access?.access_role || 'viewer',
      owner_user_id: access?.owner_user_id || req.guild.user_id,
      owner_username: access?.owner_username || null,
      owner_avatar_url: access?.owner_avatar_url || null,
    },
    collaborators: guildAccessService.listGuildCollaborators(req.guild.id).map((entry) => ({
      id: entry.id,
      user_id: entry.user_id,
      username: entry.username,
      avatar_url: entry.avatar_url || null,
      discord_id: entry.discord_id || null,
      access_role: entry.access_role,
      is_owner: !!entry.is_owner,
      is_suspended: !!entry.is_suspended,
      expires_at: entry.expires_at || null,
      accepted_at: entry.accepted_at || null,
      created_at: entry.created_at || null,
      updated_at: entry.updated_at || null,
    })),
    join_codes: access?.is_owner ? guildAccessService.listGuildJoinCodes(req.guild.id) : [],
    snapshots: access?.is_owner ? guildAccessService.listGuildSnapshots(req.guild.id) : [],
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.json(buildOverview(req));
});

// Invite a collaborator
router.post('/invite', requireGuildPrimaryOwner, validate(guildAccessInviteSchema), (req, res, next) => {
  try {
    const invitedUser = guildAccessService.inviteGuildCollaborator({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      actorUserId: req.user.id,
      target: req.body.target,
      accessRole: req.body.access_role,
      expiresInHours: req.body.expires_in_hours,
    });

    notifyProfileRefresh(invitedUser.id, 'guild_access_invited');
    notifyAllCollaborators(req.guild.id, 'team:updated', { guildId: req.guild.id }, req.user.id);

    res.status(201).json({
      message: 'Acces partage ajoute',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

// Generate a single-use join code
router.post('/codes', requireGuildPrimaryOwner, validate(guildAccessCodeCreateSchema), (req, res, next) => {
  try {
    guildAccessService.createGuildJoinCode({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      actorUserId: req.user.id,
      accessRole: req.body.access_role,
      expiresInHours: req.body.expires_in_hours,
    });

    notifyAllCollaborators(req.guild.id, 'team:updated', { guildId: req.guild.id }, null);

    res.status(201).json({
      message: 'Code d acces genere',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/codes/:codeId', requireGuildPrimaryOwner, (req, res, next) => {
  try {
    guildAccessService.revokeGuildJoinCode({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      codeId: req.params.codeId,
      actorUserId: req.user.id,
    });

    notifyAllCollaborators(req.guild.id, 'team:updated', { guildId: req.guild.id }, null);

    res.json({
      message: 'Code revoque',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

// Update collaborator role
router.patch('/members/:memberUserId', requireGuildPrimaryOwner, validate(guildAccessRoleSchema), (req, res, next) => {
  try {
    guildAccessService.updateGuildCollaboratorRole({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      memberUserId: req.params.memberUserId,
      accessRole: req.body.access_role,
    });

    notifyProfileRefresh(req.params.memberUserId, 'guild_access_role_updated');
    notifyAllCollaborators(req.guild.id, 'team:updated', { guildId: req.guild.id }, req.user.id);

    res.json({
      message: 'Role partage mis a jour',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

// Suspend / unsuspend collaborator
router.patch('/members/:memberUserId/suspend', requireGuildPrimaryOwner, validate(guildAccessSuspendSchema), (req, res, next) => {
  try {
    guildAccessService.suspendGuildCollaborator({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      memberUserId: req.params.memberUserId,
      isSuspended: req.body.is_suspended,
    });

    // Immediately refresh suspended user's session (kicks them out)
    notifyProfileRefresh(req.params.memberUserId, req.body.is_suspended ? 'guild_access_suspended' : 'guild_access_unsuspended');
    notifyAllCollaborators(req.guild.id, 'team:updated', { guildId: req.guild.id }, req.user.id);

    res.json({
      message: req.body.is_suspended ? 'Collaborateur suspendu' : 'Collaborateur reactived',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

// Remove collaborator
router.delete('/members/:memberUserId', requireGuildPrimaryOwner, (req, res, next) => {
  try {
    guildAccessService.removeGuildCollaborator({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      memberUserId: req.params.memberUserId,
    });

    notifyProfileRefresh(req.params.memberUserId, 'guild_access_removed');
    notifyAllCollaborators(req.guild.id, 'team:updated', { guildId: req.guild.id }, req.user.id);

    res.json({
      message: 'Acces partage retire',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

// ── Audit log ────────────────────────────────────────────────────────────────

router.get('/audit', requireGuildPrimaryOwner, validateQuery(collaborationAuditListSchema), (req, res) => {
  const result = guildAccessService.listCollabAuditLog(req.guild.id, {
    page: req.query.page,
    limit: req.query.limit,
    excludeActorUserId: req.guild.user_id,
  });
  res.json(result);
});

// ── Snapshots ────────────────────────────────────────────────────────────────

router.get('/snapshots', requireGuildPrimaryOwner, (req, res) => {
  res.json({
    snapshots: guildAccessService.listGuildSnapshots(req.guild.id),
  });
});

router.post('/snapshots', requireGuildPrimaryOwner, validate(guildSnapshotCreateSchema), (req, res, next) => {
  try {
    const snapshot = guildAccessService.createGuildSnapshot({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      actorUserId: req.user.id,
      label: req.body.label,
    });

    res.status(201).json({
      message: 'Sauvegarde creee',
      snapshot,
      snapshots: guildAccessService.listGuildSnapshots(req.guild.id),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/snapshots/:snapshotId/restore', requireGuildPrimaryOwner, async (req, res, next) => {
  try {
    const restored = guildAccessService.restoreGuildSnapshot({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      snapshotId: req.params.snapshotId,
    });

    await refreshGuildRuntime(req.guild.user_id, req.guild.guild_id);
    notifyProfileRefresh(req.guild.user_id, 'guild_snapshot_restored');
    notifyAllCollaborators(req.guild.id, 'team:snapshot_restored', { guildId: req.guild.id }, null);

    res.json({
      message: 'Sauvegarde restauree',
      restored,
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/snapshots/:snapshotId', requireGuildPrimaryOwner, (req, res, next) => {
  try {
    guildAccessService.deleteGuildSnapshot({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      snapshotId: req.params.snapshotId,
    });

    res.json({
      message: 'Sauvegarde supprimee',
      snapshots: guildAccessService.listGuildSnapshots(req.guild.id),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
