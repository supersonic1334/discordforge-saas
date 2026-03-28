import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Fingerprint,
  Link2,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { authAPI, modAPI, scanAPI } from '../services/api'
import { SelectGuildState, formatDate, getErrorMessage, initials, parseDurationInput } from '../components/moderation/moderationUI'
import { useAuthStore, useGuildStore } from '../stores'
import { openDiscordLinkPopup } from '../utils/discordLinkPopup'
import { wsService } from '../services/websocket'

const RISK_OPTIONS = [
  { value: 'all', label: 'Tous les risques' },
  { value: 'critical', label: 'Critique' },
  { value: 'high', label: '\u00c9lev\u00e9' },
  { value: 'medium', label: 'Mod\u00e9r\u00e9' },
  { value: 'low', label: 'Faible' },
]

const SCOPE_OPTIONS = [
  { value: 'all', label: 'Tout le serveur' },
  { value: 'suspicious', label: 'Activité suspecte' },
  { value: 'humans', label: 'Humains' },
  { value: 'bots', label: 'Bots' },
]

const ACTIONS = [
  { id: 'warn', label: 'Warn', icon: AlertTriangle, tone: 'border-amber-500/20 bg-amber-500/10 text-amber-300' },
  { id: 'timeout', label: 'Timeout', icon: Clock3, tone: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' },
  { id: 'kick', label: 'Kick', icon: Shield, tone: 'border-orange-500/20 bg-orange-500/10 text-orange-300' },
  { id: 'ban', label: 'Ban', icon: Ban, tone: 'border-red-500/20 bg-red-500/10 text-red-300' },
  { id: 'blacklist', label: 'Blacklist reseau', icon: Fingerprint, tone: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
]

const SCAN_DISCORD_LINK_STATE_KEY = 'discordforger.scan.discord-link-state'

function saveDiscordLinkScanState(state) {
  try {
    window.sessionStorage.setItem(SCAN_DISCORD_LINK_STATE_KEY, JSON.stringify({
      guildId: state.guildId || null,
      filters: state.filters || null,
      selectedUserId: state.selectedUserId || '',
      timestamp: Date.now(),
    }))
  } catch {}
}

function consumeDiscordLinkScanState(expectedGuildId) {
  try {
    const raw = window.sessionStorage.getItem(SCAN_DISCORD_LINK_STATE_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(SCAN_DISCORD_LINK_STATE_KEY)
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (expectedGuildId && parsed.guildId && String(parsed.guildId) !== String(expectedGuildId)) return null
    return {
      filters: parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : null,
      selectedUserId: String(parsed.selectedUserId || ''),
    }
  } catch {
    return null
  }
}

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

function Avatar({ src, label, size = 'w-14 h-14' }) {
  if (src) {
    return <img src={src} alt={label} className={`${size} rounded-[20px] object-cover border border-white/10 shadow-[0_16px_36px_rgba(0,0,0,0.24)]`} />
  }

  return (
    <div className={`${size} rounded-[20px] border border-white/10 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center text-sm font-mono text-white/75 shadow-[0_16px_36px_rgba(0,0,0,0.24)]`}>
      {initials(label)}
    </div>
  )
}

function MetricCard({ label, value, hint, tone = 'border-white/10 bg-black/15 text-white' }) {
  return (
    <div className={`feature-metric ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-60">{label}</p>
      <p className="mt-2 font-display text-2xl font-800">{value}</p>
      {hint ? <p className="mt-2 text-xs text-white/40">{hint}</p> : null}
    </div>
  )
}

function RiskBadge({ tier, label }) {
  const tone = tier === 'critical'
    ? 'badge-error'
    : tier === 'high'
      ? 'badge-warning'
      : tier === 'medium'
        ? 'badge-online'
        : 'badge-offline'

  return <span className={tone}>{label}</span>
}

function RiskBar({ score }) {
  const color = score >= 85 ? 'from-red-400 via-red-500 to-pink-500' : score >= 55 ? 'from-orange-400 via-amber-400 to-yellow-300' : score >= 25 ? 'from-cyan-400 via-sky-400 to-violet-400' : 'from-white/20 via-white/30 to-white/35'

  return (
    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
      <div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${Math.max(6, Math.min(100, Number(score || 0)))}%` }} />
    </div>
  )
}

function MemberCard({ member, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`spotlight-card spotlight-ring w-full p-4 text-left transition-all duration-300 ${
        active
          ? 'border-neon-cyan/25 bg-neon-cyan/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_18px_42px_rgba(0,0,0,0.35),0_0_28px_rgba(34,211,238,0.10)]'
          : 'hover:-translate-y-[2px] hover:border-white/15 hover:bg-white/[0.05]'
      }`}
    >
      <div className="relative z-[1] space-y-4">
        <div className="flex items-start gap-3">
          <Avatar src={member.avatar_url} label={member.display_name || member.username || member.id} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display font-700 text-white truncate">{member.display_name || member.username || member.id}</p>
              <RiskBadge tier={member.risk_tier} label={member.risk_label} />
              {member.bot ? <span className="badge-offline">Bot</span> : null}
              {member.selfbot_suspect ? <span className="badge-error">Self-bot suspect</span> : null}
            </div>
            <p className="mt-1 truncate text-sm text-white/45">@{member.username || member.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Score</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{member.risk_score}</p>
          </div>
        </div>

        <RiskBar score={member.risk_score} />

        <div className="flex flex-wrap gap-2 text-[11px] font-mono text-white/35">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{member.warning_summary.active_points || 0} pt actifs</span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{member.action_summary.total_actions || 0} action(s)</span>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">{member.evidence_summary.suspicious_message_count || 0} activite(s) suspecte(s)</span>
        </div>

        <div className="space-y-2">
          {member.reasons.slice(0, 3).map((reason) => (
            <div key={reason} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-sm text-white/65">
              {reason}
            </div>
          ))}
        </div>
      </div>
    </button>
  )
}

function DetailBlock({ title, children, hint = '' }) {
  return (
    <div className="spotlight-card p-5">
      <div className="relative z-[1] space-y-4">
        <div>
          <p className="font-display font-700 text-white">{title}</p>
          {hint ? <p className="mt-1 text-sm text-white/40">{hint}</p> : null}
        </div>
        {children}
      </div>
    </div>
  )
}

function EvidenceRow({ entry }) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/15 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-warning">{entry.label}</span>
        <span className="text-[11px] font-mono text-white/30">{formatDate('fr-FR', entry.created_at)}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/75">{entry.excerpt || 'Aucun extrait disponible.'}</p>
      {entry.highlights?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {entry.highlights.map((highlight) => (
            <span key={highlight} className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-mono text-amber-200">
              {highlight}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function InfoDrawer({ open, onClose, detail }) {
  if (!open || !detail) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-surface-1/95 px-4 py-5 sm:px-6 sm:py-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Informations supplémentaires</p>
              <h3 className="mt-2 font-display text-2xl font-800 text-white">{detail.display_name || detail.username || detail.id}</h3>
              <p className="mt-2 text-sm text-white/45">Historique complet, contexte et signaux utiles à la modération.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/20 hover:text-white"
            >
              Fermer
            </button>
          </div>

          <DetailBlock title="Contexte membre" hint="Infos utiles avant decision staff.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Compte</p>
                <p className="mt-2 text-sm text-white/75">
                  {detail.account_age_days !== null && detail.account_age_days !== undefined
                    ? `${detail.account_age_days} jour(s)`
                    : 'Âge indisponible'}
                </p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Presence serveur</p>
                <p className="mt-2 text-sm text-white/75">
                  {detail.joined_age_days !== null && detail.joined_age_days !== undefined
                    ? `${detail.joined_age_days} jour(s)`
                    : 'Date indisponible'}
                </p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">État modération</p>
                <p className="mt-2 text-sm text-white/75">
                  {detail.timeout_active
                    ? `Timeout actif jusqu'au ${formatDate('fr-FR', detail.timeout_until)}`
                    : 'Aucun timeout actif'}
                </p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Blacklist réseau</p>
                <p className="mt-2 text-sm text-white/75">{detail.blacklist?.reason || 'Aucune entrée réseau'}</p>
              </div>
            </div>

            <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Rôles visibles</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.roles?.length
                  ? detail.roles.map((role) => (
                    <span key={role.id} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-mono text-white/70">
                      @{role.name}
                    </span>
                  ))
                  : <span className="text-sm text-white/40">Aucun rôle visible.</span>}
              </div>
            </div>

            <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Signaux détectés</p>
                {detail.evidence_summary?.last_seen_at ? (
                  <span className="text-[11px] font-mono text-white/25">Dernier signal : {formatDate('fr-FR', detail.evidence_summary.last_seen_at)}</span>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.evidence_flags?.length
                  ? detail.evidence_flags.map((flag) => (
                    <span key={flag} className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-mono text-amber-200">
                      {flag}
                    </span>
                  ))
                  : <span className="text-sm text-white/40">Aucun flag supplémentaire.</span>}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Warnings actifs</p>
                <p className="mt-2 font-display text-2xl font-800 text-white">{detail.warning_summary?.active_points || 0}</p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Actions staff</p>
                <p className="mt-2 font-display text-2xl font-800 text-white">{detail.action_summary?.total_actions || 0}</p>
              </div>
              <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3">
                <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/30">Messages signalés</p>
                <p className="mt-2 font-display text-2xl font-800 text-white">{detail.evidence_summary?.suspicious_message_count || 0}</p>
              </div>
            </div>
          </DetailBlock>

          <DetailBlock title="Historique modération" hint="Warnings et actions déjà observés sur ce membre.">
            <div className="space-y-3">
              {detail.recent_actions?.length ? detail.recent_actions.map((entry) => (
                <div key={`${entry.action_type}-${entry.created_at}`} className="rounded-[18px] border border-white/8 bg-black/15 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge-offline">{entry.action_type}</span>
                    {entry.module_source ? <span className="badge-warning">{entry.module_source}</span> : null}
                    <span className="text-[11px] font-mono text-white/30">{formatDate('fr-FR', entry.created_at)}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/70">{entry.reason || 'Aucune raison précisée.'}</p>
                </div>
              )) : (
                <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/45">
                  Aucun historique de modération récent.
                </div>
              )}

              {detail.recent_warnings?.length ? (
                <div className="rounded-[18px] border border-amber-500/20 bg-amber-500/10 p-4">
                  <p className="font-display font-700 text-amber-100">Warnings récents</p>
                  <div className="mt-3 space-y-2">
                    {detail.recent_warnings.map((entry, index) => (
                      <div key={`${entry.created_at}-${index}`} className="text-sm text-amber-100/80">
                        {entry.points} pt - {entry.reason || 'Aucune raison'} - {formatDate('fr-FR', entry.created_at)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </DetailBlock>
        </div>
      </div>
    </div>
  )
}

export default function ScanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { guilds, selectedGuildId } = useGuildStore()
  const { user, fetchMe, setUser } = useAuthStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)

  const [filters, setFilters] = useState({
    q: '',
    risk: 'all',
    scope: 'all',
    page: 1,
    limit: 18,
  })
  const [scan, setScan] = useState(null)
  const [loadingScan, setLoadingScan] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [linkingDiscord, setLinkingDiscord] = useState(false)
  const [actionValues, setActionValues] = useState({ reason: '', duration: '10m', hideIdentity: false })
  const [submittingAction, setSubmittingAction] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)

  const members = scan?.members || []
  const viewer = scan?.viewer || detail?.viewer || {
    linked_discord: Boolean(user?.discord_id),
    can_warn: Boolean(user?.is_primary_founder && user?.discord_id),
    can_timeout: Boolean(user?.is_primary_founder && user?.discord_id),
    can_kick: Boolean(user?.is_primary_founder && user?.discord_id),
    can_ban: Boolean(user?.is_primary_founder && user?.discord_id),
    can_blacklist_network: Boolean(user?.is_primary_founder && user?.discord_id),
  }

  useEffect(() => {
    setFilters((current) => ({ ...current, q: '', risk: 'all', scope: 'all', page: 1 }))
    setSelectedUserId('')
    setDetail(null)
    setScan(null)
    setInfoOpen(false)
  }, [selectedGuildId])

  useEffect(() => {
    if (!scan?.viewer) return
    setDetail((current) => {
      if (!current) return current
      return {
        ...current,
        viewer: scan.viewer,
      }
    })
  }, [scan?.viewer])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const linked = params.get('discord_linked')
    const linkError = params.get('discord_link_error')
    if (!linked && !linkError) return

    void fetchMe()
    const restoredState = linked === '1' ? consumeDiscordLinkScanState(selectedGuildId) : null
    if (linked === '1') {
      toast.success('Compte Discord connecte')
    } else if (linkError) {
      toast.error(linkError)
    }

    params.delete('discord_linked')
    params.delete('discord_link_error')
    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true })

    if (restoredState?.filters) {
      const nextFilters = {
        ...filters,
        ...restoredState.filters,
      }
      setFilters(nextFilters)
      void loadScan(true, nextFilters, restoredState.selectedUserId)
      return
    }

    if (restoredState?.selectedUserId) {
      setSelectedUserId(restoredState.selectedUserId)
      void loadDetail(restoredState.selectedUserId)
    }
  }, [fetchMe, location.pathname, location.search, navigate, selectedGuildId])

  async function loadScan(forceRefresh = false, nextFilters = filters, preferredUserId = '', options = {}) {
    if (!selectedGuildId) return

    if (!options.silent) {
      if (forceRefresh) setRefreshing(true)
      else setLoadingScan(true)
    }

    try {
      const response = await scanAPI.scan(selectedGuildId, {
        ...nextFilters,
        refresh: forceRefresh ? 1 : 0,
      })
      const nextScan = response.data || null
      setScan(nextScan)
      if (nextScan?.viewer) {
        setDetail((current) => {
          if (!current) return current
          return {
            ...current,
            viewer: nextScan.viewer,
          }
        })
      }

      const nextMembers = nextScan?.members || []
      setSelectedUserId((current) => {
        if (preferredUserId && nextMembers.some((entry) => entry.id === preferredUserId)) return preferredUserId
        if (current && nextMembers.some((entry) => entry.id === current)) return current
        return nextMembers[0]?.id || ''
      })
      return nextScan
    } catch (error) {
      if (!options.silent) {
        toast.error(getErrorMessage(error))
      }
      return null
    } finally {
      if (!options.silent) {
        setLoadingScan(false)
        setRefreshing(false)
      }
    }
  }

  async function loadDetail(userId, { silent = false } = {}) {
    if (!selectedGuildId || !userId) {
      setDetail(null)
      return
    }

    if (!silent) setLoadingDetail(true)
    try {
      const response = await scanAPI.member(selectedGuildId, userId)
      const nextDetail = {
        ...(response.data?.member || null),
        viewer: response.data?.viewer || scan?.viewer || null,
      }
      setDetail(nextDetail)
      return nextDetail
    } catch (error) {
      if (!silent) {
        toast.error(getErrorMessage(error))
      }
      return null
    } finally {
      if (!silent) setLoadingDetail(false)
    }
  }

  function applyImmediateDiscordLink(linkResult) {
    const linkedDiscordId = String(linkResult?.linkedDiscordId || '').trim()
    if (!linkedDiscordId) return false

    const nextUser = {
      ...(useAuthStore.getState().user || user || {}),
      discord_id: linkedDiscordId,
    }
    setUser(nextUser)

    const immediateViewer = {
      ...(scan?.viewer || detail?.viewer || {}),
      linked_discord: true,
      linked_discord_id: linkedDiscordId,
      can_warn: Boolean(scan?.viewer?.can_warn || detail?.viewer?.can_warn || nextUser?.is_primary_founder),
      can_timeout: Boolean(scan?.viewer?.can_timeout || detail?.viewer?.can_timeout || nextUser?.is_primary_founder),
      can_kick: Boolean(scan?.viewer?.can_kick || detail?.viewer?.can_kick || nextUser?.is_primary_founder),
      can_ban: Boolean(scan?.viewer?.can_ban || detail?.viewer?.can_ban || nextUser?.is_primary_founder),
      can_blacklist_network: Boolean(scan?.viewer?.can_blacklist_network || detail?.viewer?.can_blacklist_network || nextUser?.is_primary_founder),
    }

    setScan((current) => current ? { ...current, viewer: immediateViewer } : current)
    setDetail((current) => current ? { ...current, viewer: { ...(current.viewer || {}), ...immediateViewer } } : current)
    return true
  }

  async function syncViewerAfterDiscordLink(linkResult) {
    const immediateLinked = applyImmediateDiscordLink(linkResult)

    await fetchMe()
    const nextScan = await loadScan(true, filters, selectedUserId)
    if (selectedUserId) {
      await loadDetail(selectedUserId, { silent: true })
    }

    return Boolean(nextScan?.viewer?.linked_discord || immediateLinked || useAuthStore.getState().user?.discord_id)
  }

  useEffect(() => {
    if (!selectedGuildId) return undefined
    const timeoutId = window.setTimeout(() => {
      loadScan(false, filters)
    }, filters.q ? 220 : 0)

    return () => window.clearTimeout(timeoutId)
  }, [selectedGuildId, filters.page, filters.limit, filters.q, filters.risk, filters.scope])

  useEffect(() => {
    if (!selectedUserId) {
      setDetail(null)
      return
    }
    loadDetail(selectedUserId)
  }, [selectedUserId, selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return undefined

    const intervalId = window.setInterval(() => {
      void loadScan(false, filters, selectedUserId, { silent: true })
      if (selectedUserId) {
        void loadDetail(selectedUserId, { silent: true })
      }
    }, 12000)

    return () => window.clearInterval(intervalId)
  }, [filters, selectedGuildId, selectedUserId])

  useEffect(() => {
    if (!selectedGuildId) return undefined

    const handleScanUpdated = (payload) => {
      if (String(payload?.guildId || '') !== String(guild?.guild_id || '')) return
      void loadScan(false, filters, selectedUserId, { silent: true })
      if (selectedUserId) {
        void loadDetail(selectedUserId, { silent: true })
      }
    }

    const unsubscribe = wsService.on('scan:updated', handleScanUpdated)
    return () => unsubscribe()
  }, [filters, guild?.guild_id, selectedGuildId, selectedUserId])

  async function handleConnectDiscord() {
    if (linkingDiscord) return
    setLinkingDiscord(true)
    try {
      saveDiscordLinkScanState({
        guildId: selectedGuildId,
        filters,
        selectedUserId,
      })
      const returnTo = `${location.pathname}${location.search || ''}`
      const response = await authAPI.createDiscordLink({ return_to: returnTo, mode: 'popup' })
      const nextUrl = response?.data?.url
      if (!nextUrl) throw new Error('Lien Discord indisponible')
      const result = await openDiscordLinkPopup(nextUrl)
      if (result?.status !== 'success') {
        throw new Error(result?.error || 'discord_link_failed')
      }

      const synced = await syncViewerAfterDiscordLink(result)
      if (!synced) {
        throw new Error('Le compte Discord est lie, mais la mise a jour n a pas encore fini. Reessaie dans quelques secondes.')
      }
      toast.success('Compte Discord connecte')
    } catch (error) {
      if (String(error?.message || '') !== 'Popup fermee') {
        toast.error(getErrorMessage(error))
      }
    } finally {
      setLinkingDiscord(false)
    }
  }

  async function handleAction(actionId) {
    if (!selectedGuildId || !detail?.id || submittingAction) return
    if (!viewer?.linked_discord) {
      toast.error('Connecte ton compte Discord')
      return
    }

    const payload = {
      action: actionId,
      target_user_id: detail.id,
      target_username: detail.display_name || detail.username || detail.id,
      reason: actionValues.reason.trim() || `Action Scan: ${actionId}`,
      hide_moderator_identity: Boolean(actionValues.hideIdentity),
    }

    if (actionId === 'timeout') {
      const durationMs = parseDurationInput(actionValues.duration.trim())
      if (!durationMs) {
        toast.error('Duree invalide')
        return
      }
      payload.duration_ms = durationMs
    }

    setSubmittingAction(actionId)
    try {
      await modAPI.action(selectedGuildId, payload)
      toast.success(`${actionId} execute`)
      await loadScan(true, filters, detail.id)
      await loadDetail(detail.id)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSubmittingAction('')
    }
  }

  const pageCount = useMemo(() => {
    const total = Number(scan?.total_filtered || 0)
    return total > 0 ? Math.max(1, Math.ceil(total / filters.limit)) : 1
  }, [filters.limit, scan?.total_filtered])

  if (!selectedGuildId) {
    return (
      <SelectGuildState
        title="Choisis d abord un serveur"
        body="Scan analyse serveur par serveur avec un score de risque et des actions directes."
        actionLabel="Choisir un serveur"
      />
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={Fingerprint} label="Scan" />
              <HeaderPill icon={ShieldCheck} label="analyse risque" />
              <HeaderPill icon={Users} label={guild?.name || 'serveur'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Scan</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55 sm:text-[15px]">
                Analyse avancée des membres, détection des bots, suspicion de self-bot, activité suspecte et actions staff rapides sans perdre le contexte.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 xl:justify-end">
            <button
              type="button"
              onClick={() => loadScan(true)}
              disabled={loadingScan || refreshing}
              className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingScan || refreshing ? 'animate-spin' : ''}`} />
              Relancer le scan
            </button>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Scannes" value={scan?.summary?.scanned_members || 0} hint={scan?.partial ? 'analyse partielle stable' : 'analyse complete'} />
          <MetricCard label="Suspects" value={scan?.summary?.suspicious_members || 0} tone="border-amber-500/20 bg-amber-500/10 text-amber-100" />
          <MetricCard label="Critiques" value={scan?.summary?.critical || 0} tone="border-red-500/20 bg-red-500/10 text-red-100" />
          <MetricCard label="\u00c9lev\u00e9s" value={scan?.summary?.high || 0} tone="border-orange-500/20 bg-orange-500/10 text-orange-100" />
          <MetricCard label="Bots" value={scan?.summary?.bots || 0} tone="border-violet-500/20 bg-violet-500/10 text-violet-100" />
        </div>

        {scan?.partial ? (
          <div className="relative z-[1] mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/85">
            {scan.partial_reason}
          </div>
        ) : null}
      </div>

      <div className="spotlight-card p-5 sm:p-6">
        <div className="relative z-[1] grid gap-3 xl:grid-cols-[minmax(0,1fr)_200px_200px_auto]">
          <div className="relative">
            <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              className="input-field pl-11"
              placeholder="Pseudo, ID, raison, signal..."
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value, page: 1 }))}
            />
          </div>

          <select
            className="select-field"
            value={filters.risk}
            onChange={(event) => setFilters((current) => ({ ...current, risk: event.target.value, page: 1 }))}
          >
            {RISK_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>

          <select
            className="select-field"
            value={filters.scope}
            onChange={(event) => setFilters((current) => ({ ...current, scope: event.target.value, page: 1 }))}
          >
            {SCOPE_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>

          <div className="flex items-center justify-end text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">
            {scan?.total_filtered || 0} résultat(s)
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {loadingScan ? [...Array(6)].map((_, index) => <div key={index} className="h-[270px] rounded-[24px] skeleton" />) : null}
            {!loadingScan && members.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                active={member.id === selectedUserId}
                onClick={() => setSelectedUserId(member.id)}
              />
            ))}
          </div>

          {!loadingScan && members.length === 0 ? (
            <div className="feature-hero p-10 text-center">
              <div className="relative z-[1]">
                <Users className="w-12 h-12 text-white/10 mx-auto mb-4" />
                <p className="font-display font-700 text-xl text-white">Aucun profil visible</p>
                <p className="mt-2 text-white/40">Change les filtres ou relance le scan.</p>
              </div>
            </div>
          ) : null}

          <div className="spotlight-card p-4">
            <div className="relative z-[1] flex items-center justify-between">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() => setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/20 hover:text-white disabled:opacity-35"
              >
                <ChevronLeft className="w-4 h-4" />
                Précédent
              </button>

              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">
                page {filters.page} / {pageCount}
              </p>

              <button
                type="button"
                disabled={filters.page >= pageCount}
                onClick={() => setFilters((current) => ({ ...current, page: Math.min(pageCount, current.page + 1) }))}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/20 hover:text-white disabled:opacity-35"
              >
                Suivant
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {!detail && !loadingDetail ? (
            <div className="feature-hero p-10 text-center">
              <div className="relative z-[1]">
                <Fingerprint className="w-12 h-12 text-white/10 mx-auto mb-4" />
                <p className="font-display font-700 text-xl text-white">Aucun membre sélectionné</p>
                <p className="mt-2 text-white/40">Ouvre une carte à gauche pour lire le profil détaillé.</p>
              </div>
            </div>
          ) : null}

          {loadingDetail ? <div className="h-[520px] rounded-[28px] skeleton" /> : null}

          {detail ? (
            <>
              <div className="feature-hero p-6">
                <div className="relative z-[1] space-y-5">
                  <div className="flex items-start gap-4">
                    <Avatar src={detail.avatar_url} label={detail.display_name || detail.username || detail.id} size="w-20 h-20" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display font-800 text-2xl text-white truncate">{detail.display_name || detail.username || detail.id}</h2>
                        <RiskBadge tier={detail.risk_tier} label={detail.risk_label} />
                        {detail.bot ? <span className="badge-offline">Bot</span> : null}
                        {detail.selfbot_suspect ? <span className="badge-error">Self-bot suspect</span> : null}
                        {detail.blacklist ? <span className="badge-warning">Blacklist reseau</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-white/45">@{detail.username || detail.id}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs font-mono text-white/35">
                        <span>ID {detail.id}</span>
                        <span>Créé {formatDate('fr-FR', detail.account_created_at)}</span>
                        {detail.joined_at ? <span>Rejoint {formatDate('fr-FR', detail.joined_at)}</span> : null}
                      </div>
                    </div>
                  </div>

                  <RiskBar score={detail.risk_score} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <MetricCard label="Score" value={detail.risk_score || 0} />
                    <MetricCard label="Activité suspecte" value={detail.evidence_summary?.suspicious_message_count || detail.suspicious_messages?.length || 0} />
                    <MetricCard label="Warnings" value={detail.warning_summary?.active_points || 0} />
                    <MetricCard label="Actions" value={detail.action_summary?.total_actions || 0} />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setInfoOpen(true)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75 transition-all hover:border-white/20 hover:text-white"
                    >
                      Informations supplémentaires
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <Link
                      to={`/dashboard/search?q=${encodeURIComponent(detail.id)}&userId=${encodeURIComponent(detail.id)}&source=scan`}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/20 hover:text-white"
                    >
                      Ouvrir Search
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <DetailBlock title="Lecture rapide" hint="Resume utilisable en un coup d oeil.">
                <div className="space-y-3">
                  {detail.reasons?.length ? detail.reasons.map((reason) => (
                    <div key={reason} className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/75">
                      {reason}
                    </div>
                  )) : <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/45">Aucun signal majeur.</div>}
                </div>
              </DetailBlock>

              <DetailBlock title="Actions directes" hint="Modération rapide depuis le scan.">
                {!viewer?.linked_discord ? (
                  <div className="rounded-[20px] border border-amber-500/20 bg-amber-500/10 p-4 space-y-4">
                    <p className="text-sm leading-6 text-amber-100/80">
                      Pour lancer warn, timeout, kick, ban ou blacklist reseau ici, connecte d'abord ton compte Discord au site.
                    </p>
                    <button
                      type="button"
                      onClick={handleConnectDiscord}
                      disabled={linkingDiscord}
                      className="inline-flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm font-mono text-amber-100 transition-all hover:bg-amber-400/15 disabled:opacity-50"
                    >
                      <Link2 className="w-4 h-4" />
                      {linkingDiscord ? 'Connexion...' : 'Connecter mon compte Discord'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <textarea
                        className="input-field min-h-[110px] resize-y sm:col-span-2"
                        value={actionValues.reason}
                        onChange={(event) => setActionValues((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Raison staff"
                      />
                      <input
                        className="input-field"
                        value={actionValues.duration}
                        onChange={(event) => setActionValues((current) => ({ ...current, duration: event.target.value }))}
                        placeholder="10m, 1h, 1d"
                      />
                      <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/45">
                        Timeout seulement: format court 10m, 1h, 1d.
                      </div>
                    </div>

                    <label className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/70">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-cyan-400"
                        checked={Boolean(actionValues.hideIdentity)}
                        onChange={(event) => setActionValues((current) => ({ ...current, hideIdentity: event.target.checked }))}
                      />
                      <span className="leading-6">
                        Masquer mon identite dans le MP envoye au membre. Les logs du site garderont ton vrai nom.
                      </span>
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {ACTIONS.map((action) => {
                        const Icon = action.icon
                        const disabled = (
                          submittingAction
                          || (action.id === 'warn' && !viewer.can_warn)
                          || (action.id === 'timeout' && !viewer.can_timeout)
                          || (action.id === 'kick' && !viewer.can_kick)
                          || (action.id === 'ban' && !viewer.can_ban)
                          || (action.id === 'blacklist' && !viewer.can_blacklist_network)
                        )
                        if (action.id === 'blacklist' && detail.blacklist) return null

                        return (
                          <button
                            key={action.id}
                            type="button"
                            onClick={() => handleAction(action.id)}
                            disabled={disabled}
                            className={`rounded-[20px] border px-4 py-4 text-left transition-all disabled:opacity-35 ${action.tone}`}
                          >
                            <div className="flex items-center gap-3">
                              <Icon className="w-4 h-4" />
                              <span className="font-mono text-sm">{submittingAction === action.id ? 'Exécution...' : action.label}</span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <span className={viewer?.can_warn ? 'badge-online' : 'badge-offline'}>Warn</span>
                  <span className={viewer?.can_timeout ? 'badge-online' : 'badge-offline'}>Timeout</span>
                  <span className={viewer?.can_kick ? 'badge-online' : 'badge-offline'}>Kick</span>
                  <span className={viewer?.can_ban ? 'badge-online' : 'badge-offline'}>Ban</span>
                  <span className={viewer?.can_blacklist_network ? 'badge-online' : 'badge-offline'}>Blacklist reseau</span>
                </div>
              </DetailBlock>

              <DetailBlock title="Activité suspecte" hint="Détection utile à la modération, mise à jour sans quitter la fiche.">
                <div className="space-y-3">
                  {detail.suspicious_messages?.length ? detail.suspicious_messages.slice(0, 4).map((entry) => <EvidenceRow key={entry.id} entry={entry} />) : (
                    <div className="rounded-[18px] border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/45">
                      Aucune trace suspecte récente pour ce profil.
                    </div>
                  )}
                </div>
              </DetailBlock>
            </>
          ) : null}
        </div>
      </div>
      <InfoDrawer open={infoOpen} onClose={() => setInfoOpen(false)} detail={detail} />
    </div>
  )
}
