import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Hash,
  Mic,
  Plus,
  RefreshCw,
  Send,
  Slash,
  Sparkles,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wand2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { aiAPI, commandsAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { useSpeechToText } from '../hooks/useSpeechToText'
import VoiceMeter from '../components/VoiceMeter'

const UI = {
  fr: {
    title: 'Commandes',
    subtitle: 'Tu choisis le prefixe ou le slash, puis tu decris la commande a l assistant.',
    selectServerTitle: "Choisis d'abord un serveur",
    selectServerText: 'Les commandes se creent serveur par serveur.',
    selectServerAction: 'Choisir un serveur',
    new: 'Nouvelle commande IA',
    edit: 'Modifier avec IA',
    refresh: 'Actualiser',
    assistantTitle: 'Assistant de commandes',
    assistantCreate: 'Creation guidee',
    assistantEdit: 'Modification guidee',
    editingTarget: 'Commande en cours',
    cancelEdit: 'Annuler',
    assistantCreateHint: 'Explique simplement ce que tu veux. Exemple: cree une commande bonjour qui repond bonjour {mention}.',
    assistantCreateEmpty: "Le chat IA va creer la commande automatiquement et l'enregistrer directement.",
    assistantEditHint: 'Decris seulement la modification a faire. La commande actuelle sera mise a jour directement.',
    assistantEditEmpty: "Ecris ce que tu veux changer. L'assistant appliquera la modification sur cette commande existante.",
    assistantHint: 'Explique simplement ce que tu veux. Exemple: cree une commande bonjour qui repond bonjour {mention}.',
    assistantEmpty: "Le chat IA va creer la commande automatiquement et l'enregistrer directement.",
    modeLabel: 'Type de commande',
    modePrefix: 'Prefixe texte',
    modeSlash: 'Slash Discord',
    prefixLabel: 'Commande texte ou prefixe',
    prefixHint: 'Exemple: !music ou !',
    slashNameLabel: 'Nom de la commande slash',
    slashNameHint: 'Exemple: music',
    promptLabel: 'Ce que tu veux',
    promptPlaceholder: 'Exemple: cree une commande annonce qui repond en embed avec le titre Infos du serveur',
    promptEditPlaceholder: 'Exemple: remplace la reponse par une version plus courte et plus propre',
    voiceStart: 'Parler',
    voiceStop: 'Stop micro',
    voiceListening: 'Ecoute en cours...',
    voicePreparing: 'Autorisation micro...',
    voiceStopDictation: 'Arreter la dictee',
    voiceSendTranscript: 'Transcrire et generer',
    voiceLiveTranscript: 'Transcription en direct',
    voiceUnsupported: 'Micro non pris en charge sur ce navigateur.',
    voiceDenied: 'Autorise le micro pour utiliser la dictée.',
    voiceError: 'La dictée vocale a rencontré un problème.',
    send: 'Generer la commande',
    generating: 'Generation...',
    created: 'Commande creee',
    updated: 'Commande mise a jour',
    deleted: 'Commande supprimee',
    deleteConfirm: 'Supprimer cette commande ?',
    empty: 'Aucune commande pour ce serveur',
    emptyHint: "Crée la première avec l'assistant IA.",
    uses: 'Utilisations',
    active: 'Active',
    disabled: 'Desactivee',
    quota: 'Quota IA restant',
    assistantReplyFallback: 'Commande preparee et enregistree.',
    slashBadge: 'Slash',
    prefixBadge: 'Prefixe',
    botReady: 'La commande est enregistree et synchronisee automatiquement avec le bot.',
  },
  en: {
    title: 'Commands',
    subtitle: 'Pick a prefix or slash, then describe the command to the assistant.',
    selectServerTitle: 'Choose a server first',
    selectServerText: 'Commands are created per server.',
    selectServerAction: 'Choose a server',
    new: 'New AI command',
    edit: 'Edit with AI',
    refresh: 'Refresh',
    assistantTitle: 'Command assistant',
    assistantCreate: 'Guided creation',
    assistantEdit: 'Guided edit',
    editingTarget: 'Current command',
    cancelEdit: 'Cancel',
    assistantCreateHint: 'Describe what you want. Example: create a hello command that replies hello {mention}.',
    assistantCreateEmpty: 'The AI chat will create the command automatically and save it directly.',
    assistantEditHint: 'Only describe the change you want. The current command will be updated in place.',
    assistantEditEmpty: 'Write what you want to change. The assistant will apply it to this existing command.',
    assistantHint: 'Describe what you want. Example: create a hello command that replies hello {mention}.',
    assistantEmpty: 'The AI chat will create the command automatically and save it directly.',
    modeLabel: 'Command type',
    modePrefix: 'Text prefix',
    modeSlash: 'Discord slash',
    prefixLabel: 'Text command or prefix',
    prefixHint: 'Example: !music or !',
    slashNameLabel: 'Slash command name',
    slashNameHint: 'Example: music',
    promptLabel: 'What you want',
    promptPlaceholder: 'Example: create an announce command that replies with an embed titled Server info',
    promptEditPlaceholder: 'Example: replace the response with a shorter and cleaner version',
    voiceStart: 'Speak',
    voiceStop: 'Stop mic',
    voiceListening: 'Listening...',
    voicePreparing: 'Requesting mic...',
    voiceStopDictation: 'Stop dictation',
    voiceSendTranscript: 'Transcribe and generate',
    voiceLiveTranscript: 'Live transcript',
    voiceUnsupported: 'Microphone is not supported on this browser.',
    voiceDenied: 'Allow microphone access to use voice dictation.',
    voiceError: 'Voice dictation ran into an issue.',
    send: 'Generate command',
    generating: 'Generating...',
    created: 'Command created',
    updated: 'Command updated',
    deleted: 'Command deleted',
    deleteConfirm: 'Delete this command?',
    empty: 'No commands for this server',
    emptyHint: 'Create the first one with the AI assistant.',
    uses: 'Uses',
    active: 'Active',
    disabled: 'Disabled',
    quota: 'AI quota left',
    assistantReplyFallback: 'Command prepared and saved.',
    slashBadge: 'Slash',
    prefixBadge: 'Prefix',
    botReady: 'The command is saved and synced automatically with the bot.',
  },
  es: {
    title: 'Comandos',
    subtitle: 'Eliges prefijo o slash y luego describes el comando al asistente.',
    selectServerTitle: 'Primero elige un servidor',
    selectServerText: 'Los comandos se crean por servidor.',
    selectServerAction: 'Elegir servidor',
    new: 'Nuevo comando IA',
    edit: 'Editar con IA',
    refresh: 'Actualizar',
    assistantTitle: 'Asistente de comandos',
    assistantCreate: 'Creacion guiada',
    assistantEdit: 'Edicion guiada',
    editingTarget: 'Comando actual',
    cancelEdit: 'Cancelar',
    assistantCreateHint: 'Describe lo que quieres. Ejemplo: crea un comando hola que responda hola {mention}.',
    assistantCreateEmpty: 'El chat IA creara el comando automaticamente y lo guardara directamente.',
    assistantEditHint: 'Describe solo el cambio que quieres. El comando actual se actualizara directamente.',
    assistantEditEmpty: 'Escribe lo que quieres cambiar. El asistente aplicara el cambio sobre este comando existente.',
    assistantHint: 'Describe lo que quieres. Ejemplo: crea un comando hola que responda hola {mention}.',
    assistantEmpty: 'El chat IA creara el comando automaticamente y lo guardara directamente.',
    modeLabel: 'Tipo de comando',
    modePrefix: 'Prefijo de texto',
    modeSlash: 'Slash de Discord',
    prefixLabel: 'Comando de texto o prefijo',
    prefixHint: 'Ejemplo: !music o !',
    slashNameLabel: 'Nombre del comando slash',
    slashNameHint: 'Ejemplo: music',
    promptLabel: 'Lo que quieres',
    promptPlaceholder: 'Ejemplo: crea un comando anuncio que responda con un embed titulado Info del servidor',
    promptEditPlaceholder: 'Ejemplo: reemplaza la respuesta por una version mas corta y mas limpia',
    voiceStart: 'Hablar',
    voiceStop: 'Detener micro',
    voiceListening: 'Escuchando...',
    voicePreparing: 'Autorizando micro...',
    voiceStopDictation: 'Detener dictado',
    voiceSendTranscript: 'Transcribir y generar',
    voiceLiveTranscript: 'Transcripcion en vivo',
    voiceUnsupported: 'El micro no es compatible con este navegador.',
    voiceDenied: 'Autoriza el micro para usar la dictado por voz.',
    voiceError: 'El dictado por voz encontro un problema.',
    send: 'Generar comando',
    generating: 'Generando...',
    created: 'Comando creado',
    updated: 'Comando actualizado',
    deleted: 'Comando eliminado',
    deleteConfirm: 'Eliminar este comando?',
    empty: 'No hay comandos para este servidor',
    emptyHint: 'Crea el primero con el asistente IA.',
    uses: 'Usos',
    active: 'Activo',
    disabled: 'Desactivado',
    quota: 'Cuota IA restante',
    assistantReplyFallback: 'Comando preparado y guardado.',
    slashBadge: 'Slash',
    prefixBadge: 'Prefijo',
    botReady: 'El comando queda guardado y sincronizado automaticamente con el bot.',
  },
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function isRouteNotFound(error, fragment) {
  const message = String(error?.response?.data?.error || '')
  return error?.response?.status === 404 && (!fragment || message.includes(fragment))
}

function getUi(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return UI[key] || UI.fr
}

function upsertCommand(list, command) {
  const exists = list.some((entry) => entry.id === command.id)
  if (!exists) return [command, ...list]
  return list.map((entry) => (entry.id === command.id ? command : entry))
}

function extractCommandDraft(text) {
  const match = String(text || '').match(/```command\s*([\s\S]*?)```/i)
  if (!match) return null
  try {
    return JSON.parse(match[1].trim())
  } catch {
    return null
  }
}

function normalizeCommandPrefix(value) {
  return String(value || '!').trim().slice(0, 5) || '!'
}

function normalizeCommandInput(value) {
  return String(value || '').trim()
}

function shouldUseSpaceAfterPrefix(prefix) {
  return /^[a-z0-9]+$/i.test(String(prefix || '').trim())
}

function deriveCommandMeta(trigger) {
  const raw = normalizeCommandInput(trigger)
  if (!raw) {
    return {
      command_type: 'prefix',
      command_prefix: '!',
      command_name: '',
      trigger: '',
    }
  }

  if (raw.startsWith('/')) {
    const commandName = sanitizeCommandName(raw.slice(1), 'slash')
    return {
      command_type: 'slash',
      command_prefix: '/',
      command_name: commandName,
      trigger: commandName ? `/${commandName}` : '/',
    }
  }

  if (raw.includes(' ')) {
    const [prefix, ...rest] = raw.split(/\s+/)
    const commandPrefix = normalizeCommandPrefix(prefix)
    const commandName = sanitizeCommandName(rest.join('-'), 'prefix')
    return {
      command_type: 'prefix',
      command_prefix: commandPrefix,
      command_name: commandName,
      trigger: commandName ? buildCommandTrigger('prefix', commandPrefix, commandName) : commandPrefix,
    }
  }

  if (/^[^a-z0-9\s/]+$/i.test(raw)) {
    const commandPrefix = normalizeCommandPrefix(raw)
    return {
      command_type: 'prefix',
      command_prefix: commandPrefix,
      command_name: '',
      trigger: commandPrefix,
    }
  }

  const symbolicTrigger = raw.match(/^([^a-z0-9\s/]+)(.+)$/i)
  if (symbolicTrigger) {
    const commandPrefix = normalizeCommandPrefix(symbolicTrigger[1])
    const commandName = sanitizeCommandName(symbolicTrigger[2], 'prefix')
    return {
      command_type: 'prefix',
      command_prefix: commandPrefix,
      command_name: commandName,
      trigger: commandName ? buildCommandTrigger('prefix', commandPrefix, commandName) : commandPrefix,
    }
  }

  const commandPrefix = '!'
  const commandName = sanitizeCommandName(raw, 'prefix')
  return {
    command_type: 'prefix',
    command_prefix: commandPrefix,
    command_name: commandName,
    trigger: commandName ? buildCommandTrigger('prefix', commandPrefix, commandName) : commandPrefix,
  }
}

function isFullPrefixCommandInput(value) {
  const raw = normalizeCommandInput(value)
  if (!raw) return false
  if (raw.includes(' ')) return true
  if (/^[^a-z0-9\s/]+$/i.test(raw)) return false
  if (/^[^a-z0-9\s/].+/i.test(raw)) return raw.length > 1
  return false
}

function sanitizeCommandName(value, commandType = 'prefix') {
  const raw = String(value || '').trim().replace(/\s+/g, '-')
  if (!raw) return ''

  if (commandType === 'slash') {
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 32)
    return cleaned || 'commande'
  }

  return raw.replace(/[^\w-]/g, '').slice(0, 32) || 'commande'
}

function buildCommandTrigger(commandType, commandPrefix, commandName) {
  if (!commandName) {
    return commandType === 'slash' ? '/' : commandPrefix
  }
  if (commandType === 'slash') return `/${commandName}`
  return shouldUseSpaceAfterPrefix(commandPrefix)
    ? `${commandPrefix} ${commandName}`
    : `${commandPrefix}${commandName}`
}

function buildRequestedCommandMeta(commandInput, currentCommand = null) {
  const rawInput = normalizeCommandInput(commandInput)
  const fallbackPrefix = currentCommand?.command_type === 'prefix'
    ? normalizeCommandPrefix(currentCommand.command_prefix || '!')
    : '!'

  if (!rawInput) {
    return {
      command_type: currentCommand?.command_type === 'slash' ? 'slash' : 'prefix',
      command_prefix: currentCommand?.command_type === 'slash' ? '/' : fallbackPrefix,
      command_name: currentCommand?.command_name || '',
      trigger: currentCommand?.display_trigger || buildCommandTrigger('prefix', fallbackPrefix, currentCommand?.command_name || ''),
      isExactTrigger: false,
      input_kind: 'empty',
    }
  }

  const meta = deriveCommandMeta(rawInput)
  const isNameOnly = !rawInput.startsWith('/') && !rawInput.includes(' ') && !/^[^a-z0-9\s/]+/i.test(rawInput)

  return {
    ...meta,
    command_prefix: meta.command_type === 'slash' ? '/' : normalizeCommandPrefix(meta.command_prefix || fallbackPrefix),
    isExactTrigger: meta.command_type === 'slash' ? false : !isNameOnly && Boolean(meta.command_name),
    input_kind: meta.command_type === 'slash'
      ? 'slash'
      : isNameOnly
        ? 'name-only'
        : (!meta.command_name ? 'prefix-only' : 'trigger'),
  }
}

function formatCooldownLabel(value) {
  const ms = Number(value || 0)
  if (!ms) return ''
  if (ms >= 3600000 && ms % 3600000 === 0) return `${ms / 3600000}h cooldown`
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000}m cooldown`
  return `${Math.round(ms / 1000)}s cooldown`
}

function buildFallbackPayload({ draft, commandInput, currentCommand }) {
  const requestedMeta = buildRequestedCommandMeta(commandInput, currentCommand)
  const commandType = requestedMeta.command_type
  const commandPrefix = commandType === 'slash'
    ? '/'
    : requestedMeta.command_prefix
  const commandName = requestedMeta.command_name || sanitizeCommandName(
    draft?.command_name || currentCommand?.command_name || 'commande',
    commandType
  )
  const trigger = requestedMeta.isExactTrigger
    ? requestedMeta.trigger
    : buildCommandTrigger(commandType, commandPrefix, commandName)

  return {
    trigger,
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    description: String(draft?.description || currentCommand?.description || '').trim().slice(0, 120),
    response: String(draft?.response || currentCommand?.response || '').trim().slice(0, 2000),
    response_mode: ['channel', 'reply', 'dm'].includes(draft?.response_mode) ? draft.response_mode : (currentCommand?.response_mode || 'reply'),
    embed_enabled: draft?.embed_enabled ?? currentCommand?.embed_enabled ?? false,
    embed_title: String(draft?.embed_title || currentCommand?.embed_title || '').trim().slice(0, 256),
    embed_color: String(draft?.embed_color || currentCommand?.embed_color || '#22d3ee').trim(),
    mention_user: draft?.mention_user ?? currentCommand?.mention_user ?? false,
    usage_hint: String(draft?.usage_hint || currentCommand?.usage_hint || '').trim().slice(0, 200),
    require_args: draft?.require_args ?? currentCommand?.require_args ?? false,
    delete_trigger: draft?.delete_trigger ?? currentCommand?.delete_trigger ?? false,
    cooldown_ms: Number(draft?.cooldown_ms ?? currentCommand?.cooldown_ms ?? 0),
  }
}

function buildAssistantFallbackPrompt({ commandInput, prompt, currentCommand, locale }) {
  const language = String(locale || 'fr').toLowerCase().startsWith('fr')
    ? 'francais'
    : String(locale || 'fr').toLowerCase().startsWith('es')
      ? 'espagnol'
      : 'anglais'
  const requestedMeta = buildRequestedCommandMeta(commandInput, currentCommand)
  const requestedInstruction = requestedMeta.command_type === 'slash'
    ? (requestedMeta.command_name ? `Nom exact impose pour la commande slash: ${requestedMeta.command_name}` : '')
    : requestedMeta.isExactTrigger
      ? `Declencheur texte exact impose: ${requestedMeta.trigger}`
      : requestedMeta.command_name
        ? `Nom de commande voulu: ${requestedMeta.command_name} (prefixe ${requestedMeta.command_prefix})`
        : `Prefixe impose: ${requestedMeta.command_prefix}`

  const existingBlock = currentCommand
    ? `Commande actuelle:
- trigger: ${currentCommand.display_trigger}
- description: ${currentCommand.description || '(vide)'}
- response: ${currentCommand.response}
- mode: ${currentCommand.response_mode}
`
    : ''

  const randomSeed = Math.random().toString(36).slice(2, 8)

  return `Tu es un generateur de commandes DiscordForger expert et creatif.
Ne fais aucune action d'administration.
Reponds en ${language}.
Seed aleatoire: ${randomSeed} (utilise cette seed pour varier tes reponses — ne genere JAMAIS la meme reponse deux fois).
${existingBlock}
Mode demande: ${requestedMeta.command_type === 'slash' ? 'slash Discord' : 'prefixe texte'}
${requestedInstruction}

Tache utilisateur:
${prompt}

Retour obligatoire:
1. Une courte explication creative et variee (change ton style a chaque fois).
2. Puis exactement un bloc \`\`\`command avec du JSON valide.

Champs autorises dans le JSON:
- command_name
- description
- response
- response_mode ("channel" | "reply" | "dm")
- embed_enabled
- embed_title
- embed_color
- mention_user
- usage_hint
- require_args
- delete_trigger
- cooldown_ms

Regles:
- command_name doit etre court et utilisable tout de suite
- pour slash, nom en minuscules compatible Discord
- si l'utilisateur veut un faux panel, un hub, un menu ou un centre d'aide, transforme ca en commande embed premium, bien structuree, avec sections, usage_hint et args si utile
- pas de JavaScript, pas de webhook, pas de boutons Discord non supportes
- placeholders autorises: {mention} {username} {server} {channel} {memberCount} {args} {arg1} {arg2}
- pour les commandes de contenu (blagues, faits, citations), utilise la syntaxe [[random: option 1 || option 2 || option 3 || option 4 || option 5 || option 6]] avec du contenu vraiment different
- les descriptions doivent etre concises mais engageantes
- Les reponses doivent etre riches, bien formatees, et professionnelles.

Format attendu:
\`\`\`command
{
  "command_name": "bonjour",
  "description": "Salue un membre avec une reponse premium",
  "response": "Bonjour {mention} !",
  "response_mode": "reply",
  "embed_enabled": false,
  "embed_title": "",
  "embed_color": "#22d3ee",
  "mention_user": false,
  "usage_hint": "",
  "require_args": false,
  "delete_trigger": false,
  "cooldown_ms": 0
}
\`\`\``
}

