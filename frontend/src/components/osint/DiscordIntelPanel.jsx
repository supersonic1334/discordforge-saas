import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Bot,
  Clock3,
  Fingerprint,
  MessageCircle,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { modAPI, scanAPI } from '../../services/api'
import { useGuildStore } from '../../stores'
import { SelectGuildState } from '../moderation/moderationUI'

function getErrorMessage(error, fallback = 'Une erreur est survenue') {
  return error?.response?.data?.error || error?.message || fallback
}

function formatDate(value) {
  if (!value) return '--'

  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

function formatCount(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getDaysSince(value) {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000))
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

function Avatar({ src, label, size = 'h-14 w-14', radius = 'rounded-[22px]' }) {
  if (src) {
    return (
      <img
        src={src}
        alt={label}
        className={`${size} ${radius} shrink-0 border border-white/10 object-cover shadow-[0_16px_32px_rgba(0,0,0,0.24)]`}
      />
    )
  }

  return (
    <div className={`${size} ${radius} shrink-0 border border-white/10 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center font-mono text-sm text-white/75 shadow-[0_16px_32px_rgba(0,0,0,0.24)]`}>
      {initials(label)}
    </div>
  )
}

function IntelMetric({ label, value, hint = '', tone = '' }) {
  return (
    <div className={`feature-metric ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">{label}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value}</p>
      {hint ? <p className="mt-2 text-xs text-white/45">{hint}</p> : null}
    </div>
  )
}

function SectionCard({ title, hint = '', children }) {
  return (
    <div className="spotlight-card p-5 sm:p-6">
      <div className="relative z-[1]">
        <div className="mb-4">
          <p className="font-display text-lg font-700 text-white">{title}</p>
          {hint ? <p className="mt-1 text-sm leading-6 text-white/45">{hint}</p> : null}
        </div>
        {children}
      </div>
    </div>
  )
}

function ResultRow({ entry, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`spotlight-card w-full p-4 text-left transition-all ${
        active
          ? 'border-neon-cyan/20 bg-neon-cyan/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_18px_42px_rgba(0,0,0,0.35),0_0_28px_rgba(34,211,238,0.10)]'
          : 'hover:-translate-y-[2px] hover:border-white/15 hover:bg-white/[0.05]'
      }`}
    >
      <div className="relative z-[1] flex items-start gap-3">
        <Avatar src={entry.avatar_url} label={entry.display_name || entry.username || entry.id} size="h-12 w-12" radius="rounded-[18px]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-display font-700 text-white">{entry.display_name || entry.username || entry.id}</p>
            {entry.in_server ? <span className="badge-online">Dans le serveur</span> : null}
            {entry.banned ? <span className="badge-error">Banni</span> : null}
            {entry.bot ? <span className="badge-offline">Bot</span> : null}
          </div>
          <p className="mt-1 truncate text-sm text-white/45">@{entry.username || entry.id}</p>
        </div>
      </div>
    </button>
  )
}

function HistoryRow({ entry }) {
  const tone = entry.source === 'discord'
    ? 'border-violet-400/20 bg-violet-400/10 text-violet-100'
    : entry.source === 'site_warning'
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
      : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100'

  return (
    <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] ${tone}`}>
          {entry.label || entry.action || 'Evenement'}
        </span>
        <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{formatDate(entry.created_at)}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/72">{entry.reason || 'Aucun detail fourni.'}</p>
    </div>
  )
}

function EvidenceRow({ entry }) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-amber-100">
          {entry.label || entry.kind || 'Signal'}
        </span>
        <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">{formatDate(entry.created_at)}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/72">{entry.excerpt || 'Aucun extrait disponible.'}</p>
    </div>
  )
}

