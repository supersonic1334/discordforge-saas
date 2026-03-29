'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { v4: uuidv4 } = require('uuid');

const { requireAuth, requireBotToken, requireGuildOwner } = require('../middleware');
const db = require('../database');
const logger = require('../utils/logger').child('PlaybooksRoutes');
const { logBotEvent } = require('../bot/utils/modHelpers');

router.use(requireAuth, requireBotToken, requireGuildOwner);

// ═══════════════════════════════════════════════════════════════════
// CONDITIONS DISPONIBLES
// ═══════════════════════════════════════════════════════════════════
const CONDITION_TYPES = {
  spam_detected: {
    name: 'Spam détecté',
    description: 'Se déclenche quand l\'anti-spam détecte du spam',
    params: ['min_messages'],
  },
  new_account: {
    name: 'Compte récent',
    description: 'Le compte Discord a moins de X jours',
    params: ['max_age_days'],
  },
  no_avatar: {
    name: 'Pas d\'avatar',
    description: 'L\'utilisateur n\'a pas d\'avatar personnalisé',
    params: [],
  },
  no_roles: {
    name: 'Aucun rôle',
    description: 'L\'utilisateur n\'a aucun rôle sur le serveur',
    params: [],
  },
  link_posted: {
    name: 'Lien posté',
    description: 'L\'utilisateur a posté un lien externe',
    params: [],
  },
  invite_posted: {
    name: 'Invitation Discord',
    description: 'L\'utilisateur a posté une invitation Discord',
    params: [],
  },
  mass_mention: {
    name: 'Mention de masse',
    description: 'L\'utilisateur a mentionné beaucoup de personnes',
    params: ['min_mentions'],
  },
  caps_abuse: {
    name: 'Abus de majuscules',
    description: 'Le message contient trop de majuscules',
    params: ['min_percent'],
  },
  warning_threshold: {
    name: 'Seuil d\'avertissements',
    description: 'L\'utilisateur a atteint X avertissements',
    params: ['min_warnings'],
  },
  joined_recently: {
    name: 'Rejoint récemment',
    description: 'L\'utilisateur a rejoint le serveur il y a moins de X minutes',
    params: ['max_minutes'],
  },
  suspicious_username: {
    name: 'Pseudo suspect',
    description: 'Le pseudo contient des patterns suspects (ex: discord, nitro, free)',
    params: [],
  },
  raid_detected: {
    name: 'Raid détecté',
    description: 'Le module anti-raid a détecté une attaque',
    params: [],
  },
};

// ═══════════════════════════════════════════════════════════════════
// ACTIONS DISPONIBLES
// ═══════════════════════════════════════════════════════════════════
const ACTION_TYPES = {
  warn: {
    name: 'Avertissement',
    description: 'Envoyer un avertissement à l\'utilisateur',
    params: ['reason', 'points'],
  },
  timeout: {
    name: 'Timeout',
    description: 'Mettre l\'utilisateur en timeout',
    params: ['duration_ms', 'reason'],
  },
  kick: {
    name: 'Expulsion',
    description: 'Expulser l\'utilisateur du serveur',
    params: ['reason'],
  },
  ban: {
    name: 'Bannissement',
    description: 'Bannir l\'utilisateur du serveur',
    params: ['reason', 'delete_messages_days'],
  },
  quarantine: {
    name: 'Quarantaine',
    description: 'Mettre l\'utilisateur en quarantaine (rôle spécial)',
    params: ['quarantine_role_id'],
  },
  delete_message: {
    name: 'Supprimer le message',
    description: 'Supprimer le message qui a déclenché le playbook',
    params: [],
  },
  alert_moderators: {
    name: 'Alerter les modérateurs',
    description: 'Envoyer une alerte dans un salon',
    params: ['channel_id', 'message'],
  },
  dm_user: {
    name: 'Envoyer un DM',
    description: 'Envoyer un message privé à l\'utilisateur',
    params: ['message'],
  },
  add_role: {
    name: 'Ajouter un rôle',
    description: 'Ajouter un rôle à l\'utilisateur',
    params: ['role_id'],
  },
  remove_role: {
    name: 'Retirer un rôle',
    description: 'Retirer un rôle à l\'utilisateur',
    params: ['role_id'],
  },
  log_event: {
    name: 'Logger l\'événement',
    description: 'Enregistrer l\'événement dans les logs',
    params: ['log_level'],
  },
};

