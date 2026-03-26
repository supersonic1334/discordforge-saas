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

  const commandPrefix = raw.slice(0, 1) || '!'
  const commandName = sanitizeCommandName(raw.slice(1), 'prefix')
  return {
    command_type: 'prefix',
    command_prefix: normalizeCommandPrefix(commandPrefix),
    command_name: commandName,
    trigger: commandName ? raw : normalizeCommandPrefix(commandPrefix),
  }
}

function isFullPrefixCommandInput(value) {
  const raw = normalizeCommandInput(value)
  if (!raw) return false
  if (raw.includes(' ')) return true
  if (raw.startsWith('!') || raw.startsWith('?') || raw.startsWith('.') || raw.startsWith('$') || raw.startsWith('-') || raw.startsWith('+') || raw.startsWith('#')) {
    return raw.length > 1
  }
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
  if (commandType === 'slash') return `/${commandName}`
  return shouldUseSpaceAfterPrefix(commandPrefix)
    ? `${commandPrefix} ${commandName}`
    : `${commandPrefix}${commandName}`
}

function buildFallbackPayload({ draft, mode, commandInput, currentCommand }) {
  const commandType = mode === 'slash' ? 'slash' : 'prefix'
  const rawInput = normalizeCommandInput(commandInput)
  const requestedMeta = commandType === 'slash'
    ? {
        command_type: 'slash',
        command_prefix: '/',
        command_name: sanitizeCommandName(rawInput, 'slash'),
        trigger: rawInput ? `/${sanitizeCommandName(rawInput, 'slash')}` : '',
      }
    : (isFullPrefixCommandInput(rawInput) ? deriveCommandMeta(rawInput) : null)

  const commandPrefix = commandType === 'slash'
    ? '/'
    : (requestedMeta?.command_prefix || normalizeCommandPrefix(rawInput || currentCommand?.command_prefix || '!'))
  const commandName = requestedMeta?.command_name || sanitizeCommandName(
    draft?.command_name || currentCommand?.command_name || 'commande',
    commandType
  )
  const trigger = requestedMeta?.trigger || buildCommandTrigger(commandType, commandPrefix, commandName)

  return {
    trigger,
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    description: String(draft?.description || currentCommand?.description || '').trim().slice(0, 120),
    response: String(draft?.response || currentCommand?.response || '').trim().slice(0, 2000),
    response_mode: ['channel', 'reply', 'dm'].includes(draft?.response_mode) ? draft.response_mode : (currentCommand?.response_mode || 'reply'),
    embed_enabled: !!draft?.embed_enabled,
    embed_title: String(draft?.embed_title || '').trim().slice(0, 256),
    mention_user: !!draft?.mention_user,
  }
}

function buildAssistantFallbackPrompt({ mode, commandInput, prompt, currentCommand, locale }) {
  const language = String(locale || 'fr').toLowerCase().startsWith('fr')
    ? 'francais'
    : String(locale || 'fr').toLowerCase().startsWith('es')
      ? 'espagnol'
      : 'anglais'
  const rawInput = normalizeCommandInput(commandInput)
  const requestedInstruction = mode === 'slash'
    ? (rawInput ? `Nom exact impose pour la commande slash: ${sanitizeCommandName(rawInput, 'slash')}` : '')
    : (isFullPrefixCommandInput(rawInput) ? `Declencheur texte exact impose: ${deriveCommandMeta(rawInput).trigger}` : (rawInput ? `Prefixe impose: ${normalizeCommandPrefix(rawInput)}` : ''))

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
Mode demande: ${mode === 'slash' ? 'slash Discord' : 'prefixe texte'}
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
- mention_user

Regles:
- command_name doit etre court et utilisable tout de suite
- pour slash, nom en minuscules compatible Discord
- pas de JavaScript, pas de webhook, pas d'alias, pas d'options avancees
- placeholders autorises: {mention} {username} {server} {channel} {memberCount} {args} {arg1} {arg2}
- VARIETE OBLIGATOIRE: chaque reponse de commande doit etre unique et creative. Pour les commandes de contenu (blagues, faits, citations), utilise du contenu genuinement different a chaque fois.
- Les descriptions doivent etre concises mais engageantes.
- Les reponses doivent etre riches, bien formatees, et professionnelles.

Format attendu:
\`\`\`command
{
  "command_name": "bonjour",
  "description": "Salue un membre",
  "response": "Bonjour {mention} !",
  "response_mode": "reply",
  "embed_enabled": false,
  "embed_title": "",
  "mention_user": false
}
\`\`\``
}

