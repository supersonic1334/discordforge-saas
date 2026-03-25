'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

const {
  requireAuth,
  requireBotToken,
  requireGuildOwner,
  requireGuildPrimaryOwner,
  validate,
} = require('../middleware');
const {
  guildAccessInviteSchema,
  guildAccessRoleSchema,
  guildSnapshotCreateSchema,
} = require('../validators/schemas');
const guildAccessService = require('../services/guildAccessService');
const botManager = require('../services/botManager');
const wsServer = require('../websocket');

router.use(requireAuth, requireBotToken, requireGuildOwner);

function notifyProfileRefresh(userId, reason = 'guild_access_updated') {
  if (!userId) return;
  wsServer.broadcastToUser(String(userId), {
    event: 'account:profileUpdated',
    data: { reason },
  });
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
      accepted_at: entry.accepted_at || null,
      created_at: entry.created_at || null,
      updated_at: entry.updated_at || null,
    })),
    snapshots: access?.is_owner ? guildAccessService.listGuildSnapshots(req.guild.id) : [],
  };
}

router.get('/', (req, res) => {
  res.json(buildOverview(req));
});

router.post('/invite', requireGuildPrimaryOwner, validate(guildAccessInviteSchema), (req, res, next) => {
  try {
    const invitedUser = guildAccessService.inviteGuildCollaborator({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      actorUserId: req.user.id,
      target: req.body.target,
      accessRole: req.body.access_role,
    });

    notifyProfileRefresh(invitedUser.id, 'guild_access_invited');

    res.status(201).json({
      message: 'Acces partage ajoute',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/members/:memberUserId', requireGuildPrimaryOwner, validate(guildAccessRoleSchema), (req, res, next) => {
  try {
    guildAccessService.updateGuildCollaboratorRole({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      memberUserId: req.params.memberUserId,
      accessRole: req.body.access_role,
    });

    notifyProfileRefresh(req.params.memberUserId, 'guild_access_role_updated');

    res.json({
      message: 'Role partage mis a jour',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/members/:memberUserId', requireGuildPrimaryOwner, (req, res, next) => {
  try {
    guildAccessService.removeGuildCollaborator({
      guildId: req.guild.id,
      ownerUserId: req.guild.user_id,
      memberUserId: req.params.memberUserId,
    });

    notifyProfileRefresh(req.params.memberUserId, 'guild_access_removed');

    res.json({
      message: 'Acces partage retire',
      ...buildOverview(req),
    });
  } catch (error) {
    next(error);
  }
});

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
