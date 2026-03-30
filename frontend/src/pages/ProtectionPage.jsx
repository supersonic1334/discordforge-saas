import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AtSign, AlertTriangle, Bot, ChevronDown, ChevronUp, FileText, Link2, Mail, RefreshCw, Settings, Shield, Sparkles, Terminal, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, modulesAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { getModuleCopy, useI18n } from '../i18n'

const TEXT_CHANNEL_TYPES = [0, 5, 11, 12, 15]

const CATEGORY_ORDER = ['security', 'moderation', 'utility']
const MODULE_ORDER = [
  'ULTIMATE_PROTECTION',
  'ANTI_SPAM',
  'ANTI_LINK',
  'ANTI_INVITE',
  'ANTI_MASS_MENTION',
  'ANTI_RAID',
  'LOCKDOWN',
  'ANTI_NUKE',
  'ANTI_ALT_ACCOUNT',
  'ANTI_BOT',
  'ANTI_TOKEN_SCAM',
  'AUTO_SLOWMODE',
  'WARNING_SYSTEM',
  'AUTO_MOD',
  'AUTO_QUARANTINE',
  'TRUST_SCORE',
  'WELCOME_MESSAGE',
  'AUTO_ROLE',
  'LOGGING',
  'PROTECTION_PRESETS',
  'CUSTOM_COMMANDS',
]

const CATEGORY_STYLES = {
  security: {
    badge: 'bg-red-500/10 border-red-500/20 text-red-300',
    card: 'border-red-500/15',
  },
  moderation: {
    badge: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    card: 'border-amber-500/15',
  },
  utility: {
    badge: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300',
    card: 'border-cyan-500/15',
  },
}

const MODULE_ICONS = {
  ULTIMATE_PROTECTION: Shield,
  ANTI_SPAM: Shield,
  ANTI_LINK: Link2,
  ANTI_INVITE: Link2,
  ANTI_MASS_MENTION: AtSign,
  ANTI_RAID: AlertTriangle,
  LOCKDOWN: Shield,
  ANTI_NUKE: AlertTriangle,
  ANTI_ALT_ACCOUNT: UserPlus,
  ANTI_BOT: Bot,
  ANTI_TOKEN_SCAM: Link2,
  AUTO_SLOWMODE: RefreshCw,
  WARNING_SYSTEM: FileText,
  AUTO_MOD: Sparkles,
  AUTO_QUARANTINE: UserPlus,
  TRUST_SCORE: Sparkles,
  WELCOME_MESSAGE: Mail,
  AUTO_ROLE: UserPlus,
  LOGGING: FileText,
  PROTECTION_PRESETS: Settings,
  CUSTOM_COMMANDS: Terminal,
}

const LOG_EVENT_KEYS = [
  'message_delete',
  'message_edit',
  'member_join',
  'member_leave',
  'ban',
  'kick',
  'role_update',
  'nickname_change',
]

const PROTECTION_LOAD_TOAST_ID = 'protection-load-error'

