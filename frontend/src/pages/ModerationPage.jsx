import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Copy, FileText, Gavel, History, RefreshCw, Search, Shield, Trash2, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { logsAPI, modAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const ACTION_LABELS = {
  warn: 'Warn',
  timeout: 'Mute temporaire',
  untimeout: 'Retirer le mute',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Deban',
  member_update: 'Mise a jour membre',
  role_update: 'Mise a jour role',
  voice_move: 'Deplacement vocal',
  voice_disconnect: 'Deconnexion vocale',
  bot_add: 'Ajout du bot',
  message_delete: 'Suppression message',
  message_bulk_delete: 'Suppression messages',
  message_pin: 'Message epingle',
  message_unpin: 'Message desepingle',
  timeout_remove: 'Fin de mute',
}

const ACTION_COLORS = {
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  timeout: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
  untimeout: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  kick: 'border-orange-500/20 bg-orange-500/10 text-orange-300',
  ban: 'border-red-500/20 bg-red-500/10 text-red-300',
  unban: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
}

const LOG_LEVEL_COLORS = {
  info: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10',
  warn: 'text-amber-300 border-amber-500/20 bg-amber-500/10',
  error: 'text-red-300 border-red-500/20 bg-red-500/10',
  success: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10',
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

function formatDate(locale, value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return String(value)
  }
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || '?'
}

function renderAvatar(url, label, accent = 'from-cyan-500/25 to-violet-500/25', size = 'w-12 h-12') {
  if (url) return <img src={url} alt={label} className={`${size} rounded-2xl object-cover border border-white/10 shadow-[0_14px_36px_rgba(0,0,0,0.24)]`} />
  return <div className={`${size} rounded-2xl border border-white/10 bg-gradient-to-br ${accent} flex items-center justify-center text-white/75 font-mono text-xs shadow-[0_14px_36px_rgba(0,0,0,0.24)]`}>{initials(label)}</div>
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-2 font-display text-2xl font-800">{value}</p>
    </div>
  )
}