function getCommandsCopy(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]

  if (key === 'en') {
    return {
      heroBadge: 'Auto-detect',
      heroTitle: 'More powerful, more visual, more adaptable command builder.',
      heroText: 'Type any trigger directly: `/help`, `!ping`, `*ticket`, `?rules`, `^^panel`. The page detects the real mode automatically.',
      detectTitle: 'Live detection',
      detectText: 'The assistant reads your trigger as you type and keeps the final command aligned with your Discord intent.',
      triggerExamples: 'Trigger ideas',
      promptIdeas: 'Prompt ideas',
      autoMode: 'Auto-detected mode',
      liveTrigger: 'Saved trigger',
      inputHelp: 'Type the exact trigger or the future command name. Examples: `/help`, `!joke`, `*ticket`, `?rules`, `^^panel`.',
      prefixOnly: 'Custom prefix only',
      slashMode: 'Discord slash command',
      nameOnly: 'Command name only',
      exactTrigger: 'Exact text trigger',
      dynamicBadge: 'Varied',
      embedBadge: 'Embed',
      argsBadge: 'Args required',
      deleteBadge: 'Delete trigger',
      usageLabel: 'Usage hint',
      responseLabel: 'Response preview',
      helperPanel: 'Help hub',
      helperRandom: 'Random jokes',
      helperTicket: 'Ticket panel',
      helperAnnounce: 'Styled announcement',
      assistantPanelTitle: 'AI creation flow',
      assistantPanelText: 'Describe a simple or advanced Discord feature. The assistant now aims for richer embeds, better argument handling, and more varied responses.',
      quotaLabel: 'AI budget left',
      total: 'Commands',
      active: 'Online',
      slash: 'Slash',
      dynamic: 'Varied',
    }
  }

  if (key === 'es') {
    return {
      heroBadge: 'Deteccion auto',
      heroTitle: 'Constructor de comandos mas potente, mas visual y mas flexible.',
      heroText: 'Escribe directamente cualquier trigger: `/help`, `!ping`, `*ticket`, `?reglas`, `^^panel`. La pagina detecta el modo real automaticamente.',
      detectTitle: 'Deteccion en vivo',
      detectText: 'El asistente interpreta tu trigger mientras escribes y mantiene el comando final alineado con tu intencion real en Discord.',
      triggerExamples: 'Ideas de trigger',
      promptIdeas: 'Ideas de pedido',
      autoMode: 'Modo detectado',
      liveTrigger: 'Trigger guardado',
      inputHelp: 'Escribe el trigger exacto o el futuro nombre del comando. Ejemplos: `/help`, `!broma`, `*ticket`, `?reglas`, `^^panel`.',
      prefixOnly: 'Solo prefijo personalizado',
      slashMode: 'Comando slash de Discord',
      nameOnly: 'Solo nombre del comando',
      exactTrigger: 'Trigger de texto exacto',
      dynamicBadge: 'Variable',
      embedBadge: 'Embed',
      argsBadge: 'Args requeridos',
      deleteBadge: 'Borra trigger',
      usageLabel: 'Guia de uso',
      responseLabel: 'Vista previa de respuesta',
      helperPanel: 'Panel de ayuda',
      helperRandom: 'Bromas aleatorias',
      helperTicket: 'Panel ticket',
      helperAnnounce: 'Anuncio premium',
      assistantPanelTitle: 'Flujo IA',
      assistantPanelText: 'Describe una funcion simple o avanzada para Discord. El asistente ahora apunta a embeds mas ricos, mejor gestion de argumentos y respuestas mas variadas.',
      quotaLabel: 'Cuota IA restante',
      total: 'Comandos',
      active: 'Activos',
      slash: 'Slash',
      dynamic: 'Variables',
    }
  }

  return {
    heroBadge: 'Detection auto',
    heroTitle: 'Constructeur de commandes plus puissant, plus visuel et plus souple.',
    heroText: 'Tape directement n’importe quel declencheur: `/help`, `!ping`, `*ticket`, `?regles`, `^^panel`. La page detecte le vrai mode automatiquement.',
    detectTitle: 'Detection en direct',
    detectText: 'L’assistant lit ton declencheur pendant la saisie et garde la commande finale coherente avec ce que tu veux vraiment faire sur Discord.',
    triggerExamples: 'Idees de declencheur',
    promptIdeas: 'Idees de demande',
    autoMode: 'Mode detecte',
    liveTrigger: 'Declencheur final',
    inputHelp: 'Ecris le declencheur exact ou le futur nom de commande. Exemples: `/help`, `!blague`, `*ticket`, `?regles`, `^^panel`.',
    prefixOnly: 'Prefixe personnalise seul',
    slashMode: 'Commande slash Discord',
    nameOnly: 'Nom de commande seul',
    exactTrigger: 'Declencheur texte exact',
    dynamicBadge: 'Variante',
    embedBadge: 'Embed',
    argsBadge: 'Args requis',
    deleteBadge: 'Efface le trigger',
    usageLabel: 'Aide d’usage',
    responseLabel: 'Apercu reponse',
    helperPanel: 'Panel d’aide',
    helperRandom: 'Blagues variees',
    helperTicket: 'Ticket premium',
    helperAnnounce: 'Annonce stylisee',
    assistantPanelTitle: 'Flux IA',
    assistantPanelText: 'Decris une fonction Discord simple ou avancee. L’assistant vise maintenant des embeds plus riches, des arguments mieux geres et des reponses moins basiques.',
    quotaLabel: 'Quota IA restant',
    total: 'Commandes',
    active: 'Actives',
    slash: 'Slash',
    dynamic: 'Variables',
  }
}