const UI = {
  fr: {
    title: 'Protection',
    subtitle: 'Protections simples, claires et vraiment utiles pour ton serveur.',
    refresh: 'Recharger',
    retry: 'Reessayer',
    loading: 'Chargement...',
    loadError: 'Chargement impossible pour le moment.',
    emptyCategory: 'Aucune protection dans cette categorie.',
    configure: 'Configurer',
    configuration: 'Configuration',
    save: 'Sauvegarder',
    saving: 'Sauvegarde...',
    reset: 'Reinitialiser',
    yes: 'Oui',
    no: 'Non',
    addStep: 'Ajouter une etape',
    remove: 'Retirer',
    noRoles: 'Aucun role charge',
    noChannels: 'Aucun salon texte charge',
    noGuilds: 'Aucun autre serveur disponible',
    noServer: 'Choisis un serveur',
    noChannelOption: 'Aucun salon',
    saved: 'Configuration sauvegardee',
    resetDone: 'Configuration reinitialisee',
    categories: {
      all: 'Tout',
      security: 'Securite',
      moderation: 'Moderation',
      utility: 'Utilitaire',
    },
    actionLabels: {
      delete: 'Supprimer le message',
      warn: 'Avertir',
      timeout: 'Mute temporaire',
      kick: 'Expulser du serveur',
      ban: 'Bannir du serveur',
      blacklist: 'Blacklist reseau du bot',
    },
    logEvents: {
      message_delete: 'Messages supprimes',
      message_edit: 'Messages modifies',
      member_join: 'Arrivees',
      member_leave: 'Departs',
      ban: 'Bannissements',
      kick: 'Expulsions',
      role_update: 'Roles modifies',
      nickname_change: 'Pseudos modifies',
    },
    labels: {
      action: 'Action',
      timeoutDuration: 'Duree du mute temporaire',
      maxMessages: 'Messages rapides avant sanction',
      window: 'Dans cette fenetre',
      deleteMessages: 'Supprimer les messages du spam',
      warnBefore: "Prevenir avant d'appliquer la sanction",
      warnThreshold: 'Avertissements avant sanction',
      whitelistRoles: 'Roles autorises',
      whitelistChannels: 'Salons autorises',
      allowOwnInvites: 'Autoriser les invitations de ce serveur',
      whitelistServers: 'Autres serveurs autorises',
      domains: 'Domaines autorises',
      deleteAndWarn: "Envoyer un petit message d'avertissement",
      punishmentAfter: 'Sanction apres combien de messages bloques',
      mentionRoles: 'Roles qui peuvent mentionner',
      warningExpiry: "Expiration des avertissements (jours)",
      dmOnWarn: "Envoyer un message prive lors d'un avertissement",
      moderatorRoles: 'Roles moderateurs',
      warningSteps: 'Paliers de sanction',
      warningCount: 'A partir de',
      filterProfanity: 'Bloquer les gros mots courants',
      bannedWords: 'Mots bloques personnalises',
      dmWarning: "Envoyer un message prive lors du blocage",
      joinThreshold: 'Arrivees rapides avant alerte',
      accountAge: 'Age mini du compte (jours)',
      raidDuration: 'Duree du mode anti-raid',
      alertChannel: "Salon d'alerte",
      newAccountAction: 'Action si le compte est trop recent',
      botIds: 'Bots autorises (IDs, une valeur par ligne)',
      channel: 'Salon',
      welcomeMessage: 'Message de bienvenue',
      sendDm: 'Envoyer aussi en DM',
      dmMessage: 'Message prive',
      embed: 'Envoyer en embed',
      deleteAfter: 'Supprimer le message apres',
      autoRoles: 'Roles a donner',
      delay: "Delai avant l'attribution",
      onlyHumans: 'Ignorer les bots',
      logChannel: 'Salon des logs',
      logEvents: 'Evenements a enregistrer',
      ignoreBots: 'Ignorer les bots',
      ignoreChannels: 'Salons ignores',
      prefix: 'Prefixe',
      caseSensitive: 'Tenir compte des majuscules',
      allowInDm: 'Autoriser les commandes en DM',
      blockInvites: 'Bloquer les invitations Discord',
      blockAllLinks: 'Bloquer tous les liens externes',
      punishmentAction: 'Sanction choisie',
      initialAction: 'Action des la premiere violation',
      escalation: 'Escalade automatique',
      profanityNote: 'Le blocage est immediat quand la regle native Discord est disponible.',
      timeoutMinimum: 'Discord impose au minimum 1 minute pour un vrai timeout.',
      messageVariables: 'Variables utiles: {user} {username} {server} {memberCount}',
      dmVariables: 'Variables utiles: {user} {server}',
      inviteNative: "Mode instantane: Discord bloque le lien avant affichage si tu n'autorises pas les invitations de ton serveur.",
      inviteFallback: "Mode rapide: le bot supprime le lien des sa detection. Garde ce mode si tu veux autoriser certains serveurs.",
      mentionNative: 'La premiere mention non autorisee est bloquee immediatement quand la regle native Discord est active.',
      autoModNote: 'AutoMod bloque le message des la premiere violation.',
      antiRaidNote: 'Les comptes trop recents peuvent aussi etre bloques des leur arrivee.',
      antiBotNote: "Le module bloque seulement les comptes Discord identifies comme bots a l'entree.",
      loggingNote: 'Choisis uniquement les evenements utiles pour garder des logs lisibles.',
      commandsNote: 'Le detail des commandes se gere dans la page Commandes. Ici, tu regles seulement le module global.',
      spamNote: 'Tous les messages envoyes trop vite comptent, meme si le texte change.',
      warningNote: "Tu definis ici des paliers simples a comprendre, sans script ni JSON.",
      linkNote: 'Le message bloque est supprime, puis la sanction tombe si la personne recommence trop souvent.',
      triggerOnRaid: 'Declencher pendant un raid',
      triggerOnNuke: 'Declencher pendant un nuke',
      excludedChannels: 'Salons ignores par le lockdown',
      lockdownDuration: 'Duree du lockdown',
      eventThreshold: 'Actions destructives avant sanction',
      whitelistUsers: 'Utilisateurs autorises',
      maxAccountAge: 'Age max du compte (jours)',
      requireCustomAvatar: 'Exiger un avatar personnalise',
      suspiciousNames: 'Surveiller les pseudos suspects',
      slowmodeSeconds: 'Slowmode applique (secondes)',
      triggerMessages: 'Messages rapides avant slowmode',
      quarantineRole: 'Role de quarantaine',
      releaseAfter: 'Fin automatique de quarantaine',
      quarantineOnAlt: 'Quarantaine sur anti-alt',
      quarantineOnToken: 'Quarantaine sur scam token',
      trustedAfterDays: 'Compte fiable apres (jours)',
      warningPenalty: 'Malus par point actif',
      actionPenalty: 'Malus par action staff',
      suspiciousPenalty: 'Malus par signal suspect',
      roleBonus: 'Bonus par role utile',
      presetProfile: 'Profil de protection',
      presetBalanced: 'Equilibre',
      presetCommunity: 'Communaute',
      presetFortress: 'Forteresse',
      lockdownNote: 'Verrouille temporairement les salons texte quand une attaque est detectee.',
      antiNukeNote: 'Surveille les creations et suppressions rapides de salons et roles via les audit logs Discord.',
      altNote: 'Repere les comptes recents, sans avatar et aux pseudos suspects des leur arrivee.',
      tokenScamNote: 'Supprime les messages de scam token, phishing ou cadeau piege avant qu ils circulent.',
      slowmodeNote: 'Active un slowmode temporaire quand un salon explose soudainement.',
      quarantineNote: 'Place automatiquement les profils suspects dans un role isole sans bannir trop vite.',
      trustNote: 'Ajuste le score de confiance visible dans Scan pour mieux prioriser les fiches.',
      presetNote: 'Applique en un clic un profil coherent sur plusieurs modules sans toucher aux roles et salons deja choisis.',
      trustedRoles: 'Roles de confiance',
      ultimateProfile: 'Niveau du bouclier',
      ultimateProfileSmart: 'Intelligent',
      ultimateProfileStrict: 'Strict',
      ultimateProfileFortress: 'Forteresse',
      ultimateShieldChat: 'Bloquer spam, liens, invitations, mentions et insultes',
      ultimateShieldRaid: 'Couper raids, comptes suspects et floods de salons',
      ultimateShieldStaff: 'Bloquer ban all, kick all, delete all et nuke staff',
      ultimateShieldQuarantine: 'Isoler automatiquement les profils a risque',
      ultimateStripStaffRoles: 'Retirer les roles staff en cas de nuke',
      ultimateNote: 'Active en un seul clic les couches clefs contre spam, liens, mentions, raids, scams et abus staff. Garde seulement le salon d alerte, les roles de confiance et le niveau de rigueur.',
    },
  },
  en: {
    title: 'Protection',
    subtitle: 'Clear, simple protections that are actually useful on your server.',
    refresh: 'Refresh',
    retry: 'Retry',
    loading: 'Loading...',
    loadError: 'Unable to load protections right now.',
    emptyCategory: 'No protections in this category.',
    configure: 'Configure',
    configuration: 'Configuration',
    save: 'Save',
    saving: 'Saving...',
    reset: 'Reset',
    yes: 'Yes',
    no: 'No',
    addStep: 'Add step',
    remove: 'Remove',
    noRoles: 'No roles loaded',
    noChannels: 'No text channels loaded',
    noGuilds: 'No other server available',
    noServer: 'Choose a server',
    noChannelOption: 'No channel',
    saved: 'Configuration saved',
    resetDone: 'Configuration reset',
    categories: {
      all: 'All',
      security: 'Security',
      moderation: 'Moderation',
      utility: 'Utility',
    },
    actionLabels: {
      delete: 'Delete the message',
      warn: 'Warn',
      timeout: 'Temporary mute',
      kick: 'Kick from server',
      ban: 'Ban from server',
      blacklist: 'Bot network blacklist',
    },
    logEvents: {
      message_delete: 'Deleted messages',
      message_edit: 'Edited messages',
      member_join: 'Joins',
      member_leave: 'Leaves',
      ban: 'Bans',
      kick: 'Kicks',
      role_update: 'Role updates',
      nickname_change: 'Nickname changes',
    },
    labels: {
      action: 'Action',
      timeoutDuration: 'Temporary mute duration',
      maxMessages: 'Fast messages before sanction',
      window: 'Within this window',
      deleteMessages: 'Delete spam messages',
      warnBefore: 'Warn before applying the sanction',
      warnThreshold: 'Warnings before sanction',
      whitelistRoles: 'Allowed roles',
      whitelistChannels: 'Allowed channels',
      allowOwnInvites: 'Allow invites for this server',
      whitelistServers: 'Other allowed servers',
      domains: 'Allowed domains',
      deleteAndWarn: 'Send a short warning message',
      punishmentAfter: 'Sanction after how many blocked messages',
      mentionRoles: 'Roles allowed to mention',
      warningExpiry: 'Warning expiry (days)',
      dmOnWarn: 'Send a DM when warning someone',
      moderatorRoles: 'Moderator roles',
      warningSteps: 'Sanction steps',
      warningCount: 'Starting at',
      filterProfanity: 'Block common profanity',
      bannedWords: 'Custom blocked words',
      dmWarning: 'Send a DM when content is blocked',
      joinThreshold: 'Fast joins before alert',
      accountAge: 'Minimum account age (days)',
      raidDuration: 'Raid mode duration',
      alertChannel: 'Alert channel',
      newAccountAction: 'Action for very new accounts',
      botIds: 'Allowed bots (IDs, one per line)',
      channel: 'Channel',
      welcomeMessage: 'Welcome message',
      sendDm: 'Also send a DM',
      dmMessage: 'Private message',
      embed: 'Send as embed',
      deleteAfter: 'Delete the message after',
      autoRoles: 'Roles to assign',
      delay: 'Delay before assignment',
      onlyHumans: 'Ignore bots',
      logChannel: 'Log channel',
      logEvents: 'Events to record',
      ignoreBots: 'Ignore bots',
      ignoreChannels: 'Ignored channels',
      prefix: 'Prefix',
      caseSensitive: 'Case sensitive',
      allowInDm: 'Allow commands in DM',
      blockInvites: 'Block Discord invites',
      blockAllLinks: 'Block all external links',
      punishmentAction: 'Selected sanction',
      initialAction: 'Action from the first violation',
      escalation: 'Automatic escalation',
      profanityNote: 'Blocking is immediate when the native Discord rule is available.',
      timeoutMinimum: 'Discord requires at least 1 minute for a real timeout.',
      messageVariables: 'Useful variables: {user} {username} {server} {memberCount}',
      dmVariables: 'Useful variables: {user} {server}',
      inviteNative: 'Instant mode: Discord blocks the invite before it shows up if you do not allow your own server invites.',
      inviteFallback: 'Fast mode: the bot deletes the invite as soon as it sees it. Keep this mode if you allow some servers.',
      mentionNative: 'The first unauthorized mention is blocked immediately when the native Discord rule is active.',
      autoModNote: 'AutoMod blocks content from the first violation.',
      antiRaidNote: 'Very new accounts can also be blocked as soon as they join.',
      antiBotNote: 'This module only blocks Discord accounts identified as bots when they join.',
      loggingNote: 'Only enable the events you really need to keep logs readable.',
      commandsNote: 'Detailed command creation lives in the Commands page. Here you only manage the global module.',
      spamNote: 'All messages sent too quickly count, even if the text changes.',
      warningNote: 'You define clear sanction steps here, without raw script or JSON.',
      linkNote: 'The blocked message is deleted, then the sanction is applied if the user keeps doing it.',
      triggerOnRaid: 'Trigger during raid',
      triggerOnNuke: 'Trigger during nuke',
      excludedChannels: 'Channels excluded from lockdown',
      lockdownDuration: 'Lockdown duration',
      eventThreshold: 'Destructive actions before sanction',
      whitelistUsers: 'Allowed users',
      maxAccountAge: 'Max account age (days)',
      requireCustomAvatar: 'Require a custom avatar',
      suspiciousNames: 'Watch suspicious usernames',
      slowmodeSeconds: 'Applied slowmode (seconds)',
      triggerMessages: 'Fast messages before slowmode',
      quarantineRole: 'Quarantine role',
      releaseAfter: 'Automatic quarantine release',
      quarantineOnAlt: 'Quarantine on anti-alt',
      quarantineOnToken: 'Quarantine on token scam',
      trustedAfterDays: 'Trusted after (days)',
      warningPenalty: 'Penalty per active point',
      actionPenalty: 'Penalty per staff action',
      suspiciousPenalty: 'Penalty per suspicious signal',
      roleBonus: 'Bonus per useful role',
      presetProfile: 'Protection profile',
      presetBalanced: 'Balanced',
      presetCommunity: 'Community',
      presetFortress: 'Fortress',
      lockdownNote: 'Temporarily locks text channels when a raid or destructive burst is detected.',
      antiNukeNote: 'Watches rapid channel and role destruction through Discord audit logs.',
      altNote: 'Flags fresh accounts, default avatars, and suspicious names right when they join.',
      tokenScamNote: 'Removes token scam, phishing, and fake gift messages before they spread.',
      slowmodeNote: 'Turns on slowmode for a short time when a channel suddenly spikes.',
      quarantineNote: 'Moves risky profiles into an isolated role without banning too quickly.',
      trustNote: 'Tunes the confidence score shown in Scan so staff can prioritize better.',
      presetNote: 'Applies a full protection profile in one save while keeping your selected roles and channels.',
      trustedRoles: 'Trusted roles',
      ultimateProfile: 'Shield level',
      ultimateProfileSmart: 'Smart',
      ultimateProfileStrict: 'Strict',
      ultimateProfileFortress: 'Fortress',
      ultimateShieldChat: 'Block spam, links, invites, mentions, and insults',
      ultimateShieldRaid: 'Stop raids, suspicious accounts, and channel floods',
      ultimateShieldStaff: 'Stop ban all, kick all, delete all, and staff nukes',
      ultimateShieldQuarantine: 'Auto-isolate risky profiles',
      ultimateStripStaffRoles: 'Strip staff roles during a nuke',
      ultimateNote: 'Turns on the main layers against spam, links, mentions, raids, scams, and staff abuse in one save. Keep only the alert channel, trusted roles, and intensity level to tune.',
    },
  },
  es: {
    title: 'Proteccion',
    subtitle: 'Protecciones claras, simples y realmente utiles para tu servidor.',
    refresh: 'Recargar',
    retry: 'Reintentar',
    loading: 'Cargando...',
    loadError: 'No se puede cargar la proteccion por ahora.',
    emptyCategory: 'No hay protecciones en esta categoria.',
    configure: 'Configurar',
    configuration: 'Configuracion',
    save: 'Guardar',
    saving: 'Guardando...',
    reset: 'Restablecer',
    yes: 'Si',
    no: 'No',
    addStep: 'Anadir etapa',
    remove: 'Quitar',
    noRoles: 'No hay roles cargados',
    noChannels: 'No hay canales de texto cargados',
    noGuilds: 'No hay otro servidor disponible',
    noServer: 'Elige un servidor',
    noChannelOption: 'Sin canal',
    saved: 'Configuracion guardada',
    resetDone: 'Configuracion restablecida',
    categories: {
      all: 'Todo',
      security: 'Seguridad',
      moderation: 'Moderacion',
      utility: 'Utilidad',
    },
    actionLabels: {
      delete: 'Eliminar el mensaje',
      warn: 'Advertir',
      timeout: 'Mute temporal',
      kick: 'Expulsar del servidor',
      ban: 'Banear del servidor',
      blacklist: 'Blacklist de la red del bot',
    },
    logEvents: {
      message_delete: 'Mensajes borrados',
      message_edit: 'Mensajes editados',
      member_join: 'Entradas',
      member_leave: 'Salidas',
      ban: 'Baneos',
      kick: 'Expulsiones',
      role_update: 'Roles modificados',
      nickname_change: 'Apodos modificados',
    },
    labels: {
      action: 'Accion',
      timeoutDuration: 'Duracion del mute temporal',
      maxMessages: 'Mensajes rapidos antes de sancion',
      window: 'Dentro de esta ventana',
      deleteMessages: 'Eliminar los mensajes de spam',
      warnBefore: 'Avisar antes de aplicar la sancion',
      warnThreshold: 'Avisos antes de sancion',
      whitelistRoles: 'Roles autorizados',
      whitelistChannels: 'Canales autorizados',
      allowOwnInvites: 'Permitir invitaciones de este servidor',
      whitelistServers: 'Otros servidores autorizados',
      domains: 'Dominios autorizados',
      deleteAndWarn: 'Enviar un aviso corto',
      punishmentAfter: 'Sancion despues de cuantos mensajes bloqueados',
      mentionRoles: 'Roles que pueden mencionar',
      warningExpiry: 'Expiracion de advertencias (dias)',
      dmOnWarn: 'Enviar un DM al advertir',
      moderatorRoles: 'Roles moderadores',
      warningSteps: 'Escalado de sanciones',
      warningCount: 'A partir de',
      filterProfanity: 'Bloquear insultos comunes',
      bannedWords: 'Palabras bloqueadas personalizadas',
      dmWarning: 'Enviar un DM cuando se bloquee el contenido',
      joinThreshold: 'Entradas rapidas antes de alerta',
      accountAge: 'Edad minima de la cuenta (dias)',
      raidDuration: 'Duracion del modo anti-raid',
      alertChannel: 'Canal de alerta',
      newAccountAction: 'Accion para cuentas muy nuevas',
      botIds: 'Bots autorizados (IDs, una por linea)',
      channel: 'Canal',
      welcomeMessage: 'Mensaje de bienvenida',
      sendDm: 'Enviar tambien por DM',
      dmMessage: 'Mensaje privado',
      embed: 'Enviar como embed',
      deleteAfter: 'Eliminar el mensaje despues de',
      autoRoles: 'Roles para asignar',
      delay: 'Retraso antes de asignar',
      onlyHumans: 'Ignorar bots',
      logChannel: 'Canal de logs',
      logEvents: 'Eventos a guardar',
      ignoreBots: 'Ignorar bots',
      ignoreChannels: 'Canales ignorados',
      prefix: 'Prefijo',
      caseSensitive: 'Distinguir mayusculas',
      allowInDm: 'Permitir comandos por DM',
      blockInvites: 'Bloquear invitaciones de Discord',
      blockAllLinks: 'Bloquear todos los enlaces externos',
      punishmentAction: 'Sancion elegida',
      initialAction: 'Accion desde la primera infraccion',
      escalation: 'Escalada automatica',
      profanityNote: 'El bloqueo es inmediato cuando la regla nativa de Discord esta disponible.',
      timeoutMinimum: 'Discord exige al menos 1 minuto para un timeout real.',
      messageVariables: 'Variables utiles: {user} {username} {server} {memberCount}',
      dmVariables: 'Variables utiles: {user} {server}',
      inviteNative: 'Modo instantaneo: Discord bloquea la invitacion antes de mostrarla si no permites las invitaciones de tu propio servidor.',
      inviteFallback: 'Modo rapido: el bot elimina la invitacion en cuanto la detecta. Usa este modo si permites algunos servidores.',
      mentionNative: 'La primera mencion no autorizada se bloquea al instante cuando la regla nativa esta activa.',
      autoModNote: 'AutoMod bloquea el contenido desde la primera infraccion.',
      antiRaidNote: 'Las cuentas demasiado nuevas tambien pueden bloquearse al entrar.',
      antiBotNote: 'Este modulo solo bloquea cuentas de Discord identificadas como bots al entrar.',
      loggingNote: 'Activa solo los eventos utiles para mantener logs claros.',
      commandsNote: 'La creacion detallada de comandos se hace en la pagina Comandos. Aqui solo ajustas el modulo global.',
      spamNote: 'Todos los mensajes enviados demasiado rapido cuentan, aunque el texto cambie.',
      warningNote: 'Aqui defines etapas claras, sin script ni JSON en bruto.',
      linkNote: 'El mensaje bloqueado se elimina y luego llega la sancion si la persona insiste.',
      triggerOnRaid: 'Activar durante raid',
      triggerOnNuke: 'Activar durante nuke',
      excludedChannels: 'Canales ignorados por el lockdown',
      lockdownDuration: 'Duracion del lockdown',
      eventThreshold: 'Acciones destructivas antes de sancion',
      whitelistUsers: 'Usuarios autorizados',
      maxAccountAge: 'Edad maxima de la cuenta (dias)',
      requireCustomAvatar: 'Exigir avatar personalizado',
      suspiciousNames: 'Vigilar nombres sospechosos',
      slowmodeSeconds: 'Slowmode aplicado (segundos)',
      triggerMessages: 'Mensajes rapidos antes del slowmode',
      quarantineRole: 'Rol de cuarentena',
      releaseAfter: 'Fin automatica de cuarentena',
      quarantineOnAlt: 'Cuarentena por anti-alt',
      quarantineOnToken: 'Cuarentena por scam token',
      trustedAfterDays: 'Cuenta fiable despues de (dias)',
      warningPenalty: 'Penalizacion por punto activo',
      actionPenalty: 'Penalizacion por accion staff',
      suspiciousPenalty: 'Penalizacion por senal sospechosa',
      roleBonus: 'Bonus por rol util',
      presetProfile: 'Perfil de proteccion',
      presetBalanced: 'Equilibrado',
      presetCommunity: 'Comunidad',
      presetFortress: 'Fortaleza',
      lockdownNote: 'Bloquea temporalmente los canales de texto cuando se detecta una oleada o un nuke.',
      antiNukeNote: 'Vigila creaciones y borrados rapidos de canales y roles mediante los audit logs de Discord.',
      altNote: 'Detecta cuentas recientes, sin avatar y con nombres sospechosos al entrar.',
      tokenScamNote: 'Elimina mensajes de scam token, phishing o regalos falsos antes de que circulen.',
      slowmodeNote: 'Activa slowmode temporal cuando un canal explota de golpe.',
      quarantineNote: 'Mueve perfiles de riesgo a un rol aislado sin banear demasiado rapido.',
      trustNote: 'Ajusta la puntuacion de confianza visible en Scan para priorizar mejor.',
      presetNote: 'Aplica un perfil completo en un clic sin perder roles ni canales ya elegidos.',
      trustedRoles: 'Roles de confianza',
      ultimateProfile: 'Nivel del escudo',
      ultimateProfileSmart: 'Inteligente',
      ultimateProfileStrict: 'Estricto',
      ultimateProfileFortress: 'Fortaleza',
      ultimateShieldChat: 'Bloquear spam, enlaces, invitaciones, menciones e insultos',
      ultimateShieldRaid: 'Cortar raids, cuentas sospechosas y floods de canales',
      ultimateShieldStaff: 'Bloquear ban all, kick all, delete all y nukes staff',
      ultimateShieldQuarantine: 'Aislar automaticamente perfiles de riesgo',
      ultimateStripStaffRoles: 'Quitar roles staff durante un nuke',
      ultimateNote: 'Activa en un solo guardado las capas clave contra spam, enlaces, menciones, raids, scams y abusos staff. Solo ajustas el canal de alerta, los roles de confianza y la intensidad.',
    },
  },
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function getUi(locale) {
  return UI[locale] || UI.en
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function splitLines(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatDuration(value) {
  const ms = Number(value || 0)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const units = [
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000],
    ['s', 1000],
  ]
  for (const [label, size] of units) {
    if (ms % size === 0) return `${ms / size}${label}`
  }
  return `${Math.round(ms / 1000)}s`
}

function parseDuration(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const input = String(value || '').trim().toLowerCase()
  if (!input) return fallback
  if (/^\d+$/.test(input)) return Number(input) * 1000

  const regex = /(\d+)\s*(d|h|m|s)/g
  let total = 0
  let matched = false

  for (const match of input.matchAll(regex)) {
    matched = true
    const amount = Number(match[1])
    const unit = match[2]
    if (unit === 'd') total += amount * 86400000
    if (unit === 'h') total += amount * 3600000
    if (unit === 'm') total += amount * 60000
    if (unit === 's') total += amount * 1000
  }

  return matched && total > 0 ? total : fallback
}

function getValue(source, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], source)
}