export default function DiscordIntelPanel() {
  const guilds = useGuildStore((state) => state.guilds)
  const selectedGuildId = useGuildStore((state) => state.selectedGuildId)
  const selectGuild = useGuildStore((state) => state.selectGuild)
  const fetchGuilds = useGuildStore((state) => state.fetchGuilds)
  const guildLoading = useGuildStore((state) => state.isLoading)

  const [query, setQuery] = useState('')
  const [searchPhase, setSearchPhase] = useState('idle')
  const [results, setResults] = useState([])
  const [searchError, setSearchError] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [profilePayload, setProfilePayload] = useState(null)
  const [scanMember, setScanMember] = useState(null)
  const [detailPhase, setDetailPhase] = useState('idle')
  const [detailError, setDetailError] = useState('')
  const [scanNotice, setScanNotice] = useState('')

  const searchRequestRef = useRef(0)
  const detailRequestRef = useRef(0)

  const selectedGuild = useMemo(
    () => guilds.find((guild) => String(guild.id) === String(selectedGuildId || '')) || null,
    [guilds, selectedGuildId]
  )

  const profile = profilePayload?.profile || null
  const siteSummary = profilePayload?.site?.summary || {}
  const discordSummary = profilePayload?.discord?.summary || {}
  const combinedHistory = Array.isArray(profilePayload?.combined_history) ? profilePayload.combined_history : []
  const viewer = profilePayload?.viewer || {}
  const accountAgeDays = getDaysSince(profile?.created_at)
  const joinedDays = getDaysSince(profile?.joined_at)

  useEffect(() => {
    if (guilds.length === 0) {
      void fetchGuilds().catch(() => {})
    }
  }, [fetchGuilds, guilds.length])

  useEffect(() => {
    setResults([])
    setSelectedUserId('')
    setProfilePayload(null)
    setScanMember(null)
    setSearchError('')
    setDetailError('')
    setScanNotice('')
  }, [selectedGuildId])

  async function loadDetail(userId) {
    if (!selectedGuildId || !userId) return

    setSelectedUserId(userId)
    setDetailPhase('loading')
    setDetailError('')
    setScanNotice('')

    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId

    const [profileResponse, scanResponse] = await Promise.allSettled([
      modAPI.userProfile(selectedGuildId, userId),
      scanAPI.member(selectedGuildId, userId),
    ])

    if (requestId !== detailRequestRef.current) return

    if (profileResponse.status !== 'fulfilled') {
      const message = getErrorMessage(profileResponse.reason, 'Impossible de charger le profil Discord.')
      setProfilePayload(null)
      setScanMember(null)
      setDetailError(message)
      setDetailPhase('error')
      toast.error(message)
      return
    }

    setProfilePayload(profileResponse.value?.data || null)

    if (scanResponse.status === 'fulfilled') {
      setScanMember(scanResponse.value?.data?.member || null)
    } else {
      setScanMember(null)
      if (Number(scanResponse.reason?.response?.status || 0) === 404) {
        setScanNotice('Le snapshot de scan ne contient pas encore de detail pour ce profil.')
      } else {
        setScanNotice(getErrorMessage(scanResponse.reason, 'Le detail de scan n a pas pu etre charge.'))
      }
    }

    setDetailPhase('done')
  }

  async function handleSearch() {
    const cleaned = query.trim().replace(/^@+/, '')
    if (!selectedGuildId || !cleaned || searchPhase === 'loading') return

    if (!/^\d+$/.test(cleaned) && cleaned.length < 2) {
      const message = 'Saisis au moins 2 caracteres ou un ID Discord.'
      setSearchError(message)
      toast.error(message)
      return
    }

    setSearchPhase('loading')
    setSearchError('')
    setDetailError('')
    setScanNotice('')
    setResults([])
    setSelectedUserId('')
    setProfilePayload(null)
    setScanMember(null)
    setDetailPhase('idle')

    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId

    try {
      const response = await modAPI.searchUsers(selectedGuildId, { q: cleaned, limit: 8 })
      if (requestId !== searchRequestRef.current) return

      const nextResults = Array.isArray(response.data?.results) ? response.data.results : []
      setResults(nextResults)
      setSearchPhase('done')

      if (nextResults.length > 0) {
        void loadDetail(nextResults[0].id)
      }
    } catch (error) {
      if (requestId !== searchRequestRef.current) return

      const message = getErrorMessage(error, 'Recherche Discord impossible.')
      setSearchError(message)
      setSearchPhase('error')
      toast.error(message)
    }
  }

  if (!guildLoading && guilds.length === 0) {
    return (
      <SelectGuildState
        title="Aucun serveur disponible"
        body="Discord Panel utilise uniquement les serveurs que ton bot gere deja. Synchronise ou ajoute un serveur pour debloquer ce module."
        actionLabel="Ouvrir les serveurs"
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="font-display text-3xl font-800 text-white">Discord Panel</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55 sm:text-[15px]">
              Recherche un membre par ID, mention ou pseudo pour afficher sa fiche, ses roles et son historique visible.
            </p>
          </div>

          <div className="w-full max-w-xl rounded-[26px] border border-white/10 bg-black/15 p-4 sm:p-5">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Serveur</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <select
                value={selectedGuildId || ''}
                onChange={(event) => selectGuild(event.target.value || null)}
                className="input-field flex-1 cursor-pointer"
              >
                <option value="">Choisir un serveur</option>
                {guilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void fetchGuilds({ force: true })}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-mono text-white/70 transition-all hover:border-white/20 hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${guildLoading ? 'animate-spin' : ''}`} />
                Sync
              </button>
            </div>
          </div>
        </div>
      </div>

      {!selectedGuildId ? (
        <div className="spotlight-card p-6 sm:p-7">
          <div className="relative z-[1] flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[20px] border border-amber-400/20 bg-amber-400/10">
              <AlertTriangle className="h-5 w-5 text-amber-200" />
            </div>
            <div>
              <p className="font-display text-xl font-700 text-white">Selectionne un serveur</p>
              <p className="mt-2 text-sm leading-7 text-white/55">
                Le panneau Discord a besoin d un serveur actif pour interroger les membres, bans, roles et historique visible.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="spotlight-card p-5 sm:p-6">
            <div className="relative z-[1] space-y-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleSearch()
                      }
                    }}
                    placeholder="ID Discord, mention, pseudo, global name..."
                    className="input-field pl-11"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void handleSearch()}
                  disabled={!query.trim() || searchPhase === 'loading'}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <RefreshCw className={`h-4 w-4 ${searchPhase === 'loading' ? 'animate-spin' : ''}`} />
                  {searchPhase === 'loading' ? 'Recherche...' : 'Analyser Discord'}
                </button>
              </div>

              <p className="text-sm leading-6 text-white/45">
                Fiche enrichie: avatar, banniere, roles, sanctions internes et historique staff.
              </p>
            </div>
          </div>

          {searchError ? (
            <div className="rounded-[24px] border border-red-400/20 bg-red-500/10 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-300" />
                </div>
                <div>
                  <p className="font-display text-lg font-700 text-red-100">Recherche Discord en erreur</p>
                  <p className="mt-1 text-sm leading-6 text-red-100/80">{searchError}</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-4">
              {results.length > 0 ? results.map((entry) => (
                <ResultRow
                  key={entry.id}
                  entry={entry}
                  active={selectedUserId === entry.id}
                  onClick={() => void loadDetail(entry.id)}
                />
              )) : (
                <div className="spotlight-card p-6 sm:p-7">
                  <div className="relative z-[1] text-center">
                    <Users className="mx-auto h-12 w-12 text-white/10" />
                    <p className="mt-4 font-display text-xl font-700 text-white">Aucune cible chargee</p>
                    <p className="mt-2 text-sm leading-6 text-white/45">
                      Lance une recherche pour afficher les profils Discord visibles sur {selectedGuild?.name || 'ce serveur'}.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-5">
              {detailError ? (
                <div className="rounded-[24px] border border-red-400/20 bg-red-500/10 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10">
                      <AlertTriangle className="h-5 w-5 text-red-300" />
                    </div>
                    <div>
                      <p className="font-display text-lg font-700 text-red-100">Chargement du profil en erreur</p>
                      <p className="mt-1 text-sm leading-6 text-red-100/80">{detailError}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {profile ? (
                <div className="space-y-5">
                  <div className="feature-hero overflow-hidden p-0">
                    <div className="relative">
                      {profile.banner_url ? (
                        <img src={profile.banner_url} alt="" className="h-40 w-full object-cover opacity-85 sm:h-48" />
                      ) : (
                        <div className="h-40 w-full bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.28),transparent_45%),linear-gradient(135deg,rgba(34,211,238,0.08),rgba(139,92,246,0.18),rgba(255,255,255,0.04))] sm:h-48" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-[#08111d]" />

                      <div className="relative z-[1] p-6 sm:p-7">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                            <Avatar
                              src={profile.avatar_url}
                              label={profile.display_name || profile.username || profile.id}
                              size="h-24 w-24"
                              radius="rounded-[28px]"
                            />
                            <div>
                              <div className="mb-3 flex flex-wrap gap-2">
                                {profile.in_server ? <span className="badge-online">Dans le serveur</span> : null}
                                {profile.banned ? <span className="badge-error">Banni</span> : null}
                                {profile.timeout_active ? <span className="badge-warning">Timeout actif</span> : null}
                                {profile.bot ? <span className="badge-offline">Bot</span> : null}
                                {scanMember?.selfbot_suspect ? <span className="badge-error">Self-bot suspect</span> : null}
                              </div>
                              <h3 className="font-display text-3xl font-800 text-white">
                                {profile.display_name || profile.username || profile.id}
                              </h3>
                              <p className="mt-2 text-sm leading-6 text-white/55">
                                @{profile.username || profile.id}
                                {profile.global_name && profile.global_name !== profile.username ? ` - ${profile.global_name}` : ''}
                                {profile.nickname ? ` - surnom ${profile.nickname}` : ''}
                              </p>
                              {profile.bio ? <p className="mt-3 max-w-3xl text-sm leading-7 text-white/65">{profile.bio}</p> : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">
                              ID {profile.id}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/55">
                              Cree {formatDate(profile.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {detailPhase === 'loading' ? (
                    <div className="rounded-[24px] border border-neon-cyan/20 bg-neon-cyan/10 p-4 sm:p-5">
                      <div className="flex items-center gap-3">
                        <RefreshCw className="h-5 w-5 animate-spin text-neon-cyan" />
                        <p className="text-sm text-neon-cyan">Chargement de la fiche Discord et des signaux de scan...</p>
                      </div>
                    </div>
                  ) : null}

                  {scanNotice ? (
                    <div className="rounded-[24px] border border-amber-400/20 bg-amber-400/10 p-4 sm:p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10">
                          <AlertTriangle className="h-5 w-5 text-amber-100" />
                        </div>
                        <div>
                          <p className="font-display text-lg font-700 text-amber-100">Signal partiel</p>
                          <p className="mt-1 text-sm leading-6 text-amber-100/80">{scanNotice}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <IntelMetric label="Age compte" value={accountAgeDays ?? '--'} hint={accountAgeDays !== null ? 'jours' : 'indisponible'} />
                    <IntelMetric label="Age serveur" value={joinedDays ?? '--'} hint={joinedDays !== null ? 'jours depuis l entree' : 'hors serveur'} tone="border-neon-cyan/18 bg-neon-cyan/[0.08]" />
                    <IntelMetric label="Sanctions site" value={formatCount(siteSummary.total_actions)} hint={`${formatCount(siteSummary.total_warnings)} warn - ${formatCount(siteSummary.active_warning_points)} pt actifs`} tone="border-violet-400/18 bg-violet-400/10 text-violet-100" />
                    <IntelMetric label="Risque scan" value={scanMember?.risk_score ?? '--'} hint={scanMember?.risk_label || 'pas de snapshot'} tone="border-emerald-400/20 bg-emerald-400/10 text-emerald-100" />
                  </div>

                  <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                    <div className="space-y-5">
                      <SectionCard title="Signaux operables" hint="Resume staff des informations visibles sur ce profil.">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Dates</p>
                            <div className="mt-3 space-y-2 text-sm text-white/70">
                              <p>Compte cree: {formatDate(profile.created_at)}</p>
                              <p>Entre sur le serveur: {formatDate(profile.joined_at)}</p>
                              <p>Boost depuis: {formatDate(profile.premium_since)}</p>
                              <p>Timeout jusqu a: {formatDate(profile.timed_out_until)}</p>
                            </div>
                          </div>

                          <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Permissions staff</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {viewer.can_warn ? <span className="badge-online">Warn</span> : null}
                              {viewer.can_timeout ? <span className="badge-online">Timeout</span> : null}
                              {viewer.can_kick ? <span className="badge-online">Kick</span> : null}
                              {viewer.can_ban ? <span className="badge-online">Ban</span> : null}
                              {viewer.can_blacklist_network ? <span className="badge-online">Blacklist</span> : null}
                              {!viewer.can_warn && !viewer.can_timeout && !viewer.can_kick && !viewer.can_ban && !viewer.can_blacklist_network ? (
                                <span className="text-sm text-white/45">Aucune action staff remontee pour ce viewer.</span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Synthese scan</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {scanMember?.risk_label ? <span className="badge-warning">{scanMember.risk_label}</span> : null}
                              {scanMember?.confidence_label ? <span className="badge-online">{scanMember.confidence_label}</span> : null}
                              {scanMember?.quarantined ? <span className="badge-error">Quarantaine</span> : null}
                              {scanMember?.suspicious ? <span className="badge-warning">Activite suspecte</span> : null}
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-white/70">
                              <p>{formatCount(scanMember?.evidence_summary?.suspicious_message_count)} message(s) suspects</p>
                              <p>{formatCount(scanMember?.evidence_summary?.deleted_message_count)} suppression(s) observee(s)</p>
                              <p>Derniere trace: {formatDate(scanMember?.evidence_summary?.last_seen_at)}</p>
                            </div>
                          </div>

                          <div className="rounded-[22px] border border-white/8 bg-black/15 p-4">
                            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Historique staff</p>
                            <div className="mt-3 space-y-2 text-sm text-white/70">
                              <p>{formatCount(siteSummary.total_warnings)} warning(s)</p>
                              <p>{formatCount(siteSummary.active_warning_points)} point(s) actif(s)</p>
                              <p>{formatCount(siteSummary.total_actions)} action(s) site</p>
                              <p>{formatCount(discordSummary.total_actions)} action(s) Discord</p>
                            </div>
                          </div>
                        </div>

                        {scanMember?.reasons?.length ? (
                          <div className="mt-4 space-y-3">
                            {scanMember.reasons.slice(0, 6).map((reason) => (
                              <div key={reason} className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm leading-6 text-white/68">
                                {reason}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-[18px] border border-white/8 bg-black/15 px-4 py-4 text-sm text-white/45">
                            Aucun signal additionnel remonte par le scan serveur.
                          </div>
                        )}
                      </SectionCard>

                      <SectionCard title="Historique consolide" hint="Actions staff internes et evenements Discord relies a ce profil.">
                        <div className="space-y-3">
                          {combinedHistory.length ? combinedHistory.slice(0, 10).map((entry) => (
                            <HistoryRow key={entry.id} entry={entry} />
                          )) : (
                            <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-4 text-sm text-white/45">
                              Aucun historique staff n a encore ete enregistre pour ce profil.
                            </div>
                          )}
                        </div>
                      </SectionCard>

                      <SectionCard title="Extraits suspects" hint="Snippets remontes par le moteur de scan du serveur.">
                        <div className="space-y-3">
                          {scanMember?.suspicious_messages?.length ? scanMember.suspicious_messages.slice(0, 8).map((entry) => (
                            <EvidenceRow key={entry.id || `${entry.kind}-${entry.created_at}`} entry={entry} />
                          )) : (
                            <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-4 text-sm text-white/45">
                              Aucun extrait suspect disponible dans le snapshot actuel.
                            </div>
                          )}
                        </div>
                      </SectionCard>
                    </div>

                    <div className="space-y-5">
                      <SectionCard title="Roles" hint="Roles resolves depuis le serveur cible.">
                        <div className="flex flex-wrap gap-2">
                          {profile.roles?.length ? profile.roles.map((role) => (
                            <span
                              key={role.id}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/60"
                            >
                              {role.name}
                            </span>
                          )) : (
                            <span className="text-sm text-white/45">Aucun role remonte.</span>
                          )}
                        </div>
                      </SectionCard>

                      <SectionCard title="Indices de moderation" hint="Flags et signaux utiles avant une action staff.">
                        <div className="space-y-4">
                          <div className="flex flex-wrap gap-2">
                            {profile.network_blacklisted ? <span className="badge-error">Blacklist reseau</span> : null}
                            {profile.banned ? <span className="badge-error">Banni du serveur</span> : null}
                            {profile.in_server ? <span className="badge-online">Membre actif</span> : null}
                            {scanMember?.evidence_flags?.map((flag) => (
                              <span key={flag} className="badge-warning">{flag}</span>
                            ))}
                            {!profile.network_blacklisted && !profile.banned && !profile.in_server && !(scanMember?.evidence_flags?.length) ? (
                              <span className="text-sm text-white/45">Aucun drapeau critique supplementaire.</span>
                            ) : null}
                          </div>

                          {profile.blacklist?.reason ? (
                            <div className="rounded-[18px] border border-red-400/20 bg-red-500/10 p-4 text-sm leading-6 text-red-100/80">
                              {profile.blacklist.reason}
                            </div>
                          ) : null}
                        </div>
                      </SectionCard>

                      <SectionCard title="Resume rapide" hint="Elements les plus utilises au premier tri.">
                        <div className="space-y-3">
                          <div className="rounded-[18px] border border-white/8 bg-black/15 p-4">
                            <div className="flex items-center gap-3">
                              <Server className="h-4 w-4 text-neon-cyan" />
                              <div>
                                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Presence</p>
                                <p className="mt-1 text-sm text-white/72">{profile.in_server ? 'Visible dans le serveur cible' : 'Hors serveur ou seulement visible via ban/profil'}</p>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-white/8 bg-black/15 p-4">
                            <div className="flex items-center gap-3">
                              <Fingerprint className="h-4 w-4 text-violet-300" />
                              <div>
                                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Compte</p>
                                <p className="mt-1 text-sm text-white/72">Flags publics: {formatCount(profile.public_flags)} - Accent {profile.accent_color ?? '--'}</p>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-white/8 bg-black/15 p-4">
                            <div className="flex items-center gap-3">
                              <Clock3 className="h-4 w-4 text-amber-200" />
                              <div>
                                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Dernier signal</p>
                                <p className="mt-1 text-sm text-white/72">{formatDate(discordSummary.last_action_at || scanMember?.evidence_summary?.last_seen_at)}</p>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-white/8 bg-black/15 p-4">
                            <div className="flex items-center gap-3">
                              {profile.bot ? <Bot className="h-4 w-4 text-white/60" /> : <MessageCircle className="h-4 w-4 text-emerald-200" />}
                              <div>
                                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Nature</p>
                                <p className="mt-1 text-sm text-white/72">{profile.bot ? 'Compte bot' : 'Compte utilisateur'}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </SectionCard>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="spotlight-card p-8 sm:p-10">
                  <div className="relative z-[1] text-center">
                    <Search className="mx-auto h-12 w-12 text-white/10" />
                    <p className="mt-4 font-display text-xl font-700 text-white">Discord Panel pret</p>
                    <p className="mt-2 text-sm leading-6 text-white/45">
                      Recherche un membre ou un ID Discord pour afficher sa fiche serveur, son historique staff et ses signaux de scan.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
