'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../../database');
const logger = require('../../utils/logger').child('PlaybookEngine');

// ═══════════════════════════════════════════════════════════════════
// COOLDOWN TRACKER (en mémoire)
// ═══════════════════════════════════════════════════════════════════
const cooldownTracker = new Map(); // `${playbookId}:${targetUserId}` -> timestamp

function isOnCooldown(playbookId, targetUserId, cooldownMs) {
  const key = `${playbookId}:${targetUserId}`;
  const lastTriggered = cooldownTracker.get(key);
  if (!lastTriggered) return false;
  return Date.now() - lastTriggered < cooldownMs;
}

function setCooldown(playbookId, targetUserId) {
  const key = `${playbookId}:${targetUserId}`;
  cooldownTracker.set(key, Date.now());
}

// Nettoyage périodique des cooldowns expirés
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24h
  for (const [key, timestamp] of cooldownTracker.entries()) {
    if (now - timestamp > maxAge) {
      cooldownTracker.delete(key);
    }
  }
}, 60 * 60 * 1000); // Toutes les heures

// ═══════════════════════════════════════════════════════════════════
// ÉVALUATEURS DE CONDITIONS
// ═══════════════════════════════════════════════════════════════════

const conditionEvaluators = {
  spam_detected: (context, params) => {
    const minMessages = params.min_messages || 5;
    return context.spamCount >= minMessages;
  },

  new_account: (context, params) => {
    const maxAgeDays = params.max_age_days || 7;
    const accountAgeMs = Date.now() - new Date(context.userCreatedAt).getTime();
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);
    return accountAgeDays < maxAgeDays;
  },

  no_avatar: (context) => {
    return !context.userAvatar || context.userAvatar === null;
  },

  no_roles: (context) => {
    return !context.memberRoles || context.memberRoles.length === 0;
  },

  link_posted: (context) => {
    return context.hasLink === true;
  },

  invite_posted: (context) => {
    return context.hasInvite === true;
  },

  mass_mention: (context, params) => {
    const minMentions = params.min_mentions || 5;
    return context.mentionCount >= minMentions;
  },

  caps_abuse: (context, params) => {
    const minPercent = params.min_percent || 70;
    return context.capsPercent >= minPercent;
  },

  warning_threshold: (context, params) => {
    const minWarnings = params.min_warnings || 3;
    return context.warningCount >= minWarnings;
  },

  joined_recently: (context, params) => {
    const maxMinutes = params.max_minutes || 10;
    if (!context.memberJoinedAt) return false;
    const joinedAgeMs = Date.now() - new Date(context.memberJoinedAt).getTime();
    const joinedAgeMinutes = joinedAgeMs / (1000 * 60);
    return joinedAgeMinutes < maxMinutes;
  },

  suspicious_username: (context) => {
    const suspiciousPatterns = [
      /discord/i, /nitro/i, /free/i, /gift/i, /steam/i,
      /admin/i, /mod(erator)?/i, /staff/i, /support/i,
      /bot/i, /official/i, /verify/i,
    ];
    const username = context.username || '';
    return suspiciousPatterns.some(pattern => pattern.test(username));
  },

  raid_detected: (context) => {
    return context.isRaidDetected === true;
  },
};

// ═══════════════════════════════════════════════════════════════════
// EXÉCUTEURS D'ACTIONS
// ═══════════════════════════════════════════════════════════════════