// ═══════════════════════════════════════════════════════════════════
// TEMPLATES PRÉDÉFINIS
// ═══════════════════════════════════════════════════════════════════
const PLAYBOOK_TEMPLATES = [
  {
    id: 'spam_new_account',
    name: 'Spam + Compte récent → Quarantaine',
    description: 'Quarantaine auto si spam détecté sur un compte de moins de 7 jours',
    conditions: [
      { type: 'spam_detected', operator: 'AND', params: { min_messages: 5 } },
      { type: 'new_account', operator: 'AND', params: { max_age_days: 7 } },
    ],
    actions: [
      { type: 'timeout', params: { duration_ms: 3600000, reason: 'Spam détecté sur compte récent' } },
      { type: 'alert_moderators', params: { message: '⚠️ Spam détecté sur compte récent: {username}' } },
      { type: 'delete_message', params: {} },
    ],
  },
  {
    id: 'raid_protection',
    name: 'Raid → Lockdown + Alerte',
    description: 'Lors d\'un raid détecté, alerte les modérateurs et loggue',
    conditions: [
      { type: 'raid_detected', operator: 'AND', params: {} },
    ],
    actions: [
      { type: 'alert_moderators', params: { message: '🚨 RAID DÉTECTÉ ! Lockdown activé automatiquement.' } },
      { type: 'log_event', params: { log_level: 'critical' } },
    ],
  },
  {
    id: 'new_no_avatar',
    name: 'Nouveau + Sans avatar → Surveillance',
    description: 'Alerte si un membre sans avatar rejoint le serveur',
    conditions: [
      { type: 'joined_recently', operator: 'AND', params: { max_minutes: 5 } },
      { type: 'no_avatar', operator: 'AND', params: {} },
      { type: 'new_account', operator: 'AND', params: { max_age_days: 14 } },
    ],
    actions: [
      { type: 'alert_moderators', params: { message: '👀 Compte suspect rejoint: {username} (sans avatar, compte récent)' } },
      { type: 'log_event', params: { log_level: 'warn' } },
    ],
  },
  {
    id: 'warning_escalation',
    name: 'Avertissements → Timeout auto',
    description: 'Timeout automatique après 3 avertissements',
    conditions: [
      { type: 'warning_threshold', operator: 'AND', params: { min_warnings: 3 } },
    ],
    actions: [
      { type: 'timeout', params: { duration_ms: 3600000, reason: 'Escalade automatique: 3 avertissements atteints' } },
      { type: 'dm_user', params: { message: 'Tu as reçu 3 avertissements. Un timeout d\'1h a été appliqué automatiquement.' } },
    ],
  },
  {
    id: 'invite_spam',
    name: 'Invitation + Nouveau → Ban',
    description: 'Ban si un nouveau compte poste des invitations Discord',
    conditions: [
      { type: 'invite_posted', operator: 'AND', params: {} },
      { type: 'new_account', operator: 'AND', params: { max_age_days: 7 } },
    ],
    actions: [
      { type: 'ban', params: { reason: 'Spam d\'invitations Discord (compte récent)', delete_messages_days: 1 } },
      { type: 'alert_moderators', params: { message: '🔨 Ban auto: {username} (spam invite + compte récent)' } },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function parseJson(value, fallback = []) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function mapPlaybookRow(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: !!row.enabled,
    conditions: parseJson(row.conditions, []),
    actions: parseJson(row.actions, []),
  };
}

function logPlaybookAction(req, actionLabel, playbook, details = []) {
  logBotEvent(req.user.id, req.guild.id, 'info', 'site_action', `${req.user.username} - ${actionLabel} - ${playbook?.name || 'Playbook'}`, {
    action: actionLabel,
    actor_name: req.user.username,
    actor_user_id: req.user.id,
    playbook_id: playbook?.id,
    playbook_name: playbook?.name,
    details,
  });
}

// ═══════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════

// GET /playbooks/definitions - Récupérer les définitions (conditions, actions, templates)
router.get('/definitions', (req, res) => {
  res.json({
    conditions: CONDITION_TYPES,
    actions: ACTION_TYPES,
    templates: PLAYBOOK_TEMPLATES,
  });
});

// GET /playbooks - Liste des playbooks du serveur
router.get('/', (req, res) => {
  const rows = db.raw(
    'SELECT * FROM playbooks WHERE guild_id = ? ORDER BY created_at DESC',
    [req.guild.id]
  );
  res.json({ playbooks: rows.map(mapPlaybookRow) });
});

// GET /playbooks/:id - Détail d'un playbook
router.get('/:id', (req, res) => {
  const row = db.raw(
    'SELECT * FROM playbooks WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];
  if (!row) return res.status(404).json({ error: 'Playbook non trouvé' });
  res.json({ playbook: mapPlaybookRow(row) });
});

// POST /playbooks - Créer un playbook
router.post('/', (req, res) => {
  const { name, description, conditions, actions, cooldown_ms } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Le nom est requis' });
  }
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return res.status(400).json({ error: 'Au moins une condition est requise' });
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    return res.status(400).json({ error: 'Au moins une action est requise' });
  }

  // Vérifier unicité du nom
  const existing = db.raw(
    'SELECT id FROM playbooks WHERE guild_id = ? AND name = ?',
    [req.guild.id, name.trim()]
  )[0];
  if (existing) {
    return res.status(409).json({ error: 'Un playbook avec ce nom existe déjà' });
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.insert('playbooks', {
    id,
    guild_id: req.guild.id,
    name: name.trim(),
    description: description?.trim() || '',
    enabled: 1,
    conditions: JSON.stringify(conditions),
    actions: JSON.stringify(actions),
    cooldown_ms: cooldown_ms || 60000,
    trigger_count: 0,
    created_at: now,
    updated_at: now,
  });

  const created = db.raw('SELECT * FROM playbooks WHERE id = ?', [id])[0];
  logPlaybookAction(req, 'Playbook créé', created, [`Nom: ${name}`, `Conditions: ${conditions.length}`, `Actions: ${actions.length}`]);

  res.status(201).json({ playbook: mapPlaybookRow(created) });
});

// POST /playbooks/from-template - Créer depuis un template
router.post('/from-template', (req, res) => {
  const { template_id, name } = req.body;

  const template = PLAYBOOK_TEMPLATES.find(t => t.id === template_id);
  if (!template) {
    return res.status(404).json({ error: 'Template non trouvé' });
  }

  const finalName = name?.trim() || template.name;

  // Vérifier unicité
  const existing = db.raw(
    'SELECT id FROM playbooks WHERE guild_id = ? AND name = ?',
    [req.guild.id, finalName]
  )[0];
  if (existing) {
    return res.status(409).json({ error: 'Un playbook avec ce nom existe déjà' });
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.insert('playbooks', {
    id,
    guild_id: req.guild.id,
    name: finalName,
    description: template.description,
    enabled: 1,
    conditions: JSON.stringify(template.conditions),
    actions: JSON.stringify(template.actions),
    cooldown_ms: 60000,
    trigger_count: 0,
    created_at: now,
    updated_at: now,
  });

  const created = db.raw('SELECT * FROM playbooks WHERE id = ?', [id])[0];
  logPlaybookAction(req, 'Playbook créé depuis template', created, [`Template: ${template_id}`, `Nom: ${finalName}`]);

  res.status(201).json({ playbook: mapPlaybookRow(created) });
});

// PATCH /playbooks/:id - Modifier un playbook
router.patch('/:id', (req, res) => {
  const row = db.raw(
    'SELECT * FROM playbooks WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];
  if (!row) return res.status(404).json({ error: 'Playbook non trouvé' });

  const { name, description, conditions, actions, cooldown_ms, enabled } = req.body;
  const updates = { updated_at: new Date().toISOString() };

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Le nom ne peut pas être vide' });
    // Vérifier unicité si changement de nom
    if (name.trim() !== row.name) {
      const existing = db.raw(
        'SELECT id FROM playbooks WHERE guild_id = ? AND name = ? AND id != ?',
        [req.guild.id, name.trim(), req.params.id]
      )[0];
      if (existing) return res.status(409).json({ error: 'Un playbook avec ce nom existe déjà' });
    }
    updates.name = name.trim();
  }
  if (description !== undefined) updates.description = description.trim();
  if (conditions !== undefined) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return res.status(400).json({ error: 'Au moins une condition est requise' });
    }
    updates.conditions = JSON.stringify(conditions);
  }
  if (actions !== undefined) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'Au moins une action est requise' });
    }
    updates.actions = JSON.stringify(actions);
  }
  if (cooldown_ms !== undefined) updates.cooldown_ms = cooldown_ms;
  if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

  const keys = Object.keys(updates);
  db.db.prepare(
    `UPDATE playbooks SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`
  ).run(...Object.values(updates), req.params.id);

  const updated = db.raw('SELECT * FROM playbooks WHERE id = ?', [req.params.id])[0];
  logPlaybookAction(req, 'Playbook modifié', updated, Object.keys(updates).filter(k => k !== 'updated_at'));

  res.json({ playbook: mapPlaybookRow(updated) });
});