export default function ModerationPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const { user } = useAuthStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [warnings, setWarnings] = useState([])
  const [siteLogs, setSiteLogs] = useState([])
  const [discordLogs, setDiscordLogs] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userProfile, setUserProfile] = useState(null)
  const [searching, setSearching] = useState(false)
  const [loadingWarnings, setLoadingWarnings] = useState(false)
  const [loadingSiteLogs, setLoadingSiteLogs] = useState(false)
  const [loadingDiscordLogs, setLoadingDiscordLogs] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [quickAction, setQuickAction] = useState({ action: 'warn', reason: '', duration: '10m', points: 1, moderator_discord_identity: '' })
  const discordClearKey = useMemo(() => `discordforge.discord-log-clear.${user?.id || 'anon'}.${selectedGuildId || 'none'}`, [selectedGuildId, user?.id])
  const [discordClearedAfter, setDiscordClearedAfter] = useState(0)

  useEffect(() => {
    const saved = Number(localStorage.getItem(discordClearKey) || '0')
    setDiscordClearedAfter(Number.isFinite(saved) ? saved : 0)
  }, [discordClearKey])

  useEffect(() => {
    setSearchQuery('')
    setSearchResults([])
    setSelectedUserId('')
    setUserProfile(null)
  }, [selectedGuildId])

  useEffect(() => { if (selectedGuildId) loadWarnings() }, [selectedGuildId])
  useEffect(() => { if (selectedGuildId) loadSiteLogs() }, [selectedGuildId])
  useEffect(() => { if (selectedGuildId) loadDiscordLogs() }, [selectedGuildId])
  useEffect(() => { if (selectedGuildId && selectedUserId) loadUserProfile(selectedUserId) }, [selectedGuildId, selectedUserId])

  const profile = userProfile?.profile || null
  const viewer = userProfile?.viewer || {}
  const history = userProfile?.combined_history || []
  const visibleDiscordLogs = useMemo(() => discordLogs.filter((entry) => !discordClearedAfter || new Date(entry.created_at).getTime() > discordClearedAfter), [discordClearedAfter, discordLogs])

  async function loadWarnings() {
    if (!selectedGuildId) return
    setLoadingWarnings(true)
    try {
      const response = await modAPI.warnings(selectedGuildId, { page: 1, limit: 50 })
      setWarnings(response.data.warnings || [])
    } finally {
      setLoadingWarnings(false)
    }
  }

  async function loadSiteLogs() {
    if (!selectedGuildId) return
    setLoadingSiteLogs(true)
    try {
      const response = await logsAPI.list(selectedGuildId, { page: 1, limit: 50 })
      setSiteLogs(response.data.logs || [])
    } finally {
      setLoadingSiteLogs(false)
    }
  }

  async function loadDiscordLogs() {
    if (!selectedGuildId) return
    setLoadingDiscordLogs(true)
    try {
      const response = await logsAPI.discord(selectedGuildId, { page: 1, limit: 50 })
      setDiscordLogs(response.data.logs || [])
    } finally {
      setLoadingDiscordLogs(false)
    }
  }

  async function loadUserProfile(userId) {
    if (!selectedGuildId || !userId) return
    setLoadingProfile(true)
    try {
      const response = await modAPI.userProfile(selectedGuildId, userId)
      setUserProfile(response.data)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setLoadingProfile(false)
    }
  }

  async function handleSearch() {
    if (!selectedGuildId || !searchQuery.trim()) return
    setSearching(true)
    try {
      const response = await modAPI.searchUsers(selectedGuildId, { q: searchQuery.trim(), limit: 8 })
      const results = response.data.results || []
      setSearchResults(results)
      if (results.length) {
        setSelectedUserId(results.find((entry) => entry.id === selectedUserId)?.id || results[0].id)
      } else {
        setSelectedUserId('')
        setUserProfile(null)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }

  async function handleDeleteWarning(warningId) {
    if (!selectedGuildId) return
    try {
      await modAPI.deleteWarning(selectedGuildId, warningId)
      setWarnings((current) => current.filter((warning) => warning.id !== warningId))
      if (selectedUserId) await loadUserProfile(selectedUserId)
      toast.success('Avertissement supprime')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function handleQuickAction() {
    if (!selectedGuildId || !profile?.id || submitting) return
    if (!quickAction.reason.trim()) return toast.error('La raison est obligatoire.')
    if (!user?.is_primary_founder && !user?.discord_id && !quickAction.moderator_discord_identity.trim()) return toast.error('Ton identite Discord est requise.')
    const payload = { target_user_id: profile.id, target_username: profile.display_name || profile.username || profile.id, action: quickAction.action, reason: quickAction.reason.trim(), moderator_discord_identity: quickAction.moderator_discord_identity.trim() || undefined }
    if (quickAction.action === 'timeout') {
      const durationMs = parseDurationInput(quickAction.duration)
      if (!durationMs || durationMs < 60000) return toast.error('Entre une duree valide comme 10m ou 1h.')
      payload.duration_ms = durationMs
    }
    if (quickAction.action === 'warn') payload.points = Number(quickAction.points || 1)
    setSubmitting(true)
    try {
      await modAPI.action(selectedGuildId, payload)
      toast.success('Action executee')
      setQuickAction((current) => ({ ...current, reason: '' }))
      await Promise.all([loadWarnings(), loadUserProfile(profile.id), loadSiteLogs(), loadDiscordLogs()])
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyId(id) {
    if (!id) return
    try {
      await navigator.clipboard.writeText(String(id))
      toast.success("ID copie")
    } catch {
      toast.error('Clipboard unavailable')
    }
  }

  if (!selectedGuildId) {
    return <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto"><div className="glass-card p-10 text-center"><Shield className="w-12 h-12 text-white/10 mx-auto mb-4" /><p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p><p className="text-white/40 mt-2">La moderation devient disponible des que ton serveur est selectionne.</p><Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">Choisir un serveur<ArrowRight className="w-4 h-4" /></Link></div></div>
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-800 text-2xl text-white">Moderation</h1>
        <p className="text-white/40 text-sm mt-1">Recherche Discord, sanctions et actions rapides. - {guild?.name}</p>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_210px]">
          <div className="relative">
            <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input className="input-field pl-11" placeholder="Pseudo Discord, surnom ou ID" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleSearch() } }} />
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-60"><RefreshCw className={`w-4 h-4 ${searching ? 'animate-spin' : ''}`} />Rechercher</button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          {!searching && searchResults.length === 0 && <div className="glass-card p-6 text-center text-white/40 text-sm">{searchQuery.trim() ? 'Aucun resultat.' : 'Lance une recherche pour ouvrir une vraie fiche moderation.'}</div>}
          {searching && [...Array(4)].map((_, index) => <div key={index} className="h-24 rounded-2xl skeleton" />)}
          {!searching && searchResults.map((entry) => <button key={entry.id} onClick={() => setSelectedUserId(entry.id)} className={`w-full text-left glass-card p-4 border transition-all ${entry.id === selectedUserId ? 'border-neon-cyan/25 shadow-[0_0_24px_rgba(34,211,238,0.12)]' : 'border-white/8 hover:border-white/15'}`}><div className="flex items-center gap-3">{renderAvatar(entry.avatar_url, entry.display_name)}<div className="min-w-0"><p className="text-white font-display font-700 truncate">{entry.display_name}</p><p className="text-sm text-white/55 truncate mt-1">@{entry.username || entry.id}</p><p className="text-[11px] text-white/30 font-mono mt-2">{entry.id}</p></div></div></button>)}
        </div>

        <div className="space-y-5">
          {!selectedUserId && <div className="glass-card p-8 text-center text-white/40 text-sm">Selectionne un resultat pour charger la fiche.</div>}
          {selectedUserId && loadingProfile && <div className="space-y-4"><div className="h-48 rounded-3xl skeleton" /><div className="grid gap-4 md:grid-cols-3"><div className="h-28 rounded-2xl skeleton" /><div className="h-28 rounded-2xl skeleton" /><div className="h-28 rounded-2xl skeleton" /></div><div className="h-80 rounded-3xl skeleton" /></div>}
          {selectedUserId && !loadingProfile && profile && (
            <>
              <div className="glass-card p-6 space-y-5">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                    {renderAvatar(profile.avatar_url, profile.display_name, 'from-cyan-500/25 to-violet-500/25', 'w-16 h-16')}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display font-800 text-white text-2xl truncate">{profile.display_name || profile.username || profile.id}</h2>
                        {profile.in_server && <span className="px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-xs font-mono">Serveur</span>}
                        {profile.banned && <span className="px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-300 text-xs font-mono">Ban</span>}
                      </div>
                      <p className="text-white/55 text-sm mt-1">@{profile.username || profile.id}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${viewer.permission_verified ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-white/50'}`}>{viewer.permission_verified ? 'Permission Discord OK' : 'Permission Discord non verifiee'}</span>
                        <span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${viewer.linked_discord ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan' : 'border-white/10 bg-white/[0.03] text-white/50'}`}>{viewer.linked_discord ? 'Discord lie' : 'Discord non lie'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2"><button onClick={() => copyId(profile.id)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/65 text-sm font-mono hover:text-white hover:border-white/20 transition-all"><Copy className="w-4 h-4" />Copier l'ID</button><button onClick={() => loadUserProfile(profile.id)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/15 transition-all"><RefreshCw className="w-4 h-4" />Recharger</button></div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard label="Points actifs" value={userProfile.site?.summary?.active_warning_points || 0} tone="border-amber-500/20 bg-amber-500/10 text-amber-300" />
                  <SummaryCard label="Warns" value={userProfile.site?.summary?.total_warnings || 0} tone="border-orange-500/20 bg-orange-500/10 text-orange-300" />
                  <SummaryCard label="Actions site" value={userProfile.site?.summary?.total_actions || 0} tone="border-cyan-500/20 bg-cyan-500/10 text-cyan-300" />
                  <SummaryCard label="Actions Discord" value={userProfile.discord?.summary?.total_actions || 0} tone="border-violet-500/20 bg-violet-500/10 text-violet-300" />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-5 space-y-4">
                    <div className="flex items-center gap-2 text-white"><User className="w-4 h-4 text-neon-cyan" /><p className="font-display font-700">Profil Discord</p></div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Compte cree</p><p className="mt-2 text-white/80 text-sm">{formatDate(locale, profile.created_at)}</p></div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Arrivee serveur</p><p className="mt-2 text-white/80 text-sm">{formatDate(locale, profile.joined_at)}</p></div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Mute jusqu'a</p><p className="mt-2 text-white/80 text-sm">{formatDate(locale, profile.timed_out_until)}</p></div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Raison du ban</p><p className="mt-2 text-white/80 text-sm">{profile.ban_reason || '—'}</p></div>
                    </div>
                    <div><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30 mb-3">Roles</p><div className="flex flex-wrap gap-2">{(profile.roles || []).length === 0 && <span className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/40 text-sm">Aucun role notable</span>}{(profile.roles || []).map((role) => <span key={role.id} className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/75 text-sm">{role.name}</span>)}</div></div>
                  </div>

                  <div className="rounded-3xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-5 space-y-4">
                    <div className="flex items-center gap-2 text-white"><Gavel className="w-4 h-4 text-amber-300" /><div><p className="font-display font-700">Actions rapides</p><p className="text-white/35 text-sm mt-1">Sanction directe sur la fiche ouverte.</p></div></div>
                    <label className="space-y-2 block"><span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Action</span><select className="select-field" value={quickAction.action} onChange={(event) => setQuickAction((current) => ({ ...current, action: event.target.value }))}>{['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban'].map((value) => <option key={value} value={value}>{ACTION_LABELS[value]}</option>)}</select></label>
                    {!user?.is_primary_founder && !user?.discord_id && <label className="space-y-2 block"><span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Ton Discord</span><input className="input-field" placeholder="@mention ou ID Discord" value={quickAction.moderator_discord_identity} onChange={(event) => setQuickAction((current) => ({ ...current, moderator_discord_identity: event.target.value }))} /></label>}
                    <label className="space-y-2 block"><span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Raison</span><textarea className="input-field min-h-[108px] resize-y" placeholder="Explique rapidement la sanction" value={quickAction.reason} onChange={(event) => setQuickAction((current) => ({ ...current, reason: event.target.value }))} /></label>
                    {quickAction.action === 'timeout' && <label className="space-y-2 block"><span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Duree</span><input className="input-field" placeholder="Exemple: 10m, 1h, 2d" value={quickAction.duration} onChange={(event) => setQuickAction((current) => ({ ...current, duration: event.target.value }))} /></label>}
                    {quickAction.action === 'warn' && <label className="space-y-2 block"><span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Points</span><input type="number" min="1" max="10" className="input-field" value={quickAction.points} onChange={(event) => setQuickAction((current) => ({ ...current, points: Number(event.target.value || 1) }))} /></label>}
                    <button onClick={handleQuickAction} disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-60"><Gavel className="w-4 h-4" />Executer l'action</button>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 space-y-4">
                <div className="flex items-center gap-2 text-white"><History className="w-4 h-4 text-violet-300" /><div><p className="font-display font-700">Historique complet</p><p className="text-white/35 text-sm mt-1">Site + Discord reunis sur la meme fiche.</p></div></div>
                {history.length === 0 && <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-white/40 text-sm text-center">Aucune sanction enregistree.</div>}
                {history.length > 0 && <div className="space-y-3">{history.map((entry) => { const moderatorName = entry.moderator?.name || 'Inconnu'; const tone = ACTION_COLORS[entry.action] || 'border-white/10 bg-white/[0.04] text-white/65'; return <motion.div key={entry.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/8 bg-white/[0.02] p-4 md:p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div className="flex items-start gap-3 min-w-0 flex-1">{renderAvatar(entry.moderator?.avatar_url, moderatorName, 'from-amber-500/20 to-violet-500/20')}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${tone}`}>{ACTION_LABELS[entry.action] || entry.action}</span><span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/55 text-xs font-mono">{entry.source === 'discord' ? 'Discord' : 'Site'}</span></div><p className="text-white mt-3 text-sm">{entry.reason || '—'}</p><div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono"><span>Par: {moderatorName}</span>{entry.points ? <span>Points: {entry.points}</span> : null}{entry.duration_ms ? <span>Duree: {Math.round(entry.duration_ms / 60000)}m</span> : null}</div></div></div><span className="text-xs text-white/35 font-mono whitespace-nowrap">{formatDate(locale, entry.created_at)}</span></div></motion.div> })}</div>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <div className="glass-card p-5 flex items-center justify-between"><div><p className="font-display font-700 text-white text-lg">Avertissements recents</p><p className="text-white/40 text-sm mt-1">Les warns actifs du serveur.</p></div><button onClick={() => loadWarnings()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"><RefreshCw className={`w-4 h-4 ${loadingWarnings ? 'animate-spin' : ''}`} />Recharger</button></div>
          <div className="space-y-3">{loadingWarnings && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-2xl skeleton" />)}{!loadingWarnings && warnings.length === 0 && <div className="glass-card p-8 text-center text-white/40 font-mono text-sm">Aucun avertissement actif.</div>}{!loadingWarnings && warnings.map((warning) => { const metadata = warning.metadata || {}; const moderatorName = metadata.moderator_display_name || metadata.moderator_site_username || warning.moderator_username || 'Inconnu'; const targetName = warning.target_username || warning.target_user_id; return <div key={warning.id} className="glass-card p-5 flex flex-col gap-4"><div className="flex items-center gap-3 min-w-0">{renderAvatar(metadata.target_avatar_url || null, targetName, 'from-amber-500/25 to-orange-500/25')}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-white font-display font-700 truncate">{targetName}</p><span className="px-2.5 py-1 rounded-full text-xs font-mono border border-amber-500/20 bg-amber-500/10 text-amber-300">{warning.points} pt</span></div><p className="text-white/70 text-sm mt-1">{warning.reason}</p><div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-white/35 font-mono"><span>{formatDate(locale, warning.created_at)}</span><span>Par: {moderatorName}</span></div></div></div><button onClick={() => handleDeleteWarning(warning.id)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-300 text-sm font-mono hover:bg-red-500/15 transition-all"><Trash2 className="w-4 h-4" />Supprimer</button></div> })}</div>
        </div>

        <div className="space-y-4 xl:col-span-1">
          <div className="glass-card p-5 flex items-center justify-between"><div><p className="font-display font-700 text-white text-lg">Logs du site</p><p className="text-white/40 text-sm mt-1">Logs internes du bot et du site.</p></div><button onClick={() => loadSiteLogs()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"><RefreshCw className={`w-4 h-4 ${loadingSiteLogs ? 'animate-spin' : ''}`} />Recharger</button></div>
          <div className="space-y-3">{loadingSiteLogs && [...Array(3)].map((_, index) => <div key={index} className="h-24 rounded-2xl skeleton" />)}{!loadingSiteLogs && siteLogs.length === 0 && <div className="glass-card p-8 text-center text-white/40 font-mono text-sm">Aucun log interne.</div>}{!loadingSiteLogs && siteLogs.map((log) => <div key={log.id} className="glass-card p-5 flex items-start gap-4"><div className="w-11 h-11 rounded-2xl border border-white/10 bg-white/[0.03] flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-white/55" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 mb-2"><span className={`px-2.5 py-1 rounded-full text-xs font-mono border ${LOG_LEVEL_COLORS[log.level] || 'text-white/70 border-white/10 bg-white/[0.05]'}`}>{String(log.level || 'info').toUpperCase()}</span><span className="px-2.5 py-1 rounded-full text-xs font-mono border border-white/10 bg-white/[0.03] text-white/50">{log.category || 'Log'}</span><span className="text-xs text-white/30 font-mono">{formatDate(locale, log.created_at)}</span></div><p className="text-white text-sm">{log.message}</p></div></div>)}</div>
        </div>

        <div className="space-y-4 xl:col-span-1">
          <div className="glass-card p-5 flex items-center justify-between"><div><p className="font-display font-700 text-white text-lg">Logs Discord</p><p className="text-white/40 text-sm mt-1">Audit log recent du serveur.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => loadDiscordLogs()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all"><RefreshCw className={`w-4 h-4 ${loadingDiscordLogs ? 'animate-spin' : ''}`} />Recharger</button><button onClick={() => { const now = Date.now(); setDiscordClearedAfter(now); localStorage.setItem(discordClearKey, String(now)); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-300 text-sm font-mono hover:bg-amber-500/15 transition-all"><Trash2 className="w-4 h-4" />Masquer</button></div></div>
          <div className="space-y-3">{loadingDiscordLogs && [...Array(3)].map((_, index) => <div key={index} className="h-28 rounded-2xl skeleton" />)}{!loadingDiscordLogs && visibleDiscordLogs.length === 0 && <div className="glass-card p-8 text-center text-white/40 font-mono text-sm">Aucun log Discord recent.</div>}{!loadingDiscordLogs && visibleDiscordLogs.map((entry) => { const executor = entry.executor || {}; const target = entry.target || {}; const targetName = target.label || target.username || target.id || 'Inconnu'; const executorName = executor.global_name || executor.username || executor.id || 'Inconnu'; return <div key={entry.id} className="glass-card p-5 space-y-4"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div className="flex items-center gap-3 min-w-0">{renderAvatar(executor.avatar_url, executorName, 'from-cyan-500/25 to-blue-500/25')}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-white font-display font-700 truncate">{executorName}</p><span className={`px-2.5 py-1 rounded-full text-xs font-mono border ${ACTION_COLORS[entry.action_type] || 'border-white/10 bg-white/[0.03] text-white/55'}`}>{ACTION_LABELS[entry.action_type] || `Action ${entry.action_type}`}</span></div><p className="text-xs text-white/35 font-mono mt-1">ID: {executor.id || 'Inconnu'}</p></div></div><p className="text-xs text-white/35 font-mono">{formatDate(locale, entry.created_at)}</p></div><div className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><p className="text-xs font-mono text-white/30 mb-2">Cible</p><div className="flex items-center gap-3">{renderAvatar(target.avatar_url, targetName, 'from-violet-500/25 to-fuchsia-500/25')}<div className="min-w-0"><p className="text-white text-sm truncate">{targetName}</p><p className="text-xs text-white/35 font-mono">ID: {target.id || 'Inconnu'}</p></div></div></div><div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4"><p className="text-xs font-mono text-white/30 mb-2">Raison</p><p className="text-white/80 text-sm">{entry.reason || '—'}</p></div></div></div> })}</div>
        </div>
      </div>
    </div>
  )
}
