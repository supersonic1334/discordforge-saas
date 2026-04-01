import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Hash,
  Mic,
  Plus,
  RefreshCw,
  Save,
  Send,
  Shield,
  Slash,
  Sparkles,
  Square,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wand2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { aiAPI, botAPI, commandsAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { useSpeechToText } from '../hooks/useSpeechToText'

const UI = {
  fr: {
    title: 'Commandes',
    subtitle: 'Tu choisis le préfixe ou le slash, puis tu décris la commande à l’assistant.',
    selectServerTitle: "Choisis d'abord un serveur",
    selectServerText: 'Les commandes se créent serveur par serveur.',
    selectServerAction: 'Choisir un serveur',
    new: 'Nouvelle commande IA',
    edit: 'Modifier avec IA',
    refresh: 'Actualiser',
    assistantTitle: 'Assistant de commandes',
    assistantCreate: 'Création guidée',
    assistantEdit: 'Modification guidée',
    editingTarget: 'Commande en cours',
    cancelEdit: 'Annuler',
    assistantCreateHint: 'Explique simplement ce que tu veux. Exemple : crée une commande bonjour qui répond bonjour {mention}.',
    assistantCreateEmpty: "Le chat IA va créer la commande automatiquement et l'enregistrer directement.",
    assistantEditHint: 'Décris seulement la modification à faire. La commande actuelle sera mise à jour directement.',
    assistantEditEmpty: "Écris ce que tu veux changer. L'assistant appliquera la modification sur cette commande existante.",
    assistantHint: 'Explique simplement ce que tu veux. Exemple : crée une commande bonjour qui répond bonjour {mention}.',
    assistantEmpty: "Le chat IA va créer la commande automatiquement et l'enregistrer directement.",
    modeLabel: 'Type de commande',
    modePrefix: 'Préfixe texte',
    modeSlash: 'Slash Discord',
    prefixLabel: 'Commande texte ou préfixe',
    prefixHint: 'Exemple : !music ou !',
    slashNameLabel: 'Nom de la commande slash',
    slashNameHint: 'Exemple : music',
    promptLabel: 'Ce que tu veux',
    promptPlaceholder: 'Exemple : crée une commande annonce qui répond en embed avec le titre Infos du serveur',
    promptEditPlaceholder: 'Exemple : remplace la réponse par une version plus courte et plus propre',
    voiceStart: 'Parler',
    voiceStop: 'Stop micro',
    voiceListening: 'Dictee en cours',
    voicePreparing: 'Autorisation micro...',
    voiceStopDictation: 'Arreter',
    voiceSendTranscript: 'Envoyer des que pret',
    voiceLiveTranscript: 'Micro simple',
    voiceTranscriptPlaceholder: 'Parle librement. Apres 3 secondes de silence, le texte sera insere ici.',
    voiceUnsupported: 'Micro non pris en charge sur ce navigateur.',
    voiceDenied: 'Autorise le micro pour utiliser la dictée.',
    voiceError: 'La dictée vocale a rencontré un problème.',
    saveTrigger: 'Enregistrer le declencheur',
    saveTriggerHint: 'Tu peux changer seulement le declencheur et garder le reste.',
    triggerSaved: 'Declencheur mis a jour',
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
    voiceListening: 'Dictation in progress',
    voicePreparing: 'Requesting mic...',
    voiceStopDictation: 'Stop',
    voiceSendTranscript: 'Send when ready',
    voiceLiveTranscript: 'Simple microphone',
    voiceTranscriptPlaceholder: 'Speak naturally. After 3 seconds of silence, the text is inserted here.',
    voiceUnsupported: 'Microphone is not supported on this browser.',
    voiceDenied: 'Allow microphone access to use voice dictation.',
    voiceError: 'Voice dictation ran into an issue.',
    saveTrigger: 'Save trigger only',
    saveTriggerHint: 'You can change only the trigger and keep the rest intact.',
    triggerSaved: 'Trigger updated',
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
    voiceListening: 'Dictado en curso',
    voicePreparing: 'Autorizando micro...',
    voiceStopDictation: 'Detener',
    voiceSendTranscript: 'Enviar cuando este listo',
    voiceLiveTranscript: 'Micro simple',
    voiceTranscriptPlaceholder: 'Habla con normalidad. Tras 3 segundos de silencio, el texto se inserta aqui.',
    voiceUnsupported: 'El micro no es compatible con este navegador.',
    voiceDenied: 'Autoriza el micro para usar la dictado por voz.',
    voiceError: 'El dictado por voz encontro un problema.',
    saveTrigger: 'Guardar solo trigger',
    saveTriggerHint: 'Puedes cambiar solo el trigger y conservar el resto.',
    triggerSaved: 'Trigger actualizado',
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

Object.assign(UI.fr, {
  subtitle: 'Tu choisis le préfixe ou le slash, puis tu décris la commande à l’assistant.',
  selectServerText: 'Les commandes se créent serveur par serveur.',
  assistantCreate: 'Création guidée',
  assistantEdit: 'Modification guidée',
  assistantCreateHint: 'Explique simplement ce que tu veux. Exemple : crée une commande bonjour qui répond bonjour {mention}.',
  assistantCreateEmpty: "Le chat IA va créer la commande automatiquement et l'enregistrer directement.",
  assistantEditHint: 'Décris seulement la modification à faire. La commande actuelle sera mise à jour directement.',
  assistantEditEmpty: "Écris ce que tu veux changer. L'assistant appliquera la modification sur cette commande existante.",
  assistantHint: 'Explique simplement ce que tu veux. Exemple : crée une commande bonjour qui répond bonjour {mention}.',
  assistantEmpty: "Le chat IA va créer la commande automatiquement et l'enregistrer directement.",
  modePrefix: 'Préfixe texte',
  prefixLabel: 'Commande texte ou préfixe',
  prefixHint: 'Exemple : !music ou !',
  slashNameHint: 'Exemple : music',
  promptPlaceholder: 'Exemple : crée une commande annonce qui répond en embed avec le titre Infos du serveur',
  promptEditPlaceholder: 'Exemple : remplace la réponse par une version plus courte et plus propre',
  voiceListening: 'Dictee en cours',
  voicePreparing: 'Autorisation du micro...',
  voiceStopDictation: 'Arreter',
  voiceSendTranscript: 'Envoyer des que pret',
  voiceDenied: 'Autorise le micro pour utiliser la dictée.',
  voiceError: 'La dictée vocale a rencontré un problème.',
  saveTrigger: 'Enregistrer le declencheur',
  saveTriggerHint: 'Tu peux changer seulement le declencheur et garder le reste.',
  triggerSaved: 'Declencheur mis a jour',
  send: 'Générer la commande',
  generating: 'Génération...',
  created: 'Commande créée',
  updated: 'Commande mise à jour',
  deleted: 'Commande supprimée',
  emptyHint: "Crée la première avec l'assistant IA.",
  disabled: 'Désactivée',
  assistantReplyFallback: 'Commande préparée et enregistrée.',
  prefixBadge: 'Préfixe',
  botReady: 'La commande est enregistrée et synchronisée automatiquement avec le bot.',
})

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

function getCommandInputValue(command) {
  if (!command) return ''
  return command.command_type === 'slash'
    ? `/${command.command_name || ''}`
    : (command.display_trigger || command.trigger || '!')
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

function extractUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s<>"']+/gi)
  return [...new Set((matches || []).map((entry) => entry.trim()).filter(Boolean))]
}

function textContainsAny(text, keywords = []) {
  const source = String(text || '').toLowerCase()
  return keywords.some((keyword) => source.includes(String(keyword || '').toLowerCase()))
}

function promptRequestsMediaShare(value) {
  return textContainsAny(value, [
    'image',
    'photo',
    'gif',
    'illustration',
    'logo',
    'banner',
    'avatar',
    'thumbnail',
    'poster',
    'wallpaper',
    'meme',
    'affiche cette image',
    'afficher cette image',
    'envoie cette image',
    'envoyer cette image',
    'poste cette image',
    'montrer cette image',
    'send this image',
    'show this image',
    'post this image',
    'display this image',
    'manda esta imagen',
    'muestra esta imagen',
    'envia esta imagen',
  ])
}

function promptRequestsOnlyMedia(value) {
  return textContainsAny(value, [
    'envoie cette image',
    'envoyer cette image',
    'affiche cette image',
    'afficher cette image',
    'poste cette image',
    'send this image',
    'show this image',
    'display this image',
    'manda esta imagen',
    'muestra esta imagen',
    'envia esta imagen',
    'uniquement le lien',
    'juste le lien',
    'only the link',
    'solo el enlace',
  ])
}

function responseContainsAnyUrl(response, urls) {
  const text = String(response || '')
  return urls.some((url) => text.includes(url))
}

function enforceDraftIntent(draft, userPrompt) {
  if (!draft || typeof draft !== 'object') return draft

  const nextDraft = { ...draft }
  const urls = extractUrls(userPrompt)
  if (urls.length && promptRequestsMediaShare(userPrompt) && !responseContainsAnyUrl(nextDraft.response, urls)) {
    const primaryUrl = urls[0]
    const mustSendOnlyMedia = promptRequestsOnlyMedia(userPrompt)
    const currentResponse = String(nextDraft.response || '').trim()

    nextDraft.response = mustSendOnlyMedia
      ? primaryUrl
      : (currentResponse ? `${currentResponse}\n${primaryUrl}` : primaryUrl)

    if (!String(nextDraft.description || '').trim()) {
      nextDraft.description = 'Envoie le media demande'
    }

    if (mustSendOnlyMedia) {
      nextDraft.embed_enabled = false
      nextDraft.embed_title = ''
    }
  }

  return nextDraft
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
  const requestedMeta = resolveDirectEditMeta(commandInput, currentCommand)
  const pinRequestedCommand = shouldPinRequestedCommand(commandInput, currentCommand)
  const commandType = pinRequestedCommand
    ? requestedMeta.command_type
    : (draft?.command_type || currentCommand?.command_type || requestedMeta.command_type)
  const commandPrefix = commandType === 'slash'
    ? '/'
    : (pinRequestedCommand ? requestedMeta.command_prefix : normalizeCommandPrefix(draft?.command_prefix || currentCommand?.command_prefix || requestedMeta.command_prefix))
  const commandName = (pinRequestedCommand ? requestedMeta.command_name : '') || sanitizeCommandName(
    draft?.command_name || currentCommand?.command_name || 'commande',
    commandType
  )
  const trigger = pinRequestedCommand && requestedMeta.isExactTrigger
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

function shouldPinRequestedCommand(commandInput, currentCommand) {
  const requested = normalizeCommandInput(commandInput)
  if (!requested) return false
  if (!currentCommand) return true
  return requested !== normalizeCommandInput(getCommandInputValue(currentCommand))
}

function hasCommandInputChanged(commandInput, currentCommand) {
  if (!currentCommand) return false
  return normalizeCommandInput(commandInput) !== normalizeCommandInput(getCommandInputValue(currentCommand))
}

function resolveDirectEditMeta(commandInput, currentCommand) {
  const requestedMeta = buildRequestedCommandMeta(commandInput, currentCommand)
  const rawInput = normalizeCommandInput(commandInput)

  if (!currentCommand || !rawInput || requestedMeta.input_kind !== 'name-only') {
    return requestedMeta
  }

  if (currentCommand.command_type === 'slash') {
    const commandName = sanitizeCommandName(rawInput, 'slash')
    return {
      ...requestedMeta,
      command_type: 'slash',
      command_prefix: '/',
      command_name: commandName,
      trigger: commandName ? `/${commandName}` : '',
      isExactTrigger: true,
      input_kind: 'slash',
    }
  }

  const commandPrefix = normalizeCommandPrefix(currentCommand.command_prefix || '!')
  const commandName = sanitizeCommandName(rawInput, 'prefix')

  return {
    ...requestedMeta,
    command_type: 'prefix',
    command_prefix: commandPrefix,
    command_name: commandName,
    trigger: commandName ? buildCommandTrigger('prefix', commandPrefix, commandName) : '',
    isExactTrigger: true,
    input_kind: 'trigger',
  }
}

function canDirectlySaveTrigger(commandInput, currentCommand) {
  if (!hasCommandInputChanged(commandInput, currentCommand)) return false
  const nextMeta = resolveDirectEditMeta(commandInput, currentCommand)
  if (!nextMeta.trigger) return false
  if (nextMeta.command_type === 'slash') return Boolean(nextMeta.command_name)
  return Boolean(nextMeta.command_name)
}

function buildAssistantFallbackPrompt({ commandInput, prompt, currentCommand, locale }) {
  const language = String(locale || 'fr').toLowerCase().startsWith('fr')
    ? 'francais'
    : String(locale || 'fr').toLowerCase().startsWith('es')
      ? 'espagnol'
      : 'anglais'
  const requestedMeta = resolveDirectEditMeta(commandInput, currentCommand)
  const pinRequestedCommand = shouldPinRequestedCommand(commandInput, currentCommand)
  const requestedInstruction = pinRequestedCommand
    ? (requestedMeta.command_type === 'slash'
      ? (requestedMeta.command_name ? `Nom exact impose pour la commande slash: ${requestedMeta.command_name}` : '')
      : requestedMeta.isExactTrigger
        ? `Declencheur texte exact impose: ${requestedMeta.trigger}`
        : requestedMeta.command_name
          ? `Nom de commande voulu: ${requestedMeta.command_name} (prefixe ${requestedMeta.command_prefix})`
          : `Prefixe impose: ${requestedMeta.command_prefix}`)
    : (currentCommand ? 'Tu peux conserver ou changer le declencheur si la demande implique une vraie refonte.' : '')

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
- pour les commandes de contenu (blagues, faits, citations), utilise soit [[combo: segment 1A || segment 1B || segment 1C :: segment 2A || segment 2B || segment 2C :: segment 3A || segment 3B || segment 3C]] soit au moins [[random: option 1 || option 2 || option 3 || option 4 || option 5 || option 6 || option 7 || option 8 || option 9 || option 10]]
- les descriptions doivent etre concises mais engageantes
- Les reponses doivent etre riches, bien formatees, et professionnelles.
- si tu modifies une commande existante, retourne sa version finale complete, pas juste une variation minimale de l'ancienne.
- le nom du declencheur est seulement un identifiant, pas une consigne de theme
- suis le prompt utilisateur avant toute interpretation du nom de commande
- si le prompt contient un lien, une image, un GIF ou un media a envoyer, conserve exactement ce contenu dans la reponse finale
- si le prompt demande d'envoyer une image, ne remplace jamais ca par une blague ou un texte inspire du nom du declencheur

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
      heroBadge: 'Guided flow',
      heroTitle: 'Create a command in three clear steps.',
      heroText: 'Write the trigger, describe what you want, then generate it. The page keeps the final Discord format aligned automatically.',
      detectTitle: 'Trigger preview',
      detectText: 'You immediately see how the command will be stored before generating it.',
      triggerExamples: 'Trigger ideas',
      promptIdeas: 'Quick ideas',
      autoMode: 'Auto-detected mode',
      liveTrigger: 'Saved trigger',
      inputHelp: 'Type the exact trigger or the future command name. Examples: /help, !joke, *ticket, ?rules, ^^panel.',
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
      assistantPanelText: 'Pick an idea or describe your own command. The assistant handles the rest.',
      quotaLabel: 'AI budget left',
      total: 'Commands',
      active: 'Online',
      slash: 'Slash',
      dynamic: 'Varied',
      systemSectionTitle: 'Built-in Discord commands',
      systemSectionText: 'These commands are provisioned by default, cannot be deleted, and run natively on Discord.',
      customSectionTitle: 'AI and custom commands',
      customSectionText: 'These commands remain fully editable with the assistant.',
      systemBadge: 'Built-in',
      systemConfigTitle: 'Native settings',
      systemSave: 'Save settings',
      systemSaving: 'Saving...',
      logChannel: 'Log channel',
      noLogChannel: 'No log channel',
      dmUser: 'Send DM to user',
      requireReason: 'Require reason',
      deleteMessageSeconds: 'Delete message history (seconds)',
      defaultTimeoutMinutes: 'Default timeout (minutes)',
      defaultPoints: 'Default warning points',
      defaultAmount: 'Default amount',
      minAmount: 'Minimum',
      maxAmount: 'Maximum',
      visibilityLabel: 'Success visibility',
      visibilityEphemeral: 'Private',
      visibilityPublic: 'Public',
      builtInLocked: 'The trigger and native action are locked. You can only toggle and configure this command.',
      stepOne: '1. Trigger',
      stepTwo: '2. Prompt',
      stepThree: '3. Generate',
    }
  }

  if (key === 'es') {
    return {
      heroBadge: 'Flujo guiado',
      heroTitle: 'Crea un comando en tres pasos claros.',
      heroText: 'Escribe el trigger, describe lo que quieres y genera. La pagina mantiene automaticamente el formato final de Discord.',
      detectTitle: 'Vista previa del trigger',
      detectText: 'Ves al instante como se guardara el comando antes de generarlo.',
      triggerExamples: 'Ideas de trigger',
      promptIdeas: 'Ideas rapidas',
      autoMode: 'Modo detectado',
      liveTrigger: 'Trigger guardado',
      inputHelp: 'Escribe el trigger exacto o el futuro nombre del comando. Ejemplos: /help, !broma, *ticket, ?reglas, ^^panel.',
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
      assistantPanelText: 'Elige una idea o describe tu comando. El asistente se encarga del resto.',
      quotaLabel: 'Cuota IA restante',
      total: 'Comandos',
      active: 'Activos',
      slash: 'Slash',
      dynamic: 'Variables',
      systemSectionTitle: 'Comandos Discord integrados',
      systemSectionText: 'Estos comandos se crean por defecto, no se pueden borrar y se ejecutan de forma nativa en Discord.',
      customSectionTitle: 'Comandos IA y personalizados',
      customSectionText: 'Estos comandos siguen siendo editables con el asistente.',
      systemBadge: 'Integrado',
      systemConfigTitle: 'Ajustes nativos',
      systemSave: 'Guardar ajustes',
      systemSaving: 'Guardando...',
      logChannel: 'Canal de logs',
      noLogChannel: 'Sin canal de logs',
      dmUser: 'Enviar DM al usuario',
      requireReason: 'Exigir motivo',
      deleteMessageSeconds: 'Borrar historial (segundos)',
      defaultTimeoutMinutes: 'Timeout por defecto (minutos)',
      defaultPoints: 'Puntos por defecto',
      defaultAmount: 'Cantidad por defecto',
      minAmount: 'Minimo',
      maxAmount: 'Maximo',
      visibilityLabel: 'Visibilidad del exito',
      visibilityEphemeral: 'Privado',
      visibilityPublic: 'Publico',
      builtInLocked: 'El trigger y la accion nativa estan bloqueados. Solo puedes activar o configurar este comando.',
      stepOne: '1. Trigger',
      stepTwo: '2. Pedido',
      stepThree: '3. Generar',
    }
  }

  return {
    heroBadge: 'Flux guide',
    heroTitle: 'Cree une commande en trois etapes claires.',
    heroText: 'Ecris le declencheur, decris ce que tu veux, puis genere. La page garde automatiquement le bon format Discord.',
    detectTitle: 'Apercu du declencheur',
    detectText: 'Tu vois tout de suite comment la commande sera enregistree avant la generation.',
    triggerExamples: 'Idees de declencheur',
    promptIdeas: 'Idees rapides',
    autoMode: 'Mode detecte',
    liveTrigger: 'Declencheur final',
    inputHelp: 'Ecris le declencheur exact ou le futur nom de commande. Exemples: /help, !blague, *ticket, ?regles, ^^panel.',
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
    assistantPanelText: 'Choisis une idee ou ecris ta demande. L assistant s occupe du reste.',
    quotaLabel: 'Quota IA restant',
    total: 'Commandes',
    active: 'Actives',
    slash: 'Slash',
    dynamic: 'Variables',
    systemSectionTitle: 'Commandes Discord par defaut',
    systemSectionText: 'Ces commandes sont creees automatiquement, non supprimables, et executees nativement sur Discord.',
    customSectionTitle: 'Commandes IA et personnalisees',
    customSectionText: 'Ces commandes restent modifiables librement avec l assistant.',
    systemBadge: 'Defaut',
    systemConfigTitle: 'Reglages natifs',
    systemSave: 'Sauvegarder',
    systemSaving: 'Sauvegarde...',
    logChannel: 'Salon de logs',
    noLogChannel: 'Aucun salon de logs',
    dmUser: 'Envoyer un DM au membre',
    requireReason: 'Raison obligatoire',
    deleteMessageSeconds: 'Historique a effacer (secondes)',
    defaultTimeoutMinutes: 'Timeout par defaut (minutes)',
    defaultPoints: 'Points par defaut',
    defaultAmount: 'Quantite par defaut',
    minAmount: 'Minimum',
    maxAmount: 'Maximum',
    visibilityLabel: 'Visibilite du succes',
    visibilityEphemeral: 'Prive',
    visibilityPublic: 'Public',
    builtInLocked: 'Le declencheur et l action native sont verrouilles. Tu peux seulement activer ou configurer cette commande.',
    stepOne: '1. Declencheur',
    stepTwo: '2. Demande',
    stepThree: '3. Generer',
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

function isTextLikeChannel(channel) {
  return [0, 5, 11, 12, 15].includes(Number(channel?.type))
}

function buildSystemDraft(command) {
  const config = command?.action_config || {}
  return {
    log_channel_id: config.log_channel_id || '',
    dm_user: Boolean(config.dm_user),
    require_reason: Boolean(config.require_reason),
    delete_message_seconds: String(config.delete_message_seconds ?? 0),
    default_timeout_minutes: String(Math.max(1, Math.round(Number(config.default_duration_ms || 600000) / 60000))),
    default_points: String(config.default_points ?? 1),
    default_amount: String(config.default_amount ?? 20),
    min_amount: String(config.min_amount ?? 1),
    max_amount: String(config.max_amount ?? 100),
    success_visibility: config.success_visibility === 'public' ? 'public' : 'ephemeral',
  }
}

function clampIntegerString(value, min, max, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function buildSystemActionConfig(command, draft) {
  const currentConfig = command?.action_config || {}
  const base = {
    log_channel_id: String(draft?.log_channel_id || '').trim(),
    success_visibility: draft?.success_visibility === 'public' ? 'public' : 'ephemeral',
  }

  switch (command?.action_type) {
    case 'clear_messages':
      return {
        ...currentConfig,
        ...base,
        min_amount: clampIntegerString(draft?.min_amount, 1, 100, Number(currentConfig.min_amount || 1)),
        max_amount: clampIntegerString(draft?.max_amount, 1, 100, Number(currentConfig.max_amount || 100)),
        default_amount: clampIntegerString(draft?.default_amount, 1, 100, Number(currentConfig.default_amount || 20)),
      }

    case 'ban_member':
      return {
        ...currentConfig,
        ...base,
        dm_user: Boolean(draft?.dm_user),
        require_reason: Boolean(draft?.require_reason),
        delete_message_seconds: clampIntegerString(draft?.delete_message_seconds, 0, 604800, Number(currentConfig.delete_message_seconds || 0)),
      }

    case 'kick_member':
    case 'untimeout_member':
      return {
        ...currentConfig,
        ...base,
        dm_user: Boolean(draft?.dm_user),
        require_reason: Boolean(draft?.require_reason),
      }

    case 'timeout_member':
      return {
        ...currentConfig,
        ...base,
        dm_user: Boolean(draft?.dm_user),
        require_reason: Boolean(draft?.require_reason),
        default_duration_ms: clampIntegerString(draft?.default_timeout_minutes, 1, 40320, Math.max(1, Math.round(Number(currentConfig.default_duration_ms || 600000) / 60000))) * 60000,
      }

    case 'warn_member':
      return {
        ...currentConfig,
        ...base,
        dm_user: Boolean(draft?.dm_user),
        require_reason: Boolean(draft?.require_reason),
        default_points: clampIntegerString(draft?.default_points, 1, 20, Number(currentConfig.default_points || 1)),
      }

    default:
      return {
        ...currentConfig,
        ...base,
      }
  }
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
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(false)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState([])
  const [editingCommand, setEditingCommand] = useState(null)
  const [quota, setQuota] = useState(null)
  const [togglingCommandIds, setTogglingCommandIds] = useState({})
  const [systemDrafts, setSystemDrafts] = useState({})
  const [savingSystemIds, setSavingSystemIds] = useState({})
  const toggleDesiredRef = useRef(new Map())
  const toggleRunningRef = useRef(new Set())
  const assistantCardRef = useRef(null)
  const promptInputRef = useRef(null)
  const voiceToastId = 'commands-voice'
  const speech = useSpeechToText({
    value: prompt,
    onChange: setPrompt,
    locale,
    onError: (code) => {
      if (code === 'unsupported') {
        toast.error(ui.voiceUnsupported, { id: voiceToastId })
        return
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        toast.error(ui.voiceDenied, { id: voiceToastId })
        return
      }
      if (code === 'aborted') return
      toast.error(ui.voiceError, { id: voiceToastId })
    },
  })

  const conversationHistory = useMemo(
    () => messages.map((message) => ({ role: message.role, content: message.content })),
    [messages]
  )
  const directEditMeta = useMemo(
    () => resolveDirectEditMeta(commandInput, editingCommand),
    [commandInput, editingCommand]
  )
  const triggerChanged = useMemo(
    () => hasCommandInputChanged(commandInput, editingCommand),
    [commandInput, editingCommand]
  )
  const canSaveTriggerOnly = useMemo(
    () => canDirectlySaveTrigger(commandInput, editingCommand),
    [commandInput, editingCommand]
  )
  const mode = directEditMeta.command_type
  const systemCommands = useMemo(
    () => commands.filter((entry) => entry.is_system),
    [commands]
  )
  const customCommands = useMemo(
    () => commands.filter((entry) => !entry.is_system),
    [commands]
  )
  const textChannels = useMemo(
    () => channels.filter((channel) => isTextLikeChannel(channel)),
    [channels]
  )
  const commandStats = useMemo(() => ({
    total: commands.length,
    active: commands.filter((entry) => entry.enabled).length,
    slash: commands.filter((entry) => entry.command_type === 'slash').length,
    dynamic: commands.filter((entry) => isDynamicCommand(entry)).length,
  }), [commands])

  useEffect(() => {
    if (!selectedGuildId) {
      setCommands([])
      setChannels([])
      setSystemDrafts({})
      return
    }
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
      const [commandsResponse, channelsResponse] = await Promise.all([
        commandsAPI.list(selectedGuildId),
        botAPI.channels(selectedGuildId),
      ])
      const nextCommands = commandsResponse.data.commands || []
      setCommands(nextCommands)
      setChannels(channelsResponse.data.channels || [])
      setSystemDrafts(
        Object.fromEntries(
          nextCommands
            .filter((command) => command.is_system)
            .map((command) => [command.id, buildSystemDraft(command)])
        )
      )
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
    if (command?.is_system) return
    setEditingCommand(command)
    setCommandInput(getCommandInputValue(command))
    setPrompt('')
    setMessages([])
  }

  async function saveCommandTriggerOnly() {
    if (!selectedGuildId || !editingCommand || assistantLoading || !canSaveTriggerOnly) return

    setAssistantLoading(true)

    try {
      const response = await commandsAPI.update(selectedGuildId, editingCommand.id, {
        trigger: directEditMeta.trigger,
        command_type: directEditMeta.command_type,
        command_prefix: directEditMeta.command_prefix,
        command_name: directEditMeta.command_name,
      })

      const command = response.data.command
      setCommands((current) => upsertCommand(current, command))
      setEditingCommand(command)
      setCommandInput(getCommandInputValue(command))
      toast.success(ui.triggerSaved)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setAssistantLoading(false)
    }
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
    const draft = enforceDraftIntent(extractCommandDraft(assistantMessage), userMessage.content)
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
      : (speech.isListening || speech.isProcessing ? await speech.stop() : prompt)
    const cleanPrompt = String(resolvedPrompt || '').trim()
    if (!cleanPrompt) {
      if (editingCommand && canSaveTriggerOnly) {
        await saveCommandTriggerOnly()
      }
      return
    }

    const userMessage = { role: 'user', content: cleanPrompt }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setAssistantLoading(true)
    setPrompt('')

    try {
      let response

      try {
        const pinRequestedCommand = shouldPinRequestedCommand(commandInput, editingCommand)
        response = await commandsAPI.assistant(selectedGuildId, {
          mode,
          prefix: mode === 'prefix' ? directEditMeta.command_prefix : undefined,
          trigger: mode === 'prefix' && pinRequestedCommand && directEditMeta.isExactTrigger ? directEditMeta.trigger : undefined,
          command_name: pinRequestedCommand ? (directEditMeta.command_name || undefined) : undefined,
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
      setCommandInput(getCommandInputValue(command))
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

  const stopCommandDictation = async () => {
    await speech.stop()
    promptInputRef.current?.focus()
  }

  const sendCommandDictation = async () => {
    const transcript = await speech.stop()
    if (String(transcript || '').trim()) {
      await sendAssistantPrompt(transcript)
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

  function updateSystemDraft(commandId, patch) {
    setSystemDrafts((current) => ({
      ...current,
      [commandId]: {
        ...(current[commandId] || {}),
        ...patch,
      },
    }))
  }

  async function saveSystemCommand(command) {
    if (!selectedGuildId || !command?.is_system) return

    const draft = systemDrafts[command.id] || buildSystemDraft(command)
    setSavingSystemIds((current) => ({ ...current, [command.id]: true }))

    try {
      const response = await commandsAPI.update(selectedGuildId, command.id, {
        action_config: buildSystemActionConfig(command, draft),
      })
      const nextCommand = response.data.command
      setCommands((current) => current.map((entry) => (entry.id === nextCommand.id ? nextCommand : entry)))
      setEditingCommand((current) => (current?.id === nextCommand.id ? nextCommand : current))
      setSystemDrafts((current) => ({ ...current, [nextCommand.id]: buildSystemDraft(nextCommand) }))
      toast.success(ui.updated)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingSystemIds((current) => {
        const next = { ...current }
        delete next[command.id]
        return next
      })
    }
  }

  function renderSystemConfig(command) {
    if (!command?.is_system) return null
    const draft = systemDrafts[command.id] || buildSystemDraft(command)

    return (
      <div className="rounded-[24px] border border-amber-400/15 bg-amber-500/[0.04] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-amber-200/75">{pageCopy.systemConfigTitle}</p>
            <p className="mt-2 text-xs leading-5 text-white/45">{pageCopy.builtInLocked}</p>
          </div>
          <button
            type="button"
            onClick={() => saveSystemCommand(command)}
            disabled={Boolean(savingSystemIds[command.id])}
            className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-2 text-xs font-mono text-amber-100 transition-all hover:border-amber-300/35 hover:bg-amber-400/16 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Save className={`h-4 w-4 ${savingSystemIds[command.id] ? 'animate-pulse' : ''}`} />
            {savingSystemIds[command.id] ? pageCopy.systemSaving : pageCopy.systemSave}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.logChannel}</span>
            <select
              className="input-field"
              value={draft.log_channel_id}
              onChange={(event) => updateSystemDraft(command.id, { log_channel_id: event.target.value })}
            >
              <option value="">{pageCopy.noLogChannel}</option>
              {textChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  #{channel.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.visibilityLabel}</span>
            <select
              className="input-field"
              value={draft.success_visibility}
              onChange={(event) => updateSystemDraft(command.id, { success_visibility: event.target.value })}
            >
              <option value="ephemeral">{pageCopy.visibilityEphemeral}</option>
              <option value="public">{pageCopy.visibilityPublic}</option>
            </select>
          </label>
        </div>

        {['ban_member', 'kick_member', 'timeout_member', 'untimeout_member', 'warn_member'].includes(command.action_type) && (
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/72">
              <input
                type="checkbox"
                checked={draft.dm_user}
                onChange={(event) => updateSystemDraft(command.id, { dm_user: event.target.checked })}
              />
              {pageCopy.dmUser}
            </label>

            <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/72">
              <input
                type="checkbox"
                checked={draft.require_reason}
                onChange={(event) => updateSystemDraft(command.id, { require_reason: event.target.checked })}
              />
              {pageCopy.requireReason}
            </label>
          </div>
        )}

        {command.action_type === 'ban_member' && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.deleteMessageSeconds}</span>
              <input
                className="input-field"
                type="number"
                min="0"
                max="604800"
                value={draft.delete_message_seconds}
                onChange={(event) => updateSystemDraft(command.id, { delete_message_seconds: event.target.value })}
              />
            </label>
          </div>
        )}

        {command.action_type === 'timeout_member' && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.defaultTimeoutMinutes}</span>
              <input
                className="input-field"
                type="number"
                min="1"
                max="40320"
                value={draft.default_timeout_minutes}
                onChange={(event) => updateSystemDraft(command.id, { default_timeout_minutes: event.target.value })}
              />
            </label>
          </div>
        )}

        {command.action_type === 'warn_member' && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.defaultPoints}</span>
              <input
                className="input-field"
                type="number"
                min="1"
                max="20"
                value={draft.default_points}
                onChange={(event) => updateSystemDraft(command.id, { default_points: event.target.value })}
              />
            </label>
          </div>
        )}

        {command.action_type === 'clear_messages' && (
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.minAmount}</span>
              <input
                className="input-field"
                type="number"
                min="1"
                max="100"
                value={draft.min_amount}
                onChange={(event) => updateSystemDraft(command.id, { min_amount: event.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.defaultAmount}</span>
              <input
                className="input-field"
                type="number"
                min="1"
                max="100"
                value={draft.default_amount}
                onChange={(event) => updateSystemDraft(command.id, { default_amount: event.target.value })}
              />
            </label>
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{pageCopy.maxAmount}</span>
              <input
                className="input-field"
                type="number"
                min="1"
                max="100"
                value={draft.max_amount}
                onChange={(event) => updateSystemDraft(command.id, { max_amount: event.target.value })}
              />
            </label>
          </div>
        )}
      </div>
    )
  }

  function renderCommandCard(command) {
    const dynamic = isDynamicCommand(command)
    const isSystem = Boolean(command.is_system)

    return (
      <motion.div
        key={command.id}
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={`group relative overflow-hidden rounded-[28px] border p-5 transition-all ${
          editingCommand?.id === command.id
            ? 'border-neon-cyan/32 bg-[linear-gradient(135deg,rgba(8,24,36,0.9),rgba(20,18,36,0.96))] shadow-[0_18px_60px_rgba(34,211,238,0.1)]'
            : isSystem
              ? 'border-amber-300/16 bg-[linear-gradient(135deg,rgba(28,24,16,0.88),rgba(22,20,30,0.96))] hover:-translate-y-0.5 hover:border-amber-300/28 hover:shadow-[0_18px_50px_rgba(245,158,11,0.08)]'
              : 'border-white/10 bg-[linear-gradient(135deg,rgba(17,24,39,0.9),rgba(20,20,32,0.96))] hover:-translate-y-0.5 hover:border-neon-violet/20 hover:shadow-[0_18px_50px_rgba(124,58,237,0.08)]'
        } ${!command.enabled ? 'opacity-65' : ''}`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.1),transparent_38%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.12),transparent_32%)] opacity-80" />
        <div className="relative flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
            isSystem
              ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
              : command.command_type === 'slash'
                ? 'border-violet-500/20 bg-violet-500/12 text-violet-300'
                : 'border-cyan-500/20 bg-cyan-500/12 text-cyan-300'
          }`}>
            {isSystem ? <Shield className="h-5 w-5" /> : command.command_type === 'slash' ? <Slash className="h-5 w-5" /> : <Terminal className="h-5 w-5" />}
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
                  {isSystem && (
                    <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[11px] font-mono text-amber-100">
                      {pageCopy.systemBadge}
                    </span>
                  )}
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
                {!isSystem && (
                  <button onClick={() => openEdit(command)} className="rounded-xl p-2 text-white/35 transition-all hover:bg-neon-cyan/10 hover:text-neon-cyan" title={ui.edit}>
                    <Wand2 className="h-4 w-4" />
                  </button>
                )}
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
                {!isSystem && (
                  <button onClick={() => deleteCommand(command.id)} className="rounded-xl p-2 text-white/35 transition-all hover:bg-red-500/10 hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
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

            {isSystem ? renderSystemConfig(command) : null}

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-white/36">
              <span>{ui.uses}: {command.use_count || 0}</span>
              <span>{ui.botReady}</span>
            </div>
          </div>
        </div>
      </motion.div>
    )
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
        <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-neon-cyan/12 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-8 h-72 w-72 rounded-full bg-neon-violet/12 blur-3xl" />
        <div className="relative space-y-4 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/85">
                <Sparkles className="h-3.5 w-3.5" />
                {guild?.name || ui.title}
              </div>
              <h1 className="font-display text-2xl font-800 text-white sm:text-[2rem]">{ui.title}</h1>
              <p className="max-w-2xl text-sm leading-6 text-white/48">{ui.subtitle}</p>
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
              <div key={card.label} className={`feature-metric depth-panel rounded-[24px] bg-gradient-to-br ${card.tone} p-4 backdrop-blur-xl`}>
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/34">{card.label}</p>
                <p className="mt-3 font-display text-3xl font-800 text-white">{card.value}</p>
              </div>
            ))}
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

          {systemCommands.length > 0 && (
            <div className="space-y-3">
              <div className="rounded-[26px] border border-amber-300/12 bg-[linear-gradient(135deg,rgba(39,27,12,0.88),rgba(26,22,34,0.96))] p-5">
                <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-amber-200/80">{pageCopy.systemSectionTitle}</p>
                <p className="mt-3 text-sm leading-6 text-white/55">{pageCopy.systemSectionText}</p>
              </div>
              {systemCommands.map(renderCommandCard)}
            </div>
          )}

          {customCommands.length > 0 && (
            <div className="space-y-3">
              <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.82),rgba(30,24,45,0.94))] p-5">
                <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/80">{pageCopy.customSectionTitle}</p>
                <p className="mt-3 text-sm leading-6 text-white/55">{pageCopy.customSectionText}</p>
              </div>
              {customCommands.map(renderCommandCard)}
            </div>
          )}
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
                {editingCommand && triggerChanged && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={saveCommandTriggerOnly}
                      disabled={!canSaveTriggerOnly || assistantLoading}
                      className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-2 text-sm font-mono text-neon-cyan transition-all hover:border-neon-cyan/40 hover:bg-neon-cyan/16 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ArrowRight className="h-4 w-4" />
                      {ui.saveTrigger}
                    </button>
                    <p className="text-xs leading-5 text-white/42">{ui.saveTriggerHint}</p>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{pageCopy.autoMode}</p>
                    <p className="mt-2 text-sm font-semibold text-white">{describeRequestedMode(directEditMeta, pageCopy)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{pageCopy.liveTrigger}</p>
                    <p className="mt-2 break-all text-sm font-mono text-white">{directEditMeta.trigger || directEditMeta.command_prefix}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
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
                  {speech.isListening || speech.isRequestingPermission || speech.isProcessing ? (
                    <>
                      <button
                        type="button"
                        onClick={stopCommandDictation}
                        disabled={speech.isRequestingPermission || assistantLoading}
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/88 transition-all disabled:opacity-55"
                        title={ui.voiceStopDictation}
                      >
                        <Square className="h-4 w-4 fill-current" />
                      </button>
                      <button
                        type="button"
                        onClick={sendCommandDictation}
                        disabled={speech.isRequestingPermission || assistantLoading}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan text-white shadow-neon-violet transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                        title={ui.voiceSendTranscript}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => speech.start()}
                        disabled={speech.isRequestingPermission || !speech.isSupported}
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/85 transition-all disabled:opacity-70 hover:border-neon-cyan/35 hover:bg-neon-cyan/10 hover:text-neon-cyan"
                        title={ui.voiceStart}
                      >
                        <Mic className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={sendAssistantPrompt}
                        disabled={assistantLoading || (!prompt.trim() && !canSaveTriggerOnly)}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan text-white shadow-neon-violet transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                        title={!prompt.trim() && canSaveTriggerOnly ? ui.saveTrigger : ui.send}
                      >
                        {assistantLoading ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Send className="h-4 w-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
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

