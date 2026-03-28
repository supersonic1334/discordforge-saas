import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  Clock3,
  Copy,
  Fingerprint,
  History,
  LogOut,
  MessageCircle,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Link2,
  UserCheck,
  UserRoundX,
  Users,
  XCircle,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { authAPI, messagesAPI, modAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { openDiscordLinkPopup } from '../utils/discordLinkPopup'
import {
  ACTION_COLORS,
  ACTION_LABELS,
  formatDate,
  getErrorMessage,
  initials,
  parseDurationInput,
  renderAvatar,
  SelectGuildState,
  SummaryCard,
} from '../components/moderation/moderationUI'

const QUICK_ACTIONS = [
  { id: 'warn', label: 'Warn', icon: AlertTriangle, tone: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  { id: 'timeout', label: 'Timeout', icon: Clock3, tone: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' },
  { id: 'untimeout', label: 'Retirer timeout', icon: XCircle, tone: 'border-sky-500/20 bg-sky-500/10 text-sky-300' },
  { id: 'kick', label: 'Kick', icon: LogOut, tone: 'border-orange-500/20 bg-orange-500/10 text-orange-300' },
  { id: 'ban', label: 'Ban', icon: Ban, tone: 'border-red-500/20 bg-red-500/10 text-red-300' },
  { id: 'blacklist', label: 'Blacklist reseau', icon: Fingerprint, tone: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
  { id: 'unban', label: 'Deban', icon: UserCheck, tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
]

const SEARCH_DISCORD_LINK_STATE_KEY = 'discordforger.search.discord-link-state'

function saveDiscordLinkSearchState(state) {
  try {
    window.sessionStorage.setItem(SEARCH_DISCORD_LINK_STATE_KEY, JSON.stringify({
      guildId: state.guildId || null,
      query: state.query || '',
      selectedUserId: state.selectedUserId || '',
      timestamp: Date.now(),
    }))
  } catch {}
}

function consumeDiscordLinkSearchState(expectedGuildId) {
  try {
    const raw = window.sessionStorage.getItem(SEARCH_DISCORD_LINK_STATE_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(SEARCH_DISCORD_LINK_STATE_KEY)
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (expectedGuildId && parsed.guildId && String(parsed.guildId) !== String(expectedGuildId)) return null
    return {
      query: String(parsed.query || ''),
      selectedUserId: String(parsed.selectedUserId || ''),
    }
  } catch {
    return null
  }
}

function Avatar({ src, label, size = 'w-16 h-16' }) {
  if (src) return <img src={src} alt={label} className={`${size} rounded-[22px] object-cover border border-white/10 shadow-[0_18px_36px_rgba(0,0,0,0.22)]`} />

  return (
    <div className={`${size} rounded-[22px] border border-white/10 bg-gradient-to-br from-cyan-500/25 to-violet-500/25 flex items-center justify-center text-white/75 font-mono text-sm shadow-[0_18px_36px_rgba(0,0,0,0.22)]`}>
      {initials(label)}
    </div>
  )
}

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

function ResultRow({ entry, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`spotlight-card spotlight-ring w-full p-4 text-left transition-all duration-300 ${active ? 'border-neon-cyan/25 bg-neon-cyan/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_18px_42px_rgba(0,0,0,0.35),0_0_28px_rgba(34,211,238,0.10)]' : 'hover:-translate-y-[2px] hover:border-white/15 hover:bg-white/[0.05]'}`}>
      <div className="flex items-center gap-3">
        <Avatar src={entry.avatar_url} label={entry.display_name || entry.username || entry.id} size="w-12 h-12" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display font-700 text-white truncate">{entry.display_name || entry.username || entry.id}</p>
            {entry.banned ? <span className="badge-error">Banni</span> : null}
            {entry.in_server ? <span className="badge-online">Dans le serveur</span> : null}
            {!entry.in_server && !entry.banned ? <span className="badge-offline">Hors serveur</span> : null}
          </div>
          <p className="mt-1 truncate text-sm text-white/50">@{entry.username || entry.id}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-mono text-white/30">
            <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1">ID {entry.id}</span>
            {entry.warning_count ? <span className="rounded-full border border-amber-500/15 bg-amber-500/8 px-2.5 py-1 text-amber-200/80">{entry.warning_count} warn</span> : null}
          </div>
        </div>
      </div>
    </button>
  )
}

function HistoryRow({ entry, locale }) {
  const color = ACTION_COLORS[entry.action] || 'border-white/10 bg-white/[0.04] text-white/60'
  const detail = entry.reason || 'Aucune raison precisee.'

  return (
    <div className="relative ml-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4 backdrop-blur-sm">
      <span className="absolute -left-[23px] top-5 h-3 w-3 rounded-full border border-neon-cyan/40 bg-neon-cyan/25 shadow-[0_0_18px_rgba(34,211,238,0.28)]" />
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono ${color}`}>{ACTION_LABELS[entry.action] || entry.label || entry.action}</span>
        <span className="text-[11px] font-mono text-white/30">{formatDate(locale, entry.created_at)}</span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        {renderAvatar(entry.moderator?.avatar_url, entry.moderator?.name || 'Staff', 'from-violet-500/25 to-fuchsia-500/25', 'w-10 h-10')}
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-line text-sm leading-6 text-white">{detail}</p>
          <p className="mt-1 text-xs text-white/40">Par {entry.moderator?.name || 'Staff'}{entry.points ? ` - ${entry.points} point${entry.points > 1 ? 's' : ''}` : ''}{entry.duration_ms ? ` - ${Math.round(entry.duration_ms / 60000)} min` : ''}</p>
        </div>
      </div>
    </div>
  )
}

function ActionModal({ action, target, values, onChange, canUseDiscordActions, linkedDiscordId, onConnectDiscord, connectingDiscord, onClose, onSubmit, submitting }) {
  const actionMeta = QUICK_ACTIONS.find((entry) => entry.id === action) || QUICK_ACTIONS[0]
  const Icon = actionMeta.icon
  const canHideIdentity = ['warn', 'timeout', 'kick', 'ban', 'blacklist'].includes(action)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} className="feature-hero w-full max-w-xl p-6 space-y-5" onClick={(event) => event.stopPropagation()}>
        <div className="relative z-[1] flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${actionMeta.tone}`}><Icon className="w-5 h-5" /></div>
          <div>
            <p className="font-display font-700 text-xl text-white">{actionMeta.label}</p>
            <p className="text-sm text-white/45">Action sur {target?.display_name || target?.username || target?.id}</p>
          </div>
        </div>
        <div className="relative z-[1] grid gap-4">
          <textarea className="input-field min-h-[120px] resize-y" value={values.reason} onChange={(event) => onChange((current) => ({ ...current, reason: event.target.value }))} placeholder="Raison" />
          {(action === 'timeout' || action === 'warn') && (
            <div className="grid gap-4 md:grid-cols-2">
              {action === 'timeout' ? <input className="input-field" value={values.duration} onChange={(event) => onChange((current) => ({ ...current, duration: event.target.value }))} placeholder="10m, 1h, 1d" /> : null}
              {action === 'warn' ? <input className="input-field" value={values.points} onChange={(event) => onChange((current) => ({ ...current, points: event.target.value }))} placeholder="Points" inputMode="numeric" /> : null}
            </div>
          )}
          {canHideIdentity ? (
            <label className="flex items-start gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/75">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-cyan-400"
                checked={Boolean(values.hideIdentity)}
                onChange={(event) => onChange((current) => ({ ...current, hideIdentity: event.target.checked }))}
              />
              <span className="leading-6">
                Masquer mon identite dans le MP recu par le membre. Les logs staff garderont ton vrai nom.
              </span>
            </label>
          ) : null}
          {canUseDiscordActions ? (
            <div className="rounded-[22px] border border-emerald-500/20 bg-emerald-500/10 p-4">
              <p className="font-display font-700 text-sm text-emerald-200">Compte Discord verifie</p>
              <p className="mt-2 text-sm leading-6 text-emerald-100/80">
                Les actions rapides utiliseront automatiquement ton compte Discord lie{linkedDiscordId ? ` (${linkedDiscordId})` : ''}.
              </p>
            </div>
          ) : (
            <div className="rounded-[22px] border border-amber-500/20 bg-amber-500/10 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl border border-amber-400/20 bg-amber-400/10 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <p className="font-display font-700 text-sm text-amber-100">Connexion Discord requise</p>
                  <p className="mt-1 text-sm leading-6 text-amber-100/75">
                    Pour warn, timeout, kick, ban ou blacklist reseau, tu dois lier ton compte Discord au site. La verification des permissions se fera ensuite automatiquement.
                  </p>
                </div>
              </div>
              <button type="button" onClick={onConnectDiscord} disabled={connectingDiscord} className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-mono text-amber-100 transition-all hover:bg-amber-400/15 disabled:opacity-50">
                <Link2 className="w-4 h-4" />
                {connectingDiscord ? 'Connexion...' : 'Connecter mon compte Discord'}
              </button>
            </div>
          )}
        </div>
        <div className="relative z-[1] flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white/70 transition-all hover:border-white/20 hover:text-white">Annuler</button>
          <button type="button" onClick={onSubmit} disabled={submitting || !canUseDiscordActions} className="flex-1 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50">{submitting ? 'Execution...' : 'Confirmer'}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function DirectMessageModal({ target, values, onChange, onClose, onSubmit, submitting }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.97 }} className="feature-hero w-full max-w-xl p-6 space-y-5" onClick={(event) => event.stopPropagation()}>
        <div className="relative z-[1] flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center"><MessageCircle className="w-5 h-5 text-violet-300" /></div>
          <div>
            <p className="font-display font-700 text-xl text-white">Envoyer un MP</p>
            <p className="text-sm text-white/45">Message prive a {target?.display_name || target?.username || target?.id}</p>
          </div>
        </div>
        <div className="relative z-[1] space-y-4">
          <input className="input-field" value={values.title} onChange={(event) => onChange((current) => ({ ...current, title: event.target.value }))} placeholder="Titre" />
          <textarea className="input-field min-h-[160px] resize-y" value={values.message} onChange={(event) => onChange((current) => ({ ...current, message: event.target.value }))} placeholder="Message" />
        </div>
        <div className="relative z-[1] flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white/70 transition-all hover:border-white/20 hover:text-white">Annuler</button>
          <button type="button" onClick={onSubmit} disabled={submitting || !values.message.trim()} className="flex-1 rounded-2xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 text-violet-200 transition-all hover:bg-violet-500/15 disabled:opacity-50">{submitting ? 'Envoi...' : 'Envoyer'}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function hasActiveTimeout(profile) {
  if (!profile?.in_server) return false
  if (typeof profile?.timeout_active === 'boolean') return profile.timeout_active
  const rawValue = String(profile?.timed_out_until || '').trim()
  if (!rawValue) return false
  const normalized = rawValue.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/, '$1')
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

export default function SearchPage() {
  const { locale } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, fetchMe } = useAuthStore()
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [profileData, setProfileData] = useState(null)
  const [loadingResults, setLoadingResults] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionModal, setActionModal] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)
  const [linkingDiscord, setLinkingDiscord] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)
  const [sendingDm, setSendingDm] = useState(false)
  const [actionValues, setActionValues] = useState({ reason: '', duration: '', points: '1', hideIdentity: false })
  const [dmValues, setDmValues] = useState({ title: '', message: '' })

  const selectedResult = useMemo(() => results.find((entry) => entry.id === selectedUserId) || null, [results, selectedUserId])

  useEffect(() => {
    setQuery('')
    setResults([])
    setSelectedUserId('')
    setProfileData(null)
    setActionModal('')
    setDmOpen(false)
  }, [selectedGuildId])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const linked = params.get('discord_linked')
    const linkError = params.get('discord_link_error')
    if (!linked && !linkError) return

    fetchMe()
    const restoredState = linked === '1' ? consumeDiscordLinkSearchState(selectedGuildId) : null
    if (linked === '1') {
      toast.success('Compte Discord connecte avec succes')
    } else if (linkError) {
      toast.error(linkError)
    }

    params.delete('discord_linked')
    params.delete('discord_link_error')
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true })

    if (restoredState) {
      setQuery(restoredState.query)
      if (restoredState.query) {
        void runSearch(restoredState.query, { preferredUserId: restoredState.selectedUserId })
      } else if (restoredState.selectedUserId) {
        void loadProfile(restoredState.selectedUserId, { silent: true })
      }
    }
  }, [fetchMe, location.pathname, location.search, navigate, selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return

    const params = new URLSearchParams(location.search)
    const queryFromUrl = String(params.get('q') || '').trim()
    const userIdFromUrl = String(params.get('userId') || '').trim()
    if (!queryFromUrl && !userIdFromUrl) return

    if (queryFromUrl) {
      setQuery(queryFromUrl)
      void runSearch(queryFromUrl, { preferredUserId: userIdFromUrl || selectedUserId })
      return
    }

    if (userIdFromUrl) {
      void loadProfile(userIdFromUrl, { silent: true })
    }
  }, [location.search, selectedGuildId])

  async function loadProfile(userId, { silent = false } = {}) {
    if (!selectedGuildId || !userId) return
    if (silent) setRefreshing(true)
    else setLoadingProfile(true)
    try {
      const response = await modAPI.userProfile(selectedGuildId, userId)
      setProfileData(response.data || null)
      setSelectedUserId(userId)
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      setLoadingProfile(false)
      setRefreshing(false)
    }
  }

  async function runSearch(searchQuery, options = {}) {
    const normalizedQuery = String(searchQuery || '').trim()
    const preferredUserId = String(options.preferredUserId || '')
    if (!selectedGuildId || !normalizedQuery) return
    setLoadingResults(true)
    setProfileData(null)
    setSelectedUserId('')
    try {
      const response = await modAPI.searchUsers(selectedGuildId, { q: normalizedQuery, limit: 10 })
      const nextResults = response.data?.results || []
      setResults(nextResults)
      const nextSelectedUserId = preferredUserId && nextResults.some((entry) => entry.id === preferredUserId)
        ? preferredUserId
        : (nextResults[0]?.id || '')
      if (nextSelectedUserId) await loadProfile(nextSelectedUserId, { silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setLoadingResults(false)
    }
  }

  async function handleSearch() {
    await runSearch(query)
  }

  async function handleSubmitAction() {
    if (!selectedGuildId || !selectedUserId || !actionModal || submittingAction) return
    if (!canUseDiscordActions) {
      toast.error('Connecte d abord ton compte Discord')
      return
    }
    const payload = {
      action: actionModal,
      target_user_id: selectedUserId,
      target_username: profileData?.profile?.display_name || selectedResult?.display_name || selectedUserId,
      reason: actionValues.reason.trim() || 'Action rapide depuis Search',
      hide_moderator_identity: Boolean(actionValues.hideIdentity),
    }
    if (actionModal === 'timeout') {
      const durationMs = parseDurationInput(actionValues.duration.trim())
      if (!durationMs) return toast.error('Duree invalide')
      payload.duration_ms = durationMs
    }
    if (actionModal === 'warn') payload.points = Number(actionValues.points || 1) || 1

    setSubmittingAction(true)
    try {
      await modAPI.action(selectedGuildId, payload)
      toast.success(`${ACTION_LABELS[actionModal] || actionModal} execute`)
      setActionModal('')
      await loadProfile(selectedUserId, { silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSubmittingAction(false)
    }
  }

  async function handleConnectDiscord() {
    if (linkingDiscord) return
    setLinkingDiscord(true)
    try {
      const returnTo = `${location.pathname}${location.search || ''}`
      const response = await authAPI.createDiscordLink({ return_to: returnTo, mode: 'popup' })
      const nextUrl = response?.data?.url
      if (!nextUrl) throw new Error('Lien Discord indisponible')
      const result = await openDiscordLinkPopup(nextUrl)
      if (result?.status !== 'success') {
        throw new Error(result?.error || 'discord_link_failed')
      }

      await fetchMe()

      if (query.trim()) {
        await runSearch(query, { preferredUserId: selectedUserId })
      } else if (selectedUserId) {
        await loadProfile(selectedUserId, { silent: true })
      }

      toast.success('Compte Discord connecte avec succes')
    } catch (error) {
      if (String(error?.message || '') !== 'Popup fermee') {
        toast.error(getErrorMessage(error))
      }
    } finally {
      setLinkingDiscord(false)
    }
  }

  async function handleSendDM() {
    if (!selectedGuildId || !selectedUserId || !dmValues.message.trim() || sendingDm) return
    setSendingDm(true)
    try {
      await messagesAPI.send(selectedGuildId, {
        target_user_id: selectedUserId,
        target_username: profileData?.profile?.display_name || selectedResult?.display_name || selectedUserId,
        title: dmValues.title.trim() || 'Message du staff',
        message: dmValues.message.trim(),
      })
      toast.success('MP envoye')
      setDmValues({ title: '', message: '' })
      setDmOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSendingDm(false)
    }
  }

  async function handleCopyId() {
    if (!selectedUserId) return
    try {
      await navigator.clipboard.writeText(selectedUserId)
      toast.success('ID copie')
    } catch {
      toast.error('Copie impossible')
    }
  }

  const actionHistory = profileData?.combined_history || []
  const profile = profileData?.profile || null
  const viewer = profileData?.viewer || null
  const siteSummary = profileData?.site?.summary || {}
  const discordSummary = profileData?.discord?.summary || {}
  const roles = profile?.roles || []
  const timeoutActive = hasActiveTimeout(profile)
  const linkedDiscordId = user?.discord_id || null
  const canUseDiscordActions = Boolean(linkedDiscordId)

  if (!selectedGuildId) {
    return <SelectGuildState title="Choisis d'abord un serveur" body="La recherche utilisateur fonctionne serveur par serveur." actionLabel="Choisir un serveur" />
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={Search} label="Search" />
              <HeaderPill icon={ShieldCheck} label="moderation rapide" />
              <HeaderPill icon={Users} label={guild?.name || 'serveur'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Recherche & actions</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">Trouve un membre en quelques secondes, ouvre sa fiche complete et lance les actions utiles sans te perdre dans des menus.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
            <div className="feature-metric"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Resultats</p><p className="mt-2 font-display text-2xl font-800 text-white">{results.length}</p></div>
            <div className="feature-metric"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Warnings</p><p className="mt-2 font-display text-2xl font-800 text-white">{siteSummary.total_warnings || 0}</p></div>
            <div className="feature-metric"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Historique</p><p className="mt-2 font-display text-2xl font-800 text-white">{actionHistory.length}</p></div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="spotlight-card p-5 sm:p-6">
            <div className="relative z-[1] space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5 text-neon-cyan" /></div>
                <div><p className="font-display font-700 text-lg text-white">Recherche utilisateur</p><p className="mt-1 text-sm text-white/40">Pseudo, surnom ou ID Discord.</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <HeaderPill icon={Search} label="pseudo" />
                <HeaderPill icon={Copy} label="id discord" />
                <HeaderPill icon={Shield} label="fiche complete" />
              </div>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input className="input-field pl-11" placeholder="Exemple: pseudo ou ID Discord" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleSearch() } }} />
                </div>
                <button type="button" onClick={handleSearch} disabled={!query.trim() || loadingResults} className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"><Search className={`w-4 h-4 ${loadingResults ? 'animate-pulse' : ''}`} />Rechercher</button>
              </div>
            </div>
          </div>

          <div className="spotlight-card p-4">
            <div className="relative z-[1] flex items-center justify-between gap-3 px-1 pb-2">
              <div><p className="font-display font-700 text-white">Resultats</p><p className="mt-1 text-xs text-white/35">Selection directe et lecture instantanee.</p></div>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/40">{results.length} trouves</span>
            </div>
            <div className="relative z-[1] mt-3 space-y-3">
              {loadingResults && [...Array(4)].map((_, index) => <div key={index} className="h-20 rounded-[22px] skeleton" />)}
              {!loadingResults && results.length === 0 ? <div className="rounded-[22px] border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/40">{query.trim() ? 'Aucun resultat.' : 'Lance une recherche pour charger une fiche membre.'}</div> : null}
              {!loadingResults && results.map((entry) => <ResultRow key={entry.id} entry={entry} active={selectedUserId === entry.id} onClick={() => loadProfile(entry.id)} />)}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {!loadingProfile && !profile ? <div className="feature-hero p-10 text-center"><div className="relative z-[1]"><UserRoundX className="w-12 h-12 text-white/10 mx-auto mb-4" /><p className="font-display font-700 text-xl text-white">Aucune fiche ouverte</p><p className="mt-2 text-white/40">Selectionne un resultat a gauche pour ouvrir le profil detaille et les actions rapides.</p></div></div> : null}
          {loadingProfile && [...Array(3)].map((_, index) => <div key={index} className="h-40 rounded-[28px] skeleton" />)}
          {!loadingProfile && profile ? (
            <>
              <div className="feature-hero p-6 sm:p-7">
                <div className="relative z-[1] space-y-6">
                  <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex items-start gap-5">
                      <Avatar src={profile.avatar_url} label={profile.display_name || profile.username || profile.id} size="w-24 h-24" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-display font-800 text-3xl text-white truncate">{profile.display_name || profile.username || profile.id}</h2>
                          {profile.banned ? <span className="badge-error">Banni</span> : null}
                          {profile.network_blacklisted ? <span className="badge-warning">Blacklist reseau</span> : null}
                          {profile.in_server ? <span className="badge-online">Dans le serveur</span> : null}
                          {!profile.in_server && !profile.banned ? <span className="badge-offline">Hors serveur</span> : null}
                          {timeoutActive ? <span className="badge-warning">Timeout actif</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-white/55">@{profile.username || profile.id}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-white/35 font-mono">
                          <span>ID: {profile.id}</span>
                          <span>Cree: {formatDate(locale, profile.created_at)}</span>
                          {profile.joined_at ? <span>Rejoint: {formatDate(locale, profile.joined_at)}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => loadProfile(selectedUserId, { silent: true })} disabled={refreshing} className="btn-ghost inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />Recharger</button>
                      <button type="button" onClick={handleCopyId} className="btn-ghost inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><Copy className="w-4 h-4" />Copier ID</button>
                      <button type="button" onClick={() => setDmOpen(true)} className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 text-violet-200 transition-all hover:bg-violet-500/15"><MessageCircle className="w-4 h-4" />MP</button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-4">
                    <SummaryCard label="Warnings" value={siteSummary.total_warnings || 0} tone="border-amber-500/20 bg-amber-500/10 text-amber-300" />
                    <SummaryCard label="Points actifs" value={siteSummary.active_warning_points || 0} tone="border-red-500/20 bg-red-500/10 text-red-300" />
                    <SummaryCard label="Actions site" value={siteSummary.total_actions || 0} tone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan" />
                    <SummaryCard label="Actions Discord" value={discordSummary.total_actions || 0} tone="border-violet-500/20 bg-violet-500/10 text-violet-300" />
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_340px]">
                <div className="spotlight-card p-6">
                  <div className="relative z-[1] space-y-5">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0"><Shield className="w-5 h-5 text-neon-cyan" /></div>
                      <div><p className="font-display font-700 text-lg text-white">Actions rapides</p><p className="mt-1 text-sm text-white/40">Tout reste centre sur cette fiche.</p></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {QUICK_ACTIONS.map((entry) => {
                        const Icon = entry.icon
                        const disabledForPermissions = Boolean(viewer?.linked_discord) && (
                          (entry.id === 'warn' && !viewer?.can_warn)
                          || (entry.id === 'timeout' && !viewer?.can_timeout)
                          || (entry.id === 'untimeout' && !viewer?.can_timeout)
                          || (entry.id === 'kick' && !viewer?.can_kick)
                          || (entry.id === 'ban' && !viewer?.can_ban)
                          || (entry.id === 'blacklist' && !viewer?.can_blacklist_network)
                          || (entry.id === 'unban' && !viewer?.can_unban)
                        )
                        if (entry.id === 'ban' && profile.banned) return null
                        if (entry.id === 'blacklist' && profile.network_blacklisted) return null
                        if (entry.id === 'unban' && !profile.banned) return null
                        if (entry.id === 'untimeout' && !timeoutActive) return null
                        return <button key={entry.id} type="button" disabled={disabledForPermissions} onClick={() => { setActionValues({ reason: '', duration: '', points: '1', hideIdentity: false }); setActionModal(entry.id) }} className={`spotlight-card w-full rounded-[22px] border px-4 py-4 text-left transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-35 ${entry.tone}`}><div className="flex items-start gap-3"><div><div className="flex items-center gap-2"><Icon className="w-4 h-4" /><span className="font-mono text-sm">{entry.label}</span></div><p className="mt-3 text-xs text-white/55">{viewer?.linked_discord ? 'Action rapide sans quitter la fiche.' : 'Clique pour connecter Discord puis executer l action.'}</p></div></div></button>
                      })}
                    </div>
                  </div>
                </div>
                <div className="space-y-5">
                  <div className="spotlight-card p-5"><div className="relative z-[1] space-y-4"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0"><History className="w-5 h-5 text-violet-300" /></div><div><p className="font-display font-700 text-white">Permissions</p><p className="mt-1 text-sm text-white/40">Ce moderateur peut faire maintenant.</p></div></div><div className="flex flex-wrap gap-2">{viewer?.can_warn ? <span className="badge-online">Warn</span> : <span className="badge-offline">Warn</span>}{viewer?.can_timeout ? <span className="badge-online">Timeout</span> : <span className="badge-offline">Timeout</span>}{viewer?.can_kick ? <span className="badge-online">Kick</span> : <span className="badge-offline">Kick</span>}{viewer?.can_ban ? <span className="badge-online">Ban</span> : <span className="badge-offline">Ban</span>}{viewer?.can_blacklist_network ? <span className="badge-online">Blacklist reseau</span> : <span className="badge-offline">Blacklist reseau</span>}{viewer?.can_unban ? <span className="badge-online">Unban</span> : <span className="badge-offline">Unban</span>}</div></div></div>
                  <div className="spotlight-card p-5"><div className="relative z-[1] space-y-4"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-white/70" /></div><div><p className="font-display font-700 text-white">Roles visibles</p><p className="mt-1 text-sm text-white/40">Resume propre des roles detectes.</p></div></div><div className="flex flex-wrap gap-2">{roles.length > 0 ? roles.slice(0, 10).map((role) => <span key={role.id} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-mono text-white/70">@{role.name}</span>) : <span className="text-sm text-white/35">Aucun role visible.</span>}</div></div></div>
                </div>
              </div>

              <div className="spotlight-card p-6">
                <div className="relative z-[1] space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0"><History className="w-5 h-5 text-violet-300" /></div>
                    <div><p className="font-display font-700 text-lg text-white">Historique complet</p><p className="mt-1 text-sm text-white/40">Site et Discord dans une seule chronologie lisible.</p></div>
                  </div>
                  {actionHistory.length === 0 ? <div className="rounded-[22px] border border-white/8 bg-white/[0.02] p-6 text-center text-sm text-white/40">Aucun historique de moderation pour ce profil.</div> : <div className="timeline-shell space-y-3 pl-2">{actionHistory.map((entry) => <HistoryRow key={entry.id} entry={entry} locale={locale} />)}</div>}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <AnimatePresence>{actionModal ? <ActionModal action={actionModal} target={profile} values={actionValues} onChange={setActionValues} canUseDiscordActions={canUseDiscordActions} linkedDiscordId={linkedDiscordId} onConnectDiscord={handleConnectDiscord} connectingDiscord={linkingDiscord} onClose={() => setActionModal('')} onSubmit={handleSubmitAction} submitting={submittingAction} /> : null}</AnimatePresence>
      <AnimatePresence>{dmOpen ? <DirectMessageModal target={profile} values={dmValues} onChange={setDmValues} onClose={() => setDmOpen(false)} onSubmit={handleSendDM} submitting={sendingDm} /> : null}</AnimatePresence>
    </div>
  )
}
