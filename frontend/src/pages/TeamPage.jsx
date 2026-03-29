import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Crown,
  Database,
  Eye,
  History,
  Link2,
  Lock,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { authAPI, teamAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { wsService } from '../services/websocket'
import { openDiscordLinkPopup } from '../utils/discordLinkPopup'

// ── Helpers ──────────────────────────────────────────────────────────────────

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function formatDate(locale, value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
}

function formatRelativeTime(value) {
  if (!value) return null
  const diff = new Date(value) - Date.now()
  if (diff <= 0) return 'Expire'
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}j ${hours % 24}h`
  if (hours > 0) return `${hours}h restante${hours > 1 ? 's' : ''}`
  const minutes = Math.max(1, Math.floor(diff / 60000))
  return `${minutes}min`
}

function timeAgo(value) {
  if (!value) return ''
  const diff = Date.now() - new Date(value)
  if (diff < 60000) return 'A l\'instant'
  if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)}min`
  if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`
  if (diff < 604800000) return `Il y a ${Math.floor(diff / 86400000)}j`
  return formatDate('fr-FR', value)
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

function formatAuditValue(key, value) {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return value ? 'oui' : 'non'
  if (key === 'expires_in_hours' && Number(value) > 0) return `${value}h`
  if (key === 'suspended_until' || key === 'expires_at') return formatDate('fr-FR', value)
  return String(value)
}

function describeAuditDetails(details = {}) {
  const entries = Object.entries(details)
    .map(([key, value]) => {
      const label = String(key)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase())
      const displayValue = formatAuditValue(key, value)
      if (!displayValue) return null
      return `${label}: ${displayValue}`
    })
    .filter(Boolean)

  return entries.length > 0 ? entries.join(' · ') : ''
}

async function connectDiscordAccountWithPopup(returnTo) {
  const response = await authAPI.createDiscordLink({ return_to: returnTo, mode: 'popup' })
  const nextUrl = response?.data?.url
  if (!nextUrl) throw new Error('Lien Discord indisponible')
  const result = await openDiscordLinkPopup(nextUrl)
  if (result?.status !== 'success') {
    throw new Error(result?.error || 'discord_link_failed')
  }
  return result
}

function getTeamDisplayName(entry) {
  return entry?.display_name || entry?.discord_global_name || entry?.discord_username || entry?.username || 'Inconnu'
}

function getTeamAvatar(entry) {
  return entry?.profile_avatar_url || entry?.discord_avatar_url || entry?.avatar_url || null
}

function applyImmediateDiscordLink(linkResult) {
  const linkedDiscordId = String(linkResult?.linkedDiscordId || '').trim()
  if (!linkedDiscordId) return false

  const currentUser = useAuthStore.getState().user || {}
  useAuthStore.getState().setUser({
    ...currentUser,
    discord_id: linkedDiscordId,
    discord_username: String(linkResult?.linkedDiscordUsername || currentUser.discord_username || '').trim() || currentUser.discord_username || null,
    discord_global_name: String(linkResult?.linkedDiscordGlobalName || currentUser.discord_global_name || '').trim() || currentUser.discord_global_name || null,
    discord_avatar_url: String(linkResult?.linkedDiscordAvatarUrl || currentUser.discord_avatar_url || '').trim() || currentUser.discord_avatar_url || null,
  })

  return true
}

async function copyText(value, successMessage = 'Copie terminee') {
  const text = String(value || '').trim()
  if (!text) return

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const input = document.createElement('textarea')
      input.value = text
      input.setAttribute('readonly', '')
      input.style.position = 'absolute'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    toast.success(successMessage)
  } catch {
    toast.error('Copie impossible')
  }
}

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Permanent' },
  { value: 1, label: '1 heure' },
  { value: 6, label: '6 heures' },
  { value: 24, label: '1 jour' },
  { value: 72, label: '3 jours' },
  { value: 168, label: '1 semaine' },
  { value: 720, label: '30 jours' },
]

const SUSPEND_OPTIONS = [
  { value: 0, label: 'Bloquer' },
  { value: 24, label: '24h' },
  { value: 168, label: '7j' },
]

const ROLE_CONFIG = {
  owner: { label: 'Proprietaire', color: 'amber', icon: Crown },
  admin: { label: 'Admin', color: 'cyan', icon: Shield },
  moderator: { label: 'Moderateur', color: 'violet', icon: UserCheck },
  viewer: { label: 'Lecture seule', color: 'slate', icon: Eye },
}

const AUDIT_ACTION_CONFIG = {
  invite:           { label: 'Invitation envoyee',       icon: UserPlus,  bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  code_create:      { label: 'Code genere',              icon: Plus,      bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-400' },
  code_redeem:      { label: 'Equipe rejointe',          icon: UserCheck, bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  code_revoke:      { label: 'Code revoque',             icon: UserMinus, bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400' },
  revoke:           { label: 'Acces retire',             icon: UserMinus, bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400' },
  role_change:      { label: 'Role modifie',             icon: Shield,    bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  text: 'text-violet-400' },
  suspend:          { label: 'Compte suspendu',          icon: Pause,     bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400' },
  unsuspend:        { label: 'Compte reactive',          icon: Play,      bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  snapshot_create:  { label: 'Sauvegarde creee',         icon: Save,      bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    text: 'text-cyan-400' },
  snapshot_restore: { label: 'Sauvegarde restauree',     icon: RotateCcw, bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   text: 'text-amber-400' },
  snapshot_delete:  { label: 'Sauvegarde supprimee',     icon: Trash2,    bg: 'bg-red-500/10',     border: 'border-red-500/20',     text: 'text-red-400' },
}

// ── Micro-components ─────────────────────────────────────────────────────────

function Avatar({ src, label, size = 'w-11 h-11', ring = '' }) {
  const base = `${size} rounded-xl object-cover shrink-0 ${ring}`
  if (src) {
    return <img src={src} alt={label} className={`${base} border border-white/10`} />
  }
  return (
    <div className={`${base} border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] flex items-center justify-center text-white/60 font-mono text-xs font-semibold`}>
      {initials(label)}
    </div>
  )
}

function RoleBadge({ role }) {
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.viewer
  const colors = {
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
    cyan: 'border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan',
    violet: 'border-violet-400/25 bg-violet-400/10 text-violet-300',
    slate: 'border-white/10 bg-white/[0.05] text-white/50',
  }
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono font-medium tracking-wide ${colors[cfg.color]}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

function StatusDot({ isSuspended, suspendedUntil, expiresAt }) {
  if (isSuspended) {
    const remaining = formatRelativeTime(suspendedUntil)
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-red-400">
        <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
        {remaining && remaining !== 'Expire' ? `Suspendu ${remaining}` : 'Suspendu'}
      </span>
    )
  }
  if (expiresAt) {
    const remaining = formatRelativeTime(expiresAt)
    if (remaining === 'Expire') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-red-400">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          Expire
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-amber-300">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        {remaining}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
      <span className="w-2 h-2 rounded-full bg-emerald-400" />
      Actif
    </span>
  )
}

function SyncIndicator({ connected }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono ${connected ? 'text-emerald-400' : 'text-white/30'}`}>
      {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {connected ? 'Synchro active' : 'Hors ligne'}
    </span>
  )
}