async function executeAction(actionType, params, context, services) {
  const { discordService, botToken, guildId, targetUserId } = services;

  switch (actionType) {
    case 'warn': {
      const { addWarning } = require('./utilityModules');
      await addWarning(
        guildId,
        targetUserId,
        context.username,
        context.moderatorUserId || 'system',
        'Playbook Auto',
        params.reason || 'Action automatique du playbook',
        params.points || 1
      );
      return { success: true, action: 'warn', message: 'Avertissement ajouté' };
    }

    case 'timeout': {
      const durationMs = params.duration_ms || 3600000; // 1h par défaut
      await discordService.timeoutMember(
        botToken,
        guildId,
        targetUserId,
        durationMs,
        params.reason || 'Action automatique du playbook'
      );
      return { success: true, action: 'timeout', message: `Timeout de ${durationMs / 60000}min appliqué` };
    }

    case 'kick': {
      await discordService.kickMember(
        botToken,
        guildId,
        targetUserId,
        params.reason || 'Action automatique du playbook'
      );
      return { success: true, action: 'kick', message: 'Membre expulsé' };
    }

    case 'ban': {
      await discordService.banMember(
        botToken,
        guildId,
        targetUserId,
        params.reason || 'Action automatique du playbook',
        params.delete_messages_days || 0
      );
      return { success: true, action: 'ban', message: 'Membre banni' };
    }

    case 'quarantine': {
      if (params.quarantine_role_id) {
        await discordService.addRole(
          botToken,
          guildId,
          targetUserId,
          params.quarantine_role_id,
          'Playbook quarantine'
        );
        return { success: true, action: 'quarantine', message: 'Rôle quarantaine ajouté' };
      }
      return { success: false, action: 'quarantine', message: 'Rôle quarantaine non configuré' };
    }

    case 'delete_message': {
      if (context.messageId && context.channelId) {
        await discordService.deleteMessage(botToken, context.channelId, context.messageId);
        return { success: true, action: 'delete_message', message: 'Message supprimé' };
      }
      return { success: false, action: 'delete_message', message: 'Pas de message à supprimer' };
    }

    case 'alert_moderators': {
      const channelId = params.channel_id || context.alertChannelId;
      if (channelId) {
        const message = (params.message || 'Alerte playbook')
          .replace('{username}', context.username || 'Utilisateur')
          .replace('{userId}', targetUserId)
          .replace('{playbookName}', context.playbookName || 'Playbook');

        await discordService.sendMessage(botToken, channelId, {
          embeds: [{
            title: '⚠️ Alerte Playbook',
            description: message,
            color: 0xff9500,
            fields: [
              { name: 'Utilisateur', value: `<@${targetUserId}>`, inline: true },
              { name: 'Playbook', value: context.playbookName || 'N/A', inline: true },
            ],
            timestamp: new Date().toISOString(),
          }],
        });
        return { success: true, action: 'alert_moderators', message: 'Alerte envoyée' };
      }
      return { success: false, action: 'alert_moderators', message: 'Canal d\'alerte non configuré' };
    }

    case 'dm_user': {
      try {
        const dmChannel = await discordService.createDM(botToken, targetUserId);
        if (dmChannel?.id) {
          await discordService.sendMessage(botToken, dmChannel.id, {
            content: params.message || 'Message automatique de modération.',
          });
          return { success: true, action: 'dm_user', message: 'DM envoyé' };
        }
      } catch (err) {
        return { success: false, action: 'dm_user', message: 'Impossible d\'envoyer le DM' };
      }
      return { success: false, action: 'dm_user', message: 'DM échoué' };
    }

    case 'add_role': {
      if (params.role_id) {
        await discordService.addRole(botToken, guildId, targetUserId, params.role_id, 'Playbook action');
        return { success: true, action: 'add_role', message: 'Rôle ajouté' };
      }
      return { success: false, action: 'add_role', message: 'Rôle non spécifié' };
    }

    case 'remove_role': {
      if (params.role_id) {
        await discordService.removeRole(botToken, guildId, targetUserId, params.role_id, 'Playbook action');
        return { success: true, action: 'remove_role', message: 'Rôle retiré' };
      }
      return { success: false, action: 'remove_role', message: 'Rôle non spécifié' };
    }

    case 'log_event': {
      const { logBotEvent } = require('./utils/modHelpers');
      logBotEvent(
        context.moderatorUserId || 'system',
        context.internalGuildId,
        params.log_level || 'info',
        'playbook_trigger',
        `Playbook ${context.playbookName} déclenché sur ${context.username}`,
        {
          playbook_name: context.playbookName,
          target_user_id: targetUserId,
          target_username: context.username,
        }
      );
      return { success: true, action: 'log_event', message: 'Événement loggé' };
    }

    default:
      return { success: false, action: actionType, message: `Action inconnue: ${actionType}` };
  }
}

// ═══════════════════════════════════════════════════════════════════
// MOTEUR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

function parseJson(value, fallback = []) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

/**
 * Évalue et exécute les playbooks pour un événement donné
 * @param {Object} context - Contexte de l'événement
 * @param {Object} services - Services nécessaires (discordService, botToken, etc.)
 * @returns {Array} Liste des résultats d'exécution
 */