function setValue(target, path, value) {
  const parts = path.split('.')
  const lastKey = parts.pop()
  const parent = parts.reduce((acc, part) => {
    if (!acc[part]) acc[part] = {}
    return acc[part]
  }, target)
  parent[lastKey] = value
}

function createWarningStep(step = {}) {
  return {
    warnings: Number(step.warnings || 3),
    action: step.action || 'timeout',
    duration: formatDuration(step.duration_ms || 600000) || '10m',
  }
}

function serializeWarningSteps(value) {
  return normalizeList(value)
    .map((step) => ({
      warnings: Math.max(1, Number(step.warnings || 1)),
      action: step.action || 'timeout',
      duration_ms: (step.action || 'timeout') === 'timeout'
        ? Math.max(60000, parseDuration(step.duration, 600000))
        : null,
    }))
    .filter((step) => Number.isFinite(step.warnings))
    .sort((a, b) => a.warnings - b.warnings)
}

function buildActionOptions(ui, values) {
  return values.map((value) => ({ value, label: ui.actionLabels[value] || value }))
}

function getFieldDefs(ui) {
  const moderationActions = buildActionOptions(ui, ['delete', 'timeout', 'kick', 'ban', 'blacklist'])
  const warningActions = buildActionOptions(ui, ['timeout', 'kick', 'ban'])
  const automodActions = buildActionOptions(ui, ['delete', 'warn', 'timeout', 'kick', 'ban', 'blacklist'])
  const ultimateProfiles = [
    { value: 'smart', label: ui.labels.ultimateProfileSmart },
    { value: 'strict', label: ui.labels.ultimateProfileStrict },
    { value: 'fortress', label: ui.labels.ultimateProfileFortress },
  ]

  return {
    ULTIMATE_PROTECTION: [
      { path: 'simple_config.profile', type: 'select', label: ui.labels.ultimateProfile, options: ultimateProfiles },
      { path: 'advanced_config.shield_chat', type: 'boolean', label: ui.labels.ultimateShieldChat },
      { path: 'advanced_config.shield_raid', type: 'boolean', label: ui.labels.ultimateShieldRaid },
      { path: 'advanced_config.shield_staff', type: 'boolean', label: ui.labels.ultimateShieldStaff },
      { path: 'advanced_config.shield_quarantine', type: 'boolean', label: ui.labels.ultimateShieldQuarantine },
      { path: 'simple_config.quarantine_role_id', type: 'role-select', label: ui.labels.quarantineRole, when: (form) => !!form['advanced_config.shield_quarantine'] },
      { path: 'advanced_config.alert_channel_id', type: 'channel-select', label: ui.labels.alertChannel },
      { path: 'advanced_config.trusted_roles', type: 'roles', label: ui.labels.trustedRoles },
      { path: 'advanced_config.strip_staff_roles', type: 'boolean', label: ui.labels.ultimateStripStaffRoles, when: (form) => !!form['advanced_config.shield_staff'] },
    ],
    ANTI_SPAM: [
      { path: 'simple_config.action', type: 'select', label: ui.labels.action, options: moderationActions },
      { path: 'simple_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['simple_config.action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.max_messages', type: 'number', label: ui.labels.maxMessages, min: 2, max: 20 },
      { path: 'advanced_config.window_ms', type: 'duration', label: ui.labels.window },
      { path: 'advanced_config.delete_messages', type: 'boolean', label: ui.labels.deleteMessages },
      { path: 'advanced_config.warn_before_action', type: 'boolean', label: ui.labels.warnBefore },
      { path: 'advanced_config.warn_threshold', type: 'number', label: ui.labels.warnThreshold, min: 1, max: 10, when: (form) => !!form['advanced_config.warn_before_action'] },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
    ],
    ANTI_LINK: [
      { path: 'simple_config.block_invites', type: 'boolean', label: ui.labels.blockInvites },
      { path: 'simple_config.block_all_links', type: 'boolean', label: ui.labels.blockAllLinks },
      { path: 'advanced_config.allowed_domains', type: 'textarea-list', label: ui.labels.domains, rows: 3 },
      { path: 'advanced_config.delete_and_warn', type: 'boolean', label: ui.labels.deleteAndWarn },
      { path: 'advanced_config.punishment_after_violations', type: 'number', label: ui.labels.punishmentAfter, min: 1, max: 20 },
      { path: 'advanced_config.punishment_action', type: 'select', label: ui.labels.punishmentAction, options: moderationActions },
      { path: 'advanced_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['advanced_config.punishment_action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
    ],
    ANTI_INVITE: [
      { path: 'simple_config.allow_own_invites', type: 'boolean', label: ui.labels.allowOwnInvites },
      { path: 'advanced_config.whitelist_servers', type: 'guilds', label: ui.labels.whitelistServers },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
      { path: 'advanced_config.punishment_action', type: 'select', label: ui.labels.initialAction, options: moderationActions },
      { path: 'advanced_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['advanced_config.punishment_action'] === 'timeout', help: ui.labels.timeoutMinimum },
    ],
    ANTI_MASS_MENTION: [
      { path: 'advanced_config.authorized_roles', type: 'roles', label: ui.labels.mentionRoles },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
      { path: 'simple_config.action', type: 'select', label: ui.labels.initialAction, options: moderationActions },
      { path: 'advanced_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['simple_config.action'] === 'timeout', help: ui.labels.timeoutMinimum },
    ],
    ANTI_RAID: [
      { path: 'advanced_config.join_threshold', type: 'number', label: ui.labels.joinThreshold, min: 2, max: 200 },
      { path: 'advanced_config.join_window_ms', type: 'duration', label: ui.labels.window },
      { path: 'simple_config.action', type: 'select', label: ui.labels.action, options: buildActionOptions(ui, ['timeout', 'kick', 'ban', 'blacklist']) },
      { path: 'simple_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['simple_config.action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.account_age_min_days', type: 'number', label: ui.labels.accountAge, min: 0, max: 365 },
      { path: 'advanced_config.new_account_action', type: 'select', label: ui.labels.newAccountAction, options: buildActionOptions(ui, ['timeout', 'kick', 'ban', 'blacklist']) },
      { path: 'advanced_config.new_account_timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['advanced_config.new_account_action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.raid_duration_ms', type: 'duration', label: ui.labels.raidDuration },
      { path: 'advanced_config.alert_channel_id', type: 'channel-select', label: ui.labels.alertChannel },
    ],
    LOCKDOWN: [
      { path: 'simple_config.trigger_on_raid', type: 'boolean', label: ui.labels.triggerOnRaid },
      { path: 'simple_config.trigger_on_nuke', type: 'boolean', label: ui.labels.triggerOnNuke },
      { path: 'advanced_config.duration_ms', type: 'duration', label: ui.labels.lockdownDuration },
      { path: 'advanced_config.excluded_channels', type: 'channels', label: ui.labels.excludedChannels },
      { path: 'advanced_config.alert_channel_id', type: 'channel-select', label: ui.labels.alertChannel },
    ],
    ANTI_NUKE: [
      { path: 'simple_config.action', type: 'select', label: ui.labels.action, options: buildActionOptions(ui, ['timeout', 'kick', 'ban', 'blacklist']) },
      { path: 'advanced_config.event_threshold', type: 'number', label: ui.labels.eventThreshold, min: 2, max: 10 },
      { path: 'advanced_config.window_ms', type: 'duration', label: ui.labels.window },
      { path: 'advanced_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['simple_config.action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.whitelist_users', type: 'textarea-list', label: ui.labels.whitelistUsers, rows: 3 },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
      { path: 'advanced_config.alert_channel_id', type: 'channel-select', label: ui.labels.alertChannel },
    ],
    ANTI_ALT_ACCOUNT: [
      { path: 'simple_config.action', type: 'select', label: ui.labels.action, options: buildActionOptions(ui, ['timeout', 'kick', 'ban', 'blacklist']) },
      { path: 'simple_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['simple_config.action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.max_account_age_days', type: 'number', label: ui.labels.maxAccountAge, min: 0, max: 365 },
      { path: 'advanced_config.require_custom_avatar', type: 'boolean', label: ui.labels.requireCustomAvatar },
      { path: 'advanced_config.suspicious_name_patterns', type: 'boolean', label: ui.labels.suspiciousNames },
      { path: 'advanced_config.alert_channel_id', type: 'channel-select', label: ui.labels.alertChannel },
    ],
    ANTI_BOT: [
      { path: 'simple_config.action', type: 'select', label: ui.labels.action, options: buildActionOptions(ui, ['kick', 'ban', 'blacklist']) },
      { path: 'advanced_config.whitelist_bots', type: 'textarea-list', label: ui.labels.botIds, rows: 4 },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
    ],
    ANTI_TOKEN_SCAM: [
      { path: 'simple_config.action', type: 'select', label: ui.labels.action, options: buildActionOptions(ui, ['delete', 'timeout', 'kick', 'ban', 'blacklist']) },
      { path: 'simple_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['simple_config.action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
      { path: 'advanced_config.alert_channel_id', type: 'channel-select', label: ui.labels.alertChannel },
    ],
    AUTO_SLOWMODE: [
      { path: 'simple_config.slowmode_seconds', type: 'number', label: ui.labels.slowmodeSeconds, min: 1, max: 21600 },
      { path: 'advanced_config.trigger_messages', type: 'number', label: ui.labels.triggerMessages, min: 2, max: 50 },
      { path: 'advanced_config.window_ms', type: 'duration', label: ui.labels.window },
      { path: 'advanced_config.duration_ms', type: 'duration', label: ui.labels.lockdownDuration },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
    ],
    WARNING_SYSTEM: [
      { path: 'simple_config.escalate_automatically', type: 'boolean', label: ui.labels.escalation },
      { path: 'advanced_config.warning_expiry_days', type: 'number', label: ui.labels.warningExpiry, min: 0, max: 3650 },
      { path: 'advanced_config.dm_on_warn', type: 'boolean', label: ui.labels.dmOnWarn },
      { path: 'advanced_config.moderator_roles', type: 'roles', label: ui.labels.moderatorRoles },
      { path: 'advanced_config.escalation_steps', type: 'warning-steps', label: ui.labels.warningSteps, when: (form) => !!form['simple_config.escalate_automatically'], actionOptions: warningActions },
    ],
    AUTO_MOD: [
      { path: 'simple_config.filter_profanity', type: 'boolean', label: ui.labels.filterProfanity },
      { path: 'advanced_config.banned_words', type: 'textarea-list', label: ui.labels.bannedWords, rows: 4 },
      { path: 'advanced_config.punishment_action', type: 'select', label: ui.labels.initialAction, options: automodActions },
      { path: 'advanced_config.timeout_duration_ms', type: 'duration', label: ui.labels.timeoutDuration, when: (form) => form['advanced_config.punishment_action'] === 'timeout', help: ui.labels.timeoutMinimum },
      { path: 'advanced_config.dm_warning', type: 'boolean', label: ui.labels.dmWarning, when: (form) => form['advanced_config.punishment_action'] === 'warn' },
      { path: 'advanced_config.whitelist_roles', type: 'roles', label: ui.labels.whitelistRoles },
      { path: 'advanced_config.whitelist_channels', type: 'channels', label: ui.labels.whitelistChannels },
    ],
    AUTO_QUARANTINE: [
      { path: 'simple_config.role_id', type: 'role-select', label: ui.labels.quarantineRole },
      { path: 'advanced_config.release_after_ms', type: 'duration', label: ui.labels.releaseAfter },
      { path: 'advanced_config.on_alt_account', type: 'boolean', label: ui.labels.quarantineOnAlt },
      { path: 'advanced_config.on_token_scam', type: 'boolean', label: ui.labels.quarantineOnToken },
    ],
    TRUST_SCORE: [
      { path: 'simple_config.trusted_after_days', type: 'number', label: ui.labels.trustedAfterDays, min: 1, max: 3650 },
      { path: 'advanced_config.warning_penalty', type: 'number', label: ui.labels.warningPenalty, min: 1, max: 50 },
      { path: 'advanced_config.action_penalty', type: 'number', label: ui.labels.actionPenalty, min: 1, max: 50 },
      { path: 'advanced_config.suspicious_penalty', type: 'number', label: ui.labels.suspiciousPenalty, min: 1, max: 50 },
      { path: 'advanced_config.role_bonus', type: 'number', label: ui.labels.roleBonus, min: 0, max: 20 },
    ],
    WELCOME_MESSAGE: [
      { path: 'simple_config.channel_id', type: 'channel-select', label: ui.labels.channel },
      { path: 'simple_config.message', type: 'textarea', label: ui.labels.welcomeMessage, rows: 4 },
      { path: 'advanced_config.send_dm', type: 'boolean', label: ui.labels.sendDm },
      { path: 'advanced_config.dm_message', type: 'textarea', label: ui.labels.dmMessage, rows: 3, when: (form) => !!form['advanced_config.send_dm'] },
      { path: 'advanced_config.embed', type: 'boolean', label: ui.labels.embed },
      { path: 'advanced_config.delete_after_ms', type: 'duration', label: ui.labels.deleteAfter },
    ],
    AUTO_ROLE: [
      { path: 'simple_config.roles', type: 'roles', label: ui.labels.autoRoles },
      { path: 'advanced_config.delay_ms', type: 'duration', label: ui.labels.delay },
      { path: 'advanced_config.only_humans', type: 'boolean', label: ui.labels.onlyHumans },
    ],
    LOGGING: [
      { path: 'simple_config.channel_id', type: 'channel-select', label: ui.labels.logChannel },
      { path: 'simple_config.events', type: 'checklist', label: ui.labels.logEvents, options: LOG_EVENT_KEYS.map((value) => ({ value, label: ui.logEvents[value] || value })) },
      { path: 'advanced_config.ignore_bots', type: 'boolean', label: ui.labels.ignoreBots },
      { path: 'advanced_config.ignore_channels', type: 'channels', label: ui.labels.ignoreChannels },
    ],
    PROTECTION_PRESETS: [
      {
        path: 'simple_config.profile',
        type: 'select',
        label: ui.labels.presetProfile,
        options: [
          { value: 'balanced', label: ui.labels.presetBalanced },
          { value: 'community', label: ui.labels.presetCommunity },
          { value: 'fortress', label: ui.labels.presetFortress },
        ],
      },
    ],
    CUSTOM_COMMANDS: [
      { path: 'simple_config.prefix', type: 'text', label: ui.labels.prefix, placeholder: '!' },
      { path: 'advanced_config.case_sensitive', type: 'boolean', label: ui.labels.caseSensitive },
      { path: 'advanced_config.allow_in_dm', type: 'boolean', label: ui.labels.allowInDm },
    ],
  }
}

function formatFieldValue(field, rawValue) {
  if (field.type === 'duration') return formatDuration(rawValue)
  if (field.type === 'textarea-list') return normalizeList(rawValue).join('\n')
  if (field.type === 'roles' || field.type === 'channels' || field.type === 'guilds' || field.type === 'checklist') return normalizeList(rawValue)
  if (field.type === 'warning-steps') return normalizeList(rawValue).map((step) => createWarningStep(step))
  if (field.type === 'channel-select' || field.type === 'role-select') return rawValue || ''
  if (field.type === 'boolean') return !!rawValue
  if (field.type === 'number') return Number(rawValue ?? field.min ?? 0)
  return rawValue ?? ''
}

function buildFormState(module, fieldDefs) {
  const state = {}
  for (const field of fieldDefs) {
    state[field.path] = formatFieldValue(field, getValue(module, field.path))
  }
  return state
}

function serializeFieldValue(field, rawValue) {
  if (field.type === 'duration') return parseDuration(rawValue, 0)
  if (field.type === 'textarea-list') return splitLines(rawValue)
  if (field.type === 'roles' || field.type === 'channels' || field.type === 'guilds' || field.type === 'checklist') return normalizeList(rawValue)
  if (field.type === 'warning-steps') return serializeWarningSteps(rawValue)
  if (field.type === 'channel-select' || field.type === 'role-select') return rawValue || null
  if (field.type === 'number') return Number(rawValue || 0)
  if (field.type === 'boolean') return !!rawValue
  return typeof rawValue === 'string' ? rawValue.trim() : rawValue
}

function buildPayload(moduleType, formState, fieldDefs) {
  const payload = { simple_config: {}, advanced_config: {} }

  for (const field of fieldDefs) {
    const serialized = serializeFieldValue(field, formState[field.path])
    setValue(payload, field.path, serialized)
  }

  if (moduleType === 'ANTI_INVITE') {
    payload.advanced_config.punishment_threshold = 1
  }

  if (moduleType === 'AUTO_MOD') {
    payload.advanced_config.punishment_threshold = 1
    payload.advanced_config.use_regex = false
  }

  if (moduleType === 'LOGGING') {
    const events = normalizeList(payload.simple_config.events)
    payload.advanced_config.log_edits = events.includes('message_edit')
    payload.advanced_config.log_roles = events.includes('role_update')
    payload.advanced_config.log_nicknames = events.includes('nickname_change')
    payload.advanced_config.log_voice = false
  }

  return payload
}

function toggleListValue(list, value) {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value]
}

function MultiToggleList({ items, value, onChange, emptyLabel }) {
  if (!items.length) {
    return <p className="text-xs text-white/30">{emptyLabel}</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = value.includes(item.value)
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(toggleListValue(value, item.value))}
            className={`px-3 py-1.5 rounded-xl text-xs transition-all border ${
              active
                ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                : 'bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white hover:border-white/20'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function WarningStepsField({ ui, value, onChange, actionOptions }) {
  const steps = normalizeList(value)

  const updateStep = (index, patch) => {
    const next = steps.map((step, stepIndex) => (
      stepIndex === index ? { ...step, ...patch } : step
    ))
    onChange(next)
  }

  const removeStep = (index) => {
    onChange(steps.filter((_, stepIndex) => stepIndex !== index))
  }

  const addStep = () => {
    const previousWarnings = steps[steps.length - 1]?.warnings || 1
    onChange([
      ...steps,
      { warnings: previousWarnings + 2, action: 'timeout', duration: '10m' },
    ])
  }

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div key={`${index}-${step.warnings}-${step.action}`} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
          <div className="grid gap-3 md:grid-cols-[120px,1fr,180px,auto] items-end">
            <div>
              <label className="block text-xs text-white/45 mb-1">{ui.labels.warningCount}</label>
              <input
                type="number"
                min="1"
                className="input-field"
                value={step.warnings}
                onChange={(event) => updateStep(index, { warnings: Number(event.target.value || 1) })}
              />
            </div>
            <div>
              <label className="block text-xs text-white/45 mb-1">{ui.labels.action}</label>
              <select
                className="select-field"
                value={step.action}
                onChange={(event) => updateStep(index, { action: event.target.value })}
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/45 mb-1">{ui.labels.timeoutDuration}</label>
              <input
                type="text"
                className="input-field"
                value={step.action === 'timeout' ? step.duration : ''}
                disabled={step.action !== 'timeout'}
                onChange={(event) => updateStep(index, { duration: event.target.value })}
                placeholder="10m"
              />
            </div>
            <button
              type="button"
              onClick={() => removeStep(index)}
              className="px-3 py-2 rounded-xl text-xs border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/15 transition-colors"
            >
              {ui.remove}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addStep}
        className="px-3 py-2 rounded-xl text-xs border border-white/[0.08] text-white/70 hover:text-white hover:border-white/20 transition-colors"
      >
        {ui.addStep}
      </button>
    </div>
  )
}

function ModuleField({ field, formState, setFormState, ui, roles, channels, guilds, currentGuild }) {
  const value = formState[field.path]
  const updateValue = (nextValue) => setFormState((current) => ({ ...current, [field.path]: nextValue }))

  const textChannels = channels.filter((channel) => TEXT_CHANNEL_TYPES.includes(channel.type))
  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }))
  const channelOptions = textChannels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))
  const guildOptions = guilds
    .filter((guild) => guild.id !== currentGuild?.id)
    .map((guild) => ({ value: guild.guild_id, label: guild.name }))

  return (
    <div className="space-y-2">
      <label className="block text-sm font-display font-600 text-white">{field.label}</label>

      {field.type === 'text' && (
        <input
          type="text"
          className="input-field"
          value={value}
          placeholder={field.placeholder || ''}
          onChange={(event) => updateValue(event.target.value)}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          className="input-field"
          min={field.min}
          max={field.max}
          value={value}
          onChange={(event) => updateValue(Number(event.target.value || 0))}
        />
      )}

      {field.type === 'duration' && (
        <input
          type="text"
          className="input-field"
          value={value}
          placeholder="10m"
          onChange={(event) => updateValue(event.target.value)}
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          className="input-field min-h-[110px] resize-y"
          rows={field.rows || 4}
          value={value}
          onChange={(event) => updateValue(event.target.value)}
        />
      )}

      {field.type === 'textarea-list' && (
        <textarea
          className="input-field min-h-[110px] resize-y"
          rows={field.rows || 4}
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          placeholder="une valeur par ligne"
        />
      )}

      {field.type === 'select' && (
        <select
          className="select-field"
          value={value}
          onChange={(event) => updateValue(event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}

      {field.type === 'boolean' && (
        <div className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          <button
            type="button"
            onClick={() => updateValue(true)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${value ? 'bg-neon-cyan/12 text-neon-cyan' : 'text-white/45'}`}
          >
            {ui.yes}
          </button>
          <button
            type="button"
            onClick={() => updateValue(false)}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${!value ? 'bg-neon-cyan/12 text-neon-cyan' : 'text-white/45'}`}
          >
            {ui.no}
          </button>
        </div>
      )}

      {field.type === 'roles' && (
        <MultiToggleList
          items={roleOptions}
          value={normalizeList(value)}
          onChange={updateValue}
          emptyLabel={ui.noRoles}
        />
      )}

      {field.type === 'channels' && (
        <MultiToggleList
          items={channelOptions}
          value={normalizeList(value)}
          onChange={updateValue}
          emptyLabel={ui.noChannels}
        />
      )}

      {field.type === 'guilds' && (
        <MultiToggleList
          items={guildOptions}
          value={normalizeList(value)}
          onChange={updateValue}
          emptyLabel={ui.noGuilds}
        />
      )}

      {field.type === 'channel-select' && (
        <select
          className="select-field"
          value={value}
          onChange={(event) => updateValue(event.target.value)}
        >
          <option value="">{ui.noChannelOption}</option>
          {channelOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}

      {field.type === 'role-select' && (
        <select
          className="select-field"
          value={value}
          onChange={(event) => updateValue(event.target.value)}
        >
          <option value="">{ui.noRoles}</option>
          {roleOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}

      {field.type === 'checklist' && (
        <MultiToggleList
          items={field.options}
          value={normalizeList(value)}
          onChange={updateValue}
          emptyLabel=""
        />
      )}

      {field.type === 'warning-steps' && (
        <WarningStepsField
          ui={ui}
          value={normalizeList(value)}
          onChange={updateValue}
          actionOptions={field.actionOptions || []}
        />
      )}

      {field.help && <p className="text-xs text-white/35">{field.help}</p>}
    </div>
  )
}

function getModuleNote(moduleType, formState, ui) {
  if (moduleType === 'ULTIMATE_PROTECTION') return ui.labels.ultimateNote
  if (moduleType === 'ANTI_SPAM') return ui.labels.spamNote
  if (moduleType === 'ANTI_LINK') return ui.labels.linkNote
  if (moduleType === 'ANTI_INVITE') {
    const allowOwnInvites = !!formState['simple_config.allow_own_invites']
    const whitelistedServers = normalizeList(formState['advanced_config.whitelist_servers'])
    return !allowOwnInvites && whitelistedServers.length === 0
      ? ui.labels.inviteNative
      : ui.labels.inviteFallback
  }
  if (moduleType === 'ANTI_MASS_MENTION') return ui.labels.mentionNative
  if (moduleType === 'WARNING_SYSTEM') return ui.labels.warningNote
  if (moduleType === 'AUTO_MOD') return ui.labels.autoModNote
  if (moduleType === 'ANTI_RAID') return ui.labels.antiRaidNote
  if (moduleType === 'LOCKDOWN') return ui.labels.lockdownNote
  if (moduleType === 'ANTI_NUKE') return ui.labels.antiNukeNote
  if (moduleType === 'ANTI_ALT_ACCOUNT') return ui.labels.altNote
  if (moduleType === 'ANTI_BOT') return ui.labels.antiBotNote
  if (moduleType === 'ANTI_TOKEN_SCAM') return ui.labels.tokenScamNote
  if (moduleType === 'AUTO_SLOWMODE') return ui.labels.slowmodeNote
  if (moduleType === 'AUTO_QUARANTINE') return ui.labels.quarantineNote
  if (moduleType === 'TRUST_SCORE') return ui.labels.trustNote
  if (moduleType === 'WELCOME_MESSAGE') return ''
  if (moduleType === 'LOGGING') return ui.labels.loggingNote
  if (moduleType === 'PROTECTION_PRESETS') return ui.labels.presetNote
  if (moduleType === 'CUSTOM_COMMANDS') return ui.labels.commandsNote
  return ''
}

function ModuleCard({ module, ui, locale, roles, channels, guilds, currentGuild, onToggle, onSave, onReset }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const fieldDefs = useMemo(() => getFieldDefs(ui)[module.type] || [], [ui, module.type])
  const [formState, setFormState] = useState(() => buildFormState(module, fieldDefs))

  useEffect(() => {
    setFormState(buildFormState(module, fieldDefs))
  }, [module, fieldDefs])

  const colors = CATEGORY_STYLES[module.category] || CATEGORY_STYLES.utility
  const moduleCopy = getModuleCopy(module.type, locale, module)
  const Icon = MODULE_ICONS[module.type] || Shield
  const visibleFields = fieldDefs.filter((field) => !field.when || field.when(formState))
  const note = getModuleNote(module.type, formState, ui)

  const handleToggle = async () => {
    setToggling(true)
    try {
      await onToggle(module.type, !module.enabled)
    } finally {
      setToggling(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(module.type, buildPayload(module.type, formState, fieldDefs))
      toast.success(ui.saved)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      await onReset(module.type)
      toast.success(ui.resetDone)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className={`glass-card self-start border ${module.enabled ? colors.card : 'border-white/[0.08]'}`}>
      <div className="p-5">
        <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-4 sm:grid-cols-[auto,minmax(0,1fr),auto] sm:items-start">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${colors.badge}`}>
            <Icon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-700 text-white text-xl leading-none">{moduleCopy.name}</h3>
              <span className={`px-2.5 py-1 rounded-full border text-xs ${colors.badge}`}>
                {ui.categories[module.category] || module.category}
              </span>
            </div>
            <p className="text-white/45 mt-2">{moduleCopy.description}</p>
          </div>

          <div className="col-span-2 sm:col-span-1 flex justify-end sm:justify-start">
            <label className="toggle-switch shrink-0 sm:mt-1">
              <input type="checkbox" checked={module.enabled} onChange={handleToggle} disabled={toggling} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex items-center gap-2 mt-4 text-sm text-white/45 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4" />
          {ui.configure}
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] p-5 space-y-5">
          <div>
            <p className="text-xs tracking-[0.25em] uppercase text-white/30 font-mono">{ui.configuration}</p>
            {note && (
              <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-white/60">
                {note}
              </div>
            )}
          </div>

          <div className="space-y-5">
            {visibleFields.map((field) => (
              <ModuleField
                key={field.path}
                field={field}
                formState={formState}
                setFormState={setFormState}
                ui={ui}
                roles={roles}
                channels={channels}
                guilds={guilds}
                currentGuild={currentGuild}
              />
            ))}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15 transition-colors disabled:opacity-60"
            >
              {saving ? ui.saving : ui.save}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="px-4 py-2 rounded-xl border border-white/[0.08] text-white/55 hover:text-white hover:border-white/20 transition-colors disabled:opacity-60"
            >
              {ui.reset}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProtectionPage() {
  const { locale } = useI18n()
  const ui = getUi(locale)
  const { guilds, selectedGuildId } = useGuildStore()
  const [modules, setModules] = useState([])
  const [roles, setRoles] = useState([])
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeCategory, setActiveCategory] = useState('all')
  const [loadError, setLoadError] = useState('')
  const loadPromiseRef = useRef(null)
  const pendingReloadRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const selectedGuildIdRef = useRef(selectedGuildId)

  const currentGuild = guilds.find((guild) => guild.id === selectedGuildId) || null

  const filteredModules = useMemo(() => {
    const source = activeCategory === 'all'
      ? modules
      : modules.filter((module) => module.category === activeCategory)

    const order = new Map(MODULE_ORDER.map((type, index) => [type, index]))
    return [...source].sort((left, right) => {
      const leftIndex = order.get(left.type) ?? 999
      const rightIndex = order.get(right.type) ?? 999
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
      return left.type.localeCompare(right.type)
    })
  }, [activeCategory, modules])

  useEffect(() => {
    selectedGuildIdRef.current = selectedGuildId
  }, [selectedGuildId])

  const loadAll = useCallback(async (initial = false) => {
    if (!selectedGuildIdRef.current) return

    if (loadPromiseRef.current) {
      pendingReloadRef.current = true
      return loadPromiseRef.current
    }

    const guildId = selectedGuildIdRef.current
    const requestId = ++loadRequestIdRef.current

    setLoadError('')
    if (initial) setLoading(true)
    else setRefreshing(true)

    const request = Promise.all([
      modulesAPI.list(guildId),
      botAPI.roles(guildId),
      botAPI.channels(guildId),
    ])
      .then(([modulesResponse, rolesResponse, channelsResponse]) => {
        if (requestId !== loadRequestIdRef.current || guildId !== selectedGuildIdRef.current) return
        setModules(modulesResponse.data.modules || [])
        setRoles((rolesResponse.data.roles || []).filter((role) => role.name !== '@everyone'))
        setChannels(channelsResponse.data.channels || [])
        setLoadError('')
        toast.dismiss(PROTECTION_LOAD_TOAST_ID)
      })
      .catch((error) => {
        if (requestId !== loadRequestIdRef.current || guildId !== selectedGuildIdRef.current) return
        const message = getErrorMessage(error)
        setLoadError(message)
        toast.error(message, { id: PROTECTION_LOAD_TOAST_ID })
      })
      .finally(() => {
        if (requestId === loadRequestIdRef.current) {
          setLoading(false)
          setRefreshing(false)
        }

        loadPromiseRef.current = null

        if (pendingReloadRef.current && guildId === selectedGuildIdRef.current) {
          pendingReloadRef.current = false
          void loadAll(false)
        }
      })

    loadPromiseRef.current = request
    return request
  }, [])

  useEffect(() => {
    if (!selectedGuildId) {
      setModules([])
      setRoles([])
      setChannels([])
      setLoadError('')
      setLoading(false)
      return
    }
    loadAll(true)
  }, [loadAll, selectedGuildId])

  const toggleModule = async (type, enabled) => {
    await modulesAPI.toggle(selectedGuildId, type, enabled)
    await loadAll(false)
  }

  const saveModule = async (type, payload) => {
    await modulesAPI.config(selectedGuildId, type, payload)
    await loadAll(false)
  }

  const resetModule = async (type) => {
    await modulesAPI.reset(selectedGuildId, type)
    await loadAll(false)
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 py-5 sm:p-6 max-w-4xl mx-auto">
        <div className="glass-card p-8 text-center space-y-3">
          <h1 className="font-display font-800 text-3xl text-white">{ui.noServer}</h1>
          <p className="text-white/45">{ui.subtitle}</p>
          <Link
            to="/dashboard/servers"
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15 transition-colors"
          >
            {ui.noServer}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display font-800 text-3xl text-white">{ui.title}</h1>
          <p className="text-white/45 mt-2">
            {currentGuild?.name ? `${ui.subtitle} - ${currentGuild.name}` : ui.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadAll(false)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {ui.refresh}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`px-4 py-2 rounded-xl border text-sm transition-colors ${
            activeCategory === 'all'
              ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
              : 'border-white/[0.08] text-white/50 hover:text-white hover:border-white/18'
          }`}
        >
          {ui.categories.all}
        </button>
        {CATEGORY_ORDER.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`px-4 py-2 rounded-xl border text-sm transition-colors ${
              activeCategory === category
                ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
                : 'border-white/[0.08] text-white/50 hover:text-white hover:border-white/18'
            }`}
          >
            {ui.categories[category]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass-card p-8 text-white/45">{ui.loading}</div>
      ) : loadError && modules.length === 0 ? (
        <div className="glass-card p-8 text-center space-y-4">
          <div className="space-y-2">
            <p className="text-lg font-display font-700 text-white">{ui.loadError}</p>
            <p className="text-sm text-red-300/90">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => loadAll(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {ui.retry}
          </button>
        </div>
      ) : filteredModules.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/45">{ui.emptyCategory}</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2 items-start">
          {filteredModules.map((module) => (
            <ModuleCard
              key={module.type}
              module={module}
              ui={ui}
              locale={locale}
              roles={roles}
              channels={channels}
              guilds={guilds}
              currentGuild={currentGuild}
              onToggle={toggleModule}
              onSave={saveModule}
              onReset={resetModule}
            />
          ))}
        </div>
      )}
    </div>
  )
}
