import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Gavel, History, RefreshCw, Search as SearchIcon, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { modAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import {
  ACTION_COLORS,
  ACTION_LABELS,
  SelectGuildState,
  SummaryCard,
  formatDate,
  getErrorMessage,
  parseDurationInput,
  renderAvatar,
} from '../components/moderation/moderationUI'

export default function SearchPage() {
  const { locale } = useI18n()
  const { guilds, selectedGuildId } = useGuildStore()
  const { user } = useAuthStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userProfile, setUserProfile] = useState(null)
  const [searching, setSearching] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [quickAction, setQuickAction] = useState({
    action: 'warn',
    reason: '',
    duration: '10m',
    points: 1,
    moderator_discord_identity: '',
  })

  useEffect(() => {
    setSearchQuery('')
    setSearchResults([])
    setSelectedUserId('')
    setUserProfile(null)
  }, [selectedGuildId])

  useEffect(() => {
    if (selectedGuildId && selectedUserId) loadUserProfile(selectedUserId)
  }, [selectedGuildId, selectedUserId])

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
      const response = await modAPI.searchUsers(selectedGuildId, { q: searchQuery.trim(), limit: 10 })
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

  async function handleQuickAction() {
    if (!selectedGuildId || !profile?.id || submitting) return
    if (!quickAction.reason.trim()) return toast.error('La raison est obligatoire.')
    if (!user?.is_primary_founder && !user?.discord_id && !quickAction.moderator_discord_identity.trim()) {
      return toast.error('Ton identite Discord est requise.')
    }

    const payload = {
      target_user_id: profile.id,
      target_username: profile.display_name || profile.username || profile.id,
      action: quickAction.action,
      reason: quickAction.reason.trim(),
      moderator_discord_identity: quickAction.moderator_discord_identity.trim() || undefined,
    }

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
      await loadUserProfile(profile.id)
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
      toast.success('ID copie')
    } catch {
      toast.error('Clipboard unavailable')
    }
  }

  if (!selectedGuildId) {
    return (
      <SelectGuildState
        title="Choisis d abord un serveur"
        body="Search devient disponible des que ton serveur est selectionne."
        actionLabel="Choisir un serveur"
      />
    )
  }

  const profile = userProfile?.profile || null
  const viewer = userProfile?.viewer || {}
  const history = userProfile?.combined_history || []

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="font-display font-800 text-2xl text-white">Search</h1>
        <p className="text-white/40 text-sm mt-1">Recherche par pseudo ou ID avec actions rapides. - {guild?.name}</p>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <SearchIcon className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-11"
              placeholder="Username ou User ID"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSearch()
                }
              }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${searching ? 'animate-spin' : ''}`} />
            Search
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          {!searching && searchResults.length === 0 && (
            <div className="glass-card p-6 text-center text-white/40 text-sm">
              {searchQuery.trim() ? 'Aucun resultat.' : 'Lance une recherche pour ouvrir une fiche utilisateur.'}
            </div>
          )}
          {searching && [...Array(4)].map((_, index) => <div key={index} className="h-24 rounded-2xl skeleton" />)}
          {!searching && searchResults.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelectedUserId(entry.id)}
              className={`w-full text-left glass-card p-4 border transition-all ${entry.id === selectedUserId ? 'border-neon-cyan/25 shadow-[0_0_24px_rgba(34,211,238,0.12)]' : 'border-white/8 hover:border-white/15'}`}
            >
              <div className="flex items-center gap-3">
                {renderAvatar(entry.avatar_url, entry.display_name)}
                <div className="min-w-0">
                  <p className="text-white font-display font-700 truncate">{entry.display_name}</p>
                  <p className="text-sm text-white/55 truncate mt-1">@{entry.username || entry.id}</p>
                  <p className="text-[11px] text-white/30 font-mono mt-2">{entry.id}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-5">
          {!selectedUserId && <div className="glass-card p-8 text-center text-white/40 text-sm">Selectionne un resultat pour charger la fiche.</div>}
          {selectedUserId && loadingProfile && (
            <div className="space-y-4">
              <div className="h-48 rounded-3xl skeleton" />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="h-28 rounded-2xl skeleton" />
                <div className="h-28 rounded-2xl skeleton" />
                <div className="h-28 rounded-2xl skeleton" />
              </div>
              <div className="h-80 rounded-3xl skeleton" />
            </div>
          )}
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

                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => copyId(profile.id)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/[0.03] text-white/65 text-sm font-mono hover:text-white hover:border-white/20 transition-all"><Copy className="w-4 h-4" />Copier l'ID</button>
                    <button onClick={() => loadUserProfile(profile.id)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/15 transition-all"><RefreshCw className="w-4 h-4" />Recharger</button>
                  </div>
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
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Mute jusqu a</p><p className="mt-2 text-white/80 text-sm">{formatDate(locale, profile.timed_out_until)}</p></div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/30">Raison du ban</p><p className="mt-2 text-white/80 text-sm">{profile.ban_reason || '-'}</p></div>
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
                {history.length > 0 && <div className="space-y-3">{history.map((entry) => { const moderatorName = entry.moderator?.name || 'Inconnu'; const tone = ACTION_COLORS[entry.action] || 'border-white/10 bg-white/[0.04] text-white/65'; return <motion.div key={entry.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/8 bg-white/[0.02] p-4 md:p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div className="flex items-start gap-3 min-w-0 flex-1">{renderAvatar(entry.moderator?.avatar_url, moderatorName, 'from-amber-500/20 to-violet-500/20')}<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`px-2.5 py-1 rounded-full border text-xs font-mono ${tone}`}>{ACTION_LABELS[entry.action] || entry.action}</span><span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/55 text-xs font-mono">{entry.source === 'discord' ? 'Discord' : 'Site'}</span></div><p className="text-white mt-3 text-sm">{entry.reason || '-'}</p><div className="flex flex-wrap gap-3 mt-3 text-xs text-white/35 font-mono"><span>Par: {moderatorName}</span>{entry.points ? <span>Points: {entry.points}</span> : null}{entry.duration_ms ? <span>Duree: {Math.round(entry.duration_ms / 60000)}m</span> : null}</div></div></div><span className="text-xs text-white/35 font-mono whitespace-nowrap">{formatDate(locale, entry.created_at)}</span></div></motion.div> })}</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