function SectionTitle({ icon: Icon, title, subtitle, tone = 'cyan', action }) {
  const toneMap = {
    cyan: 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan',
    amber: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
    violet: 'border-violet-400/20 bg-violet-400/10 text-violet-300',
    emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    red: 'border-red-400/20 bg-red-400/10 text-red-300',
  }
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${toneMap[tone]}`}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-700 text-white text-[15px] leading-tight">{title}</h3>
          {subtitle && <p className="text-white/40 text-xs mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="w-14 h-14 rounded-2xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-white/15" />
      </div>
      <p className="text-sm text-white/30 max-w-xs">{message}</p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-28 rounded-2xl skeleton" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-24 rounded-2xl skeleton" />
        <div className="h-24 rounded-2xl skeleton" />
        <div className="h-24 rounded-2xl skeleton" />
      </div>
      <div className="h-40 rounded-2xl skeleton" />
    </div>
  )
}

// ── Stat cards for header ────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value, tone = 'cyan' }) {
  const tones = {
    cyan: 'border-neon-cyan/15 bg-neon-cyan/[0.06] text-neon-cyan',
    violet: 'border-violet-400/15 bg-violet-400/[0.06] text-violet-300',
    amber: 'border-amber-400/15 bg-amber-400/[0.06] text-amber-300',
    emerald: 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300',
  }
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]} transition-all`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 opacity-70" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-60">{label}</span>
      </div>
      <p className="font-display font-800 text-2xl text-white leading-none">{value}</p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function TeamPage() {
  const { user, fetchMe } = useAuthStore()
  const { guilds, selectedGuildId, selectGuild } = useGuildStore()
  const location = useLocation()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [overview, setOverview] = useState({ access: null, collaborators: [], snapshots: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [inviteForm, setInviteForm] = useState({ target: '', expires_in_hours: 0 })
  const [codeForm, setCodeForm] = useState({ expires_in_hours: 1 })
  const [joinCode, setJoinCode] = useState('')
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [activeTab, setActiveTab] = useState('team')
  const [auditData, setAuditData] = useState({ items: [], total: 0, page: 1 })
  const [wsConnected, setWsConnected] = useState(false)
  const lastSyncRef = useRef(null)

  const locale = typeof navigator !== 'undefined' ? navigator.language || 'fr-FR' : 'fr-FR'
  const isOwner = !!overview.access?.is_owner
  const collaborators = overview.collaborators || []
  const joinCodes = overview.join_codes || []
  const snapshots = overview.snapshots || []
  const nonOwnerCollabs = useMemo(() => collaborators.filter((c) => !c.is_owner), [collaborators])
  const activeCollabs = useMemo(() => nonOwnerCollabs.filter((c) => !c.is_suspended), [nonOwnerCollabs])
  const suspendedCollabs = useMemo(() => nonOwnerCollabs.filter((c) => c.is_suspended), [nonOwnerCollabs])
  const hasCollaborators = nonOwnerCollabs.length > 0
  const ownGuilds = useMemo(() => guilds.filter((entry) => entry.is_owner), [guilds])
  const sharedGuilds = useMemo(() => guilds.filter((entry) => !entry.is_owner), [guilds])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    if (!selectedGuildId) return
    if (!silent) setLoading(true)
    try {
      const response = await teamAPI.overview(selectedGuildId)
      setOverview(response.data || { access: null, collaborators: [], snapshots: [] })
      lastSyncRef.current = Date.now()
    } catch (error) {
      if (!silent) toast.error(getErrorMessage(error))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [selectedGuildId])

  const loadAuditLog = useCallback(async (page = 1) => {
    if (!selectedGuildId) return
    try {
      const response = await teamAPI.auditLog(selectedGuildId, { page, limit: 30 })
      setAuditData(response.data || { items: [], total: 0, page: 1 })
    } catch {
      // Silently fail
    }
  }, [selectedGuildId])

  const syncTeamAfterDiscordLink = useCallback(async (linkResult) => {
    const immediateLinked = applyImmediateDiscordLink(linkResult)

    await fetchMe()
    await useGuildStore.getState().fetchGuilds()

    if (selectedGuildId) {
      await loadOverview({ silent: true })
    }

    return Boolean(immediateLinked || useAuthStore.getState().user?.discord_id)
  }, [fetchMe, loadOverview, selectedGuildId])

  // Reset on guild change
  useEffect(() => {
    setInviteForm({ target: '', expires_in_hours: 0 })
    setCodeForm({ expires_in_hours: 1 })
    setJoinCode('')
    setSnapshotLabel('')
    setOverview({ access: null, collaborators: [], snapshots: [] })
    setActiveTab('team')
    setAuditData({ items: [], total: 0, page: 1 })
    setLoading(true)
  }, [selectedGuildId])

  // Initial load
  useEffect(() => {
    if (!selectedGuildId) return
    loadOverview()
  }, [selectedGuildId, loadOverview])

  // WebSocket real-time sync
  useEffect(() => {
    if (!selectedGuildId) return undefined

    const handleTeamUpdate = (data) => {
      if (data?.guildId === selectedGuildId || !data?.guildId) {
        loadOverview({ silent: true })
        if (activeTab === 'audit') loadAuditLog(auditData.page)
      }
    }

    const handleSnapshotRestored = (data) => {
      if (data?.guildId === selectedGuildId) {
        loadOverview({ silent: true })
        toast.success('Sauvegarde restauree — donnees synchronisees.')
      }
    }

    const handleConnected = () => setWsConnected(true)
    const handleDisconnected = () => setWsConnected(false)

    const unsub1 = wsService.on('team:updated', handleTeamUpdate)
    const unsub2 = wsService.on('team:snapshot_restored', handleSnapshotRestored)
    const unsub3 = wsService.on('ws:connected', handleConnected)
    const unsub4 = wsService.on('ws:disconnected', handleDisconnected)

    return () => { unsub1(); unsub2(); unsub3(); unsub4() }
  }, [selectedGuildId, activeTab, loadOverview, loadAuditLog, auditData.page])

  // Polling fallback (5s instead of 8s for better responsiveness)
  useEffect(() => {
    if (!selectedGuildId) return undefined
    const intervalId = window.setInterval(() => {
      loadOverview({ silent: true })
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [selectedGuildId, loadOverview])

  // Auto-load audit on tab switch
  useEffect(() => {
    if (activeTab === 'audit' && isOwner) loadAuditLog(1)
  }, [activeTab, isOwner, selectedGuildId, loadAuditLog])

  // ── Action handlers ────────────────────────────────────────────────────────

  const handleInvite = async () => {
    if (!selectedGuildId || !inviteForm.target.trim()) return
    setSaving('invite')
    try {
      const response = await teamAPI.invite(selectedGuildId, {
        target: inviteForm.target.trim(),
        access_role: 'admin',
        expires_in_hours: inviteForm.expires_in_hours,
      })
      setOverview(response.data)
      setInviteForm((c) => ({ ...c, target: '' }))
      toast.success('Acces partage ajoute')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleCreateCode = async () => {
    if (!selectedGuildId) return
    setSaving('code:create')
    try {
      const response = await teamAPI.createCode(selectedGuildId, {
        access_role: 'admin',
        expires_in_hours: codeForm.expires_in_hours,
      })
      setOverview(response.data)
      toast.success('Code genere')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRevokeCode = async (codeId) => {
    if (!selectedGuildId || !codeId) return
    setSaving(`code:revoke:${codeId}`)
    try {
      const response = await teamAPI.revokeCode(selectedGuildId, codeId)
      setOverview(response.data)
      toast.success('Code revoque')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRedeemCode = async () => {
    if (!joinCode.trim()) return
    setSaving('code:redeem')
    try {
      const response = await teamAPI.redeemCode({ code: joinCode.trim() })
      await fetchMe()
      await useGuildStore.getState().fetchGuilds()
      if (response?.data?.guild?.id) {
        selectGuild(response.data.guild.id)
      }
      setJoinCode('')
      toast.success('Equipe rejointe')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleConnectDiscord = async () => {
    setSaving('discord:link')
    try {
      const returnTo = `${location.pathname}${location.search || ''}`
      const result = await connectDiscordAccountWithPopup(returnTo)
      const linked = await syncTeamAfterDiscordLink(result)
      if (!linked) {
        throw new Error('Le compte Discord est lie, mais la synchronisation n est pas encore finie.')
      }
      toast.success('Compte Discord connecte')
    } catch (error) {
      if (String(error?.message || '') !== 'Popup fermee') {
        toast.error(getErrorMessage(error))
      }
    } finally {
      setSaving('')
    }
  }

  const handleMemberRole = async (memberUserId, accessRole) => {
    if (!selectedGuildId) return
    setSaving(`member:${memberUserId}`)
    try {
      const response = await teamAPI.updateMember(selectedGuildId, memberUserId, { access_role: accessRole })
      setOverview(response.data)
      toast.success('Role mis a jour')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleSuspend = async (memberUserId, username, isSuspended, durationHours = 0) => {
    if (!selectedGuildId) return
    setSaving(`suspend:${memberUserId}:${durationHours}`)
    try {
      const response = await teamAPI.suspendMember(selectedGuildId, memberUserId, {
        is_suspended: isSuspended,
        duration_hours: durationHours,
      })
      setOverview(response.data)
      toast.success(
        isSuspended
          ? (durationHours > 0 ? `${username} bloque ${durationHours}h` : `${username} suspendu`)
          : `${username} reactive`
      )
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRemoveMember = async (memberUserId, username) => {
    if (!selectedGuildId) return
    if (!window.confirm(`Retirer l'acces de ${username || 'ce compte'} ? Cette action est immediate.`)) return
    setSaving(`remove:${memberUserId}`)
    try {
      const response = await teamAPI.removeMember(selectedGuildId, memberUserId)
      setOverview(response.data)
      toast.success('Acces retire')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleCreateSnapshot = async () => {
    if (!selectedGuildId) return
    setSaving('snapshot:create')
    try {
      const response = await teamAPI.createSnapshot(selectedGuildId, { label: snapshotLabel.trim() })
      setOverview((current) => ({ ...current, snapshots: response.data?.snapshots || current.snapshots }))
      setSnapshotLabel('')
      toast.success('Sauvegarde creee')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleRestoreSnapshot = async (snapshot) => {
    if (!selectedGuildId || !snapshot?.id) return
    if (!window.confirm(`Restaurer "${snapshot.label || 'cette sauvegarde'}" ?\nCommandes, modules et reglages seront remis a cet etat.`)) return
    setSaving(`snapshot:restore:${snapshot.id}`)
    try {
      const response = await teamAPI.restoreSnapshot(selectedGuildId, snapshot.id)
      setOverview(response.data)
      toast.success('Sauvegarde restauree')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  const handleDeleteSnapshot = async (snapshot) => {
    if (!selectedGuildId || !snapshot?.id) return
    if (!window.confirm(`Supprimer "${snapshot.label || 'cette sauvegarde'}" ?`)) return
    setSaving(`snapshot:delete:${snapshot.id}`)
    try {
      const response = await teamAPI.deleteSnapshot(selectedGuildId, snapshot.id)
      setOverview((current) => ({ ...current, snapshots: response.data?.snapshots || [] }))
      toast.success('Sauvegarde supprimee')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving('')
    }
  }

  // ── No guild selected ──────────────────────────────────────────────────────

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-5xl mx-auto space-y-5">
        <JoinTeamCard
          user={user}
          joinCode={joinCode}
          setJoinCode={setJoinCode}
          saving={saving}
          onRedeem={handleRedeemCode}
          onConnectDiscord={handleConnectDiscord}
        />
        <WorkspaceSwitchCard
          guilds={guilds}
          ownGuilds={ownGuilds}
          sharedGuilds={sharedGuilds}
          selectedGuildId={selectedGuildId}
          onSelectGuild={selectGuild}
        />
        <div className="spotlight-card p-10 text-center">
          <div className="w-16 h-16 rounded-2xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center mx-auto mb-5">
            <Users className="w-7 h-7 text-white/15" />
          </div>
          <p className="font-display font-700 text-white text-xl">Selectionne un espace</p>
          <p className="text-white/35 mt-2 text-sm max-w-sm mx-auto">Choisis ton propre serveur ou rejoins une equipe avec un code d acces a usage unique.</p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-6 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            Voir les serveurs
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading && !overview.access) {
    return (
      <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto">
        <LoadingSkeleton />
      </div>
    )
  }

  // ── Tabs config ────────────────────────────────────────────────────────────

  const tabs = [
    { id: 'team', label: 'Equipe', icon: Users },
    { id: 'collaborators', label: 'Collaborateurs', icon: UserCheck },
    { id: 'spaces', label: 'Espaces', icon: ArrowRight },
    ...(isOwner ? [
      { id: 'codes', label: 'Codes d’accès', icon: Shield },
      { id: 'backups', label: 'Sauvegardes', icon: Database },
      { id: 'audit', label: 'Activite', icon: ScrollText },
    ] : []),
  ]

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan/20 to-violet-500/20 border border-white/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-neon-cyan" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display font-800 text-2xl text-white sm:text-3xl leading-tight">Equipe</h1>
                  <p className="text-white/40 text-xs font-mono mt-0.5">{guild?.name || 'Serveur'}</p>
                </div>
              </div>
              <p className="max-w-xl text-sm text-white/45 leading-relaxed">
                Partage le dashboard en toute securite. Le token reste prive, chaque modification est tracee et tu peux tout restaurer.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SyncIndicator connected={wsConnected} />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <StatPill icon={Crown} label="Ton role" value={isOwner ? 'Proprietaire' : (ROLE_CONFIG[overview.access?.access_role]?.label || 'Partage')} tone="amber" />
            <StatPill icon={Users} label="Collaborateurs" value={nonOwnerCollabs.length} tone="violet" />
            <StatPill icon={UserCheck} label="Actifs" value={activeCollabs.length} tone="emerald" />
            <StatPill icon={Database} label="Sauvegardes" value={isOwner ? snapshots.length : '—'} tone="cyan" />
          </div>
        </div>
      </div>

      {/* ── Tab navigation ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06] w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-mono transition-all ${
                isActive
                  ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20'
                  : 'text-white/40 hover:text-white/70 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {activeTab === 'team' && (
          <motion.div key="team" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <SimpleTeamTab
              isOwner={isOwner}
              collaborators={collaborators}
              activeCollabs={activeCollabs}
              suspendedCollabs={suspendedCollabs}
              joinCodes={joinCodes}
              locale={locale}
            />
          </motion.div>
        )}

        {activeTab === 'collaborators' && (
          <motion.div key="collaborators" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <CollaboratorsTab
              isOwner={isOwner}
              nonOwnerCollabs={nonOwnerCollabs}
              saving={saving}
              inviteForm={inviteForm}
              setInviteForm={setInviteForm}
              onInvite={handleInvite}
              onSuspend={handleSuspend}
              onRemoveMember={handleRemoveMember}
            />
          </motion.div>
        )}

        {activeTab === 'spaces' && (
          <motion.div key="spaces" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <SpacesTab
              user={user}
              joinCode={joinCode}
              setJoinCode={setJoinCode}
              saving={saving}
              ownGuilds={ownGuilds}
              sharedGuilds={sharedGuilds}
              selectedGuildId={selectedGuildId}
              onSelectGuild={selectGuild}
              onRedeemCode={handleRedeemCode}
              onConnectDiscord={handleConnectDiscord}
            />
          </motion.div>
        )}

        {activeTab === 'codes' && isOwner && (
          <motion.div key="codes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <AccessCodesTab
              saving={saving}
              codeForm={codeForm}
              setCodeForm={setCodeForm}
              joinCodes={joinCodes}
              onCreateCode={handleCreateCode}
              onRevokeCode={handleRevokeCode}
            />
          </motion.div>
        )}

        {activeTab === 'backups' && isOwner && (
          <motion.div key="backups" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <BackupsTab
              snapshots={snapshots}
              saving={saving}
              snapshotLabel={snapshotLabel}
              setSnapshotLabel={setSnapshotLabel}
              locale={locale}
              hasCollaborators={hasCollaborators}
              onCreateSnapshot={handleCreateSnapshot}
              onRestoreSnapshot={handleRestoreSnapshot}
              onDeleteSnapshot={handleDeleteSnapshot}
            />
          </motion.div>
        )}

        {activeTab === 'audit' && isOwner && (
          <motion.div key="audit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            <AuditTab
              auditData={auditData}
              locale={locale}
              onPageChange={(page) => loadAuditLog(page)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// TEAM HELPERS / TEAM TAB
// ══════════════════════════════════════════════════════════════════════════════

function WorkspaceSwitchCard({ ownGuilds, sharedGuilds, selectedGuildId, onSelectGuild }) {
  const renderGuilds = (items, emptyMessage) => {
    if (!items.length) {
      return <p className="text-xs text-white/28">{emptyMessage}</p>
    }

    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelectGuild(entry.id)}
            className={`group rounded-2xl border px-3 py-3 text-left text-sm transition-all ${
              selectedGuildId === entry.id
                ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan shadow-[0_14px_30px_rgba(34,211,238,0.10)]'
                : 'border-white/[0.06] bg-white/[0.03] text-white/65 hover:border-white/12 hover:bg-white/[0.05] hover:text-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <Avatar
                src={entry.iconUrl || entry.icon_url || null}
                label={entry.name}
                size="w-11 h-11"
                ring={selectedGuildId === entry.id ? 'ring-2 ring-neon-cyan/20' : ''}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-display font-600 text-white transition-colors group-hover:text-white">
                    {entry.name}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em] ${
                    entry.is_owner
                      ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                      : 'border border-violet-400/20 bg-violet-400/10 text-violet-300'
                  }`}>
                    {entry.is_owner ? 'Principal' : 'Partage'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-white/35">
                  <span className="truncate">
                    {entry.member_count ? `${entry.member_count} membres` : 'Serveur synchronise'}
                  </span>
                  <span className="text-white/18">•</span>
                  <span className="truncate">
                    {entry.is_owner ? 'Ton espace' : 'Espace partage'}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="spotlight-card p-5 space-y-4">
      <SectionTitle
        icon={ArrowRight}
        title="Mes espaces"
        subtitle="Passe de ton espace principal à un espace partagé sans te déconnecter."
        tone="cyan"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">Mes espaces</p>
          {renderGuilds(ownGuilds, 'Aucun espace principal disponible.')}
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">Espaces partages</p>
          {renderGuilds(sharedGuilds, 'Aucune equipe rejointe pour le moment.')}
        </div>
      </div>
    </div>
  )
}

function JoinTeamCard({ user, joinCode, setJoinCode, saving, onRedeem, onConnectDiscord }) {
  const linked = Boolean(user?.discord_id)

  return (
    <div className="spotlight-card p-5 space-y-4">
      <SectionTitle
        icon={UserPlus}
        title="Rejoindre une equipe"
        subtitle="Le code est a usage unique. Un compte Discord lie est obligatoire avant validation."
        tone="emerald"
      />
      {!linked ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display font-600 text-amber-100">Compte Discord requis</p>
            <p className="mt-1 text-sm text-amber-100/70">Lie ton compte Discord une fois, puis les codes equipe marcheront instantanement.</p>
          </div>
          <button
            type="button"
            onClick={onConnectDiscord}
            disabled={saving === 'discord:link'}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm font-mono text-amber-100 transition-all hover:bg-amber-400/15 disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            {saving === 'discord:link' ? 'Connexion...' : 'Lier mon compte Discord'}
          </button>
        </div>
      ) : null}
      {linked ? (
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.05] px-4 py-3 text-xs text-emerald-200/80 font-mono">
          Compte Discord lie: {user?.discord_global_name || user?.discord_username || user?.username || user?.discord_id}
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <input
          className="input-field"
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
          onKeyDown={(event) => event.key === 'Enter' && linked && onRedeem()}
          placeholder="Code d acces a usage unique"
        />
        <button
          type="button"
          onClick={onRedeem}
          disabled={!linked || saving === 'code:redeem' || !joinCode.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-3 text-sm font-mono text-emerald-300 transition-all hover:bg-emerald-400/20 disabled:opacity-40"
        >
          {saving === 'code:redeem' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {saving === 'code:redeem' ? 'Connexion...' : 'Rejoindre'}
        </button>
      </div>
    </div>
  )
}

function OwnerJoinCodeCard({ saving, codeForm, setCodeForm, joinCodes, onCreateCode, onRevokeCode }) {
  return (
    <div className="spotlight-card p-5 space-y-4">
      <SectionTitle
        icon={Shield}
        title="Codes d'accès"
        subtitle="Un code = une personne. Accès complet à l'équipe, hors sauvegardes et activité."
        tone="violet"
      />
      <div className="grid gap-3 lg:grid-cols-[220px_auto]">
        <select
          className="select-field"
          value={codeForm.expires_in_hours}
          onChange={(event) => setCodeForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) }))}
        >
          {EXPIRY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCreateCode}
          disabled={saving === 'code:create'}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/10 px-5 py-3 text-sm font-mono text-violet-300 transition-all hover:bg-violet-500/20 disabled:opacity-40"
        >
          {saving === 'code:create' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {saving === 'code:create' ? 'Génération...' : 'Générer un code'}
        </button>
      </div>
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-white/38">
        Le code reste actif jusqu'à son expiration ou sa première utilisation.
      </div>
      {joinCodes.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-sm text-white/35">
          Aucun code actif pour l'instant.
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {joinCodes.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-700 text-white tracking-[0.18em] break-all">{entry.code}</p>
                  <p className="mt-1 text-xs text-white/32 font-mono">
                    {ROLE_CONFIG[entry.access_role]?.label || entry.access_role} · {entry.expires_at ? `expire ${formatRelativeTime(entry.expires_at)}` : 'sans expiration'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevokeCode(entry.id)}
                  disabled={saving === `code:revoke:${entry.id}`}
                  className="inline-flex items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-mono text-red-300 transition-all hover:bg-red-500/20 disabled:opacity-40"
                >
                  {saving === `code:revoke:${entry.id}` ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/35">
                <span>Cree {timeAgo(entry.created_at)}</span>
                <span>Par {entry.created_by_display_name || entry.created_by_username || 'Inconnu'}</span>
                <span className="font-mono">1 seule utilisation</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TeamTab({
  isOwner,
  collaborators,
  nonOwnerCollabs,
  activeCollabs,
  suspendedCollabs,
  saving,
  user,
  inviteForm,
  setInviteForm,
  codeForm,
  setCodeForm,
  joinCode,
  setJoinCode,
  joinCodes,
  locale,
  guilds,
  ownGuilds,
  sharedGuilds,
  selectedGuildId,
  onSelectGuild,
  onInvite,
  onCreateCode,
  onRevokeCode,
  onRedeemCode,
  onConnectDiscord,
  onMemberRole,
  onSuspend,
  onRemoveMember,
}) {
  const [showInviteForm, setShowInviteForm] = useState(false)
  const ownerEntry = collaborators.find((c) => c.is_owner)
  const teamOwner = ownerEntry || collaborators[0] || null

  return (
    <div className="space-y-5">
      <WorkspaceSwitchCard
        ownGuilds={ownGuilds}
        sharedGuilds={sharedGuilds}
        selectedGuildId={selectedGuildId}
        onSelectGuild={onSelectGuild}
      />

      <JoinTeamCard
        user={user}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        saving={saving}
        onRedeem={onRedeemCode}
        onConnectDiscord={onConnectDiscord}
      />

      {/* ── Owner card ────────────────────────────────────────────────────── */}
      {teamOwner && (
        <div className="spotlight-card p-5">
          <div className="flex items-center gap-4">
            <Avatar src={getTeamAvatar(teamOwner)} label={getTeamDisplayName(teamOwner)} ring="ring-2 ring-amber-400/30" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-700 text-white text-base truncate">{getTeamDisplayName(teamOwner)}</span>
                <RoleBadge role="owner" />
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-white/30 font-mono">
                <span>{isOwner ? 'Proprietaire du bot' : 'Espace partage'}</span>
                {teamOwner.site_username && <span>Site: {teamOwner.site_username}</span>}
                {teamOwner.discord_id && <span>Discord: {teamOwner.discord_id}</span>}
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/15 bg-amber-400/[0.06]">
                <Lock className="w-3 h-3 text-amber-300" />
                <span className="text-[11px] font-mono text-amber-300">Token prive</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {isOwner && (
        <OwnerJoinCodeCard
          saving={saving}
          codeForm={codeForm}
          setCodeForm={setCodeForm}
          joinCodes={joinCodes}
          onCreateCode={onCreateCode}
          onRevokeCode={onRevokeCode}
        />
      )}

      {/* ── Invite section (owner only) ───────────────────────────────────── */}
      {isOwner && (
        <div className="spotlight-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border border-emerald-400/20 bg-emerald-400/10 flex items-center justify-center">
                <UserPlus className="w-[18px] h-[18px] text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="font-display font-700 text-white text-sm">Inviter un collaborateur</p>
                <p className="text-white/35 text-xs mt-0.5">Partager l'acces au dashboard sans exposer le token</p>
              </div>
            </div>
            <motion.div animate={{ rotate: showInviteForm ? 45 : 0 }} transition={{ duration: 0.2 }}>
              <Plus className="w-5 h-5 text-white/40" />
            </motion.div>
          </button>

          <AnimatePresence>
            {showInviteForm && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 space-y-3 border-t border-white/[0.06]">
                  <div className="pt-4 grid gap-3 sm:grid-cols-[1fr_130px_130px]">
                    <input
                      className="input-field"
                      placeholder="Pseudo, email ou ID Discord"
                      value={inviteForm.target}
                      onChange={(e) => setInviteForm((c) => ({ ...c, target: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && onInvite()}
                    />
                    <select
                      className="select-field"
                      value={inviteForm.access_role}
                      onChange={(e) => setInviteForm((c) => ({ ...c, access_role: e.target.value }))}
                    >
                      <option value="admin">Admin</option>
                      <option value="moderator">Moderateur</option>
                      <option value="viewer">Lecture seule</option>
                    </select>
                    <select
                      className="select-field"
                      value={inviteForm.expires_in_hours}
                      onChange={(e) => setInviteForm((c) => ({ ...c, expires_in_hours: Number(e.target.value) }))}
                    >
                      {EXPIRY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-white/25 font-mono">L'utilisateur recevra un acces immediat au dashboard</p>
                    <button
                      type="button"
                      onClick={onInvite}
                      disabled={saving === 'invite' || !inviteForm.target.trim()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-400/25 text-emerald-300 font-mono text-sm hover:from-emerald-500/30 hover:to-emerald-600/30 transition-all disabled:opacity-40"
                    >
                      {saving === 'invite' ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <UserPlus className="w-4 h-4" />
                      )}
                      {saving === 'invite' ? 'Ajout...' : 'Inviter'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Collaborators list ────────────────────────────────────────────── */}
      <div className="spotlight-card p-5 space-y-4">
        <SectionTitle
          icon={Users}
          title={`Collaborateurs${nonOwnerCollabs.length > 0 ? ` (${nonOwnerCollabs.length})` : ''}`}
          subtitle={isOwner ? 'Gere les acces et permissions de ton equipe' : 'Les personnes qui partagent ce dashboard'}
          tone="cyan"
        />

        {nonOwnerCollabs.length === 0 ? (
          <EmptyState
            icon={Users}
            message={isOwner ? 'Aucun collaborateur pour le moment. Invite quelqu\'un pour commencer.' : 'Aucun autre collaborateur sur ce serveur.'}
          />
        ) : (
          <div className="space-y-2">
            {nonOwnerCollabs.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.04, 0.2) }}
                className={`group rounded-2xl border p-4 transition-all hover:bg-white/[0.02] ${
                  entry.is_suspended
                    ? 'border-red-500/10 bg-red-500/[0.02]'
                    : 'border-white/[0.06] bg-white/[0.01]'
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={getTeamAvatar(entry)}
                      label={getTeamDisplayName(entry)}
                      ring={entry.is_suspended ? 'ring-1 ring-red-500/20' : ''}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-display font-600 text-sm truncate ${entry.is_suspended ? 'text-white/35 line-through' : 'text-white'}`}>
                          {getTeamDisplayName(entry)}
                        </span>
                        <RoleBadge role={entry.access_role} />
                        <StatusDot isSuspended={entry.is_suspended} suspendedUntil={entry.suspended_until} expiresAt={entry.expires_at} />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-white/25 font-mono">
                        {entry.site_username && <span>Site: {entry.site_username}</span>}
                        {entry.discord_id && <span>Discord: {entry.discord_id}</span>}
                        <span>Depuis {timeAgo(entry.accepted_at || entry.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {isOwner && (
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <select
                        className="select-compact"
                        value={entry.access_role}
                        onChange={(e) => onMemberRole(entry.user_id, e.target.value)}
                        disabled={saving === `member:${entry.user_id}` || entry.is_suspended}
                      >
                        <option value="admin">Admin</option>
                        <option value="moderator">Moderateur</option>
                        <option value="viewer">Lecture</option>
                      </select>
                      {entry.is_suspended ? (
                        <button
                          type="button"
                          onClick={() => onSuspend(entry.user_id, getTeamDisplayName(entry), false, 0)}
                          disabled={saving.startsWith(`suspend:${entry.user_id}:`)}
                          title="Reactiver"
                          className="p-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        SUSPEND_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => onSuspend(entry.user_id, getTeamDisplayName(entry), true, option.value)}
                            disabled={saving.startsWith(`suspend:${entry.user_id}:`)}
                            title={option.label}
                            className={`rounded-xl border px-3 py-2 text-[11px] font-mono transition-all disabled:opacity-40 ${
                              option.value === 0
                                ? 'border-amber-400/20 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                                : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-amber-400/20 hover:text-amber-200'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveMember(entry.user_id, getTeamDisplayName(entry))}
                        disabled={saving === `remove:${entry.user_id}`}
                        title="Retirer l'acces"
                        className="p-2.5 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── Token security info (compact) ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 overflow-hidden relative">
          <div className="absolute inset-x-4 bottom-4 h-10 rounded-full bg-emerald-400/10 blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between gap-2 mb-2 relative">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-display font-600 text-white">Securite du token</span>
          </div>
          <div className="relative mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border border-emerald-400/20 bg-emerald-400/10 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(74,222,128,0.14)]">
                <ShieldCheck className="w-4 h-4 text-emerald-300" />
              </div>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)] animate-pulse" />
                <span className="h-2 w-2 rounded-full bg-white/14" />
                <span className="h-2 w-2 rounded-full bg-white/10" />
              </div>
              <span className="px-3 py-1.5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-200 shadow-[0_8px_24px_rgba(16,185,129,0.12)]">
                actif
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 overflow-hidden relative">
          <div className="absolute inset-x-4 bottom-4 h-10 rounded-full bg-neon-cyan/10 blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between gap-2 mb-2 relative">
            <Zap className="w-4 h-4 text-neon-cyan" />
            <span className="text-xs font-display font-600 text-white">Synchronisation</span>
          </div>
          <div className="relative mt-4 rounded-2xl border border-neon-cyan/15 bg-neon-cyan/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(34,211,238,0.14)]">
                <Zap className="w-4 h-4 text-neon-cyan" />
              </div>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="h-2.5 w-2.5 rounded-full bg-neon-cyan shadow-[0_0_14px_rgba(34,211,238,0.8)] animate-pulse" />
                <div className="h-2 flex-1 rounded-full bg-white/8 overflow-hidden">
                  <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-neon-cyan/35 via-neon-cyan/70 to-neon-cyan/35" />
                </div>
              </div>
              <span className="px-3 py-1.5 rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 text-[11px] font-mono uppercase tracking-[0.18em] text-cyan-100 shadow-[0_8px_24px_rgba(34,211,238,0.12)]">
                live
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BACKUPS TAB (Owner-only private section)
// ══════════════════════════════════════════════════════════════════════════════

function SimpleTeamTab({ isOwner, collaborators, activeCollabs, suspendedCollabs, joinCodes }) {
  const ownerEntry = collaborators.find((entry) => entry.is_owner)
  const teamOwner = ownerEntry || collaborators[0] || null

  return (
    <div className="space-y-5">
      {teamOwner && (
        <div className="spotlight-card p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <Avatar src={getTeamAvatar(teamOwner)} label={getTeamDisplayName(teamOwner)} ring="ring-2 ring-amber-400/30" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-700 text-white text-lg truncate">{getTeamDisplayName(teamOwner)}</span>
                  <RoleBadge role="owner" />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-white/30 font-mono">
                  <span>{isOwner ? 'Espace principal' : 'Espace partagé'}</span>
                  {teamOwner.site_username && <span>Site: {teamOwner.site_username}</span>}
                  {teamOwner.discord_id && <span>ID Discord: {teamOwner.discord_id}</span>}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatPill icon={Users} label="Collaborateurs" value={Math.max(collaborators.length - 1, 0)} tone="violet" />
              <StatPill icon={UserCheck} label="Actifs" value={activeCollabs.length} tone="emerald" />
              <StatPill icon={Pause} label="Bloqués" value={suspendedCollabs.length} tone="amber" />
              <StatPill icon={Shield} label="Codes actifs" value={joinCodes.length} tone="cyan" />
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <SectionTitle
            icon={ShieldCheck}
            title="Sécurité du token"
            subtitle="Les invités n'ont jamais accès au token ni aux sauvegardes privées."
            tone="emerald"
          />
          <p className="mt-4 text-sm text-white/50 leading-relaxed">
            Chaque accès partagé reste isolé, contrôlé et révocable en un clic.
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <SectionTitle
            icon={Zap}
            title="Synchronisation"
            subtitle="Les espaces partagés se mettent à jour en temps réel pour toute l'équipe."
            tone="cyan"
          />
          <p className="mt-4 text-sm text-white/50 leading-relaxed">
            Les changements visibles sont propagés sans rechargement manuel.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">Collaborateurs</p>
          <p className="mt-2 text-sm text-white/60 leading-relaxed">Gère l'accès, bloque temporairement ou retire un membre sans quitter la page.</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">Codes d’accès</p>
          <p className="mt-2 text-sm text-white/60 leading-relaxed">Génère un code sécurisé, copie-le en un clic et laisse-le expirer automatiquement.</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">Espaces</p>
          <p className="mt-2 text-sm text-white/60 leading-relaxed">Passe facilement de ton espace principal aux espaces partagés sans te déconnecter.</p>
        </div>
      </div>
    </div>
  )
}

function CollaboratorsTab({ isOwner, nonOwnerCollabs, saving, inviteForm, setInviteForm, onInvite, onSuspend, onRemoveMember }) {
  const [showInviteForm, setShowInviteForm] = useState(false)

  return (
    <div className="space-y-5">
      {isOwner && (
        <div className="spotlight-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowInviteForm((current) => !current)}
            className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl border border-emerald-400/20 bg-emerald-400/10 flex items-center justify-center">
                <UserPlus className="w-[18px] h-[18px] text-emerald-400" />
              </div>
              <div className="text-left">
                <p className="font-display font-700 text-white text-sm">Inviter un collaborateur</p>
                <p className="text-white/35 text-xs mt-0.5">Accès unique à l’équipe, sans réglage complexe.</p>
              </div>
            </div>
            <motion.div animate={{ rotate: showInviteForm ? 45 : 0 }} transition={{ duration: 0.2 }}>
              <Plus className="w-5 h-5 text-white/40" />
            </motion.div>
          </button>

          <AnimatePresence>
            {showInviteForm && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 pt-4 space-y-3 border-t border-white/[0.06]">
                  <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
                    <input
                      className="input-field"
                      placeholder="Pseudo, email ou ID Discord"
                      value={inviteForm.target}
                      onChange={(event) => setInviteForm((current) => ({ ...current, target: event.target.value }))}
                      onKeyDown={(event) => event.key === 'Enter' && onInvite()}
                    />
                    <select
                      className="select-field"
                      value={inviteForm.expires_in_hours}
                      onChange={(event) => setInviteForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) }))}
                    >
                      {EXPIRY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={onInvite}
                      disabled={saving === 'invite' || !inviteForm.target.trim()}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-400/25 text-emerald-300 font-mono text-sm hover:from-emerald-500/30 hover:to-emerald-600/30 transition-all disabled:opacity-40"
                    >
                      {saving === 'invite' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      {saving === 'invite' ? 'Ajout...' : 'Inviter'}
                    </button>
                  </div>
                  <p className="text-xs text-white/30">Chaque invité a l’accès équipe complet, hors sauvegardes et activité privée.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="spotlight-card p-5 space-y-4">
        <SectionTitle
          icon={Users}
          title={`Collaborateurs${nonOwnerCollabs.length > 0 ? ` (${nonOwnerCollabs.length})` : ''}`}
          subtitle={isOwner ? 'Gère les accès de ton équipe depuis une vue claire.' : 'Les personnes qui partagent cet espace avec toi.'}
          tone="cyan"
        />

        {nonOwnerCollabs.length === 0 ? (
          <EmptyState
            icon={Users}
            message={isOwner ? 'Aucun collaborateur pour le moment. Invite quelqu’un pour commencer.' : 'Aucun autre collaborateur sur ce serveur.'}
          />
        ) : (
          <div className="space-y-3">
            {nonOwnerCollabs.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.04, 0.2) }}
                className={`rounded-2xl border p-4 transition-all hover:bg-white/[0.02] ${
                  entry.is_suspended ? 'border-red-500/10 bg-red-500/[0.02]' : 'border-white/[0.06] bg-white/[0.01]'
                }`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={getTeamAvatar(entry)} label={getTeamDisplayName(entry)} ring={entry.is_suspended ? 'ring-1 ring-red-500/20' : ''} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-display font-600 text-sm truncate ${entry.is_suspended ? 'text-white/35 line-through' : 'text-white'}`}>
                          {getTeamDisplayName(entry)}
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-neon-cyan/20 bg-neon-cyan/10 text-[11px] font-mono text-neon-cyan">
                          <Shield className="w-3 h-3" />
                          Accès équipe
                        </span>
                        <StatusDot isSuspended={entry.is_suspended} suspendedUntil={entry.suspended_until} expiresAt={entry.expires_at} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/28 font-mono">
                        {entry.email && <span>Email: {entry.email}</span>}
                        {entry.site_username && <span>Site: {entry.site_username}</span>}
                        {entry.discord_username && <span>Discord: {entry.discord_username}</span>}
                        {entry.discord_id && <span>ID Discord: {entry.discord_id}</span>}
                        <span>Depuis {timeAgo(entry.accepted_at || entry.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {isOwner && (
                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                      {entry.is_suspended ? (
                        <button
                          type="button"
                          onClick={() => onSuspend(entry.user_id, getTeamDisplayName(entry), false, 0)}
                          disabled={saving.startsWith(`suspend:${entry.user_id}:`)}
                          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-mono text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                        >
                          Réactiver
                        </button>
                      ) : (
                        SUSPEND_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => onSuspend(entry.user_id, getTeamDisplayName(entry), true, option.value)}
                            disabled={saving.startsWith(`suspend:${entry.user_id}:`)}
                            className={`rounded-xl border px-3 py-2 text-[11px] font-mono transition-all disabled:opacity-40 ${
                              option.value === 0
                                ? 'border-amber-400/20 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                                : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-amber-400/20 hover:text-amber-200'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveMember(entry.user_id, getTeamDisplayName(entry))}
                        disabled={saving === `remove:${entry.user_id}`}
                        className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] font-mono text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-40"
                      >
                        Retirer
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SpacesTab({ user, joinCode, setJoinCode, saving, ownGuilds, sharedGuilds, selectedGuildId, onSelectGuild, onRedeemCode, onConnectDiscord }) {
  return (
    <div className="space-y-5">
      <WorkspaceSwitchCard
        ownGuilds={ownGuilds}
        sharedGuilds={sharedGuilds}
        selectedGuildId={selectedGuildId}
        onSelectGuild={onSelectGuild}
      />
      <JoinTeamCard
        user={user}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        saving={saving}
        onRedeem={onRedeemCode}
        onConnectDiscord={onConnectDiscord}
      />
    </div>
  )
}

function AccessCodesTab({ saving, codeForm, setCodeForm, joinCodes, onCreateCode, onRevokeCode }) {
  return (
    <div className="space-y-5">
      <div className="spotlight-card p-5 space-y-4">
        <SectionTitle
          icon={Shield}
          title="Codes d’accès"
          subtitle="Crée un code sécurisé, copie-le et partage-le à une seule personne."
          tone="violet"
        />
        <div className="grid gap-3 lg:grid-cols-[220px_auto]">
          <select
            className="select-field"
            value={codeForm.expires_in_hours}
            onChange={(event) => setCodeForm((current) => ({ ...current, expires_in_hours: Number(event.target.value) }))}
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onCreateCode}
            disabled={saving === 'code:create'}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-500/10 px-5 py-3 text-sm font-mono text-violet-300 transition-all hover:bg-violet-500/20 disabled:opacity-40"
          >
            {saving === 'code:create' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {saving === 'code:create' ? 'Génération...' : 'Générer un code'}
          </button>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-white/38">
          Chaque code donne un accès équipe complet, hors sauvegardes et activité privée.
        </div>
        {joinCodes.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 text-sm text-white/35">
            Aucun code actif pour l'instant.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {joinCodes.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-700 text-white tracking-[0.18em] break-all">{entry.code}</p>
                    <p className="mt-1 text-xs text-white/32 font-mono">
                      {entry.expires_at ? `Expire ${formatRelativeTime(entry.expires_at)}` : 'Sans expiration'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => copyText(entry.code, 'Code copié')}
                      className="inline-flex items-center justify-center rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-2 text-xs font-mono text-neon-cyan transition-all hover:bg-neon-cyan/20"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevokeCode(entry.id)}
                      disabled={saving === `code:revoke:${entry.id}`}
                      className="inline-flex items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-mono text-red-300 transition-all hover:bg-red-500/20 disabled:opacity-40"
                    >
                      {saving === `code:revoke:${entry.id}` ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/35">
                  <span>Créé {timeAgo(entry.created_at)}</span>
                  <span>Par {entry.created_by_display_name || entry.created_by_username || 'Inconnu'}</span>
                  <span className="font-mono">Usage unique</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BackupsTab({ snapshots, saving, snapshotLabel, setSnapshotLabel, locale, hasCollaborators, onCreateSnapshot, onRestoreSnapshot, onDeleteSnapshot }) {
  return (
    <div className="space-y-5">

      {/* ── Private banner ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-amber-400/15 bg-gradient-to-r from-amber-500/[0.06] to-transparent p-4 flex items-center gap-3">
        <Lock className="w-5 h-5 text-amber-300 shrink-0" />
        <div>
          <p className="text-sm font-display font-600 text-amber-200">Zone privee — proprietaire uniquement</p>
          <p className="text-xs text-amber-200/50 mt-0.5">Les collaborateurs ne voient pas cette section. Tes sauvegardes restent confidentielles.</p>
        </div>
      </div>

      {/* ── Create snapshot ───────────────────────────────────────────────── */}
      <div className="spotlight-card p-5 space-y-4">
        <SectionTitle
          icon={Save}
          title="Nouvelle sauvegarde"
          subtitle="Capture l'etat actuel des commandes, modules et reglages"
          tone="violet"
        />
        <div className="flex gap-3">
          <input
            className="input-field flex-1"
            placeholder="Nom de la sauvegarde (optionnel)"
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreateSnapshot()}
          />
          <button
            type="button"
            onClick={onCreateSnapshot}
            disabled={saving === 'snapshot:create'}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-violet-500/20 to-violet-600/20 border border-violet-400/25 text-violet-300 font-mono text-sm hover:from-violet-500/30 hover:to-violet-600/30 transition-all disabled:opacity-40 shrink-0"
          >
            {saving === 'snapshot:create' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving === 'snapshot:create' ? 'Creation...' : 'Sauvegarder'}
          </button>
        </div>

        {/* What's backed up */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/25 mb-2">Contenu de la sauvegarde</p>
          <div className="flex flex-wrap gap-2">
            {[
              { icon: Terminal, label: 'Commandes' },
              { icon: Package, label: 'Modules' },
              { icon: Shield, label: 'Protections' },
              { icon: Sparkles, label: 'Reglages DM' },
              { icon: ScrollText, label: 'Logs config' },
            ].map(({ icon: I, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/40 font-mono">
                <I className="w-3 h-3" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Snapshots list ────────────────────────────────────────────────── */}
      <div className="spotlight-card p-5 space-y-4">
        <SectionTitle
          icon={History}
          title={`Historique${snapshots.length > 0 ? ` (${snapshots.length})` : ''}`}
          subtitle="Restaure un etat precedent si un collaborateur casse quelque chose"
          tone="amber"
        />

        {snapshots.length === 0 ? (
          <EmptyState
            icon={Database}
            message={hasCollaborators
              ? 'Aucune sauvegarde manuelle. Cree-en une pour proteger ta configuration.'
              : 'Les sauvegardes apparaitront ici. Une sauvegarde automatique est creee au premier partage.'}
          />
        ) : (
          <div className="space-y-3">
            {snapshots.map((snapshot, index) => (
              <motion.div
                key={snapshot.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.05, 0.2) }}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03] transition-all"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-violet-400 shrink-0" />
                        <p className="font-display font-600 text-white text-sm truncate">{snapshot.label || 'Sauvegarde sans nom'}</p>
                      </div>
                      <div className="flex flex-wrap gap-x-3 mt-1.5 text-[11px] text-white/25 font-mono">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="w-3 h-3" />
                          {timeAgo(snapshot.created_at)}
                        </span>
                        <span>Par {snapshot.created_by_username || 'Inconnu'}</span>
                      </div>
                    </div>
                    <Avatar src={snapshot.created_by_avatar_url} label={snapshot.created_by_username} size="w-9 h-9" />
                  </div>

                  {/* Snapshot stats */}
                  <div className="flex gap-2 mt-3">
                    {[
                      { label: 'Modules', value: snapshot.module_count },
                      { label: 'Commandes', value: snapshot.command_count },
                      { label: 'Extras', value: Number(!!snapshot.has_log_channel) + Number(!!snapshot.has_dm_settings) },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex-1 rounded-lg border border-white/[0.06] bg-black/15 px-3 py-2 text-center">
                        <p className="text-[10px] font-mono uppercase text-white/25 tracking-wider">{label}</p>
                        <p className="text-white font-display font-700 text-base mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => onRestoreSnapshot(snapshot)}
                      disabled={saving === `snapshot:restore:${snapshot.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 text-xs font-mono hover:bg-emerald-400/20 transition-all disabled:opacity-40"
                    >
                      {saving === `snapshot:restore:${snapshot.id}` ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      Restaurer
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSnapshot(snapshot)}
                      disabled={saving === `snapshot:delete:${snapshot.id}`}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/15 bg-red-500/[0.06] text-red-400 text-xs font-mono hover:bg-red-500/15 transition-all disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT TAB (Owner-only)
// ══════════════════════════════════════════════════════════════════════════════

function AuditTab({ auditData, locale, onPageChange }) {
  const { items, total, page, limit = 30 } = auditData
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="space-y-5">

      {/* ── Private banner ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-violet-400/15 bg-gradient-to-r from-violet-500/[0.06] to-transparent p-4 flex items-center gap-3">
        <Eye className="w-5 h-5 text-violet-300 shrink-0" />
        <div>
          <p className="text-sm font-display font-600 text-violet-200">Journal d'activite — proprietaire uniquement</p>
          <p className="text-xs text-violet-200/50 mt-0.5">Chaque action de l'equipe est enregistree ici pour identifier qui a modifie quoi.</p>
        </div>
      </div>

      <div className="spotlight-card p-5 space-y-4">
        <SectionTitle
          icon={ScrollText}
          title={`Historique des actions${total > 0 ? ` (${total})` : ''}`}
          subtitle="Toutes les modifications de l'equipe, en temps reel"
          tone="cyan"
          action={
            totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                  className="p-2 rounded-lg border border-white/[0.06] text-white/40 hover:text-white disabled:opacity-25 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-white/30 font-mono px-2">{page}/{totalPages}</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                  className="p-2 rounded-lg border border-white/[0.06] text-white/40 hover:text-white disabled:opacity-25 transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )
          }
        />

        {items.length === 0 ? (
          <EmptyState icon={ScrollText} message="Aucune activite enregistree pour le moment." />
        ) : (
          <div className="space-y-1.5">
            {items.map((logEntry, index) => {
              const config = AUDIT_ACTION_CONFIG[logEntry.action_type] || {
                label: logEntry.action_type,
                icon: AlertTriangle,
                bg: 'bg-white/[0.04]',
                border: 'border-white/10',
                text: 'text-white/50',
              }
              const Icon = config.icon

              return (
                <motion.div
                  key={logEntry.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.025, 0.15) }}
                  className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-white/[0.04] hover:border-white/[0.08] bg-white/[0.01] hover:bg-white/[0.03] transition-all group"
                >
                  <Avatar
                    src={logEntry.actor_avatar_url}
                    label={logEntry.actor_display_name || logEntry.actor_username}
                    size="w-9 h-9"
                  />
                  <div className={`w-8 h-8 rounded-lg ${config.bg} ${config.border} border flex items-center justify-center shrink-0`}>
                    <Icon className={`w-3.5 h-3.5 ${config.text}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-600 text-white text-[13px]">{logEntry.actor_display_name || logEntry.actor_username || 'Inconnu'}</span>
                      <span className={`text-[11px] font-mono ${config.text}`}>{config.label}</span>
                      {logEntry.target && (
                        <span className="text-[11px] text-white/30 font-mono truncate max-w-[200px]">→ {logEntry.target}</span>
                      )}
                    </div>
                    {logEntry.details && Object.keys(logEntry.details).length > 0 && (
                      <p className="text-[11px] text-white/20 font-mono mt-0.5 truncate">
                        {describeAuditDetails(logEntry.details)}
                      </p>
                    )}
                  </div>

                  <span className="text-[11px] text-white/20 font-mono whitespace-nowrap shrink-0 group-hover:text-white/35 transition-colors">
                    {timeAgo(logEntry.created_at)}
                  </span>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