export default function CommandsPage() {
  const { locale } = useI18n()
  const ui = getUi(locale)
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [commands, setCommands] = useState([])
  const [loading, setLoading] = useState(false)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [mode, setMode] = useState('prefix')
  const [commandInput, setCommandInput] = useState('!')
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
    setMode('prefix')
    setCommandInput('!')
    setPrompt('')
    setMessages([])
  }

  function openEdit(command) {
    setEditingCommand(command)
    setMode(command.command_type || 'prefix')
    setCommandInput(command.command_type === 'slash'
      ? (command.command_name || '')
      : (command.display_trigger || command.trigger || '!'))
    setPrompt('')
    setMessages([])
  }

  async function runAssistantFallback(userMessage) {
    const aiResponse = await aiAPI.chat({
      message: buildAssistantFallbackPrompt({
        mode,
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
      mode,
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

  async function sendAssistantPrompt() {
    if (!selectedGuildId || !prompt.trim() || assistantLoading) return
    if (speech.isListening) speech.stop()

    const userMessage = { role: 'user', content: prompt.trim() }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setAssistantLoading(true)
    setPrompt('')

    try {
      let response

      try {
        response = await commandsAPI.assistant(selectedGuildId, {
          mode,
          prefix: mode === 'prefix' && !isFullPrefixCommandInput(commandInput) ? commandInput : undefined,
          trigger: mode === 'prefix' && isFullPrefixCommandInput(commandInput) ? commandInput : undefined,
          command_name: mode === 'slash' ? commandInput : undefined,
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
    <div className="px-4 py-5 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">{ui.title}</h1>
          <p className="text-white/40 text-sm">{guild?.name} - {ui.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => loadCommands(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {ui.refresh}
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/15 transition-all">
            <Plus className="w-4 h-4" />
            {ui.new}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_380px]">
        <div className="space-y-3">
          {commands.length === 0 && !loading && (
            <div className="glass-card p-10 text-center">
              <Terminal className="w-12 h-12 text-white/10 mx-auto mb-3" />
              <p className="text-white/40 mb-1">{ui.empty}</p>
              <p className="text-white/25 text-sm">{ui.emptyHint}</p>
            </div>
          )}

          {commands.map((command) => (
            <motion.div
              key={command.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass-card p-5 transition-all ${!command.enabled ? 'opacity-55' : ''} ${editingCommand?.id === command.id ? 'ring-1 ring-neon-cyan/30 border-neon-cyan/25 shadow-[0_0_26px_rgba(34,211,238,0.12)]' : ''}`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${command.command_type === 'slash' ? 'border-violet-500/20 bg-violet-500/10 text-violet-300' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'}`}>
                  {command.command_type === 'slash' ? <Slash className="w-5 h-5" /> : <Terminal className="w-5 h-5" />}
                </div>

                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono text-white text-sm">{command.display_trigger}</p>
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-mono border ${command.command_type === 'slash' ? 'border-violet-500/20 bg-violet-500/10 text-violet-300' : 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'}`}>
                          {command.command_type === 'slash' ? ui.slashBadge : ui.prefixBadge}
                        </span>
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-mono border ${command.enabled ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-white/45'}`}>
                          {command.enabled ? ui.active : ui.disabled}
                        </span>
                      </div>
                      {command.description ? <p className="text-white/55 text-sm mt-1">{command.description}</p> : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(command)} className="p-2 rounded-lg text-white/30 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-all" title={ui.edit}>
                        <Wand2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleCommand(command)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-mono transition-all ${
                          command.enabled
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/18'
                            : 'border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/18'
                        } ${togglingCommandIds[command.id] ? 'animate-pulse' : ''}`}
                        title={command.enabled ? ui.active : ui.disabled}
                      >
                        {command.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        <span>{command.enabled ? ui.active : ui.disabled}</span>
                      </button>
                      <button onClick={() => deleteCommand(command.id)} className="p-2 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                    <p className="text-white/75 text-sm whitespace-pre-wrap break-words">{command.response}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-white/35 font-mono">
                    <span>{ui.uses}: {command.use_count || 0}</span>
                    <span>{ui.botReady}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div ref={assistantCardRef} className="glass-card p-5 space-y-5 h-fit sticky top-24">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display font-700 text-white text-lg">{ui.assistantTitle}</p>
              <p className="text-white/40 text-sm mt-1">{editingCommand ? ui.assistantEdit : ui.assistantCreate}</p>
            </div>
            <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
          </div>

          {editingCommand && (
            <div className="rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-neon-cyan/70 mb-1">{ui.editingTarget}</p>
                  <p className="text-sm font-mono text-white break-all">{editingCommand.display_trigger}</p>
                </div>
                <button
                  type="button"
                  onClick={openCreate}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-mono text-white/70 hover:text-white hover:border-white/20 transition-all"
                >
                  {ui.cancelEdit}
                </button>
              </div>
              {editingCommand.description ? (
                <p className="text-sm text-white/55">{editingCommand.description}</p>
              ) : null}
            </div>
          )}

          <div className="grid gap-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.18em] text-white/35 mb-2">{ui.modeLabel}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('prefix')}
                  className={`flex-1 px-4 py-3 rounded-2xl border text-sm font-mono transition-all ${mode === 'prefix' ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300' : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white'}`}
                >
                  {ui.modePrefix}
                </button>
                <button
                  onClick={() => setMode('slash')}
                  className={`flex-1 px-4 py-3 rounded-2xl border text-sm font-mono transition-all ${mode === 'slash' ? 'border-violet-500/25 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white'}`}
                >
                  {ui.modeSlash}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-mono uppercase tracking-[0.18em] text-white/35 mb-2 block">
                {mode === 'slash' ? ui.slashNameLabel : ui.prefixLabel}
              </label>
              <input
                className="input-field"
                value={commandInput}
                onChange={(event) => setCommandInput(event.target.value)}
                placeholder={mode === 'slash' ? ui.slashNameHint : ui.prefixHint}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4 space-y-3 max-h-[340px] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-sm text-white/35 leading-relaxed">
                <p>{editingCommand ? ui.assistantEditHint : ui.assistantCreateHint}</p>
                <p className="mt-2">{editingCommand ? ui.assistantEditEmpty : ui.assistantCreateEmpty}</p>
              </div>
            ) : messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === 'user' ? 'bg-neon-cyan/10 border border-neon-cyan/15 text-white/85' : 'bg-white/[0.03] border border-white/8 text-white/70'}`}>
                {message.content}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono uppercase tracking-[0.18em] text-white/35 block">{ui.promptLabel}</label>
            {(speech.isListening || speech.isRequestingPermission) && (
              <p className={`text-xs font-mono ${speech.isRequestingPermission ? 'text-amber-300/80' : 'text-neon-cyan/70'}`}>
                {speech.isRequestingPermission ? ui.voicePreparing : ui.voiceListening}
              </p>
            )}
            <div className="relative">
              <textarea
                ref={promptInputRef}
                className="input-field min-h-[148px] resize-y pr-[126px] sm:pr-[154px]"
                placeholder={editingCommand ? ui.promptEditPlaceholder : ui.promptPlaceholder}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {(speech.isListening || speech.isRequestingPermission) && (
                  <VoiceMeter
                    bars={speech.audioBars}
                    active={speech.isListening}
                    accent={speech.isRequestingPermission ? 'amber' : 'cyan'}
                  />
                )}
                <button
                  type="button"
                  onClick={() => (speech.isListening ? speech.stop() : speech.start())}
                  disabled={speech.isRequestingPermission}
                  className={`h-11 w-11 rounded-full border flex items-center justify-center transition-all shrink-0 disabled:opacity-70 ${
                    speech.isListening
                      ? 'border-red-500/35 bg-red-500/14 text-red-200 shadow-[0_0_20px_rgba(248,113,113,0.2)]'
                      : speech.isRequestingPermission
                        ? 'border-amber-400/35 bg-amber-400/12 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.18)]'
                        : 'border-white/12 bg-white/[0.06] text-white/85 hover:border-neon-cyan/35 hover:bg-neon-cyan/10 hover:text-neon-cyan'
                  }`}
                  title={speech.isListening ? ui.voiceStop : ui.voiceStart}
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={sendAssistantPrompt}
                  disabled={assistantLoading || !prompt.trim()}
                  className="h-11 w-11 rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan flex items-center justify-center text-white shadow-neon-violet disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
                >
                  {assistantLoading ? <Sparkles className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {(speech.isListening || speech.isRequestingPermission) && (
              <p className="text-[11px] text-white/35">{speech.interimTranscript || ''}</p>
            )}
          </div>

          {quota?.enabled && (
            <div className="rounded-2xl border border-emerald-500/18 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-200">
              <span className="font-mono">{ui.quota}:</span> {quota.remainingTokens}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