function getCommandTriggerExamples() {
  return ['/help', '!blague', '*ticket', '?regles', '^^panel']
}

function getPromptIdeas(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]

  if (key === 'en') {
    return [
      'Create a premium help hub with sections and a polished embed.',
      'Create a joke command with truly varied random outputs.',
      'Create a ticket embed flow with arguments and usage hints.',
      'Create a stylish announcement command with a clean structure.',
    ]
  }

  if (key === 'es') {
    return [
      'Crea un panel de ayuda premium con secciones y un embed claro.',
      'Crea un comando de bromas con resultados realmente variables.',
      'Crea un flujo ticket en embed con argumentos y guia de uso.',
      'Crea un comando de anuncio elegante y bien estructurado.',
    ]
  }

  return [
    'Cree un panel d’aide premium avec sections et embed propre.',
    'Cree une commande de blagues avec de vraies variantes aleatoires.',
    'Cree un flux ticket en embed avec args et guide d’utilisation.',
    'Cree une commande d’annonce stylisee et bien structuree.',
  ]
}

function describeRequestedMode(meta, copy) {
  if (meta.command_type === 'slash') return copy.slashMode
  if (meta.input_kind === 'prefix-only') return copy.prefixOnly
  if (meta.input_kind === 'name-only') return copy.nameOnly
  return copy.exactTrigger
}

