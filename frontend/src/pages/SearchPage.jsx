import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Clock3,
  Copy,
  History,
  LogOut,
  MessageCircle,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserRoundX,
  Users,
  XCircle,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { messagesAPI, modAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
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
  { id: 'unban', label: 'Deban', icon: UserCheck, tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
]

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
          <p className="text-sm text-white">{entry.reason || 'Aucune raison precisee.'}</p>
          <p className="mt-1 text-xs text-white/40">Par {entry.moderator?.name || 'Staff'}{entry.points ? ` - ${entry.points} point${entry.points > 1 ? 's' : ''}` : ''}{entry.duration_ms ? ` - ${Math.round(entry.duration_ms / 60000)} min` : ''}</p>
        </div>
      </div>
    </div>
  )
}

function ActionModal({ action, target, values, onChange, onClose, onSubmit, submitting }) {
  const actionMeta = QUICK_ACTIONS.find((entry) => entry.id === action) || QUICK_ACTIONS[0]
  const Icon = actionMeta.icon

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
          <input className="input-field" value={values.moderatorIdentity} onChange={(event) => onChange((current) => ({ ...current, moderatorIdentity: event.target.value }))} placeholder="Identite Discord du moderateur (optionnel)" />
        </div>
        <div className="relative z-[1] flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white/70 transition-all hover:border-white/20 hover:text-white">Annuler</button>
          <button type="button" onClick={onSubmit} disabled={submitting} className="flex-1 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50">{submitting ? 'Execution...' : 'Confirmer'}</button>
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

export default function SearchPage() {
  const { locale } = useI18n()
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
  const [dmOpen, setDmOpen] = useState(false)
  const [sendingDm, setSendingDm] = useState(false)
  const [actionValues, setActionValues] = useState({ reason: '', duration: '', points: '1', moderatorIdentity: '' })
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

  async function handleSearch() {
    if (!selectedGuildId || !query.trim()) return
    setLoadingResults(true)
    setProfileData(null)
    setSelectedUserId('')
    try {
      const response = await modAPI.searchUsers(selectedGuildId, { q: query.trim(), limit: 10 })
      const nextResults = response.data?.results || []
      setResults(nextResults)
      if (nextResults[0]?.id) await loadProfile(nextResults[0].id, { silent: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setLoadingResults(false)
    }
  }

  async function handleSubmitAction() {
    if (!selectedGuildId || !selectedUserId || !actionModal || submittingAction) return
    const payload = {
      action: actionModal,
      target_user_id: selectedUserId,
      target_username: profileData?.profile?.display_name || selectedResult?.display_name || selectedUserId,
      reason: actionValues.reason.trim() || 'Action rapide depuis Search',
      moderator_discord_identity: actionValues.moderatorIdentity.trim() || undefined,
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
                  <input className="input-field pl-11" placeholder="Exemple: Dream ou 123456789" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleSearch() } }} />
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
                          {profile.in_server ? <span className="badge-online">Dans le serveur</span> : null}
                          {!profile.in_server && !profile.banned ? <span className="badge-offline">Hors serveur</span> : null}
                          {profile.timed_out_until ? <span className="badge-warning">Timeout actif</span> : null}
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
                        const disabled = (entry.id === 'warn' && !viewer?.can_warn) || (entry.id === 'timeout' && !viewer?.can_timeout) || (entry.id === 'untimeout' && !viewer?.can_timeout) || (entry.id === 'kick' && !viewer?.can_kick) || (entry.id === 'ban' && !viewer?.can_ban) || (entry.id === 'unban' && !viewer?.can_unban)
                        if (entry.id === 'ban' && profile.banned) return null
                        if (entry.id === 'unban' && !profile.banned) return null
                        if (entry.id === 'untimeout' && !profile.timed_out_until) return null
                        return <button key={entry.id} type="button" disabled={disabled} onClick={() => { setActionValues({ reason: '', duration: '', points: '1', moderatorIdentity: '' }); setActionModal(entry.id) }} className={`spotlight-card w-full rounded-[22px] border px-4 py-4 text-left transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-35 ${entry.tone}`}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Icon className="w-4 h-4" /><span className="font-mono text-sm">{entry.label}</span></div><p className="mt-3 text-xs text-white/55">Action rapide sans quitter la fiche.</p></div><span className="rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">direct</span></div></button>
                      })}
                    </div>
                  </div>
                </div>
                <div className="space-y-5">
                  <div className="spotlight-card p-5"><div className="relative z-[1] space-y-4"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0"><History className="w-5 h-5 text-violet-300" /></div><div><p className="font-display font-700 text-white">Permissions</p><p className="mt-1 text-sm text-white/40">Ce moderateur peut faire maintenant.</p></div></div><div className="flex flex-wrap gap-2">{viewer?.can_warn ? <span className="badge-online">Warn</span> : <span className="badge-offline">Warn</span>}{viewer?.can_timeout ? <span className="badge-online">Timeout</span> : <span className="badge-offline">Timeout</span>}{viewer?.can_kick ? <span className="badge-online">Kick</span> : <span className="badge-offline">Kick</span>}{viewer?.can_ban ? <span className="badge-online">Ban</span> : <span className="badge-offline">Ban</span>}{viewer?.can_unban ? <span className="badge-online">Unban</span> : <span className="badge-offline">Unban</span>}</div></div></div>
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

      <AnimatePresence>{actionModal ? <ActionModal action={actionModal} target={profile} values={actionValues} onChange={setActionValues} onClose={() => setActionModal('')} onSubmit={handleSubmitAction} submitting={submittingAction} /> : null}</AnimatePresence>
      <AnimatePresence>{dmOpen ? <DirectMessageModal target={profile} values={dmValues} onChange={setDmValues} onClose={() => setDmOpen(false)} onSubmit={handleSendDM} submitting={sendingDm} /> : null}</AnimatePresence>
    </div>
  )
}