async function evaluateAndExecutePlaybooks(context, services) {
  const { internalGuildId, targetUserId, triggerType } = context;

  if (!internalGuildId || !targetUserId) {
    return [];
  }

  // Récupérer les playbooks actifs pour ce serveur
  const playbooks = db.raw(
    'SELECT * FROM playbooks WHERE guild_id = ? AND enabled = 1',
    [internalGuildId]
  );

  const results = [];

  for (const playbook of playbooks) {
    try {
      // Vérifier le cooldown
      if (isOnCooldown(playbook.id, targetUserId, playbook.cooldown_ms)) {
        continue;
      }

      const conditions = parseJson(playbook.conditions, []);
      const actions = parseJson(playbook.actions, []);

      // Évaluer toutes les conditions (toutes doivent être vraies pour AND)
      let allConditionsMet = true;
      let triggeredCondition = null;

      for (const condition of conditions) {
        const evaluator = conditionEvaluators[condition.type];
        if (!evaluator) {
          logger.warn(`Condition inconnue: ${condition.type}`);
          allConditionsMet = false;
          break;
        }

        const conditionMet = evaluator(context, condition.params || {});
        if (!conditionMet) {
          allConditionsMet = false;
          break;
        }

        if (!triggeredCondition) {
          triggeredCondition = condition.type;
        }
      }

      if (!allConditionsMet) {
        continue;
      }

      // Toutes les conditions sont remplies, exécuter les actions
      logger.info(`Playbook "${playbook.name}" déclenché`, {
        playbookId: playbook.id,
        targetUserId,
        triggerType,
        triggeredCondition,
      });

      // Mettre le cooldown
      setCooldown(playbook.id, targetUserId);

      // Enrichir le contexte
      const enrichedContext = {
        ...context,
        playbookName: playbook.name,
        playbookId: playbook.id,
      };

      // Exécuter chaque action
      const actionResults = [];
      for (const action of actions) {
        try {
          const result = await executeAction(
            action.type,
            action.params || {},
            enrichedContext,
            services
          );
          actionResults.push(result);
        } catch (err) {
          logger.error(`Erreur action playbook ${action.type}`, { error: err.message });
          actionResults.push({
            success: false,
            action: action.type,
            message: err.message,
          });
        }
      }

      // Mettre à jour le compteur de déclenchements
      db.db.prepare(
        'UPDATE playbooks SET trigger_count = trigger_count + 1, last_triggered_at = ?, updated_at = ? WHERE id = ?'
      ).run(new Date().toISOString(), new Date().toISOString(), playbook.id);

      // Logger l'exécution
      const logId = uuidv4();
      const success = actionResults.every(r => r.success);
      db.insert('playbook_logs', {
        id: logId,
        playbook_id: playbook.id,
        guild_id: internalGuildId,
        target_user_id: targetUserId,
        target_username: context.username || null,
        triggered_by: triggeredCondition || triggerType,
        actions_taken: JSON.stringify(actionResults),
        success: success ? 1 : 0,
        error_message: success ? null : actionResults.find(r => !r.success)?.message,
        created_at: new Date().toISOString(),
      });

      results.push({
        playbook: playbook.name,
        triggered: true,
        actions: actionResults,
        success,
      });

    } catch (err) {
      logger.error(`Erreur playbook ${playbook.name}`, { error: err.message });
      results.push({
        playbook: playbook.name,
        triggered: false,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Crée un contexte d'évaluation à partir d'un message Discord
 */
function createMessageContext(message, member, guildRow, additionalContext = {}) {
  const content = message.content || '';
  const upperCount = (content.match(/[A-Z]/g) || []).length;
  const letterCount = (content.match(/[a-zA-Z]/g) || []).length;
  const capsPercent = letterCount > 0 ? (upperCount / letterCount) * 100 : 0;

  return {
    // Identifiants
    internalGuildId: guildRow.id,
    guildId: guildRow.guild_id,
    targetUserId: message.author?.id,
    username: message.author?.username || message.author?.global_name,
    messageId: message.id,
    channelId: message.channel_id,

    // Données utilisateur
    userAvatar: message.author?.avatar,
    userCreatedAt: message.author?.id 
      ? new Date(Number(BigInt(message.author.id) >> 22n) + 1420070400000).toISOString()
      : null,

    // Données membre
    memberRoles: member?.roles || [],
    memberJoinedAt: member?.joined_at,

    // Analyse du message
    hasLink: /https?:\/\/[^\s]+/i.test(content),
    hasInvite: /discord(?:\.gg|\.com\/invite)\/[a-zA-Z0-9]+/i.test(content),
    mentionCount: (message.mentions || []).length + (message.mention_roles || []).length,
    capsPercent,

    // Contexte additionnel
    ...additionalContext,
  };
}

/**
 * Récupère le nombre d'avertissements actifs pour un utilisateur
 */
function getWarningCount(guildId, targetUserId) {
  const row = db.raw(
    `SELECT COUNT(*) as count FROM warnings 
     WHERE guild_id = ? AND target_user_id = ? AND is_active = 1`,
    [guildId, targetUserId]
  )[0];
  return row?.count || 0;
}

module.exports = {
  evaluateAndExecutePlaybooks,
  createMessageContext,
  getWarningCount,
  conditionEvaluators,
  CONDITION_TYPES: Object.keys(conditionEvaluators),
};
