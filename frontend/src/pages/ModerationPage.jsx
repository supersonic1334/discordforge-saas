import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  Gavel,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { logsAPI, modAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const COPY = {
  fr: {
    title: 'Modération',
    noServerTitle: "Choisis d'abord un serveur",
    noServerText: 'La modération devient disponible dès que ton serveur est sélectionné.',
    noServerAction: 'Choisir un serveur',
    tabs: { warnings: 'Avertissements', logs: 'Logs', discord: 'Discord', manual: 'Action manuelle' },
    warningsTitle: 'Avertissements récents',
    warningsSubtitle: 'Tu vois directement les derniers warns actifs et qui les a posés.',
    warningsAction: 'Nouvel avertissement',
    warningsEmpty: 'Aucun avertissement actif pour le moment.',
    logsTitle: 'Logs',
    logsSubtitle: 'Logs internes du site et du bot pour ce serveur.',
    logsEmpty: 'Aucun log site pour le moment.',
    discordTitle: 'Logs Discord',
    discordSubtitle: "Actions récupérées depuis l'audit log Discord du serveur.",
    discordEmpty: 'Aucun log Discord récent.',
    refresh: 'Actualiser',
    clearDisplayed: 'Nettoyer la vue',
    clearDone: 'Vue Discord nettoyée',
    manualTitle: 'Action manuelle',
    manualSubtitle: 'Une seule fiche claire pour warn, timeout, kick, ban ou unban.',
    targetLabel: 'Utilisateur Discord',
    targetHint: '@mention ou ID Discord',
    actionLabel: 'Sanction',
    reasonLabel: 'Raison',
    reasonHint: 'Explique rapidement pourquoi',
    durationLabel: 'Durée du timeout',
    durationHint: 'Exemple: 10m, 1h, 2d',
    pointsLabel: "Points d'avertissement",
    moderatorIdentityLabel: 'Ton Discord',
    moderatorIdentityHint: '@mention ou ID pour afficher ton profil',
    submitWarn: "Envoyer l'avertissement",
    submitAction: "Exécuter l'action",
    identityRequired: 'Ton identité Discord est requise pour cette action.',
    targetRequired: 'Entre une @mention ou un ID Discord valide.',
    durationRequired: 'Entre une durée valide comme 10m ou 1h.',
    reasonRequired: 'La raison est obligatoire.',
    warningSent: 'Avertissement ajouté',
    actionDone: 'Action exécutée',
    warningDeleted: 'Avertissement supprimé',
    deleteWarning: "Supprimer l'avertissement",
    by: 'Par',
    target: 'Cible',
    reason: 'Raison',
    unknown: 'Inconnu',
    idLabel: 'ID',
    actionLabels: {
      warn: 'Avertissement',
      timeout: 'Mute temporaire',
      kick: 'Expulser',
      ban: 'Ban',
      unban: 'Déban',
      untimeout: 'Retirer le mute',
    },
    auditActions: {
      20: 'Expulsion',
      22: 'Ban',
      23: 'Déban',
      24: 'Membre modifié',
      25: 'Rôle modifié',
      26: 'Déplacement vocal',
      27: 'Déconnexion vocale',
      28: 'Bot ajouté',
      72: 'Message supprimé',
    },
    unknownAction: 'Action',
  },
  en: {
    title: 'Moderation',
    noServerTitle: 'Choose a server first',
    noServerText: 'Moderation becomes available as soon as your server is selected.',
    noServerAction: 'Choose a server',
    tabs: { warnings: 'Warnings', logs: 'Logs', discord: 'Discord', manual: 'Manual action' },
    warningsTitle: 'Recent warnings',
    warningsSubtitle: 'You can immediately see the latest active warns and who issued them.',
    warningsAction: 'New warning',
    warningsEmpty: 'No active warnings right now.',
    logsTitle: 'Logs',
    logsSubtitle: 'Internal website and bot logs for this server.',
    logsEmpty: 'No site logs yet.',
    discordTitle: 'Discord logs',
    discordSubtitle: 'Actions pulled from the Discord server audit log.',
    discordEmpty: 'No recent Discord logs.',
    refresh: 'Refresh',
    clearDisplayed: 'Clear view',
    clearDone: 'Discord view cleared',
    manualTitle: 'Manual action',
    manualSubtitle: 'One clear form for warn, timeout, kick, ban or unban.',
    targetLabel: 'Discord user',
    targetHint: '@mention or Discord ID',
    actionLabel: 'Action',
    reasonLabel: 'Reason',
    reasonHint: 'Short explanation',
    durationLabel: 'Timeout duration',
    durationHint: 'Example: 10m, 1h, 2d',
    pointsLabel: 'Warning points',
    moderatorIdentityLabel: 'Your Discord',
    moderatorIdentityHint: '@mention or ID to show your profile',
    submitWarn: 'Send warning',
    submitAction: 'Run action',
    identityRequired: 'Your Discord identity is required for this action.',
    targetRequired: 'Enter a valid @mention or Discord ID.',
    durationRequired: 'Enter a valid duration like 10m or 1h.',
    reasonRequired: 'Reason is required.',
    warningSent: 'Warning added',
    actionDone: 'Action executed',
    warningDeleted: 'Warning deleted',
    deleteWarning: 'Delete warning',
    by: 'By',
    target: 'Target',
    reason: 'Reason',
    unknown: 'Unknown',
    idLabel: 'ID',
    actionLabels: {
      warn: 'Warning',
      timeout: 'Temporary mute',
      kick: 'Kick',
      ban: 'Ban',
      unban: 'Unban',
      untimeout: 'Remove mute',
    },
    auditActions: {
      20: 'Kick',
      22: 'Ban',
      23: 'Unban',
      24: 'Member updated',
      25: 'Role updated',
      26: 'Voice moved',
      27: 'Voice disconnected',
      28: 'Bot added',
      72: 'Message deleted',
    },
    unknownAction: 'Action',
  },
  es: {
    title: 'Moderacion',
    noServerTitle: 'Primero elige un servidor',
    noServerText: 'La moderacion estara disponible cuando el servidor quede seleccionado.',
    noServerAction: 'Elegir servidor',
    tabs: { warnings: 'Advertencias', logs: 'Logs', discord: 'Discord', manual: 'Accion manual' },
    warningsTitle: 'Advertencias recientes',
    warningsSubtitle: 'Ves rapidamente los warns activos y quien los hizo.',
    warningsAction: 'Nueva advertencia',
    warningsEmpty: 'No hay advertencias activas.',
    logsTitle: 'Logs',
    logsSubtitle: 'Logs internos del sitio y del bot para este servidor.',
    logsEmpty: 'Todavia no hay logs del sitio.',
    discordTitle: 'Logs de Discord',
    discordSubtitle: 'Acciones obtenidas desde el audit log de Discord.',
    discordEmpty: 'No hay logs recientes de Discord.',
    refresh: 'Actualizar',
    clearDisplayed: 'Limpiar vista',
    clearDone: 'Vista de Discord limpiada',
    manualTitle: 'Accion manual',
    manualSubtitle: 'Un solo formulario claro para warn, timeout, kick, ban o unban.',
    targetLabel: 'Usuario de Discord',
    targetHint: '@mencion o ID de Discord',
    actionLabel: 'Accion',
    reasonLabel: 'Razon',
    reasonHint: 'Explica rapidamente',
    durationLabel: 'Duracion del timeout',
    durationHint: 'Ejemplo: 10m, 1h, 2d',
    pointsLabel: 'Puntos de advertencia',
    moderatorIdentityLabel: 'Tu Discord',
    moderatorIdentityHint: '@mencion o ID para mostrar tu perfil',
    submitWarn: 'Enviar advertencia',
    submitAction: 'Ejecutar accion',
    identityRequired: 'Tu identidad de Discord es obligatoria para esta accion.',
    targetRequired: 'Escribe una @mencion o un ID de Discord valido.',
    durationRequired: 'Escribe una duracion valida como 10m o 1h.',
    reasonRequired: 'La razon es obligatoria.',
    warningSent: 'Advertencia agregada',
    actionDone: 'Accion ejecutada',
    warningDeleted: 'Advertencia eliminada',
    deleteWarning: 'Eliminar advertencia',
    by: 'Por',
    target: 'Objetivo',
    reason: 'Razon',
    unknown: 'Desconocido',
    idLabel: 'ID',
    actionLabels: {
      warn: 'Advertencia',
      timeout: 'Mute temporal',
      kick: 'Expulsar',
      ban: 'Ban',
      unban: 'Desbanear',
      untimeout: 'Quitar mute',
    },
    auditActions: {
      20: 'Expulsion',
      22: 'Ban',
      23: 'Desban',
      24: 'Miembro modificado',
      25: 'Rol modificado',
      26: 'Movimiento de voz',
      27: 'Desconexion de voz',
      28: 'Bot agregado',
      72: 'Mensaje eliminado',
    },
    unknownAction: 'Accion',
  },
}

const LOG_LEVEL_COLORS = {
  info: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10',
  warn: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
  error: 'text-red-300 border-red-500/20 bg-red-500/10',
  success: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
}

function getCopy(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return COPY[key] || COPY.fr
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function parseDurationInput(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*(s|m|h|d)$/i)
  if (!match) return null
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
  return amount * multipliers[unit]
}

function extractDiscordId(reference) {
  const raw = String(reference || '').trim()
  const mentionMatch = raw.match(/^<@!?(\d+)>$/)
  if (mentionMatch) return mentionMatch[1]
  if (/^\d+$/.test(raw)) return raw
  return null
}

function formatDate(locale, value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
}

function getDisplayName(profile, fallback) {
  return profile?.global_name || profile?.username || profile?.id || fallback
}

function getInitials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

function renderAvatar(url, label, accent = 'from-cyan-500/25 to-violet-500/25') {
  if (url) {
    return <img src={url} alt={label} className="w-11 h-11 rounded-2xl object-cover border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.22)]" />
  }

  return (
    <div className={`w-11 h-11 rounded-2xl border border-white/10 bg-gradient-to-br ${accent} flex items-center justify-center text-white/75 font-mono text-xs shadow-[0_10px_30px_rgba(0,0,0,0.22)]`}>
      {getInitials(label)}
    </div>
  )
}

function getAuditActionLabel(type, copy) {
  return copy.auditActions[type] || `${copy.unknownAction} ${type}`
}

export default function ModerationPage() {
  const { locale } = useI18n()
  const copy = getCopy(locale)
  const { guilds, selectedGuildId } = useGuildStore()
  const { user } = useAuthStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [tab, setTab] = useState('warnings')
  const [warnings, setWarnings] = useState([])
  const [siteLogs, setSiteLogs] = useState([])
  const [discordLogs, setDiscordLogs] = useState([])
  const [loadingWarnings, setLoadingWarnings] = useState(false)
  const [loadingSiteLogs, setLoadingSiteLogs] = useState(false)
  const [loadingDiscordLogs, setLoadingDiscordLogs] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [manualForm, setManualForm] = useState({
    target_reference: '',
    action: 'warn',
    reason: '',
    duration: '10m',
    points: 1,
    moderator_discord_identity: '',
  })
  const discordClearKey = useMemo(
    () => `discordforge.discord-log-clear.${user?.id || 'anon'}.${selectedGuildId || 'none'}`,
    [selectedGuildId, user?.id]
  )
  const [discordClearedAfter, setDiscordClearedAfter] = useState(0)

  useEffect(() => {
    const saved = Number(localStorage.getItem(discordClearKey) || '0')
    setDiscordClearedAfter(Number.isFinite(saved) ? saved : 0)
  }, [discordClearKey])

  useEffect(() => {
    if (!selectedGuildId) return
    loadWarnings()
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId || tab !== 'logs') return
    loadSiteLogs()
  }, [selectedGuildId, tab])

  useEffect(() => {
    if (!selectedGuildId || tab !== 'discord') return
    loadDiscordLogs()
  }, [selectedGuildId, tab])

  const visibleDiscordLogs = useMemo(
    () => discordLogs.filter((entry) => !discordClearedAfter || new Date(entry.created_at).getTime() > discordClearedAfter),
    [discordClearedAfter, discordLogs]
  )

  async function loadWarnings(showToast = false) {
    if (!selectedGuildId) return
    setLoadingWarnings(true)
    try {
      const response = await modAPI.warnings(selectedGuildId, { page: 1, limit: 50 })
      setWarnings(response.data.warnings || [])
      if (showToast) toast.success(copy.refresh)
    } catch (error) {
      if (showToast) toast.error(getErrorMessage(error))
    } finally {
      setLoadingWarnings(false)
    }
  }

  async function loadSiteLogs(showToast = false) {
    if (!selectedGuildId) return
    setLoadingSiteLogs(true)
    try {
      const response = await logsAPI.list(selectedGuildId, { page: 1, limit: 50 })
      setSiteLogs(response.data.logs || [])
      if (showToast) toast.success(copy.refresh)
    } catch (error) {
      if (showToast) toast.error(getErrorMessage(error))
    } finally {
      setLoadingSiteLogs(false)
    }
  }

  async function loadDiscordLogs(showToast = false) {
    if (!selectedGuildId) return
    setLoadingDiscordLogs(true)
    try {
      const response = await logsAPI.discord(selectedGuildId, { page: 1, limit: 50 })
      setDiscordLogs(response.data.logs || [])
      if (showToast) toast.success(copy.refresh)
    } catch (error) {
      if (showToast) toast.error(getErrorMessage(error))
    } finally {
      setLoadingDiscordLogs(false)
    }
  }

  async function handleDeleteWarning(warningId) {
    if (!selectedGuildId) return
    try {
      await modAPI.deleteWarning(selectedGuildId, warningId)
      setWarnings((current) => current.filter((warning) => warning.id !== warningId))
      toast.success(copy.warningDeleted)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleManualAction() {
    if (!selectedGuildId || submitting) return

    const targetUserId = extractDiscordId(manualForm.target_reference)
    const reason = manualForm.reason.trim()
    const moderatorIdentity = manualForm.moderator_discord_identity.trim()

    if (!targetUserId) return toast.error(copy.targetRequired)
    if (!reason) return toast.error(copy.reasonRequired)
    if (!user?.is_primary_founder && !moderatorIdentity) return toast.error(copy.identityRequired)

    const payload = {
      target_user_id: targetUserId,
      action: manualForm.action,
      reason,
      moderator_discord_identity: moderatorIdentity || undefined,
    }

    if (manualForm.action === 'timeout') {
      const durationMs = parseDurationInput(manualForm.duration)
      if (!durationMs || durationMs < 60000) return toast.error(copy.durationRequired)
      payload.duration_ms = durationMs
    }

    if (manualForm.action === 'warn') {
      payload.points = Number(manualForm.points || 1)
    }

    setSubmitting(true)
    try {
      await modAPI.action(selectedGuildId, payload)
      toast.success(manualForm.action === 'warn' ? copy.warningSent : copy.actionDone)
      setManualForm((current) => ({
        ...current,
        target_reference: '',
        reason: '',
      }))
      await loadWarnings()
      if (tab === 'logs') await loadSiteLogs()
      if (tab === 'discord') await loadDiscordLogs()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  function clearDiscordView() {
    const now = Date.now()
    setDiscordClearedAfter(now)
    localStorage.setItem(discordClearKey, String(now))
    toast.success(copy.clearDone)
  }

  if (!selectedGuildId) {
    return (
      <div className="p-6 max-w-3xl mx-auto pt-24">
        <div className="glass-card p-10 text-center">
          <Shield className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">{copy.noServerTitle}</p>
          <p className="text-white/40 mt-2">{copy.noServerText}</p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            {copy.noServerAction}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">{copy.title}</h1>
          <p className="text-white/40 text-sm">{guild?.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ['warnings', copy.tabs.warnings],
            ['logs', copy.tabs.logs],
            ['discord', copy.tabs.discord],
            ['manual', copy.tabs.manual],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-xl border text-sm font-mono transition-all ${
                tab === id
                  ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan shadow-[0_0_20px_rgba(34,211,238,0.14)]'
                  : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white hover:border-white/20'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'warnings' && (
        <div className="space-y-4">
          <div className="glass-card p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-display font-700 text-white text-lg">{copy.warningsTitle}</p>
              <p className="text-white/40 text-sm mt-1">{copy.warningsSubtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => loadWarnings(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${loadingWarnings ? 'animate-spin' : ''}`} />
                {copy.refresh}
              </button>
              <button
                onClick={() => {
                  setTab('manual')
                  setManualForm((current) => ({ ...current, action: 'warn' }))
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-300 text-sm font-mono hover:bg-amber-500/15 transition-all"
              >
                <AlertTriangle className="w-4 h-4" />
                {copy.warningsAction}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {loadingWarnings && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-2xl skeleton" />)}
            {!loadingWarnings && warnings.length === 0 && (
              <div className="glass-card p-8 text-center text-white/40 font-mono text-sm">
                {copy.warningsEmpty}
              </div>
            )}

            {!loadingWarnings && warnings.map((warning) => {
              const metadata = warning.metadata || {}
              const moderatorName = metadata.moderator_display_name || metadata.moderator_site_username || warning.moderator_username || copy.unknown
              const moderatorAvatar = metadata.moderator_discord_avatar_url || metadata.moderator_site_avatar_url || null
              const targetName = warning.target_username || warning.target_user_id
              const targetAvatar = metadata.target_avatar_url || null

              return (
                <motion.div
                  key={warning.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card p-5 flex flex-col gap-4 md:flex-row md:items-start"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {renderAvatar(targetAvatar, targetName, 'from-amber-500/25 to-orange-500/25')}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-white font-display font-700 truncate">{targetName}</p>
                        <span className="px-2.5 py-1 rounded-full text-xs font-mono border border-amber-500/20 bg-amber-500/10 text-amber-300">
                          {warning.points} pt
                        </span>
                      </div>
                      <p className="text-white/70 text-sm mt-1">{warning.reason}</p>
                      <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-white/35 font-mono">
                        <span>{formatDate(locale, warning.created_at)}</span>
                        <span>{copy.idLabel}: {warning.target_user_id}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 md:flex-col md:items-end md:min-w-[220px]">
                    <div className="flex items-center gap-3">
                      {renderAvatar(moderatorAvatar, moderatorName, 'from-cyan-500/25 to-violet-500/25')}
                      <div className="text-right">
                        <p className="text-xs text-white/35 font-mono">{copy.by}</p>
                        <p className="text-sm text-white">{moderatorName}</p>
                        {(metadata.moderator_discord_id || metadata.moderator_discord_identity) && (
                          <p className="text-[11px] text-white/30 font-mono">
                            {metadata.moderator_discord_id || metadata.moderator_discord_identity}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteWarning(warning.id)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm font-mono hover:bg-red-500/15 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                      {copy.deleteWarning}
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-4">
          <div className="glass-card p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-display font-700 text-white text-lg">{copy.logsTitle}</p>
              <p className="text-white/40 text-sm mt-1">{copy.logsSubtitle}</p>
            </div>
            <button
              onClick={() => loadSiteLogs(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loadingSiteLogs ? 'animate-spin' : ''}`} />
              {copy.refresh}
            </button>
          </div>

          <div className="space-y-3">
            {loadingSiteLogs && [...Array(3)].map((_, index) => <div key={index} className="h-24 rounded-2xl skeleton" />)}
            {!loadingSiteLogs && siteLogs.length === 0 && (
              <div className="glass-card p-8 text-center text-white/40 font-mono text-sm">
                {copy.logsEmpty}
              </div>
            )}

            {!loadingSiteLogs && siteLogs.map((log) => (
              <div key={log.id} className="glass-card p-5 flex items-start gap-4">
                <div className="w-11 h-11 rounded-2xl border border-white/10 bg-white/[0.03] flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-white/55" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-mono border ${LOG_LEVEL_COLORS[log.level] || 'text-white/70 border-white/10 bg-white/[0.05]'}`}>
                      {String(log.level || 'info').toUpperCase()}
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-mono border border-white/10 bg-white/[0.03] text-white/50">
                      {log.category || copy.logsTitle}
                    </span>
                    <span className="text-xs text-white/30 font-mono">{formatDate(locale, log.created_at)}</span>
                  </div>
                  <p className="text-white text-sm">{log.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'discord' && (
        <div className="space-y-4">
          <div className="glass-card p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-display font-700 text-white text-lg">{copy.discordTitle}</p>
              <p className="text-white/40 text-sm mt-1">{copy.discordSubtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => loadDiscordLogs(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${loadingDiscordLogs ? 'animate-spin' : ''}`} />
                {copy.refresh}
              </button>
              <button
                onClick={clearDiscordView}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-300 text-sm font-mono hover:bg-amber-500/15 transition-all"
              >
                <Trash2 className="w-4 h-4" />
                {copy.clearDisplayed}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {loadingDiscordLogs && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-2xl skeleton" />)}
            {!loadingDiscordLogs && visibleDiscordLogs.length === 0 && (
              <div className="glass-card p-8 text-center text-white/40 font-mono text-sm">
                {copy.discordEmpty}
              </div>
            )}

            {!loadingDiscordLogs && visibleDiscordLogs.map((entry) => {
              const executor = entry.executor || {}
              const target = entry.target || {}
              const executorName = getDisplayName(executor, copy.unknown)
              const targetName = getDisplayName(target, copy.unknown)

              return (
                <div key={entry.id} className="glass-card p-5 space-y-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      {renderAvatar(executor.avatar_url, executorName, 'from-cyan-500/25 to-blue-500/25')}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-white font-display font-700 truncate">{executorName}</p>
                          <span className="px-2.5 py-1 rounded-full text-xs font-mono border border-white/10 bg-white/[0.03] text-white/65">
                            {getAuditActionLabel(entry.action_type, copy)}
                          </span>
                        </div>
                        <p className="text-xs text-white/35 font-mono mt-1">
                          {copy.idLabel}: {executor.id || copy.unknown}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-white/35 font-mono">{formatDate(locale, entry.created_at)}</p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                      <p className="text-xs font-mono text-white/30 mb-2">{copy.target}</p>
                      <div className="flex items-center gap-3">
                        {renderAvatar(target.avatar_url, targetName, 'from-violet-500/25 to-fuchsia-500/25')}
                        <div className="min-w-0">
                          <p className="text-white text-sm truncate">{targetName}</p>
                          <p className="text-xs text-white/35 font-mono">{copy.idLabel}: {target.id || copy.unknown}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                      <p className="text-xs font-mono text-white/30 mb-2">{copy.reason}</p>
                      <p className="text-white/80 text-sm">{entry.reason || '—'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'manual' && (
        <div className="glass-card p-6 max-w-3xl space-y-5">
          <div>
            <p className="font-display font-700 text-white text-lg">{copy.manualTitle}</p>
            <p className="text-white/40 text-sm mt-1">{copy.manualSubtitle}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.targetLabel}</span>
              <input
                className="input-field"
                placeholder={copy.targetHint}
                value={manualForm.target_reference}
                onChange={(event) => setManualForm((current) => ({ ...current, target_reference: event.target.value }))}
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.actionLabel}</span>
              <select
                className="select-field"
                value={manualForm.action}
                onChange={(event) => setManualForm((current) => ({ ...current, action: event.target.value }))}
              >
                {Object.entries(copy.actionLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            {!user?.is_primary_founder && (
              <label className="space-y-2 md:col-span-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.moderatorIdentityLabel}</span>
                <input
                  className="input-field"
                  placeholder={copy.moderatorIdentityHint}
                  value={manualForm.moderator_discord_identity}
                  onChange={(event) => setManualForm((current) => ({ ...current, moderator_discord_identity: event.target.value }))}
                />
              </label>
            )}

            {manualForm.action === 'timeout' && (
              <label className="space-y-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.durationLabel}</span>
                <input
                  className="input-field"
                  placeholder={copy.durationHint}
                  value={manualForm.duration}
                  onChange={(event) => setManualForm((current) => ({ ...current, duration: event.target.value }))}
                />
              </label>
            )}

            {manualForm.action === 'warn' && (
              <label className="space-y-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.pointsLabel}</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className="input-field"
                  value={manualForm.points}
                  onChange={(event) => setManualForm((current) => ({ ...current, points: Number(event.target.value || 1) }))}
                />
              </label>
            )}

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">{copy.reasonLabel}</span>
              <textarea
                className="input-field min-h-[120px] resize-y"
                placeholder={copy.reasonHint}
                value={manualForm.reason}
                onChange={(event) => setManualForm((current) => ({ ...current, reason: event.target.value }))}
              />
            </label>
          </div>

          <button
            onClick={handleManualAction}
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-60"
          >
            <Gavel className="w-4 h-4" />
            {manualForm.action === 'warn' ? copy.submitWarn : copy.submitAction}
          </button>
        </div>
      )}
    </div>
  )
}
