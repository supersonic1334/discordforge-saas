export const GUILD_FEATURE_OPTIONS = [
  { key: 'team', label: 'Equipe', description: "Collaborateurs, codes et demandes" },
  { key: 'protection', label: 'Protection', description: 'Modules anti-spam, anti-lien et securite' },
  { key: 'onboarding', label: 'Accueil & roles', description: "Bienvenue, autoroles et arrivee membre" },
  { key: 'search', label: 'Recherche', description: 'Recherche et actions staff rapides' },
  { key: 'scan', label: 'Scan', description: 'Scan OSINT interne du serveur' },
  { key: 'logs', label: 'Logs', description: 'Historique et journal serveur' },
  { key: 'incidents', label: 'Incidents', description: 'Alertes moderation et suivi incident' },
  { key: 'messages', label: 'Messages', description: 'MP staff et actions texte' },
  { key: 'dm_center', label: 'Centre DM', description: 'Centre DM et recherche membre' },
  { key: 'notifications', label: 'Notifications', description: 'Branding et notifications auto' },
  { key: 'blocked', label: "Controle d'acces", description: 'Bannissements et blocages' },
  { key: 'commands', label: 'Commandes', description: 'Slash systeme et commandes natives' },
  { key: 'commands_ai', label: 'Commandes IA', description: 'Generateur et edition IA des commandes' },
  { key: 'tickets', label: 'Tickets', description: 'Generation et reglage tickets' },
  { key: 'captcha', label: 'CAPTCHA', description: 'Verification et panel Discord' },
  { key: 'voice_rooms', label: 'Vocaux temporaires', description: 'Vocaux auto et panneau vocal' },
  { key: 'bot_messages', label: 'Messages du bot', description: 'Envoi bot dans un salon' },
  { key: 'analytics', label: 'Analytics', description: 'Stats et vue activite' },
  { key: 'ai', label: 'Assistant IA', description: 'Assistant et outils IA du site' },
]

export const GUILD_FEATURE_KEYS = GUILD_FEATURE_OPTIONS.map((entry) => entry.key)

export function normalizeBlockedFeatures(value) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(GUILD_FEATURE_KEYS)
  return [...new Set(
    value
      .map((entry) => String(entry || '').trim())
      .filter((entry) => allowed.has(entry))
  )]
}

export function getBlockedFeatureSet(guild) {
  return new Set(normalizeBlockedFeatures(guild?.blocked_features || []))
}

export function getRouteFeatureKey(pathname) {
  const path = String(pathname || '').trim()
  const routeMap = [
    ['/dashboard/team', 'team'],
    ['/dashboard/protection', 'protection'],
    ['/dashboard/onboarding', 'onboarding'],
    ['/dashboard/search', 'search'],
    ['/dashboard/scan', 'scan'],
    ['/dashboard/logs', 'logs'],
    ['/dashboard/incidents', 'incidents'],
    ['/dashboard/messages', 'messages'],
    ['/dashboard/dm-center', 'dm_center'],
    ['/dashboard/notifications', 'notifications'],
    ['/dashboard/blocked', 'blocked'],
    ['/dashboard/commands-ai', 'commands_ai'],
    ['/dashboard/commands', 'commands'],
    ['/dashboard/tickets', 'tickets'],
    ['/dashboard/captcha', 'captcha'],
    ['/dashboard/voice-rooms', 'voice_rooms'],
    ['/dashboard/bot-messages', 'bot_messages'],
    ['/dashboard/analytics', 'analytics'],
    ['/dashboard/ai', 'ai'],
  ]

  const match = routeMap.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  return match?.[1] || null
}