// PATCH /playbooks/:id/toggle - Activer/désactiver un playbook
router.patch('/:id/toggle', (req, res) => {
  const row = db.raw(
    'SELECT * FROM playbooks WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];
  if (!row) return res.status(404).json({ error: 'Playbook non trouvé' });

  const newState = typeof req.body.enabled === 'boolean' ? req.body.enabled : !row.enabled;
  db.db.prepare('UPDATE playbooks SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(newState ? 1 : 0, new Date().toISOString(), req.params.id);

  const updated = db.raw('SELECT * FROM playbooks WHERE id = ?', [req.params.id])[0];
  logPlaybookAction(req, newState ? 'Playbook activé' : 'Playbook désactivé', updated);

  res.json({ playbook: mapPlaybookRow(updated) });
});

// DELETE /playbooks/:id - Supprimer un playbook
router.delete('/:id', (req, res) => {
  const row = db.raw(
    'SELECT * FROM playbooks WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];
  if (!row) return res.status(404).json({ error: 'Playbook non trouvé' });

  db.db.prepare('DELETE FROM playbooks WHERE id = ?').run(req.params.id);
  logPlaybookAction(req, 'Playbook supprimé', row);

  res.json({ message: 'Playbook supprimé' });
});

// GET /playbooks/:id/logs - Historique d'exécution d'un playbook
router.get('/:id/logs', (req, res) => {
  const row = db.raw(
    'SELECT id FROM playbooks WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];
  if (!row) return res.status(404).json({ error: 'Playbook non trouvé' });

  const logs = db.raw(
    `SELECT * FROM playbook_logs 
     WHERE playbook_id = ? 
     ORDER BY created_at DESC 
     LIMIT 100`,
    [req.params.id]
  );

  res.json({
    logs: logs.map(log => ({
      ...log,
      actions_taken: parseJson(log.actions_taken, []),
      success: !!log.success,
    })),
  });
});

module.exports = router;
module.exports.CONDITION_TYPES = CONDITION_TYPES;
module.exports.ACTION_TYPES = ACTION_TYPES;
