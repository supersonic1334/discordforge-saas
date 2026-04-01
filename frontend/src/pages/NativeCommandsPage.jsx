import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Slash,
  Sparkles,
  Terminal,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, commandsAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const TEXT_CHANNEL_TYPES = [0, 5, 11, 12, 15]
const CATEGORY_ORDER = ['all', 'moderation', 'utility']

const CATEGORY_STYLES = {
  moderation: {
    badge: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    card: 'border-amber-400/18',
  },
  utility: {
    badge: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300',
    card: 'border-cyan-400/18',
  },
}

const UI = {
  fr: {
    title: 'Commandes',
    subtitle: 'Commandes natives Discord deja pretes. Active-les, configure-les, et tout le serveur reste synchro en temps reel.',
    selectServerTitle: "Choisis d'abord un serveur",
    selectServerText: 'Les commandes natives se gerent serveur par serveur.',
    selectServerAction: 'Choisir un serveur',
    refresh: 'Recharger',
    retry: 'Reessayer',
    loading: 'Chargement...',
    loadError: 'Impossible de charger les commandes natives.',
    emptyCategory: 'Aucune commande native dans cette categorie.',
    categories: {
      all: 'Tout',
      moderation: 'Moderation',
      utility: 'Utilitaire',
    },
    nativeBadge: 'Par defaut',
    slashBadge: 'Slash',
    active: 'Active',
    disabled: 'Desactivee',
    configure: 'Configurer',
    configuration: 'Configuration native',
    save: 'Sauvegarder',
    saving: 'Sauvegarde...',
    reset: 'Reinitialiser',
    updated: 'Commande synchronisee',
    systemPanelTitle: 'Commandes automatiques',
    systemPanelText: 'Ces commandes ne sont pas supprimables. Tu controles seulement leur statut, leur visibilite et leurs reglages natifs.',
    openAiCommands: 'Ouvrir Commandes IA',
    total: 'Commandes',
    moderationCount: 'Moderation',
    utilityCount: 'Utilitaire',
    uses: 'Utilisations',
    botReady: 'Synchro bot automatique',
    logChannel: 'Salon de logs',
    noLogChannel: 'Aucun salon',
    defaultTargetChannel: 'Salon par defaut',
    visibilityLabel: 'Visibilite du succes',
    visibilityEphemeral: 'Prive',
    visibilityPublic: 'Public',
    dmUser: 'Envoyer un DM au membre',
    requireReason: 'Raison obligatoire',
    deleteMessageSeconds: 'Historique a effacer (secondes)',
    defaultTimeoutMinutes: 'Timeout par defaut (minutes)',
    defaultPoints: 'Points par defaut',
    defaultSlowmodeSeconds: 'Slowmode par defaut (secondes)',
    defaultAmount: 'Quantite par defaut',
    minAmount: 'Minimum',
    maxAmount: 'Maximum',
    allowMentions: 'Autoriser les mentions',
    pingEveryone: 'Autoriser @everyone',
    builtInLocked: 'Le declencheur et l action native sont verrouilles. La configuration ci-dessous reste la seule partie editable.',
    responseLabel: 'Apercu reponse',
    usageLabel: 'Aide d usage',
    liveSyncReady: 'Synchro live active',
    liveSyncSaving: 'Synchronisation...',
  },
  en: {
    title: 'Commands',
    subtitle: 'Built-in Discord commands ready to use. Toggle them, configure them, and keep every collaborator in sync in real time.',
    selectServerTitle: 'Choose a server first',
    selectServerText: 'Native commands are managed per server.',
    selectServerAction: 'Choose a server',
    refresh: 'Refresh',
    retry: 'Retry',
    loading: 'Loading...',
    loadError: 'Unable to load native commands.',
    emptyCategory: 'No native command in this category.',
    categories: {
      all: 'All',
      moderation: 'Moderation',
      utility: 'Utility',
    },
    nativeBadge: 'Built-in',
    slashBadge: 'Slash',
    active: 'Active',
    disabled: 'Disabled',
    configure: 'Configure',
    configuration: 'Native configuration',
    save: 'Save',
    saving: 'Saving...',
    reset: 'Reset',
    updated: 'Command synced',
    systemPanelTitle: 'Automatic commands',
    systemPanelText: 'These commands cannot be deleted. You only control their status, visibility, and native settings.',
    openAiCommands: 'Open AI Commands',
    total: 'Commands',
    moderationCount: 'Moderation',
    utilityCount: 'Utility',
    uses: 'Uses',
    botReady: 'Automatic bot sync',
    logChannel: 'Log channel',
    noLogChannel: 'No channel',
    defaultTargetChannel: 'Default channel',
    visibilityLabel: 'Success visibility',
    visibilityEphemeral: 'Private',
    visibilityPublic: 'Public',
    dmUser: 'Send DM to member',
    requireReason: 'Require reason',
    deleteMessageSeconds: 'Delete history (seconds)',
    defaultTimeoutMinutes: 'Default timeout (minutes)',
    defaultPoints: 'Default points',
    defaultSlowmodeSeconds: 'Default slowmode (seconds)',
    defaultAmount: 'Default amount',
    minAmount: 'Minimum',
    maxAmount: 'Maximum',
    allowMentions: 'Allow mentions',
    pingEveryone: 'Allow @everyone',
    builtInLocked: 'The trigger and native action are locked. The configuration below is the only editable part.',
    responseLabel: 'Response preview',
    usageLabel: 'Usage hint',
    liveSyncReady: 'Live sync ready',
    liveSyncSaving: 'Syncing...',
  },
  es: {
    title: 'Comandos',
    subtitle: 'Comandos nativos de Discord ya listos. Activalos, configuralos y manten a todos los colaboradores sincronizados en tiempo real.',
    selectServerTitle: 'Primero elige un servidor',
    selectServerText: 'Los comandos nativos se gestionan por servidor.',
    selectServerAction: 'Elegir servidor',
    refresh: 'Actualizar',
    retry: 'Reintentar',
    loading: 'Cargando...',
    loadError: 'No se pueden cargar los comandos nativos.',
    emptyCategory: 'No hay comandos nativos en esta categoria.',
    categories: {
      all: 'Todo',
      moderation: 'Moderacion',
      utility: 'Utilidad',
    },
    nativeBadge: 'Integrado',
    slashBadge: 'Slash',
    active: 'Activo',
    disabled: 'Desactivado',
    configure: 'Configurar',
    configuration: 'Configuracion nativa',
    save: 'Guardar',
    saving: 'Guardando...',
    reset: 'Restablecer',
    updated: 'Comando sincronizado',
    systemPanelTitle: 'Comandos automaticos',
    systemPanelText: 'Estos comandos no se pueden borrar. Solo controlas su estado, visibilidad y ajustes nativos.',
    openAiCommands: 'Abrir Comandos IA',
    total: 'Comandos',
    moderationCount: 'Moderacion',
    utilityCount: 'Utilidad',
    uses: 'Usos',
    botReady: 'Sync automatica del bot',
    logChannel: 'Canal de logs',
    noLogChannel: 'Sin canal',
    defaultTargetChannel: 'Canal por defecto',
    visibilityLabel: 'Visibilidad del exito',
    visibilityEphemeral: 'Privado',
    visibilityPublic: 'Publico',
    dmUser: 'Enviar DM al miembro',
    requireReason: 'Exigir motivo',
    deleteMessageSeconds: 'Borrar historial (segundos)',
    defaultTimeoutMinutes: 'Timeout por defecto (minutos)',
    defaultPoints: 'Puntos por defecto',
    defaultSlowmodeSeconds: 'Slowmode por defecto (segundos)',
    defaultAmount: 'Cantidad por defecto',
    minAmount: 'Minimo',
    maxAmount: 'Maximo',
    allowMentions: 'Permitir menciones',
    pingEveryone: 'Permitir @everyone',
    builtInLocked: 'El trigger y la accion nativa estan bloqueados. La configuracion de abajo es la unica parte editable.',
    responseLabel: 'Vista previa de respuesta',
    usageLabel: 'Guia de uso',
    liveSyncReady: 'Sync activa',
    liveSyncSaving: 'Sincronizando...',
  },
}