function isDynamicCommand(command) {
  return String(command?.response || '').includes('[[random:')
}

export default function CommandsPage() {
  const { locale } = useI18n()
  const ui = getUi(locale)
  const pageCopy = getCommandsCopy(locale)
  const triggerExamples = useMemo(() => getCommandTriggerExamples(), [])
  const promptIdeas = useMemo(() => getPromptIdeas(locale), [locale])
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [commands, setCommands] = useState([])
  const [loading, setLoading] = useState(false)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState([])
  const [editingCommand, setEditingCommand] = useState(null)
  const [quota, setQuota] = useState(null)
  const [togglingCommandIds, setTogglingCommandIds] = useState({})
  const toggleDesiredRef = useRef(new Map())
  const toggleRunningRef = useRef(new Set())
  const assistantCardRef = useRef(null)
  const promptInputRef = useRef(null)
  const speech = useSpeechToText({
    value: prompt,
    onChange: setPrompt,
    locale,
    onError: (code) => {
      if (code === 'unsupported') {
        toast.error(ui.voiceUnsupported)
        return
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        toast.error(ui.voiceDenied)
        return
      }
      if (code === 'aborted') return
      toast.error(ui.voiceError)
    },
  })

  const conversationHistory = useMemo(
    () => messages.map((message) => ({ role: message.role, content: message.content })),
    [messages]
  )
  const requestedMeta = useMemo(
    () => buildRequestedCommandMeta(commandInput, editingCommand),
    [commandInput, editingCommand]
  )
  const mode = requestedMeta.command_type
  const commandStats = useMemo(() => ({
    total: commands.length,
    active: commands.filter((entry) => entry.enabled).length,
    slash: commands.filter((entry) => entry.command_type === 'slash').length,
    dynamic: commands.filter((entry) => isDynamicCommand(entry)).length,
  }), [commands])

  useEffect(() => {
    if (!selectedGuildId) return
    loadCommands()
  }, [selectedGuildId])

  useEffect(() => {
    if (!editingCommand) return
    const timer = window.setTimeout(() => {
      assistantCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      promptInputRef.current?.focus()
      const length = promptInputRef.current?.value?.length || 0
      promptInputRef.current?.setSelectionRange?.(length, length)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [editingCommand?.id])

  async function loadCommands(showToast = false) {
    if (!selectedGuildId) return
    setLoading(true)
    try {
      const response = await commandsAPI.list(selectedGuildId)
      setCommands(response.data.commands || [])
      if (showToast) toast.success(ui.refresh)
    } catch (error) {
      if (showToast) toast.error(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingCommand(null)
    setCommandInput('')
    setPrompt('')
    setMessages([])
  }

  function openEdit(command) {
    setEditingCommand(command)
    setCommandInput(command.command_type === 'slash'
      ? `/${command.command_name || ''}`
      : (command.display_trigger || command.trigger || '!'))
    setPrompt('')
    setMessages([])
  }

  async function runAssistantFallback(userMessage) {
    const aiResponse = await aiAPI.chat({
      message: buildAssistantFallbackPrompt({
        commandInput,
        prompt: userMessage.content,
        currentCommand: editingCommand,
        locale,
      }),
      guild_id: selectedGuildId,
      conversation_history: [],
    })

    const assistantMessage = aiResponse.data.message || ui.assistantReplyFallback
    const draft = extractCommandDraft(assistantMessage)
    if (!draft) {
      throw new Error('Assistant command draft invalid')
    }

    const payload = buildFallbackPayload({
      draft,
      commandInput,
      currentCommand: editingCommand,
    })

    const saveResponse = editingCommand
      ? await commandsAPI.update(selectedGuildId, editingCommand.id, payload)
      : await commandsAPI.create(selectedGuildId, payload)

    return {
      assistant_message: assistantMessage.replace(/```command[\s\S]*?```/gi, '').trim() || ui.assistantReplyFallback,
      command: saveResponse.data.command,
      quota: aiResponse.data.quota || null,
      updated: !!editingCommand,
    }
  }

  async function sendAssistantPrompt(overridePrompt = '') {
    if (!selectedGuildId || assistantLoading) return

    const resolvedPrompt = String(overridePrompt || '').trim()
      ? String(overridePrompt || '').trim()
      : (speech.isListening ? await speech.stop() : prompt)
    const cleanPrompt = String(resolvedPrompt || '').trim()
    if (!cleanPrompt) return

    const userMessage = { role: 'user', content: cleanPrompt }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setAssistantLoading(true)
    setPrompt('')

    try {
      let response

      try {
        response = await commandsAPI.assistant(selectedGuildId, {
          mode,
          prefix: mode === 'prefix' ? requestedMeta.command_prefix : undefined,
          trigger: mode === 'prefix' && requestedMeta.isExactTrigger ? requestedMeta.trigger : undefined,
          command_name: requestedMeta.command_name || undefined,
          prompt: userMessage.content,
          command_id: editingCommand?.id,
          conversation_history: conversationHistory,
        })
      } catch (error) {
        if (!isRouteNotFound(error, '/commands/assistant')) {
          throw error
        }
        response = { data: await runAssistantFallback(userMessage) }
      }

      const assistantMessage = response.data.assistant_message || ui.assistantReplyFallback
      const command = response.data.command
      setMessages((current) => [...current, { role: 'assistant', content: assistantMessage }])
      setCommands((current) => upsertCommand(current, command))
      setEditingCommand(command)
      setQuota(response.data.quota || null)
      toast.success(response.data.updated ? ui.updated : ui.created)
    } catch (error) {
      toast.error(getErrorMessage(error))
      setMessages((current) => current.slice(0, -1))
      setPrompt(userMessage.content)
    } finally {
      setAssistantLoading(false)
    }
  }

  function setCommandEnabledLocally(commandId, enabled) {
    setCommands((current) => current.map((entry) => (
      entry.id === commandId ? { ...entry, enabled } : entry
    )))
    setEditingCommand((current) => (current?.id === commandId ? { ...current, enabled } : current))
  }

  async function flushToggleQueue(commandId) {
    if (!selectedGuildId || toggleRunningRef.current.has(commandId)) return
    toggleRunningRef.current.add(commandId)
    setTogglingCommandIds((current) => ({ ...current, [commandId]: true }))

    try {
      while (toggleDesiredRef.current.has(commandId)) {
        const targetEnabled = toggleDesiredRef.current.get(commandId)
        toggleDesiredRef.current.delete(commandId)
        const response = await commandsAPI.toggle(selectedGuildId, commandId, targetEnabled)
        const nextCommand = response.data.command
        if (nextCommand) {
          setCommands((current) => current.map((entry) => (
            entry.id === commandId ? nextCommand : entry
          )))
          setEditingCommand((current) => (current?.id === commandId ? nextCommand : current))
        } else {
          setCommandEnabledLocally(commandId, !!targetEnabled)
        }
      }
    } catch (error) {
      toggleDesiredRef.current.delete(commandId)
      toast.error(getErrorMessage(error))
      await loadCommands()
    } finally {
      toggleRunningRef.current.delete(commandId)
      setTogglingCommandIds((current) => {
        const next = { ...current }
        delete next[commandId]
        return next
      })
    }
  }

  function toggleCommand(command) {
    let nextEnabled = !command.enabled

    setCommands((current) => {
      const currentCommand = current.find((entry) => entry.id === command.id) || command
      nextEnabled = !currentCommand.enabled
      return current.map((entry) => (
        entry.id === command.id ? { ...entry, enabled: nextEnabled } : entry
      ))
    })
    setEditingCommand((current) => (current?.id === command.id ? { ...current, enabled: nextEnabled } : current))

    toggleDesiredRef.current.set(command.id, nextEnabled)
    flushToggleQueue(command.id)
  }

  async function deleteCommand(id) {
    if (!window.confirm(ui.deleteConfirm)) return
    try {
      await commandsAPI.delete(selectedGuildId, id)
      setCommands((current) => current.filter((entry) => entry.id !== id))
      if (editingCommand?.id === id) {
        setEditingCommand(null)
        setMessages([])
      }
      toast.success(ui.deleted)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <Hash className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">{ui.selectServerTitle}</p>
          <p className="text-white/40 mt-2">{ui.selectServerText}</p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            {ui.selectServerAction}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,24,40,0.94),rgba(16,16,32,0.98))] shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
        <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-neon-cyan/18 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-8 h-72 w-72 rounded-full bg-neon-violet/18 blur-3xl" />
        <div className="relative space-y-5 p-5 sm:p-7">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/85">
                <Sparkles className="h-3.5 w-3.5" />
                {pageCopy.heroBadge}
              </span>
              <div className="space-y-2">
                <h1 className="font-display text-2xl font-800 text-white sm:text-[2rem]">{ui.title}</h1>
                <p className="text-base text-white/88">{pageCopy.heroTitle}</p>
                <p className="max-w-2xl text-sm leading-6 text-white/46">
                  {guild?.name} - {pageCopy.heroText}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => loadCommands(true)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-mono text-white/72 transition-all hover:border-neon-cyan/30 hover:bg-white/[0.07] hover:text-white">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {ui.refresh}
              </button>
              <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-gradient-to-r from-neon-cyan/18 to-neon-violet/18 px-4 py-2.5 text-sm font-mono text-white transition-all hover:scale-[1.02] hover:border-neon-cyan/40">
                <Plus className="h-4 w-4" />
                {ui.new}
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: pageCopy.total, value: commandStats.total, tone: 'from-neon-cyan/18 to-neon-cyan/5' },
              { label: pageCopy.active, value: commandStats.active, tone: 'from-emerald-500/18 to-emerald-500/5' },
              { label: pageCopy.slash, value: commandStats.slash, tone: 'from-neon-violet/18 to-neon-violet/5' },
              { label: pageCopy.dynamic, value: commandStats.dynamic, tone: 'from-fuchsia-500/18 to-fuchsia-500/5' },
            ].map((card) => (
              <div key={card.label} className={`rounded-[24px] border border-white/10 bg-gradient-to-br ${card.tone} p-4 backdrop-blur-xl`}>
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/34">{card.label}</p>
                <p className="mt-3 font-display text-3xl font-800 text-white">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-4 sm:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/34">{pageCopy.detectTitle}</p>
                  <p className="max-w-xl text-sm leading-6 text-white/58">{pageCopy.detectText}</p>
                </div>
                <div className={`rounded-2xl border px-3 py-2 text-xs font-mono ${
                  mode === 'slash'
                    ? 'border-neon-violet/30 bg-neon-violet/10 text-violet-200'
                    : 'border-neon-cyan/25 bg-neon-cyan/10 text-cyan-200'
                }`}>
                  {describeRequestedMode(requestedMeta, pageCopy)}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.autoMode}</p>
                  <p className="mt-2 text-sm font-semibold text-white">{describeRequestedMode(requestedMeta, pageCopy)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.liveTrigger}</p>
                  <p className="mt-2 break-all font-mono text-sm text-white">{requestedMeta.trigger || requestedMeta.command_prefix}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.triggerExamples}</p>
                <div className="flex flex-wrap gap-2">
                  {triggerExamples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setCommandInput(example)}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-mono text-white/72 transition-all hover:-translate-y-0.5 hover:border-neon-cyan/28 hover:bg-neon-cyan/8 hover:text-neon-cyan"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-4 sm:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/34">{pageCopy.promptIdeas}</p>
                  <p className="text-sm leading-6 text-white/58">{pageCopy.assistantPanelText}</p>
                </div>
                <div className="rounded-2xl border border-neon-violet/25 bg-neon-violet/10 p-3 text-neon-violet">
                  <Bot className="h-4 w-4" />
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {promptIdeas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setPrompt(idea)}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm text-white/78 transition-all hover:-translate-y-0.5 hover:border-neon-violet/25 hover:bg-neon-violet/8"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_400px]">
        <div className="space-y-3">
          {commands.length === 0 && !loading && (
            <div className="glass-card p-10 text-center">
              <Terminal className="w-12 h-12 text-white/10 mx-auto mb-3" />
              <p className="text-white/40 mb-1">{ui.empty}</p>
              <p className="text-white/25 text-sm">{ui.emptyHint}</p>
            </div>
          )}

          {commands.map((command) => {
            const dynamic = isDynamicCommand(command)

            return (
              <motion.div
                key={command.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className={`group relative overflow-hidden rounded-[28px] border p-5 transition-all ${
                  editingCommand?.id === command.id
                    ? 'border-neon-cyan/32 bg-[linear-gradient(135deg,rgba(8,24,36,0.9),rgba(20,18,36,0.96))] shadow-[0_18px_60px_rgba(34,211,238,0.1)]'
                    : 'border-white/10 bg-[linear-gradient(135deg,rgba(17,24,39,0.9),rgba(20,20,32,0.96))] hover:-translate-y-0.5 hover:border-neon-violet/20 hover:shadow-[0_18px_50px_rgba(124,58,237,0.08)]'
                } ${!command.enabled ? 'opacity-65' : ''}`}
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.1),transparent_38%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.12),transparent_32%)] opacity-80" />
                <div className="relative flex items-start gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                    command.command_type === 'slash'
                      ? 'border-violet-500/20 bg-violet-500/12 text-violet-300'
                      : 'border-cyan-500/20 bg-cyan-500/12 text-cyan-300'
                  }`}>
                    {command.command_type === 'slash' ? <Slash className="h-5 w-5" /> : <Terminal className="h-5 w-5" />}
                  </div>

                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-all font-mono text-sm text-white">{command.display_trigger}</p>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${
                            command.command_type === 'slash'
                              ? 'border-violet-500/20 bg-violet-500/10 text-violet-300'
                              : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
                          }`}>
                            {command.command_type === 'slash' ? ui.slashBadge : ui.prefixBadge}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${
                            command.enabled
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : 'border-white/10 bg-white/[0.03] text-white/45'
                          }`}>
                            {command.enabled ? ui.active : ui.disabled}
                          </span>
                          {dynamic && (
                            <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-mono text-fuchsia-200">
                              {pageCopy.dynamicBadge}
                            </span>
                          )}
                          {command.embed_enabled && (
                            <span className="rounded-full border border-neon-violet/20 bg-neon-violet/10 px-2.5 py-1 text-[11px] font-mono text-violet-200">
                              {pageCopy.embedBadge}
                            </span>
                          )}
                          {command.require_args && (
                            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-mono text-amber-200">
                              {pageCopy.argsBadge}
                            </span>
                          )}
                          {command.delete_trigger && (
                            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-mono text-red-200">
                              {pageCopy.deleteBadge}
                            </span>
                          )}
                          {command.cooldown_ms > 0 && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-mono text-white/60">
                              {formatCooldownLabel(command.cooldown_ms)}
                            </span>
                          )}
                        </div>
                        {command.description ? <p className="text-sm text-white/58">{command.description}</p> : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(command)} className="rounded-xl p-2 text-white/35 transition-all hover:bg-neon-cyan/10 hover:text-neon-cyan" title={ui.edit}>
                          <Wand2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleCommand(command)}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-mono transition-all ${
                            command.enabled
                              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/18'
                              : 'border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/18'
                          } ${togglingCommandIds[command.id] ? 'animate-pulse' : ''}`}
                        >
                          {command.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                          <span>{command.enabled ? ui.active : ui.disabled}</span>
                        </button>
                        <button onClick={() => deleteCommand(command.id)} className="rounded-xl p-2 text-white/35 transition-all hover:bg-red-500/10 hover:text-red-400">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                      <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{pageCopy.responseLabel}</p>
                      <p className="whitespace-pre-wrap break-words text-sm text-white/78">{command.response}</p>
                    </div>

                    {command.usage_hint ? (
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{pageCopy.usageLabel}</p>
                        <p className="mt-2 text-sm text-white/68">{command.usage_hint}</p>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-white/36">
                      <span>{ui.uses}: {command.use_count || 0}</span>
                      <span>{ui.botReady}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

        <div ref={assistantCardRef} className="sticky top-24 h-fit overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(160deg,rgba(15,23,42,0.94),rgba(24,18,38,0.98))] p-5 shadow-[0_20px_60px_rgba(2,8,23,0.35)]">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="font-display text-lg font-700 text-white">{ui.assistantTitle}</p>
                <p className="text-sm text-white/45">{editingCommand ? ui.assistantEdit : ui.assistantCreate}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-neon-cyan/20 bg-gradient-to-br from-neon-cyan/16 to-neon-violet/16 text-neon-cyan">
                <Bot className="h-5 w-5" />
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/34">{pageCopy.assistantPanelTitle}</p>
                  <p className="text-sm leading-6 text-white/58">{pageCopy.assistantPanelText}</p>
                </div>
                <div className={`rounded-2xl border px-3 py-2 text-xs font-mono ${
                  mode === 'slash'
                    ? 'border-neon-violet/28 bg-neon-violet/10 text-violet-200'
                    : 'border-neon-cyan/25 bg-neon-cyan/10 text-cyan-200'
                }`}>
                  {describeRequestedMode(requestedMeta, pageCopy)}
                </div>
              </div>
            </div>

            {editingCommand && (
              <div className="rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-1 text-[11px] font-mono uppercase tracking-[0.18em] text-neon-cyan/70">{ui.editingTarget}</p>
                    <p className="break-all text-sm font-mono text-white">{editingCommand.display_trigger}</p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreate}
                    className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
                  >
                    {ui.cancelEdit}
                  </button>
                </div>
                {editingCommand.description ? (
                  <p className="text-sm text-white/55">{editingCommand.description}</p>
                ) : null}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-xs font-mono uppercase tracking-[0.18em] text-white/35">
                  {pageCopy.liveTrigger}
                </label>
                <input
                  className="input-field"
                  value={commandInput}
                  onChange={(event) => setCommandInput(event.target.value)}
                  placeholder={pageCopy.inputHelp}
                />
                <p className="mt-2 text-xs leading-5 text-white/36">{pageCopy.inputHelp}</p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{pageCopy.autoMode}</p>
                    <p className="mt-2 text-sm font-semibold text-white">{describeRequestedMode(requestedMeta, pageCopy)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{pageCopy.liveTrigger}</p>
                    <p className="mt-2 break-all text-sm font-mono text-white">{requestedMeta.trigger || requestedMeta.command_prefix}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 space-y-3 max-h-[300px] overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-sm leading-relaxed text-white/35">
                  <p>{editingCommand ? ui.assistantEditHint : ui.assistantCreateHint}</p>
                  <p className="mt-2">{editingCommand ? ui.assistantEditEmpty : ui.assistantCreateEmpty}</p>
                </div>
              ) : messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'border border-neon-cyan/15 bg-neon-cyan/10 text-white/85'
                    : 'border border-white/8 bg-white/[0.03] text-white/70'
                }`}>
                  {message.content}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.promptIdeas}</p>
              <div className="flex flex-wrap gap-2">
                {promptIdeas.map((idea, index) => (
                  <button
                    key={`${idea}-${index}`}
                    type="button"
                    onClick={() => setPrompt(idea)}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-mono text-white/68 transition-all hover:border-neon-violet/25 hover:bg-neon-violet/8 hover:text-violet-200"
                  >
                    {index === 0 ? pageCopy.helperPanel : index === 1 ? pageCopy.helperRandom : index === 2 ? pageCopy.helperTicket : pageCopy.helperAnnounce}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-mono uppercase tracking-[0.18em] text-white/35">{ui.promptLabel}</label>
              <div className="relative">
                <textarea
                  ref={promptInputRef}
                  className="input-field min-h-[148px] resize-y pr-[126px] sm:pr-[154px]"
                  placeholder={editingCommand ? ui.promptEditPlaceholder : ui.promptPlaceholder}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                  {(speech.isListening || speech.isRequestingPermission) && (
                    <VoiceMeter
                      bars={speech.audioBars}
                      active={speech.isListening}
                      accent={speech.isRequestingPermission ? 'amber' : 'cyan'}
                    />
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (speech.isListening) {
                        await speech.stop()
                        return
                      }
                      await speech.start()
                    }}
                    disabled={speech.isRequestingPermission}
                    className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all disabled:opacity-70 ${
                      speech.isListening
                        ? 'border-red-500/35 bg-red-500/14 text-red-200 shadow-[0_0_20px_rgba(248,113,113,0.2)]'
                        : speech.isRequestingPermission
                          ? 'border-amber-400/35 bg-amber-400/12 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.18)]'
                          : 'border-white/12 bg-white/[0.06] text-white/85 hover:border-neon-cyan/35 hover:bg-neon-cyan/10 hover:text-neon-cyan'
                    }`}
                    title={speech.isListening ? ui.voiceStop : ui.voiceStart}
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={sendAssistantPrompt}
                    disabled={assistantLoading || !prompt.trim()}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan text-white shadow-neon-violet transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {assistantLoading ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {(speech.isListening || speech.isRequestingPermission) && (
                <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <VoiceMeter
                        bars={speech.audioBars}
                        active={speech.isListening}
                        processing={speech.isRequestingPermission}
                        accent={speech.isRequestingPermission ? 'amber' : 'cyan'}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-mono ${speech.isRequestingPermission ? 'text-amber-300/80' : 'text-neon-cyan/75'}`}>
                          {speech.isRequestingPermission ? ui.voicePreparing : ui.voiceListening}
                        </p>
                        <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">{ui.voiceLiveTranscript}</p>
                        <p className="mt-2 truncate text-sm text-white/55">{speech.interimTranscript || '...'}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          await speech.stop()
                          promptInputRef.current?.focus()
                        }}
                        disabled={speech.isRequestingPermission}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-mono text-white/70 transition-all hover:border-white/20 hover:text-white disabled:opacity-50"
                      >
                        {ui.voiceStopDictation}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const transcript = await speech.stop()
                          if (String(transcript || '').trim()) {
                            await sendAssistantPrompt(transcript)
                          }
                        }}
                        disabled={speech.isRequestingPermission || assistantLoading}
                        className="rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-2.5 text-xs font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"
                      >
                        {ui.voiceSendTranscript}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {quota?.enabled && (
              <div className="rounded-2xl border border-emerald-500/18 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-200">
                <span className="font-mono">{pageCopy.quotaLabel}:</span> {quota.remainingTokens}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