function getUi(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return UI[key] || UI.fr
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function isTextLikeChannel(channel) {
  return TEXT_CHANNEL_TYPES.includes(Number(channel?.type))
}

function clampIntegerString(value, min, max, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function buildSystemDraft(command) {
  const config = command?.action_config || {}
  return {
    log_channel_id: config.log_channel_id || '',
    default_channel_id: config.default_channel_id || '',
    dm_user: Boolean(config.dm_user),
    require_reason: Boolean(config.require_reason),
    delete_message_seconds: String(config.delete_message_seconds ?? 0),
    default_timeout_minutes: String(Math.max(1, Math.round(Number(config.default_duration_ms || 600000) / 60000))),
    default_points: String(config.default_points ?? 1),
    default_slowmode_seconds: String(config.default_seconds ?? 30),
    default_amount: String(config.default_amount ?? 20),
    min_amount: String(config.min_amount ?? 1),
    max_amount: String(config.max_amount ?? 100),
    allow_mentions: Boolean(config.allow_mentions),
    ping_everyone: Boolean(config.ping_everyone),
    success_visibility: config.success_visibility === 'public' ? 'public' : 'ephemeral',
  }
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
    case 'unban_member':
    case 'add_role':
    case 'remove_role':
    case 'set_nickname':
    case 'move_member':
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

    case 'lock_channel':
    case 'unlock_channel':
      return {
        ...currentConfig,
        ...base,
        default_channel_id: String(draft?.default_channel_id || '').trim(),
        require_reason: Boolean(draft?.require_reason),
      }

    case 'slowmode_channel':
      return {
        ...currentConfig,
        ...base,
        default_channel_id: String(draft?.default_channel_id || '').trim(),
        require_reason: Boolean(draft?.require_reason),
        default_seconds: clampIntegerString(draft?.default_slowmode_seconds, 0, 21600, Number(currentConfig.default_seconds || 30)),
      }

    case 'say_message':
      return {
        ...currentConfig,
        ...base,
        default_channel_id: String(draft?.default_channel_id || '').trim(),
        allow_mentions: Boolean(draft?.allow_mentions),
      }

    case 'announce_message':
      return {
        ...currentConfig,
        ...base,
        default_channel_id: String(draft?.default_channel_id || '').trim(),
        ping_everyone: Boolean(draft?.ping_everyone),
      }

    default:
      return {
        ...currentConfig,
        ...base,
      }
  }
}

function formatCooldownLabel(value) {
  const ms = Number(value || 0)
  if (!ms) return ''
  if (ms >= 3600000 && ms % 3600000 === 0) return `${ms / 3600000}h cooldown`
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000}m cooldown`
  return `${Math.round(ms / 1000)}s cooldown`
}

function NativeCommandCard({ command, ui, textChannels, onToggle, onSave }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [draft, setDraft] = useState(() => buildSystemDraft(command))

  useEffect(() => {
    setDraft(buildSystemDraft(command))
  }, [command])

  const colors = CATEGORY_STYLES[command.system_category] || CATEGORY_STYLES.utility
  const moderationWithDm = ['ban_member', 'kick_member', 'timeout_member', 'untimeout_member', 'warn_member']
  const supportsReason = [
    ...moderationWithDm,
    'unban_member',
    'add_role',
    'remove_role',
    'set_nickname',
    'lock_channel',
    'unlock_channel',
    'slowmode_channel',
    'move_member',
  ].includes(command.action_type)
  const supportsDefaultChannel = [
    'lock_channel',
    'unlock_channel',
    'slowmode_channel',
    'say_message',
    'announce_message',
  ].includes(command.action_type)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(command, draft)
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    setToggling(true)
    try {
      await onToggle(command, !command.enabled)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className={`glass-card self-start border ${command.enabled ? colors.card : 'border-white/[0.08]'}`}>
      <div className="p-5">
        <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-4 sm:grid-cols-[auto,minmax(0,1fr),auto] sm:items-start">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${colors.badge}`}>
            <Slash className="w-5 h-5" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-700 text-white text-xl leading-none break-all">{command.display_trigger}</h3>
              <span className={`px-2.5 py-1 rounded-full border text-xs ${colors.badge}`}>
                {ui.categories[command.system_category] || command.system_category || ui.categories.utility}
              </span>
              <span className="px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-xs text-white/65">
                {ui.nativeBadge}
              </span>
              <span className="px-2.5 py-1 rounded-full border border-violet-500/20 bg-violet-500/10 text-xs text-violet-300">
                {ui.slashBadge}
              </span>
              <span className={`px-2.5 py-1 rounded-full border text-xs ${
                command.enabled
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/[0.08] bg-white/[0.04] text-white/45'
              }`}>
                {command.enabled ? ui.active : ui.disabled}
              </span>
              {command.cooldown_ms > 0 && (
                <span className="px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.04] text-xs text-white/60">
                  {formatCooldownLabel(command.cooldown_ms)}
                </span>
              )}
            </div>
            {command.description ? <p className="text-white/45 mt-2">{command.description}</p> : null}
          </div>

          <div className="col-span-2 sm:col-span-1 flex justify-end sm:justify-start">
            <label className="toggle-switch shrink-0 sm:mt-1">
              <input type="checkbox" checked={command.enabled} onChange={handleToggle} disabled={toggling} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{ui.responseLabel}</p>
            <p className="mt-2 text-sm text-white/72 whitespace-pre-wrap break-words">{command.response}</p>
            {command.usage_hint ? (
              <div className="mt-3 border-t border-white/[0.06] pt-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{ui.usageLabel}</p>
                <p className="mt-2 text-sm text-white/58">{command.usage_hint}</p>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/58">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{ui.systemPanelTitle}</p>
            <p className="mt-2">{ui.builtInLocked}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-mono text-white/40">
              <span>{ui.uses}: {command.use_count || 0}</span>
              <span>{ui.botReady}</span>
            </div>
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
            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-white/60">
              {ui.builtInLocked}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.logChannel}</span>
              <select
                className="select-field"
                value={draft.log_channel_id}
                onChange={(event) => setDraft((current) => ({ ...current, log_channel_id: event.target.value }))}
              >
                <option value="">{ui.noLogChannel}</option>
                {textChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>#{channel.name}</option>
                ))}
              </select>
            </label>

            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.visibilityLabel}</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'ephemeral', label: ui.visibilityEphemeral },
                  { value: 'public', label: ui.visibilityPublic },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, success_visibility: option.value }))}
                    className={`px-4 py-2 rounded-xl border text-sm transition-colors ${
                      draft.success_visibility === option.value
                        ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-white/[0.08] text-white/50 hover:text-white hover:border-white/18'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {supportsDefaultChannel && (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.defaultTargetChannel}</span>
                <select
                  className="select-field"
                  value={draft.default_channel_id}
                  onChange={(event) => setDraft((current) => ({ ...current, default_channel_id: event.target.value }))}
                >
                  <option value="">{ui.noLogChannel}</option>
                  {textChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>#{channel.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(moderationWithDm.includes(command.action_type) || supportsReason || command.action_type === 'say_message' || command.action_type === 'announce_message') && (
            <div className="flex flex-wrap gap-3">
              {moderationWithDm.includes(command.action_type) && (
                <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/72">
                  <input
                    type="checkbox"
                    checked={draft.dm_user}
                    onChange={(event) => setDraft((current) => ({ ...current, dm_user: event.target.checked }))}
                  />
                  {ui.dmUser}
                </label>
              )}

              {supportsReason && (
                <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/72">
                  <input
                    type="checkbox"
                    checked={draft.require_reason}
                    onChange={(event) => setDraft((current) => ({ ...current, require_reason: event.target.checked }))}
                  />
                  {ui.requireReason}
                </label>
              )}

              {command.action_type === 'say_message' && (
                <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/72">
                  <input
                    type="checkbox"
                    checked={draft.allow_mentions}
                    onChange={(event) => setDraft((current) => ({ ...current, allow_mentions: event.target.checked }))}
                  />
                  {ui.allowMentions}
                </label>
              )}

              {command.action_type === 'announce_message' && (
                <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/72">
                  <input
                    type="checkbox"
                    checked={draft.ping_everyone}
                    onChange={(event) => setDraft((current) => ({ ...current, ping_everyone: event.target.checked }))}
                  />
                  {ui.pingEveryone}
                </label>
              )}
            </div>
          )}

          {command.action_type === 'ban_member' && (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.deleteMessageSeconds}</span>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  max="604800"
                  value={draft.delete_message_seconds}
                  onChange={(event) => setDraft((current) => ({ ...current, delete_message_seconds: event.target.value }))}
                />
              </label>
            </div>
          )}

          {command.action_type === 'timeout_member' && (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.defaultTimeoutMinutes}</span>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  max="40320"
                  value={draft.default_timeout_minutes}
                  onChange={(event) => setDraft((current) => ({ ...current, default_timeout_minutes: event.target.value }))}
                />
              </label>
            </div>
          )}

          {command.action_type === 'warn_member' && (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.defaultPoints}</span>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  max="20"
                  value={draft.default_points}
                  onChange={(event) => setDraft((current) => ({ ...current, default_points: event.target.value }))}
                />
              </label>
            </div>
          )}

          {command.action_type === 'slowmode_channel' && (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.defaultSlowmodeSeconds}</span>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  max="21600"
                  value={draft.default_slowmode_seconds}
                  onChange={(event) => setDraft((current) => ({ ...current, default_slowmode_seconds: event.target.value }))}
                />
              </label>
            </div>
          )}

          {command.action_type === 'clear_messages' && (
            <div className="grid gap-5 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.minAmount}</span>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  max="100"
                  value={draft.min_amount}
                  onChange={(event) => setDraft((current) => ({ ...current, min_amount: event.target.value }))}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.defaultAmount}</span>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  max="100"
                  value={draft.default_amount}
                  onChange={(event) => setDraft((current) => ({ ...current, default_amount: event.target.value }))}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/34">{ui.maxAmount}</span>
                <input
                  className="input-field"
                  type="number"
                  min="1"
                  max="100"
                  value={draft.max_amount}
                  onChange={(event) => setDraft((current) => ({ ...current, max_amount: event.target.value }))}
                />
              </label>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-mono text-white/45">
              {saving ? ui.liveSyncSaving : ui.liveSyncReady}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15 transition-colors disabled:opacity-60 inline-flex items-center gap-2"
              >
                <Save className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
                {saving ? ui.saving : ui.save}
              </button>
              <button
                type="button"
                onClick={() => setDraft(buildSystemDraft(command))}
                className="px-4 py-2 rounded-xl border border-white/[0.08] text-white/55 hover:text-white hover:border-white/20 transition-colors"
              >
                {ui.reset}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function NativeCommandsPage() {
  const { locale } = useI18n()
  const ui = getUi(locale)
  const { guilds, selectedGuildId } = useGuildStore()
  const currentGuild = guilds.find((guild) => guild.id === selectedGuildId) || null
  const [commands, setCommands] = useState([])
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeCategory, setActiveCategory] = useState('all')
  const [loadError, setLoadError] = useState('')

  const textChannels = useMemo(
    () => channels.filter((channel) => isTextLikeChannel(channel)),
    [channels]
  )

  const filteredCommands = useMemo(() => {
    if (activeCategory === 'all') return commands
    return commands.filter((command) => command.system_category === activeCategory)
  }, [activeCategory, commands])

  const stats = useMemo(() => ({
    total: commands.length,
    active: commands.filter((command) => command.enabled).length,
    moderation: commands.filter((command) => command.system_category === 'moderation').length,
    utility: commands.filter((command) => command.system_category === 'utility').length,
  }), [commands])

  function applyCommandSnapshot(incomingCommands = []) {
    if (!Array.isArray(incomingCommands)) return
    setCommands(incomingCommands.filter((command) => command.is_system))
  }

  async function loadAll(showToast = false) {
    if (!selectedGuildId) return

    const updateLoading = !commands.length
    if (updateLoading) setLoading(true)
    else setRefreshing(true)

    try {
      const [commandsResponse, channelsResponse] = await Promise.all([
        commandsAPI.list(selectedGuildId),
        botAPI.channels(selectedGuildId),
      ])

      applyCommandSnapshot(commandsResponse.data.commands || [])
      setChannels(channelsResponse.data.channels || [])
      setLoadError('')
      if (showToast) toast.success(ui.refresh)
    } catch (error) {
      const message = getErrorMessage(error)
      setLoadError(message)
      if (showToast) toast.error(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!selectedGuildId) {
      setCommands([])
      setChannels([])
      setLoadError('')
      setLoading(false)
      return
    }

    loadAll(false)
  }, [selectedGuildId])

  useEffect(() => {
    const handleRealtimeSync = (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId || '')) return
      if (Array.isArray(payload.commands)) {
        applyCommandSnapshot(payload.commands)
        setLoadError('')
        return
      }
      void loadAll(false)
    }

    const handleSnapshotRestore = (payload = {}) => {
      if (String(payload.guildId || '') !== String(selectedGuildId || '')) return
      void loadAll(false)
    }

    const unsubscribeCommands = wsService.on('commands:updated', handleRealtimeSync)
    const unsubscribeSnapshots = wsService.on('team:snapshot_restored', handleSnapshotRestore)

    return () => {
      unsubscribeCommands()
      unsubscribeSnapshots()
    }
  }, [selectedGuildId])

  const toggleCommand = async (command, enabled) => {
    const response = await commandsAPI.toggle(selectedGuildId, command.id, enabled)
    const nextCommand = response?.data?.command || null
    if (nextCommand) {
      setCommands((current) => current.map((entry) => (entry.id === nextCommand.id ? nextCommand : entry)))
      return
    }
    await loadAll(false)
  }

  const saveCommand = async (command, draft) => {
    const response = await commandsAPI.update(selectedGuildId, command.id, {
      action_config: buildSystemActionConfig(command, draft),
    })
    const nextCommand = response?.data?.command || null
    if (nextCommand) {
      setCommands((current) => current.map((entry) => (entry.id === nextCommand.id ? nextCommand : entry)))
      toast.success(ui.updated)
      return
    }
    await loadAll(false)
    toast.success(ui.updated)
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <Terminal className="w-12 h-12 text-white/10 mx-auto mb-4" />
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
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-6">
      <section className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,24,40,0.94),rgba(16,16,32,0.98))] shadow-[0_30px_90px_rgba(2,8,23,0.45)]">
        <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-8 h-72 w-72 rounded-full bg-neon-cyan/10 blur-3xl" />
        <div className="relative space-y-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.22em] text-amber-200/85">
                <Shield className="h-3.5 w-3.5" />
                {currentGuild?.name || ui.title}
              </div>
              <h1 className="font-display text-2xl font-800 text-white sm:text-[2rem]">{ui.title}</h1>
              <p className="max-w-3xl text-sm leading-6 text-white/48">{ui.subtitle}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                to="/dashboard/commands-ai"
                className="inline-flex items-center gap-2 rounded-2xl border border-neon-violet/25 bg-neon-violet/10 px-4 py-2.5 text-sm font-mono text-violet-200 transition-all hover:border-neon-violet/40 hover:bg-neon-violet/16"
              >
                <Sparkles className="h-4 w-4" />
                {ui.openAiCommands}
              </Link>
              <button
                type="button"
                onClick={() => loadAll(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-mono text-white/72 transition-all hover:border-neon-cyan/30 hover:bg-white/[0.07] hover:text-white disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {ui.refresh}
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: ui.total, value: stats.total, tone: 'from-amber-400/18 to-amber-300/5' },
              { label: ui.active, value: stats.active, tone: 'from-emerald-500/18 to-emerald-500/5' },
              { label: ui.moderationCount, value: stats.moderation, tone: 'from-orange-500/18 to-orange-500/5' },
              { label: ui.utilityCount, value: stats.utility, tone: 'from-neon-cyan/18 to-neon-cyan/5' },
            ].map((card) => (
              <div key={card.label} className={`feature-metric depth-panel rounded-[24px] bg-gradient-to-br ${card.tone} p-4 backdrop-blur-xl`}>
                <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/34">{card.label}</p>
                <p className="mt-3 font-display text-3xl font-800 text-white">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-amber-200/80">{ui.systemPanelTitle}</p>
            <p className="mt-3 text-sm leading-6 text-white/55">{ui.systemPanelText}</p>
          </div>
        </div>
      </section>

      <div className="flex gap-2 flex-wrap">
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
      ) : loadError && commands.length === 0 ? (
        <div className="glass-card p-8 text-center space-y-4">
          <div className="space-y-2">
            <p className="text-lg font-display font-700 text-white">{ui.loadError}</p>
            <p className="text-sm text-red-300/90">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/15 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {ui.retry}
          </button>
        </div>
      ) : filteredCommands.length === 0 ? (
        <div className="glass-card p-8 text-center text-white/45">{ui.emptyCategory}</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2 items-start">
          {filteredCommands.map((command) => (
            <NativeCommandCard
              key={command.id}
              command={command}
              ui={ui}
              textChannels={textChannels}
              onToggle={toggleCommand}
              onSave={saveCommand}
            />
          ))}
        </div>
      )}
    </div>
  )
}
